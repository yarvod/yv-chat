import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserVideoNoteRecorder } from '../app/infrastructure/browser/video-note-recorder'
import type { VideoNoteCaptureError } from '../app/infrastructure/browser/video-note-recorder'

const originalSrcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject')

class FakeTrack {
  readonly stop = vi.fn()
  readonly applyConstraints = vi.fn().mockResolvedValue(undefined)
  contentHint = ''

  constructor(readonly kind: 'audio' | 'video') {}
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}

  getTracks(): FakeTrack[] {
    return [...this.tracks]
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter(track => track.kind === 'audio')
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter(track => track.kind === 'video')
  }
}

class FakeMediaRecorder extends EventTarget {
  static lastOptions: MediaRecorderOptions | undefined
  static isTypeSupported(mimeType: string): boolean {
    return mimeType.startsWith('video/mp4')
  }

  readonly mimeType: string
  state: RecordingState = 'inactive'

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    FakeMediaRecorder.lastOptions = options
    this.mimeType = options?.mimeType ?? 'video/mp4'
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    const data = new Event('dataavailable')
    Object.defineProperty(data, 'data', {
      value: new Blob(['bounded-recording'], { type: this.mimeType }),
    })
    this.dispatchEvent(data)
    this.dispatchEvent(new Event('stop'))
  }
}

describe('browser video note recorder', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get() { return Reflect.get(this, '__testStream') ?? null },
      set(value: MediaStream | null) { Reflect.set(this, '__testStream', value) },
    })
  })

  afterEach(() => {
    if (originalSrcObject) {
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', originalSrcObject)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requests a bounded high-quality profile, negotiates MP4 and stops every capture track', async () => {
    const videoTrack = new FakeTrack('video')
    const audioTrack = new FakeTrack('audio')
    const canvasVideoTrack = new FakeTrack('video')
    const canvasContext = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    let capturedCanvas: { width: number, height: number, frameRate?: number } | null = null
    let scheduledDraw: FrameRequestCallback | null = null
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext)
    vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(function (frameRate) {
      capturedCanvas = { width: this.width, height: this.height, frameRate }
      return new FakeMediaStream([canvasVideoTrack]) as unknown as MediaStream
    })
    vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      scheduledDraw = callback
      return 1
    })
    const getUserMedia = vi.fn().mockResolvedValue(
      new FakeMediaStream([videoTrack, audioTrack]),
    )
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const recorder = new BrowserVideoNoteRecorder()

    const session = await recorder.open('user')
    session.start()
    expect(canvasContext.drawImage).toHaveBeenCalledTimes(1)
    scheduledDraw?.(110)
    expect(canvasContext.drawImage).toHaveBeenCalledTimes(1)
    scheduledDraw?.(134)
    expect(canvasContext.drawImage).toHaveBeenCalledTimes(2)
    const result = await session.stop()

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ channelCount: 1, sampleRate: 48_000 }),
      video: expect.objectContaining({
        facingMode: { ideal: 'user' },
        width: { ideal: 720, max: 1_080 },
        height: { ideal: 720, max: 1_080 },
        frameRate: { ideal: 30, max: 30 },
      }),
    })
    expect(FakeMediaRecorder.lastOptions).toMatchObject({
      mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      videoBitsPerSecond: 900_000,
      audioBitsPerSecond: 96_000,
    })
    const maximumTargetBytes = (
      Number(FakeMediaRecorder.lastOptions?.videoBitsPerSecond)
      + Number(FakeMediaRecorder.lastOptions?.audioBitsPerSecond)
    ) * 60 / 8
    expect(maximumTargetBytes).toBeLessThan(8 * 1024 * 1024)
    expect(videoTrack.contentHint).toBe('motion')
    expect(audioTrack.contentHint).toBe('speech')
    expect(canvasVideoTrack.contentHint).toBe('motion')
    expect(capturedCanvas).toEqual({ width: 720, height: 720, frameRate: 30 })
    expect(canvasContext.imageSmoothingEnabled).toBe(true)
    expect(canvasContext.imageSmoothingQuality).toBe('high')
    expect(result).toMatchObject({ contentType: 'video/mp4', durationSeconds: 1 })
    expect(result.body.size).toBeGreaterThan(0)
    expect(videoTrack.stop).toHaveBeenCalled()
    expect(audioTrack.stop).toHaveBeenCalled()
    expect(canvasVideoTrack.stop).toHaveBeenCalled()
  })

  it('maps denied permission to a recoverable typed error', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(
          new DOMException('denied', 'NotAllowedError'),
        ),
      },
    })
    const recorder = new BrowserVideoNoteRecorder()

    await expect(recorder.open('environment')).rejects.toEqual(
      expect.objectContaining<Partial<VideoNoteCaptureError>>({ code: 'permission' }),
    )
  })

  it('recognizes a cross-realm-style PWA permission denial by its error name', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue({ name: 'PermissionDeniedError' }),
      },
    })
    const recorder = new BrowserVideoNoteRecorder()

    await expect(recorder.open('user')).rejects.toEqual(
      expect.objectContaining<Partial<VideoNoteCaptureError>>({ code: 'permission' }),
    )
  })
})
