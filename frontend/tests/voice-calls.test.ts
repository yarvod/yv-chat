import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OutgoingCallSignal } from '../app/application/ports/realtime-gateway'
import type { NativeCallAudioPort } from '../app/application/ports/native-call-audio'
import { BrowserVoiceCallService } from '../app/infrastructure/webrtc/browser-voice-call-service'

const ALICE_USER = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const ALICE_DEVICE = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const BOB_USER = 'abfef0af-10d0-4655-b4c7-84b3b418e4b7'
const BOB_DEVICE = 'd44483ee-2c69-4eef-aeba-5ce92bc9181d'
const CONVERSATION = 'f6a5941b-c417-4e50-a69c-9a30bd7ed28c'
const SIGNATURE = new Uint8Array(64).fill(7)

let trackSequence = 0

class FakeTrack extends EventTarget {
  readonly id = `track-${++trackSequence}`
  enabled = true
  muted = false
  readyState: MediaStreamTrackState = 'live'
  contentHint = ''
  stop = vi.fn(() => { this.readyState = 'ended' })

  constructor(readonly kind: 'audio' | 'video') { super() }
}

class FakeStream {
  readonly tracks: FakeTrack[]
  readonly track: FakeTrack

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks
    this.track = tracks[0] ?? new FakeTrack('audio')
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter(track => track.kind === 'audio') as unknown as MediaStreamTrack[]
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter(track => track.kind === 'video') as unknown as MediaStreamTrack[]
  }

  getTracks(): MediaStreamTrack[] { return this.tracks as unknown as MediaStreamTrack[] }
  addTrack(track: MediaStreamTrack): void { this.tracks.push(track as unknown as FakeTrack) }
}

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = []
  connectionState: RTCPeerConnectionState = 'new'
  remoteDescription: RTCSessionDescription | null = null
  localDescription: RTCSessionDescription | null = null
  addTrack = vi.fn()
  readonly videoSender = {
    replaceTrack: vi.fn(async (_track: MediaStreamTrack | null) => undefined),
    getParameters: vi.fn(() => ({ encodings: [] }) as RTCRtpSendParameters),
    setParameters: vi.fn(async (_parameters: RTCRtpSendParameters) => undefined),
  }
  readonly videoTransceiver = {
    sender: this.videoSender,
    receiver: { track: new FakeTrack('video') },
    direction: 'sendrecv' as RTCRtpTransceiverDirection,
  }
  addTransceiver = vi.fn(() => this.videoTransceiver)
  getTransceivers = vi.fn(() => (
    [this.videoTransceiver] as unknown as RTCRtpTransceiver[]
  ))
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

  emitIceCandidate(candidate = 'candidate:1 1 udp 1 192.0.2.1 5000 typ host'): void {
    this.dispatchEvent(Object.assign(new Event('icecandidate'), {
      candidate: { toJSON: () => ({ candidate, sdpMid: '0', sdpMLineIndex: 0 }) },
    }))
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

class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null
  readyState = 4
  videoWidth = 1280
  play = vi.fn(async () => undefined)
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

function fakeIdentity() {
  return {
    signCallBinding: vi.fn(async () => ({ signature: SIGNATURE.slice() })),
    verifyCallBinding: vi.fn(async () => ({ verified: true as const })),
    deriveCallVerificationCode: vi.fn(async () => ({ code: '1234 5678 9012' })),
  }
}

describe('browser voice calls', () => {
  const signals: OutgoingCallSignal[] = []
  const stream = new FakeStream([new FakeTrack('audio')])
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
    stream.track.readyState = 'live'
    stream.track.stop.mockClear()
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('MediaStream', FakeStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    })
  })

  it('creates an audio-only encrypted WebRTC offer and handles answer/mute/hangup', async () => {
    const identity = fakeIdentity()
    const service = new BrowserVoiceCallService(
      signaling, config, identity, ALICE_USER, ALICE_DEVICE,
    )
    const states: string[] = []
    service.subscribe(state => states.push(state.phase))

    await service.start(CONVERSATION, BOB_USER)
    const offer = signals[0]
    expect(offer).toMatchObject({
      type: 'call_offer',
      version: 2,
      conversation_id: CONVERSATION,
      sdp: 'offer-sdp',
      identity_signature: '07'.repeat(64),
    })
    expect(FakePeerConnection.instances[0]?.configuration).toEqual({
      iceServers: [{ urls: ['stun:example.test'] }],
    })
    expect(FakePeerConnection.instances[0]?.addTransceiver)
      .toHaveBeenCalledWith('video', { direction: 'sendrecv' })
    expect(states).toContain('outgoing')

    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer?.call_id ?? '',
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    expect(FakePeerConnection.instances[0]?.remoteDescription?.sdp).toBe('answer-sdp')
    service.toggleMute()
    expect(stream.track.enabled).toBe(false)
    service.hangup()
    expect(signals.at(-1)).toMatchObject({ type: 'call_ended', reason: 'hangup' })
    expect(stream.track.stop).toHaveBeenCalled()
  })

  it('uses native receiver/speaker routing and releases proximity state on hangup', async () => {
    let route: 'system' | 'earpiece' | 'speaker' = 'system'
    const state = () => ({
      selectedRoute: route,
      outputs: [
        { deviceId: 'native:earpiece', label: 'Разговорный динамик', kind: 'earpiece' as const },
        { deviceId: 'native:speaker', label: 'Встроенный динамик', kind: 'speaker' as const },
      ],
    })
    const native: NativeCallAudioPort = {
      activate: vi.fn(async () => state()),
      setVideo: vi.fn(async () => state()),
      selectRoute: vi.fn(async selected => {
        route = selected
        return state()
      }),
      setProximity: vi.fn(async () => undefined),
      deactivate: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => async () => undefined),
    }
    const service = new BrowserVoiceCallService(
      signaling,
      config,
      fakeIdentity(),
      ALICE_USER,
      ALICE_DEVICE,
      null,
      fakeTones(),
      native,
    )
    let latest = null
    service.subscribe(value => { latest = value })

    await service.start(CONVERSATION, BOB_USER)
    expect(native.activate).toHaveBeenCalledWith(false)
    expect(latest).toMatchObject({
      audioOutputSupported: true,
      audioOutputPickerSupported: false,
      selectedAudioOutputId: '',
    })
    await service.selectAudioOutput('native:earpiece')
    expect(native.selectRoute).toHaveBeenCalledWith('earpiece')
    expect(latest).toMatchObject({ selectedAudioOutputId: 'native:earpiece' })

    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const peer = FakePeerConnection.instances[0]!
    peer.connectionState = 'connected'
    peer.dispatchEvent(new Event('connectionstatechange'))
    await vi.waitFor(() => expect(native.setProximity).toHaveBeenCalledWith(true))

    service.hangup()
    await vi.waitFor(() => expect(native.deactivate).toHaveBeenCalledOnce())
    expect(native.setProximity).toHaveBeenCalledWith(false)
  })

  it('does not request microphone until an incoming call is accepted', async () => {
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia)
    const tones = fakeTones()
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), BOB_USER, BOB_DEVICE, null, tones,
    )
    await service.apply({
      type: 'call_offer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: '538998bb-1943-4cf3-beb1-8b87cadf0fc1',
      actorUserId: ALICE_USER,
      actorDeviceId: ALICE_DEVICE,
      sdp: 'offer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    expect(getUserMedia).not.toHaveBeenCalled()
    await service.toggleCamera()
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

  it('does not reject a shared incoming call when only this device is busy', async () => {
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), BOB_USER, BOB_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, ALICE_USER)
    expect(latest).toMatchObject({ phase: 'outgoing' })

    await service.apply({
      type: 'call_offer',
      version: 2,
      eventId: 'second-call-event',
      conversationId: '4a9a3ee6-075f-481a-9458-b805b6775a77',
      callId: '899c894a-2cf3-45f8-8619-c24a0bef9e6a',
      actorUserId: ALICE_USER,
      actorDeviceId: ALICE_DEVICE,
      sdp: 'second-offer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    expect(signals.map(signal => signal.type)).toEqual(['call_offer'])
    expect(latest).toMatchObject({ phase: 'outgoing' })
    service.reset()
  })

  it('binds callee camera to the video transceiver created by the remote offer', async () => {
    const camera = new FakeStream([new FakeTrack('video')])
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => (
      constraints.video === false ? stream : camera
    ) as unknown as MediaStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), BOB_USER, BOB_DEVICE,
    )
    await service.apply({
      type: 'call_offer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: '538998bb-1943-4cf3-beb1-8b87cadf0fc1',
      actorUserId: ALICE_USER,
      actorDeviceId: ALICE_DEVICE,
      sdp: 'offer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    await service.accept()
    const peer = FakePeerConnection.instances[0]!
    expect(peer.addTransceiver).not.toHaveBeenCalled()
    expect(peer.getTransceivers).toHaveBeenCalledOnce()
    expect(peer.videoTransceiver.direction).toBe('sendrecv')

    await service.toggleCamera()

    expect(peer.videoSender.replaceTrack).toHaveBeenCalledWith(camera.track)
    expect(signals.at(-1)).toMatchObject({ type: 'call_answer', sdp: 'answer-sdp' })
  })

  it('sends caller ICE only after the authenticated offer is accepted by signaling', async () => {
    let releaseSignature!: (value: { signature: Uint8Array }) => void
    const identity = fakeIdentity()
    identity.signCallBinding.mockImplementationOnce(() => new Promise(resolve => {
      releaseSignature = resolve
    }))
    const service = new BrowserVoiceCallService(
      signaling, config, identity, ALICE_USER, ALICE_DEVICE,
    )

    const start = service.start(CONVERSATION, BOB_USER)
    await vi.waitFor(() => expect(identity.signCallBinding).toHaveBeenCalledOnce())
    FakePeerConnection.instances[0]!.emitIceCandidate()
    expect(signals).toHaveLength(0)

    releaseSignature({ signature: SIGNATURE.slice() })
    await start

    expect(signals.map(signal => signal.type)).toEqual(['call_offer', 'ice_candidate'])
    service.reset()
  })

  it('sends callee ICE only after the authenticated answer is accepted by signaling', async () => {
    let releaseSignature!: (value: { signature: Uint8Array }) => void
    const identity = fakeIdentity()
    identity.signCallBinding.mockImplementationOnce(() => new Promise(resolve => {
      releaseSignature = resolve
    }))
    const service = new BrowserVoiceCallService(
      signaling, config, identity, BOB_USER, BOB_DEVICE,
    )
    await service.apply({
      type: 'call_offer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: '538998bb-1943-4cf3-beb1-8b87cadf0fc1',
      actorUserId: ALICE_USER,
      actorDeviceId: ALICE_DEVICE,
      sdp: 'offer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    const accept = service.accept()
    await vi.waitFor(() => expect(identity.signCallBinding).toHaveBeenCalledOnce())
    FakePeerConnection.instances[0]!.emitIceCandidate()
    expect(signals).toHaveLength(0)

    releaseSignature({ signature: SIGNATURE.slice() })
    await accept

    expect(signals.map(signal => signal.type)).toEqual(['call_answer', 'ice_candidate'])
    service.reset()
  })

  it('fails a verified call that never establishes a media connection', async () => {
    vi.useFakeTimers()
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    vi.advanceTimersByTime(30_000)

    expect(latest).toMatchObject({
      phase: 'error',
      notice: 'Не удалось установить защищённое соединение. Попробуйте ещё раз',
    })
    expect(signals.at(-1)).toMatchObject({ type: 'call_ended', reason: 'media_error' })
  })

  it('bounds recovery when an established media connection stays disconnected', async () => {
    vi.useFakeTimers()
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const peer = FakePeerConnection.instances[0]!
    peer.connectionState = 'connected'
    peer.dispatchEvent(new Event('connectionstatechange'))
    peer.connectionState = 'disconnected'
    peer.dispatchEvent(new Event('connectionstatechange'))
    expect(latest).toMatchObject({
      phase: 'connecting',
      notice: 'Восстанавливаем защищённое соединение…',
    })

    vi.advanceTimersByTime(15_000)

    expect(latest).toMatchObject({
      phase: 'error',
      notice: 'Не удалось установить защищённое соединение. Попробуйте ещё раз',
    })
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
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE, recordHistory, tones,
    )
    let latest = null
    service.subscribe(state => { latest = state })

    await service.start(CONVERSATION, BOB_USER)
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
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const peer = FakePeerConnection.instances[0]!
    peer.connectionState = 'connected'
    peer.dispatchEvent(new Event('connectionstatechange'))
    service.hangup()

    expect(recordHistory).toHaveBeenCalledOnce()
    expect(recordHistory).toHaveBeenCalledWith(CONVERSATION, {
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
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })

    await service.start(CONVERSATION, BOB_USER)
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

  it('rejects a signaling-tampered offer before ringing or requesting media', async () => {
    const tones = fakeTones()
    const identity = fakeIdentity()
    identity.verifyCallBinding.mockRejectedValueOnce(new Error('modified fingerprint'))
    const service = new BrowserVoiceCallService(
      signaling, config, identity, BOB_USER, BOB_DEVICE, null, tones,
    )
    let latest = null
    service.subscribe(state => { latest = state })

    await service.apply({
      type: 'call_offer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: '538998bb-1943-4cf3-beb1-8b87cadf0fc1',
      actorUserId: ALICE_USER,
      actorDeviceId: ALICE_DEVICE,
      sdp: 'tampered-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    expect(tones.startIncoming).not.toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(latest).toMatchObject({
      phase: 'error',
      notice: 'Не удалось подтвердить устройство звонящего',
    })
    expect(signals).toHaveLength(0)
  })

  it('does not apply a tampered answer from a compromised signaling relay', async () => {
    const identity = fakeIdentity()
    const service = new BrowserVoiceCallService(
      signaling, config, identity, ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    identity.verifyCallBinding.mockRejectedValueOnce(new Error('wrong device binding'))

    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'tampered-answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    expect(FakePeerConnection.instances[0]?.remoteDescription).toBeNull()
    expect(latest).toMatchObject({
      phase: 'error',
      identityVerified: false,
      notice: 'Не удалось подтвердить устройство собеседника',
    })
  })

  it('enables, switches and disables a bounded camera track without touching audio', async () => {
    const front = new FakeStream([new FakeTrack('video')])
    const rear = new FakeStream([new FakeTrack('video')])
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video === false) return stream as unknown as MediaStream
      return constraints.video && typeof constraints.video === 'object'
        && constraints.video.facingMode
        && JSON.stringify(constraints.video.facingMode).includes('environment')
        ? rear as unknown as MediaStream
        : front as unknown as MediaStream
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const localVideo = {
      srcObject: null,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement
    service.attachVideoElements(localVideo, null)

    await service.toggleCamera()
    const peer = FakePeerConnection.instances[0]!
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
    })
    expect(peer.videoSender.replaceTrack).toHaveBeenLastCalledWith(front.track)
    expect(peer.videoSender.setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 1_200_000, maxFramerate: 30 }],
      degradationPreference: 'balanced',
    })
    expect(localVideo.srcObject).toBe(front)
    expect(latest).toMatchObject({ cameraEnabled: true, cameraFacingMode: 'user' })

    await service.switchCamera()
    expect(peer.videoSender.replaceTrack).toHaveBeenLastCalledWith(rear.track)
    expect(front.track.stop).toHaveBeenCalledOnce()
    expect(latest).toMatchObject({ cameraEnabled: true, cameraFacingMode: 'environment' })

    await service.toggleCamera()
    expect(peer.videoSender.replaceTrack).toHaveBeenLastCalledWith(null)
    expect(rear.track.stop).toHaveBeenCalledOnce()
    expect(stream.track.stop).not.toHaveBeenCalled()
    expect(latest).toMatchObject({ cameraEnabled: false })
    service.hangup()
    expect(stream.track.stop).toHaveBeenCalledOnce()
  })

  it('shares a system-selected monitor in detail mode and restores the camera on stop', async () => {
    const front = new FakeStream([new FakeTrack('video')])
    const restored = new FakeStream([new FakeTrack('video')])
    const screen = new FakeStream([new FakeTrack('video')])
    let cameraRequest = 0
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video === false) return stream as unknown as MediaStream
      return [front, restored][cameraRequest++] as unknown as MediaStream
    })
    const getDisplayMedia = vi.fn(async () => screen as unknown as MediaStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, getDisplayMedia },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const localVideo = {
      srcObject: null,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement
    service.attachVideoElements(localVideo, null)
    await service.toggleCamera()

    const peer = FakePeerConnection.instances[0]!
    peer.videoSender.replaceTrack.mockImplementationOnce(async () => {
      expect(latest).toMatchObject({ screenSharing: true })
    })
    await service.toggleScreenShare()

    expect(getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      video: {
        displaySurface: 'monitor',
        width: { ideal: 1_920, max: 2_560 },
        height: { ideal: 1_080, max: 1_440 },
        frameRate: { ideal: 15, max: 30 },
      },
    })
    expect(screen.track.contentHint).toBe('detail')
    expect(peer.videoSender.replaceTrack).toHaveBeenLastCalledWith(screen.track)
    expect(peer.videoSender.setParameters).toHaveBeenLastCalledWith({
      encodings: [{ maxBitrate: 1_800_000, maxFramerate: 15 }],
      degradationPreference: 'maintain-resolution',
    })
    expect(front.track.stop).toHaveBeenCalledOnce()
    expect(localVideo.srcObject).toBeNull()
    expect(latest).toMatchObject({
      cameraEnabled: false,
      screenShareSupported: true,
      screenSharing: true,
    })

    screen.track.dispatchEvent(new Event('ended'))

    await vi.waitFor(() => expect(latest).toMatchObject({
      cameraEnabled: true,
      cameraBusy: false,
      screenSharing: false,
    }))
    expect(screen.track.stop).toHaveBeenCalledOnce()
    expect(peer.videoSender.replaceTrack).toHaveBeenLastCalledWith(restored.track)
    expect(localVideo.srcObject).toBe(restored)
    service.hangup()
  })

  it('keeps the current camera when the screen picker is cancelled', async () => {
    const camera = new FakeStream([new FakeTrack('video')])
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => (
      constraints.video === false ? stream : camera
    ) as unknown as MediaStream)
    const getDisplayMedia = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, getDisplayMedia },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    await service.toggleCamera()

    await service.toggleScreenShare()

    expect(camera.track.stop).not.toHaveBeenCalled()
    expect(FakePeerConnection.instances[0]?.videoSender.replaceTrack)
      .toHaveBeenLastCalledWith(camera.track)
    expect(latest).toMatchObject({
      cameraEnabled: true,
      cameraBusy: false,
      screenSharing: false,
      notice: 'Демонстрация экрана не начата',
    })
    service.hangup()
  })

  it('stops screen capture immediately when the call ends', async () => {
    const screen = new FakeStream([new FakeTrack('video')])
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream),
        getDisplayMedia: vi.fn(async () => screen),
      },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    await service.toggleScreenShare()

    service.hangup()

    expect(screen.track.stop).toHaveBeenCalledOnce()
    expect(stream.track.stop).toHaveBeenCalledOnce()
    expect(FakePeerConnection.instances[0]?.close).toHaveBeenCalledOnce()
  })

  it('derives remote video visibility from the authenticated WebRTC track', async () => {
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const remoteVideo = new FakeVideo() as unknown as HTMLVideoElement
    service.attachVideoElements(null, remoteVideo)
    const remoteTrack = new FakeTrack('video')
    const trackEvent = Object.assign(new Event('track'), {
      track: remoteTrack as unknown as MediaStreamTrack,
      streams: [],
    })
    FakePeerConnection.instances[0]!.dispatchEvent(trackEvent)
    expect(latest).toMatchObject({ remoteVideoEnabled: true })
    expect(remoteVideo.srcObject).toBeInstanceOf(FakeStream)

    remoteTrack.muted = true
    remoteTrack.dispatchEvent(new Event('mute'))
    expect(latest).toMatchObject({ remoteVideoEnabled: false })
  })

  it('confirms authenticated remote video from browser playback when unmute is missed', async () => {
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })
    const remoteVideo = new FakeVideo()
    service.attachVideoElements(null, remoteVideo as unknown as HTMLVideoElement)
    const remoteTrack = new FakeTrack('video')
    remoteTrack.muted = true
    FakePeerConnection.instances[0]!.dispatchEvent(Object.assign(new Event('track'), {
      track: remoteTrack as unknown as MediaStreamTrack,
      streams: [],
    }))
    expect(latest).toMatchObject({ remoteVideoEnabled: false })

    remoteVideo.dispatchEvent(new Event('playing'))

    expect(latest).toMatchObject({ remoteVideoEnabled: true, identityVerified: true })
    service.reset()
  })

  it('keeps the audio call alive when camera permission is denied', async () => {
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video === false) return stream as unknown as MediaStream
      throw new DOMException('denied', 'NotAllowedError')
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    let latest = null
    service.subscribe(state => { latest = state })
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    await service.toggleCamera()
    expect(latest).toMatchObject({
      phase: 'connecting',
      cameraEnabled: false,
      notice: 'Разрешите доступ к камере в настройках браузера',
    })
    expect(stream.track.stop).not.toHaveBeenCalled()
  })

  it('stops an active camera track when the call ends', async () => {
    const camera = new FakeStream([new FakeTrack('video')])
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => (
      constraints.video === false ? stream : camera
    ) as unknown as MediaStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const service = new BrowserVoiceCallService(
      signaling, config, fakeIdentity(), ALICE_USER, ALICE_DEVICE,
    )
    await service.start(CONVERSATION, BOB_USER)
    const offer = signals.find(signal => signal.type === 'call_offer')!
    await service.apply({
      type: 'call_answer',
      version: 2,
      eventId: 'event',
      conversationId: CONVERSATION,
      callId: offer.call_id,
      actorUserId: BOB_USER,
      actorDeviceId: BOB_DEVICE,
      sdp: 'answer-sdp',
      candidate: null,
      reason: null,
      identitySignature: '07'.repeat(64),
    })

    await service.toggleCamera()
    service.hangup()

    expect(camera.track.stop).toHaveBeenCalledOnce()
    expect(stream.track.stop).toHaveBeenCalledOnce()
    expect(FakePeerConnection.instances[0]?.close).toHaveBeenCalledOnce()
  })
})
