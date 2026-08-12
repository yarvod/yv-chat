import {
  VIDEO_NOTE_MAX_BYTES,
  type RecordedVideoNote,
  type VideoNoteFacingMode,
  type VideoNoteRecorder,
  type VideoNoteRecordingSession,
} from '../../application/ports/video-note-recorder'

const CAPTURE_SIZE = 480
const CAPTURE_FRAME_RATE = 20
const VIDEO_BITS_PER_SECOND = 420_000
const AUDIO_BITS_PER_SECOND = 48_000
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm',
] as const

type SessionState = 'preview' | 'recording' | 'stopping' | 'closed'

export class VideoNoteCaptureError extends Error {
  constructor(readonly code: 'unsupported' | 'permission' | 'capture' | 'too-large') {
    super(`video note capture failed: ${code}`)
    this.name = 'VideoNoteCaptureError'
  }
}

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

function cameraConstraints(facingMode: VideoNoteFacingMode): MediaTrackConstraints {
  return {
    facingMode: { ideal: facingMode },
    width: { ideal: CAPTURE_SIZE, max: 720 },
    height: { ideal: CAPTURE_SIZE, max: 720 },
    aspectRatio: { ideal: 1 },
    frameRate: { ideal: CAPTURE_FRAME_RATE, max: 24 },
  }
}

function baseVideoType(value: string): 'video/mp4' | 'video/webm' {
  const base = value.split(';', 1)[0]?.trim().toLowerCase()
  if (base === 'video/mp4' || base === 'video/webm') return base
  throw new VideoNoteCaptureError('unsupported')
}

function createRecorder(stream: MediaStream): MediaRecorder {
  const options = {
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  }
  for (const mimeType of MIME_CANDIDATES) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue
    try {
      return new MediaRecorder(stream, { ...options, mimeType })
    } catch {
      // A positive capability check may still fail under current device resources.
    }
  }
  try {
    return new MediaRecorder(stream, options)
  } catch {
    throw new VideoNoteCaptureError('unsupported')
  }
}

function drawSquareFrame(
  context: CanvasRenderingContext2D,
  source: HTMLVideoElement,
  facingMode: VideoNoteFacingMode,
): void {
  const width = source.videoWidth
  const height = source.videoHeight
  if (width <= 0 || height <= 0) return
  const side = Math.min(width, height)
  const sourceX = (width - side) / 2
  const sourceY = (height - side) / 2
  context.save()
  if (facingMode === 'user') {
    context.translate(CAPTURE_SIZE, 0)
    context.scale(-1, 1)
  }
  context.drawImage(
    source,
    sourceX,
    sourceY,
    side,
    side,
    0,
    0,
    CAPTURE_SIZE,
    CAPTURE_SIZE,
  )
  context.restore()
}

class BrowserVideoNoteSession implements VideoNoteRecordingSession {
  private state: SessionState = 'preview'
  private cameraStream: MediaStream
  private readonly microphoneTrack: MediaStreamTrack
  private preview: MediaStream
  private readonly sourceVideo: HTMLVideoElement
  private recorder: MediaRecorder | null = null
  private recordingStream: MediaStream | null = null
  private canvasStream: MediaStream | null = null
  private chunks: Blob[] = []
  private recordingStartedAt = 0
  private animationFrame: number | null = null
  private completion: Promise<Blob> | null = null
  private resolveCompletion: ((blob: Blob) => void) | null = null
  private rejectCompletion: ((error: Error) => void) | null = null
  private currentFacingMode: VideoNoteFacingMode

  private constructor(stream: MediaStream, facingMode: VideoNoteFacingMode) {
    const microphoneTrack = stream.getAudioTracks()[0]
    const cameraTrack = stream.getVideoTracks()[0]
    if (!microphoneTrack || !cameraTrack) {
      stopTracks(stream)
      throw new VideoNoteCaptureError('capture')
    }
    this.cameraStream = new MediaStream([cameraTrack])
    this.microphoneTrack = microphoneTrack
    this.preview = new MediaStream([cameraTrack])
    this.currentFacingMode = facingMode
    this.sourceVideo = document.createElement('video')
    this.sourceVideo.muted = true
    this.sourceVideo.playsInline = true
    this.sourceVideo.autoplay = true
    this.sourceVideo.srcObject = this.cameraStream
  }

  static async create(
    stream: MediaStream,
    facingMode: VideoNoteFacingMode,
  ): Promise<BrowserVideoNoteSession> {
    const session = new BrowserVideoNoteSession(stream, facingMode)
    try {
      await session.sourceVideo.play()
      return session
    } catch {
      await session.cancel()
      throw new VideoNoteCaptureError('capture')
    }
  }

  get previewStream(): MediaStream {
    return this.preview
  }

  get facingMode(): VideoNoteFacingMode {
    return this.currentFacingMode
  }

  get recording(): boolean {
    return this.state === 'recording' || this.state === 'stopping'
  }

  start(): void {
    if (this.state !== 'preview') throw new VideoNoteCaptureError('capture')
    this.chunks = []
    this.recordingStream = this.buildRecordingStream()
    this.recorder = createRecorder(this.recordingStream)
    this.completion = new Promise<Blob>((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })
    this.recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) this.chunks.push(event.data)
    })
    this.recorder.addEventListener('error', () => {
      this.rejectCompletion?.(new VideoNoteCaptureError('capture'))
    }, { once: true })
    this.recorder.addEventListener('stop', () => {
      try {
        const contentType = baseVideoType(this.recorder?.mimeType || this.chunks[0]?.type || '')
        this.resolveCompletion?.(new Blob(this.chunks, { type: contentType }))
      } catch {
        this.rejectCompletion?.(new VideoNoteCaptureError('unsupported'))
      }
    }, { once: true })
    this.recordingStartedAt = performance.now()
    this.state = 'recording'
    try {
      this.recorder.start(1_000)
    } catch {
      this.state = 'preview'
      this.cleanupRecordingStream()
      throw new VideoNoteCaptureError('capture')
    }
  }

  async switchCamera(): Promise<MediaStream> {
    if (this.state === 'closed' || this.state === 'stopping') {
      throw new VideoNoteCaptureError('capture')
    }
    const nextFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user'
    if (this.state === 'recording' && this.canvasStream === null) {
      const track = this.cameraStream.getVideoTracks()[0]
      if (!track) throw new VideoNoteCaptureError('capture')
      try {
        await track.applyConstraints({ facingMode: { exact: nextFacingMode } })
        this.currentFacingMode = nextFacingMode
        return this.preview
      } catch {
        throw new VideoNoteCaptureError('capture')
      }
    }
    let nextStream: MediaStream
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(nextFacingMode),
      })
    } catch {
      throw new VideoNoteCaptureError('capture')
    }
    const nextTrack = nextStream.getVideoTracks()[0]
    if (!nextTrack) {
      stopTracks(nextStream)
      throw new VideoNoteCaptureError('capture')
    }
    const previousCamera = this.cameraStream
    this.cameraStream = new MediaStream([nextTrack])
    this.preview = new MediaStream([nextTrack])
    this.currentFacingMode = nextFacingMode
    this.sourceVideo.srcObject = this.cameraStream
    try {
      await this.sourceVideo.play()
    } catch {
      stopTracks(this.cameraStream)
      this.cameraStream = previousCamera
      this.preview = new MediaStream(previousCamera.getVideoTracks())
      this.currentFacingMode = nextFacingMode === 'user' ? 'environment' : 'user'
      this.sourceVideo.srcObject = previousCamera
      throw new VideoNoteCaptureError('capture')
    }
    stopTracks(previousCamera)
    return this.preview
  }

  async stop(): Promise<RecordedVideoNote> {
    if (this.state !== 'recording' || !this.recorder || !this.completion) {
      throw new VideoNoteCaptureError('capture')
    }
    this.state = 'stopping'
    const durationMilliseconds = Math.max(1, performance.now() - this.recordingStartedAt)
    this.recorder.stop()
    try {
      const body = await this.completion
      if (body.size <= 0) throw new VideoNoteCaptureError('capture')
      if (body.size > VIDEO_NOTE_MAX_BYTES) throw new VideoNoteCaptureError('too-large')
      return {
        body,
        contentType: baseVideoType(body.type),
        durationSeconds: Math.max(1, Math.min(60, Math.ceil(durationMilliseconds / 1_000))),
      }
    } finally {
      this.close()
    }
  }

  async cancel(): Promise<void> {
    if (this.state === 'closed') return
    if (this.recorder?.state === 'recording') {
      this.recorder.stop()
      try {
        await this.completion
      } catch {
        // Cancellation intentionally discards both valid and failed capture output.
      }
    }
    this.close()
  }

  private buildRecordingStream(): MediaStream {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context && typeof canvas.captureStream === 'function') {
      canvas.width = CAPTURE_SIZE
      canvas.height = CAPTURE_SIZE
      const draw = () => {
        drawSquareFrame(context, this.sourceVideo, this.currentFacingMode)
        this.animationFrame = requestAnimationFrame(draw)
      }
      draw()
      this.canvasStream = canvas.captureStream(CAPTURE_FRAME_RATE)
      const videoTrack = this.canvasStream.getVideoTracks()[0]
      if (videoTrack) return new MediaStream([videoTrack, this.microphoneTrack])
      stopTracks(this.canvasStream)
      this.canvasStream = null
    }
    const cameraTrack = this.cameraStream.getVideoTracks()[0]
    if (!cameraTrack) throw new VideoNoteCaptureError('capture')
    return new MediaStream([cameraTrack, this.microphoneTrack])
  }

  private cleanupRecordingStream(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    for (const track of this.recordingStream?.getVideoTracks() ?? []) {
      if (!this.cameraStream.getTracks().includes(track)) track.stop()
    }
    this.recordingStream = null
    this.canvasStream = null
  }

  private close(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.cleanupRecordingStream()
    stopTracks(this.cameraStream)
    this.microphoneTrack.stop()
    this.preview = new MediaStream()
    this.sourceVideo.pause()
    this.sourceVideo.srcObject = null
  }
}

export class BrowserVideoNoteRecorder implements VideoNoteRecorder {
  isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && typeof navigator.mediaDevices?.getUserMedia === 'function'
      && typeof MediaRecorder !== 'undefined'
      && typeof MediaRecorder.isTypeSupported === 'function'
  }

  async open(facingMode: VideoNoteFacingMode): Promise<VideoNoteRecordingSession> {
    if (!this.isSupported()) throw new VideoNoteCaptureError('unsupported')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48_000,
        },
        video: cameraConstraints(facingMode),
      })
    } catch (error) {
      const denied = error instanceof DOMException
        && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      throw new VideoNoteCaptureError(denied ? 'permission' : 'capture')
    }
    return await BrowserVideoNoteSession.create(stream, facingMode)
  }
}
