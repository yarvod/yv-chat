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
  autoplay = false
  srcObject: MediaStream | null = null
  play = vi.fn(async () => undefined)
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
    const service = new BrowserVoiceCallService(signaling, config)
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
    await service.accept()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    expect(signals.at(-1)).toMatchObject({ type: 'call_answer', sdp: 'answer-sdp' })
  })
})
