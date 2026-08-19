import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OutgoingCallSignal } from '../app/application/ports/realtime-gateway'
import { BrowserVoiceCallService } from '../app/infrastructure/webrtc/browser-voice-call-service'

class FakeTrack {
  enabled = true
  stop = vi.fn()
}

class FakeStream {
  track = new FakeTrack()
  getAudioTracks(): MediaStreamTrack[] { return [this.track as unknown as MediaStreamTrack] }
  getTracks(): MediaStreamTrack[] { return this.getAudioTracks() }
}

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = []
  connectionState: RTCPeerConnectionState = 'new'
  remoteDescription: RTCSessionDescription | null = null
  localDescription: RTCSessionDescription | null = null
  addTrack = vi.fn()
  addIceCandidate = vi.fn(async () => undefined)
  close = vi.fn(() => { this.connectionState = 'closed' })

  constructor(readonly configuration: RTCConfiguration) {
    super()
    FakePeerConnection.instances.push(this)
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-sdp' }
  }

  async setLocalDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = value as RTCSessionDescription
  }

  async setRemoteDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = value as RTCSessionDescription
  }
}

class FakeAudio {
  static instances: FakeAudio[] = []
  autoplay = false
  srcObject: MediaStream | null = null
  play = vi.fn(async () => undefined)
  setSinkId = vi.fn(async (_deviceId: string) => undefined)

  constructor() { FakeAudio.instances.push(this) }
}

function fakeTones() {
  return {
    unlock: vi.fn(),
    startIncoming: vi.fn(),
    startOutgoing: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('browser voice calls', () => {
  const signals: OutgoingCallSignal[] = []
  const stream = new FakeStream()
  const signaling = {
    sendCallSignal(signal: OutgoingCallSignal): boolean {
      signals.push(signal)
      return true
    },
  }
  const config = {
    async load() {
      return {
        enabled: true,
        configuration: { iceServers: [{ urls: ['stun:example.test'] }] },
      }
    },
  }

  beforeEach(() => {
    signals.length = 0
    FakePeerConnection.instances.length = 0
    FakeAudio.instances.length = 0
    stream.track.enabled = true
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.stubGlobal('Audio', FakeAudio)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    })
  })

  it('creates an audio-only encrypted WebRTC offer and handles answer/mute/hangup', async () => {
    const service = new BrowserVoiceCallService(signaling, config)
    const states: string[] = []
    service.subscribe(state => states.push(state.phase))

    await service.start('conversation')
    const offer = signals[0]
    expect(offer).toMatchObject({
      type: 'call_offer',
      version: 1,
      conversation_id: 'conversation',
      sdp: 'offer-sdp',
    })
    expect(FakePeerConnection.instances[0]?.configuration).toEqual({
      iceServers: [{ urls: ['stun:example.test'] }],
    })
    expect(states).toContain('outgoing')

    await service.apply({
      type: 'call_answer',
      version: 1,
      eventId: 'event',
      conversationId: 'conversation',
      callId: offer?.call_id ?? '',
      actorUserId: 'bob',
      actorDeviceId: 'bob-phone',
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
    })
    expect(FakePeerConnection.instances[0]?.remoteDescription?.sdp).toBe('answer-sdp')
    service.toggleMute()
    expect(stream.track.enabled).toBe(false)
    service.hangup()
    expect(signals.at(-1)).toMatchObject({ type: 'call_ended', reason: 'hangup' })
    expect(stream.track.stop).toHaveBeenCalled()
  })

  it('does not request microphone until an incoming call is accepted', async () => {
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia)
    const tones = fakeTones()
    const service = new BrowserVoiceCallService(signaling, config, null, tones)
    await service.apply({
      type: 'call_offer',
      version: 1,
      eventId: 'event',
      conversationId: 'conversation',
      callId: 'call',
      actorUserId: 'alice',
      actorDeviceId: 'alice-phone',
      sdp: 'offer-sdp',
      candidate: null,
      reason: null,
    })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(tones.startIncoming).toHaveBeenCalledOnce()
    await service.accept()
    expect(tones.stop).toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    expect(signals.at(-1)).toMatchObject({ type: 'call_answer', sdp: 'answer-sdp' })
  })

  it('plays ringback, follows new audio outputs and records one encrypted-call summary', async () => {
    const listeners = new Map<string, EventListener>()
    let audioOutputs: MediaDeviceInfo[] = [{
      kind: 'audiooutput',
      deviceId: 'bluetooth-headset',
      groupId: 'headset',
      label: 'Bluetooth наушники',
      toJSON: () => ({}),
    } as MediaDeviceInfo]
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream),
        enumerateDevices: vi.fn(async () => audioOutputs),
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          listeners.set(type, listener)
        }),
        removeEventListener: vi.fn((type: string) => listeners.delete(type)),
      },
    })
    const recordHistory = vi.fn(async () => true)
    const tones = fakeTones()
    const service = new BrowserVoiceCallService(signaling, config, recordHistory, tones)
    let latest = null
    service.subscribe(state => { latest = state })

    await service.start('conversation')
    expect(tones.unlock).toHaveBeenCalled()
    expect(tones.startOutgoing).toHaveBeenCalledOnce()
    expect(latest).toMatchObject({
      audioOutputSupported: true,
      audioOutputs: [{
        deviceId: 'bluetooth-headset',
        label: 'Bluetooth наушники',
        kind: 'bluetooth',
      }],
    })
    await service.selectAudioOutput('bluetooth-headset')
    expect(FakeAudio.instances[0]?.setSinkId).toHaveBeenCalledWith('bluetooth-headset')
    audioOutputs = []
    listeners.get('devicechange')?.(new Event('devicechange'))
    await vi.waitFor(() => expect(latest).toMatchObject({ selectedAudioOutputId: '' }))
    expect(FakeAudio.instances[0]?.setSinkId).toHaveBeenCalledWith('')

    const callId = signals.find(signal => signal.type === 'call_offer')?.call_id ?? ''
    await service.apply({
      type: 'call_answer',
      version: 1,
      eventId: 'event',
      conversationId: 'conversation',
      callId,
      actorUserId: 'bob',
      actorDeviceId: 'bob-phone',
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
    })
    const peer = FakePeerConnection.instances[0]!
    peer.connectionState = 'connected'
    peer.dispatchEvent(new Event('connectionstatechange'))
    service.hangup()

    expect(recordHistory).toHaveBeenCalledOnce()
    expect(recordHistory).toHaveBeenCalledWith('conversation', {
      callId,
      outcome: 'completed',
      durationSeconds: 1,
    })
    expect(tones.stop).toHaveBeenCalled()
  })

  it('uses the browser output picker and exposes the chosen route', async () => {
    const selectAudioOutput = vi.fn(async () => ({
      kind: 'audiooutput',
      deviceId: 'phone-receiver',
      groupId: 'phone',
      label: 'Разговорный динамик телефона',
      toJSON: () => ({}),
    } as MediaDeviceInfo))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream),
        enumerateDevices: vi.fn(async () => []),
        selectAudioOutput,
      },
    })
    const service = new BrowserVoiceCallService(signaling, config)
    let latest = null
    service.subscribe(state => { latest = state })

    await service.start('conversation')
    expect(latest).toMatchObject({
      audioOutputSupported: true,
      audioOutputPickerSupported: true,
    })

    await service.requestAudioOutput()

    expect(selectAudioOutput).toHaveBeenCalledOnce()
    expect(FakeAudio.instances[0]?.setSinkId).toHaveBeenCalledWith('phone-receiver')
    expect(latest).toMatchObject({
      selectedAudioOutputId: 'phone-receiver',
      audioOutputs: [{
        deviceId: 'phone-receiver',
        label: 'Разговорный динамик телефона',
        kind: 'earpiece',
      }],
    })
    service.reset()
  })
})
