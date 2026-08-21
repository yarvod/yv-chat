import type { CallRealtimeFrame } from '../../domain/messaging/realtime'
import type { OutgoingCallSignal } from '../../application/ports/realtime-gateway'
import type {
  VoiceCallAudioOutput,
  VoiceCallState,
  VoiceCallSummary,
} from '../../domain/calls/voice-call'
import {
  BrowserCallToneService,
  type CallTonePlayer,
} from '../browser/browser-call-tone-service'
import type { CallIdentityGateway } from '../../application/ports/call-identity-gateway'
import type {
  NativeCallAudioPort,
  NativeCallAudioRoute,
  NativeCallAudioState,
} from '../../application/ports/native-call-audio'

interface CallSignalingTransport {
  sendCallSignal(signal: OutgoingCallSignal): boolean
}

interface CallConfigGateway {
  load(): Promise<{ enabled: boolean, configuration: RTCConfiguration }>
}

interface AudioOutputMediaDevices extends MediaDevices {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>
}

const VIDEO_MAX_BITRATE = 1_200_000
const CALL_CONNECTION_TIMEOUT_MS = 30_000
const CALL_RECONNECT_TIMEOUT_MS = 15_000
const MAX_BUFFERED_ICE_CANDIDATES = 64

function cameraConstraints(facingMode: VoiceCallState['cameraFacingMode']): MediaTrackConstraints {
  return {
    facingMode: { ideal: facingMode },
    width: { ideal: 1_280, max: 1_280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 24, max: 30 },
  }
}

export type VoiceCallHistoryRecorder = (
  conversationId: string,
  summary: VoiceCallSummary,
) => Promise<boolean>

const IDLE_STATE: VoiceCallState = {
  phase: 'idle',
  conversationId: null,
  callId: null,
  muted: false,
  startedAt: null,
  notice: null,
  audioOutputSupported: false,
  audioOutputPickerSupported: false,
  audioOutputs: [],
  selectedAudioOutputId: '',
  identityVerified: false,
  verificationCode: null,
  cameraSupported: false,
  cameraEnabled: false,
  cameraBusy: false,
  cameraFacingMode: 'user',
  remoteVideoEnabled: false,
}

interface AuthenticatedOffer {
  sdp: string
  signature: Uint8Array
  callerUserId: string
  callerDeviceId: string
  calleeUserId: string
}

export class BrowserVoiceCallService {
  private state: VoiceCallState = IDLE_STATE
  private listeners = new Set<(state: VoiceCallState) => void>()
  private peer: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteAudio: HTMLAudioElement | null = null
  private remoteMediaStream: MediaStream | null = null
  private cameraStream: MediaStream | null = null
  private videoSender: RTCRtpSender | null = null
  private localVideoElement: HTMLVideoElement | null = null
  private remoteVideoElement: HTMLVideoElement | null = null
  private cameraOperation: Promise<void> | null = null
  private cameraOperationToken = 0
  private pendingOffer: AuthenticatedOffer | null = null
  private localOffer: AuthenticatedOffer | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private pendingLocalCandidates: string[] = []
  private localDescriptionSignaled = false
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  private connectionTimer: ReturnType<typeof setTimeout> | null = null
  private caller = false
  private offerSent = false
  private summaryRecorded = false
  private connectedAt: number | null = null
  private listeningForDeviceChanges = false
  private nativeAudioActive = false
  private stopNativeAudioSubscription: (() => Promise<void>) | null = null
  private nativeAudioCleanup: Promise<void> = Promise.resolve()

  constructor(
    private readonly signaling: CallSignalingTransport,
    private readonly config: CallConfigGateway,
    private readonly identity: CallIdentityGateway,
    private readonly localUserId: string,
    private readonly localDeviceId: string,
    private readonly recordHistory: VoiceCallHistoryRecorder | null = null,
    private readonly tones: CallTonePlayer = new BrowserCallToneService(),
    private readonly nativeCallAudio: NativeCallAudioPort | null = null,
  ) {}

  subscribe(listener: (state: VoiceCallState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  async start(conversationId: string, calleeUserId: string): Promise<void> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended' && this.state.phase !== 'error') {
      return
    }
    this.tones.unlock()
    const callId = crypto.randomUUID()
    this.caller = true
    this.offerSent = false
    this.localDescriptionSignaled = false
    this.pendingLocalCandidates = []
    this.summaryRecorded = false
    this.connectedAt = null
    this.update({
      phase: 'connecting',
      conversationId,
      callId,
      muted: false,
      startedAt: null,
      notice: 'Подключаем микрофон…',
      audioOutputSupported: false,
      audioOutputPickerSupported: false,
      audioOutputs: [],
      selectedAudioOutputId: '',
      identityVerified: false,
      verificationCode: null,
      cameraSupported: false,
      cameraEnabled: false,
      cameraBusy: false,
      cameraFacingMode: 'user',
      remoteVideoEnabled: false,
    })
    try {
      const peer = await this.preparePeer()
      const offer = await peer.createOffer({ offerToReceiveAudio: true })
      await peer.setLocalDescription(offer)
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('missing local SDP')
      const signed = await this.identity.signCallBinding({
        role: 'offer',
        conversationId,
        callId,
        callerUserId: this.localUserId,
        callerDeviceId: this.localDeviceId,
        calleeUserId,
        calleeDeviceId: null,
        sdp,
      })
      this.localOffer = {
        sdp,
        signature: signed.signature,
        callerUserId: this.localUserId,
        callerDeviceId: this.localDeviceId,
        calleeUserId,
      }
      if (!this.send({
        type: 'call_offer',
        version: 2,
        conversation_id: conversationId,
        call_id: callId,
        sdp,
        identity_signature: bytesToHex(signed.signature),
      })) {
        throw new Error('signaling unavailable')
      }
      this.localDescriptionSignaled = true
      this.flushLocalCandidates()
      this.offerSent = true
      this.update({ ...this.state, phase: 'outgoing', notice: 'Вызываем…' })
      this.tones.startOutgoing()
      this.armRingTimeout()
    } catch (error) {
      this.fail(this.microphoneError(error))
    }
  }

  async accept(): Promise<void> {
    if (
      this.state.phase !== 'incoming'
      || !this.state.conversationId
      || !this.state.callId
      || !this.pendingOffer
    ) return
    this.tones.unlock()
    this.tones.stop()
    this.clearRingTimeout()
    this.update({ ...this.state, phase: 'connecting', notice: 'Соединяем…' })
    try {
      const peer = await this.preparePeer()
      await peer.setRemoteDescription({ type: 'offer', sdp: this.pendingOffer.sdp })
      this.bindIncomingVideoSender(peer)
      await this.flushCandidates()
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('missing local SDP')
      const offer = this.pendingOffer
      const signed = await this.identity.signCallBinding({
        role: 'answer',
        conversationId: this.state.conversationId,
        callId: this.state.callId,
        callerUserId: offer.callerUserId,
        callerDeviceId: offer.callerDeviceId,
        calleeUserId: this.localUserId,
        calleeDeviceId: this.localDeviceId,
        sdp,
      })
      const verification = await this.identity.deriveCallVerificationCode({
        conversationId: this.state.conversationId,
        callId: this.state.callId,
        callerUserId: offer.callerUserId,
        callerDeviceId: offer.callerDeviceId,
        calleeUserId: this.localUserId,
        calleeDeviceId: this.localDeviceId,
        offerSdp: offer.sdp,
        offerSignature: offer.signature,
        answerSdp: sdp,
        answerSignature: signed.signature,
      })
      if (!this.send({
        type: 'call_answer',
        version: 2,
        conversation_id: this.state.conversationId,
        call_id: this.state.callId,
        sdp,
        identity_signature: bytesToHex(signed.signature),
      })) throw new Error('signaling unavailable')
      this.localDescriptionSignaled = true
      this.flushLocalCandidates()
      this.pendingOffer = null
      this.update({
        ...this.state,
        identityVerified: true,
        verificationCode: verification.code,
        notice: 'Устройство подтверждено MLS',
      })
      this.armConnectionTimeout(CALL_CONNECTION_TIMEOUT_MS)
    } catch (error) {
      this.fail(this.microphoneError(error), true)
    }
  }

  reject(): void {
    if (this.state.phase !== 'incoming') return
    this.sendTerminal('call_rejected', 'declined')
    this.finish('Звонок отклонён', 'declined')
  }

  hangup(): void {
    if (this.state.phase === 'idle') return
    this.sendTerminal('call_ended', 'hangup')
    this.finish(
      'Звонок завершён',
      this.connectedAt === null ? 'cancelled' : 'completed',
    )
  }

  toggleMute(): void {
    const next = !this.state.muted
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !next
    this.update({ ...this.state, muted: next })
  }

  toggleCamera(): Promise<void> {
    if (this.cameraOperation) return this.cameraOperation
    const operation = this.state.cameraEnabled
      ? this.disableCamera()
      : this.enableCamera(this.state.cameraFacingMode)
    const token = ++this.cameraOperationToken
    this.cameraOperation = operation.finally(() => {
      if (this.cameraOperationToken === token) this.cameraOperation = null
    })
    return this.cameraOperation
  }

  switchCamera(): Promise<void> {
    if (this.cameraOperation || !this.state.cameraEnabled) {
      return this.cameraOperation ?? Promise.resolve()
    }
    const facingMode = this.state.cameraFacingMode === 'user' ? 'environment' : 'user'
    const operation = this.enableCamera(facingMode)
    const token = ++this.cameraOperationToken
    this.cameraOperation = operation.finally(() => {
      if (this.cameraOperationToken === token) this.cameraOperation = null
    })
    return this.cameraOperation
  }

  attachVideoElements(
    local: HTMLVideoElement | null,
    remote: HTMLVideoElement | null,
  ): void {
    this.detachRemoteVideoListeners()
    if (this.localVideoElement && this.localVideoElement !== local) {
      this.localVideoElement.srcObject = null
    }
    if (this.remoteVideoElement && this.remoteVideoElement !== remote) {
      this.remoteVideoElement.srcObject = null
    }
    this.localVideoElement = local
    this.remoteVideoElement = remote
    this.attachRemoteVideoListeners()
    this.attachStream(local, this.cameraStream)
    this.attachStream(remote, this.remoteMediaStream)
  }

  async selectAudioOutput(deviceId: string): Promise<void> {
    const allowed = deviceId === '' || this.state.audioOutputs.some(item => (
      item.deviceId === deviceId
    ))
    if (!allowed || !this.state.audioOutputSupported) return
    if (this.nativeCallAudio && this.nativeAudioActive) {
      const route: NativeCallAudioRoute = deviceId === 'native:speaker'
        ? 'speaker'
        : deviceId === 'native:earpiece'
          ? 'earpiece'
          : 'system'
      try {
        this.applyNativeAudioState(await this.nativeCallAudio.selectRoute(route))
        await this.syncNativeProximity()
      } catch {
        this.update({ ...this.state, notice: 'Система не разрешила сменить аудиовыход' })
      }
      return
    }
    const audio = this.remoteAudio
    if (!audio?.setSinkId) return
    try {
      await audio.setSinkId(deviceId)
      this.update({ ...this.state, selectedAudioOutputId: deviceId, notice: null })
    } catch {
      this.update({ ...this.state, notice: 'Браузер не разрешил выбрать этот аудиовыход' })
    }
  }

  async requestAudioOutput(): Promise<void> {
    const audio = this.remoteAudio
    const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices | undefined
    if (
      !audio?.setSinkId
      || !this.state.audioOutputPickerSupported
      || typeof mediaDevices?.selectAudioOutput !== 'function'
    ) return
    try {
      const selected = await mediaDevices.selectAudioOutput()
      if (selected.kind !== 'audiooutput' || selected.deviceId.length === 0) return
      await audio.setSinkId(selected.deviceId)
      const output = this.describeAudioOutput(selected, this.state.audioOutputs.length)
      const outputs = this.state.audioOutputs.some(item => item.deviceId === output.deviceId)
        ? this.state.audioOutputs
        : [...this.state.audioOutputs, output]
      this.update({
        ...this.state,
        audioOutputs: outputs,
        selectedAudioOutputId: output.deviceId,
        notice: null,
      })
      await this.refreshAudioOutputs(output)
    } catch (error) {
      if (error instanceof DOMException && (
        error.name === 'NotAllowedError' || error.name === 'AbortError'
      )) return
      this.update({ ...this.state, notice: 'Браузер не разрешил выбрать аудиовыход' })
    }
  }

  resumeAudio(): void {
    this.tones.unlock()
    void this.remoteAudio?.play().catch(() => undefined)
  }

  reset(): void {
    if (this.state.phase === 'incoming') this.reject()
    else if (
      this.state.phase === 'active'
      || this.state.phase === 'connecting'
      || this.state.phase === 'outgoing'
    ) this.hangup()
    this.cleanup()
    this.update(IDLE_STATE)
  }

  dispose(): void {
    this.reset()
    this.tones.dispose()
  }

  async apply(frame: CallRealtimeFrame): Promise<void> {
    if (frame.type === 'call_offer') {
      if (
        this.state.phase !== 'idle'
        && this.state.phase !== 'ended'
        && this.state.phase !== 'error'
        && this.state.callId !== frame.callId
      ) {
        // Busy is local to this device. Rejecting here would terminate the shared
        // user-level call before another online device has a chance to answer.
        return
      }
      if (!frame.sdp || !frame.identitySignature) return
      let verifiedOffer: AuthenticatedOffer
      try {
        const signature = hexToBytes(frame.identitySignature)
        await this.identity.verifyCallBinding({
          role: 'offer',
          conversationId: frame.conversationId,
          callId: frame.callId,
          callerUserId: frame.actorUserId,
          callerDeviceId: frame.actorDeviceId,
          calleeUserId: this.localUserId,
          calleeDeviceId: null,
          sdp: frame.sdp,
          signature,
        })
        verifiedOffer = {
          sdp: frame.sdp,
          signature,
          callerUserId: frame.actorUserId,
          callerDeviceId: frame.actorDeviceId,
          calleeUserId: this.localUserId,
        }
      } catch {
        this.cleanup()
        this.update({
          ...IDLE_STATE,
          phase: 'error',
          conversationId: frame.conversationId,
          callId: frame.callId,
          notice: 'Не удалось подтвердить устройство звонящего',
        })
        return
      }
      this.cleanup()
      this.caller = false
      this.offerSent = false
      this.localDescriptionSignaled = false
      this.pendingLocalCandidates = []
      this.summaryRecorded = false
      this.connectedAt = null
      this.pendingOffer = verifiedOffer
      this.update({
        phase: 'incoming',
        conversationId: frame.conversationId,
        callId: frame.callId,
        muted: false,
        startedAt: null,
        notice: 'Входящий голосовой звонок',
        audioOutputSupported: false,
        audioOutputPickerSupported: false,
        audioOutputs: [],
      selectedAudioOutputId: '',
      cameraSupported: typeof navigator.mediaDevices?.getUserMedia === 'function',
      cameraEnabled: false,
      cameraBusy: false,
      cameraFacingMode: 'user',
      remoteVideoEnabled: false,
        identityVerified: true,
        verificationCode: null,
      })
      this.tones.startIncoming()
      navigator.vibrate?.([280, 140, 280])
      this.armRingTimeout()
      return
    }
    if (frame.callId !== this.state.callId) return
    if (
      frame.type === 'call_answer' && this.peer && frame.sdp
      && frame.identitySignature && this.localOffer
    ) {
      try {
        const signature = hexToBytes(frame.identitySignature)
        const offer = this.localOffer
        await this.identity.verifyCallBinding({
          role: 'answer',
          conversationId: frame.conversationId,
          callId: frame.callId,
          callerUserId: this.localUserId,
          callerDeviceId: this.localDeviceId,
          calleeUserId: frame.actorUserId,
          calleeDeviceId: frame.actorDeviceId,
          sdp: frame.sdp,
          signature,
        })
        const verification = await this.identity.deriveCallVerificationCode({
          conversationId: frame.conversationId,
          callId: frame.callId,
          callerUserId: this.localUserId,
          callerDeviceId: this.localDeviceId,
          calleeUserId: frame.actorUserId,
          calleeDeviceId: frame.actorDeviceId,
          offerSdp: offer.sdp,
          offerSignature: offer.signature,
          answerSdp: frame.sdp,
          answerSignature: signature,
        })
        this.tones.stop()
        this.clearRingTimeout()
        await this.peer.setRemoteDescription({ type: 'answer', sdp: frame.sdp })
        await this.flushCandidates()
        this.update({
          ...this.state,
          phase: 'connecting',
          identityVerified: true,
          verificationCode: verification.code,
          notice: 'Устройство подтверждено MLS',
        })
        this.armConnectionTimeout(CALL_CONNECTION_TIMEOUT_MS)
      } catch {
        this.sendTerminal('call_ended', 'identity_error')
        this.fail('Не удалось подтвердить устройство собеседника')
      }
      return
    }
    if (frame.type === 'ice_candidate' && frame.candidate) {
      const candidate = this.parseCandidate(frame.candidate)
      if (!this.peer?.remoteDescription) this.pendingCandidates.push(candidate)
      else await this.peer.addIceCandidate(candidate)
      return
    }
    if (frame.type === 'call_rejected') {
      this.finish(
        frame.reason === 'busy' ? 'Собеседник занят' : 'Звонок отклонён',
        frame.reason === 'busy' ? 'busy' : 'declined',
      )
      return
    }
    if (frame.type === 'call_ended') {
      const outcome = frame.reason === 'timeout'
        ? 'missed'
        : frame.reason === 'media_error'
          ? 'failed'
          : this.connectedAt === null ? 'cancelled' : 'completed'
      this.finish(
        frame.reason === 'answered_elsewhere' ? 'Принято на другом устройстве' : 'Звонок завершён',
        outcome,
      )
    }
  }

  private async preparePeer(): Promise<RTCPeerConnection> {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('unsupported')
    }
    const loaded = await this.config.load()
    if (!loaded.enabled) throw new Error('disabled')
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    await this.activateNativeAudio()
    const peer = new RTCPeerConnection(loaded.configuration)
    this.peer = peer
    for (const track of this.localStream.getAudioTracks()) peer.addTrack(track, this.localStream)
    if (
      typeof peer.addTransceiver === 'function'
      && (this.caller || typeof peer.getTransceivers !== 'function')
    ) {
      try {
        this.videoSender = peer.addTransceiver('video', { direction: 'sendrecv' }).sender
      } catch {
        this.videoSender = null
      }
    }
    this.update({
      ...this.state,
      cameraSupported: this.videoSender !== null,
      cameraEnabled: false,
      cameraBusy: false,
      cameraFacingMode: 'user',
      remoteVideoEnabled: false,
    })
    this.remoteMediaStream = new MediaStream()
    this.remoteAudio = new Audio()
    this.remoteAudio.autoplay = true
    this.remoteAudio.srcObject = this.remoteMediaStream
    await this.refreshAudioOutputs()
    if (!this.listeningForDeviceChanges) {
      navigator.mediaDevices.addEventListener?.('devicechange', this.handleDeviceChange)
      this.listeningForDeviceChanges = true
    }
    peer.addEventListener('track', event => {
      if (this.peer !== peer || !this.remoteMediaStream) return
      if (!this.remoteMediaStream.getTracks().some(track => track.id === event.track.id)) {
        this.remoteMediaStream.addTrack(event.track)
      }
      if (event.track.kind === 'video') {
        const updateRemoteVideo = (): void => {
          if (this.peer !== peer) return
          this.update({
            ...this.state,
            remoteVideoEnabled: event.track.readyState === 'live' && !event.track.muted,
          })
          void this.syncNativeProximity()
        }
        event.track.addEventListener('mute', updateRemoteVideo)
        event.track.addEventListener('unmute', updateRemoteVideo)
        event.track.addEventListener('ended', updateRemoteVideo)
        updateRemoteVideo()
        this.attachStream(this.remoteVideoElement, this.remoteMediaStream)
      } else if (this.remoteAudio) {
        void this.remoteAudio.play().catch(() => {
          this.update({ ...this.state, notice: 'Нажмите на экран, чтобы включить звук' })
        })
      }
    })
    peer.addEventListener('icecandidate', event => {
      if (!event.candidate || !this.state.conversationId || !this.state.callId) return
      this.queueOrSendLocalCandidate(JSON.stringify(event.candidate.toJSON()))
    })
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'connected') {
        this.tones.stop()
        this.clearConnectionTimeout()
        this.connectedAt ??= Date.now()
        if (!this.state.identityVerified) {
          this.fail('Не удалось подтвердить устройство собеседника', true)
          return
        }
        this.update({ ...this.state, phase: 'active', startedAt: this.connectedAt, notice: null })
        void this.syncNativeProximity()
      } else if (peer.connectionState === 'disconnected') {
        this.update({
          ...this.state,
          phase: 'connecting',
          notice: 'Восстанавливаем защищённое соединение…',
        })
        this.armConnectionTimeout(CALL_RECONNECT_TIMEOUT_MS)
      } else if (peer.connectionState === 'failed') {
        this.fail('Не удалось установить соединение', true)
      }
    })
    return peer
  }

  private bindIncomingVideoSender(peer: RTCPeerConnection): void {
    if (this.caller || typeof peer.getTransceivers !== 'function') return
    const transceiver = peer.getTransceivers().find(item => (
      item.receiver.track.kind === 'video'
    ))
    if (!transceiver) {
      this.videoSender = null
      this.update({ ...this.state, cameraSupported: false })
      return
    }
    try {
      transceiver.direction = 'sendrecv'
    } catch {
      this.videoSender = null
      this.update({ ...this.state, cameraSupported: false })
      return
    }
    this.videoSender = transceiver.sender
    this.update({ ...this.state, cameraSupported: true })
  }

  private async flushCandidates(): Promise<void> {
    if (!this.peer) return
    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.peer.addIceCandidate(candidate)
    }
  }

  private queueOrSendLocalCandidate(candidate: string): void {
    if (!this.localDescriptionSignaled) {
      if (this.pendingLocalCandidates.length < MAX_BUFFERED_ICE_CANDIDATES) {
        this.pendingLocalCandidates.push(candidate)
      }
      return
    }
    this.sendLocalCandidate(candidate)
  }

  private flushLocalCandidates(): void {
    for (const candidate of this.pendingLocalCandidates.splice(0)) {
      this.sendLocalCandidate(candidate)
    }
  }

  private sendLocalCandidate(candidate: string): void {
    if (!this.state.conversationId || !this.state.callId) return
    this.send({
      type: 'ice_candidate',
      version: 2,
      conversation_id: this.state.conversationId,
      call_id: this.state.callId,
      candidate,
    })
  }

  private async enableCamera(
    facingMode: VoiceCallState['cameraFacingMode'],
  ): Promise<void> {
    const peer = this.peer
    const sender = this.videoSender
    if (
      !peer || !sender || !this.state.identityVerified
      || !['connecting', 'active'].includes(this.state.phase)
      || !navigator.mediaDevices?.getUserMedia
    ) return
    this.update({ ...this.state, cameraBusy: true, notice: 'Включаем камеру…' })
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(facingMode),
      })
      const track = stream.getVideoTracks()[0]
      if (!track) throw new Error('camera track unavailable')
      try {
        track.contentHint = 'motion'
      } catch {
        // Some otherwise compatible WebViews expose a read-only property.
      }
      if (this.peer !== peer || this.videoSender !== sender) {
        for (const item of stream.getTracks()) item.stop()
        return
      }
      await sender.replaceTrack(track)
      await this.limitVideoSender(sender)
      if (this.peer !== peer || this.videoSender !== sender) {
        for (const item of stream.getTracks()) item.stop()
        return
      }
      const previous = this.cameraStream
      this.cameraStream = stream
      stream = null
      this.attachStream(this.localVideoElement, this.cameraStream)
      for (const item of previous?.getTracks() ?? []) item.stop()
      this.update({
        ...this.state,
        cameraEnabled: true,
        cameraBusy: false,
        cameraFacingMode: facingMode,
        notice: null,
      })
      void this.updateNativeVideo(true)
    } catch (error) {
      for (const item of stream?.getTracks() ?? []) item.stop()
      if (this.peer !== peer) return
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      this.update({
        ...this.state,
        cameraBusy: false,
        notice: denied
          ? 'Разрешите доступ к камере в настройках браузера'
          : 'Не удалось включить камеру — аудиозвонок продолжается',
      })
    }
  }

  private async disableCamera(): Promise<void> {
    const peer = this.peer
    const sender = this.videoSender
    this.update({ ...this.state, cameraBusy: true })
    try {
      await sender?.replaceTrack(null)
    } catch {
      // Stopping the local track below is the privacy-preserving fallback.
    }
    for (const track of this.cameraStream?.getTracks() ?? []) track.stop()
    this.cameraStream = null
    this.attachStream(this.localVideoElement, null)
    if (this.peer !== peer) return
    this.update({ ...this.state, cameraEnabled: false, cameraBusy: false, notice: null })
    void this.updateNativeVideo(false)
  }

  private async limitVideoSender(sender: RTCRtpSender): Promise<void> {
    try {
      const parameters = sender.getParameters()
      parameters.encodings ??= []
      if (parameters.encodings.length === 0) parameters.encodings.push({})
      parameters.encodings[0]!.maxBitrate = VIDEO_MAX_BITRATE
      parameters.encodings[0]!.maxFramerate = 30
      parameters.degradationPreference = 'balanced'
      await sender.setParameters(parameters)
    } catch {
      // Browser congestion control remains active when explicit caps are unsupported.
    }
  }

  private attachStream(element: HTMLVideoElement | null, stream: MediaStream | null): void {
    if (!element) return
    if (element.srcObject !== stream) element.srcObject = stream
    if (stream) void element.play().catch(() => undefined)
  }

  private attachRemoteVideoListeners(): void {
    for (const type of ['playing', 'loadeddata', 'resize'] as const) {
      this.remoteVideoElement?.addEventListener(type, this.handleRemoteVideoPlayback)
    }
  }

  private detachRemoteVideoListeners(): void {
    for (const type of ['playing', 'loadeddata', 'resize'] as const) {
      this.remoteVideoElement?.removeEventListener(type, this.handleRemoteVideoPlayback)
    }
  }

  private readonly handleRemoteVideoPlayback = (): void => {
    const element = this.remoteVideoElement
    const hasLiveTrack = this.remoteMediaStream?.getVideoTracks().some(track => (
      track.readyState === 'live'
    )) ?? false
    if (
      !element
      || !this.state.identityVerified
      || !hasLiveTrack
      || element.readyState < 2
      || element.videoWidth === 0
    ) return
    this.update({ ...this.state, remoteVideoEnabled: true })
  }

  private parseCandidate(value: string): RTCIceCandidateInit {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('invalid ICE candidate')
    }
    const candidate = (parsed as Record<string, unknown>).candidate
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new TypeError('invalid ICE candidate')
    }
    return parsed as RTCIceCandidateInit
  }

  private send(signal: OutgoingCallSignal): boolean {
    return this.signaling.sendCallSignal(signal)
  }

  private sendTerminal(type: 'call_rejected' | 'call_ended', reason: string): void {
    if (!this.state.conversationId || !this.state.callId) return
    this.send({
      type,
      version: 2,
      conversation_id: this.state.conversationId,
      call_id: this.state.callId,
      reason,
    })
  }

  private armRingTimeout(): void {
    this.clearRingTimeout()
    this.ringTimer = setTimeout(() => {
      this.sendTerminal('call_ended', 'timeout')
      this.finish('Нет ответа', 'missed')
    }, 60_000)
  }

  private clearRingTimeout(): void {
    if (this.ringTimer !== null) clearTimeout(this.ringTimer)
    this.ringTimer = null
  }

  private armConnectionTimeout(delay: number): void {
    this.clearConnectionTimeout()
    const peer = this.peer
    this.connectionTimer = setTimeout(() => {
      if (this.peer !== peer || peer?.connectionState === 'connected') return
      this.fail('Не удалось установить защищённое соединение. Попробуйте ещё раз', true)
    }, delay)
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimer !== null) clearTimeout(this.connectionTimer)
    this.connectionTimer = null
  }

  private fail(notice: string, notifyPeer = false): void {
    if (notifyPeer) this.sendTerminal('call_ended', 'media_error')
    this.recordSummary('failed')
    this.cleanup()
    this.update({
      ...this.state,
      phase: 'error',
      notice,
      startedAt: null,
      cameraEnabled: false,
      cameraBusy: false,
      remoteVideoEnabled: false,
    })
  }

  private finish(notice: string, outcome: VoiceCallSummary['outcome']): void {
    this.recordSummary(outcome)
    this.cleanup()
    this.update({
      ...this.state,
      phase: 'ended',
      notice,
      startedAt: null,
      cameraEnabled: false,
      cameraBusy: false,
      remoteVideoEnabled: false,
    })
  }

  private cleanup(): void {
    this.tones.stop()
    navigator.vibrate?.(0)
    this.clearRingTimeout()
    this.clearConnectionTimeout()
    this.peer?.close()
    this.peer = null
    for (const track of this.localStream?.getTracks() ?? []) track.stop()
    this.localStream = null
    for (const track of this.cameraStream?.getTracks() ?? []) track.stop()
    this.cameraStream = null
    this.videoSender = null
    this.cameraOperationToken += 1
    this.cameraOperation = null
    if (this.localVideoElement) this.localVideoElement.srcObject = null
    this.detachRemoteVideoListeners()
    if (this.remoteVideoElement) this.remoteVideoElement.srcObject = null
    this.remoteMediaStream = null
    if (this.remoteAudio) this.remoteAudio.srcObject = null
    this.remoteAudio = null
    this.pendingOffer = null
    this.localOffer = null
    this.pendingCandidates = []
    this.pendingLocalCandidates = []
    this.localDescriptionSignaled = false
    this.deactivateNativeAudio()
    if (this.listeningForDeviceChanges) {
      navigator.mediaDevices?.removeEventListener?.('devicechange', this.handleDeviceChange)
      this.listeningForDeviceChanges = false
    }
  }

  private readonly handleDeviceChange = (): void => {
    void this.refreshAudioOutputs()
  }

  private async refreshAudioOutputs(preferred?: VoiceCallAudioOutput): Promise<void> {
    if (this.nativeCallAudio && this.nativeAudioActive) return
    const audio = this.remoteAudio
    const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices | undefined
    const sinkSupported = typeof audio?.setSinkId === 'function'
    const pickerSupported = sinkSupported
      && typeof mediaDevices?.selectAudioOutput === 'function'
    if (!sinkSupported) {
      this.update({
        ...this.state,
        audioOutputSupported: false,
        audioOutputPickerSupported: false,
        audioOutputs: [],
        selectedAudioOutputId: '',
      })
      return
    }
    if (typeof mediaDevices?.enumerateDevices !== 'function') {
      this.update({
        ...this.state,
        audioOutputSupported: pickerSupported,
        audioOutputPickerSupported: pickerSupported,
        audioOutputs: preferred ? [preferred] : this.state.audioOutputs,
      })
      return
    }
    try {
      const devices = await mediaDevices.enumerateDevices()
      const seen = new Set<string>()
      const outputs = devices.filter(device => (
        device.kind === 'audiooutput'
        && device.deviceId.length > 0
        && device.deviceId !== 'default'
        && !seen.has(device.deviceId)
        && seen.add(device.deviceId)
      )).map((device, index) => this.describeAudioOutput(device, index))
      if (preferred && !outputs.some(item => item.deviceId === preferred.deviceId)) {
        outputs.push(preferred)
      }
      const selected = outputs.some(item => item.deviceId === this.state.selectedAudioOutputId)
        ? this.state.selectedAudioOutputId
        : ''
      if (selected !== this.state.selectedAudioOutputId) await audio.setSinkId('')
      this.update({
        ...this.state,
        audioOutputSupported: true,
        audioOutputPickerSupported: pickerSupported,
        audioOutputs: outputs,
        selectedAudioOutputId: selected,
      })
    } catch {
      this.update({
        ...this.state,
        audioOutputSupported: pickerSupported,
        audioOutputPickerSupported: pickerSupported,
        audioOutputs: preferred ? [preferred] : this.state.audioOutputs,
      })
    }
  }

  private describeAudioOutput(
    device: Pick<MediaDeviceInfo, 'deviceId' | 'label'>,
    index: number,
  ): VoiceCallAudioOutput {
    const label = device.label || `Аудиовыход ${index + 1}`
    const normalized = label.toLocaleLowerCase('ru-RU')
    const kind: VoiceCallAudioOutput['kind'] = (
      /bluetooth|airpods|galaxy buds|pixel buds|wireless/.test(normalized)
        ? 'bluetooth'
        : /earpiece|receiver|разговорн|телефон/.test(normalized)
          ? 'earpiece'
          : /headphone|headset|earphone|наушник|гарнитур/.test(normalized)
            ? 'headphones'
            : /speaker|динамик|громк/.test(normalized)
              ? 'speaker'
              : 'other'
    )
    return { deviceId: device.deviceId, label, kind }
  }

  private async activateNativeAudio(): Promise<void> {
    if (!this.nativeCallAudio || this.nativeAudioActive) return
    await this.nativeAudioCleanup
    try {
      const state = await this.nativeCallAudio.activate(false)
      this.nativeAudioActive = true
      this.applyNativeAudioState(state)
      this.stopNativeAudioSubscription = await this.nativeCallAudio.subscribe(state => {
        if (!this.nativeAudioActive) return
        this.applyNativeAudioState(state)
        void this.syncNativeProximity()
      })
    } catch {
      this.nativeAudioCleanup = this.nativeCallAudio.deactivate().catch(() => undefined)
      this.nativeAudioActive = false
      this.stopNativeAudioSubscription = null
    }
  }

  private applyNativeAudioState(state: NativeCallAudioState): void {
    const selectedAudioOutputId = state.selectedRoute === 'speaker'
      ? 'native:speaker'
      : state.selectedRoute === 'earpiece'
        ? 'native:earpiece'
        : ''
    this.update({
      ...this.state,
      audioOutputSupported: true,
      audioOutputPickerSupported: false,
      audioOutputs: state.outputs,
      selectedAudioOutputId,
      notice: null,
    })
  }

  private async updateNativeVideo(video: boolean): Promise<void> {
    if (!this.nativeCallAudio || !this.nativeAudioActive) return
    try {
      this.applyNativeAudioState(await this.nativeCallAudio.setVideo(video))
      await this.syncNativeProximity()
    } catch {
      // WebRTC remains usable when a platform route transition is unavailable.
    }
  }

  private async syncNativeProximity(): Promise<void> {
    if (!this.nativeCallAudio || !this.nativeAudioActive) return
    const enabled = this.state.phase === 'active'
      && !this.state.cameraEnabled
      && !this.state.remoteVideoEnabled
      && this.state.selectedAudioOutputId !== 'native:speaker'
    await this.nativeCallAudio.setProximity(enabled).catch(() => undefined)
  }

  private deactivateNativeAudio(): void {
    if (!this.nativeCallAudio || !this.nativeAudioActive) return
    this.nativeAudioActive = false
    const stop = this.stopNativeAudioSubscription
    this.stopNativeAudioSubscription = null
    this.nativeAudioCleanup = Promise.all([
      this.nativeCallAudio.setProximity(false),
      this.nativeCallAudio.deactivate(),
      stop?.() ?? Promise.resolve(),
    ]).then(() => undefined).catch(() => undefined)
  }

  private recordSummary(outcome: VoiceCallSummary['outcome']): void {
    if (
      !this.caller
      || !this.offerSent
      || this.summaryRecorded
      || !this.recordHistory
      || !this.state.conversationId
      || !this.state.callId
    ) return
    this.summaryRecorded = true
    const durationSeconds = this.connectedAt === null
      ? 0
      : Math.max(1, Math.min(8 * 60 * 60, Math.round((Date.now() - this.connectedAt) / 1_000)))
    const recordHistory = this.recordHistory
    void recordHistory(this.state.conversationId, {
      callId: this.state.callId,
      outcome,
      durationSeconds,
    }).catch(() => undefined)
  }

  private microphoneError(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return 'Разрешите доступ к микрофону в настройках браузера'
    }
    if (error instanceof Error && error.message === 'unsupported') {
      return 'Этот браузер не поддерживает голосовые звонки'
    }
    if (error instanceof Error && error.message === 'disabled') {
      return 'Звонки отключены на сервере'
    }
    return 'Не удалось начать звонок'
  }

  private update(state: VoiceCallState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}

function bytesToHex(value: Uint8Array): string {
  return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{128}$/.test(value)) throw new TypeError('invalid call signature')
  const result = new Uint8Array(64)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}
