import type { CallRealtimeFrame } from '../../domain/messaging/realtime'
import type { OutgoingCallSignal } from '../../application/ports/realtime-gateway'
import type { VoiceCallState, VoiceCallSummary } from '../../domain/calls/voice-call'
import {
  BrowserCallToneService,
  type CallTonePlayer,
} from '../browser/browser-call-tone-service'

interface CallSignalingTransport {
  sendCallSignal(signal: OutgoingCallSignal): boolean
}

interface CallConfigGateway {
  load(): Promise<{ enabled: boolean, configuration: RTCConfiguration }>
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
  audioOutputs: [],
  selectedAudioOutputId: '',
}

export class BrowserVoiceCallService {
  private state: VoiceCallState = IDLE_STATE
  private listeners = new Set<(state: VoiceCallState) => void>()
  private peer: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteAudio: HTMLAudioElement | null = null
  private pendingOffer: string | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  private caller = false
  private offerSent = false
  private summaryRecorded = false
  private connectedAt: number | null = null
  private listeningForDeviceChanges = false

  constructor(
    private readonly signaling: CallSignalingTransport,
    private readonly config: CallConfigGateway,
    private readonly recordHistory: VoiceCallHistoryRecorder | null = null,
    private readonly tones: CallTonePlayer = new BrowserCallToneService(),
  ) {}

  subscribe(listener: (state: VoiceCallState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  async start(conversationId: string): Promise<void> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended' && this.state.phase !== 'error') {
      return
    }
    this.tones.unlock()
    const callId = crypto.randomUUID()
    this.caller = true
    this.offerSent = false
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
      audioOutputs: [],
      selectedAudioOutputId: '',
    })
    try {
      const peer = await this.preparePeer()
      const offer = await peer.createOffer({ offerToReceiveAudio: true })
      await peer.setLocalDescription(offer)
      if (!offer.sdp || !this.send({
        type: 'call_offer',
        version: 1,
        conversation_id: conversationId,
        call_id: callId,
        sdp: offer.sdp,
      })) {
        throw new Error('signaling unavailable')
      }
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
      await peer.setRemoteDescription({ type: 'offer', sdp: this.pendingOffer })
      await this.flushCandidates()
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      if (!answer.sdp || !this.send({
        type: 'call_answer',
        version: 1,
        conversation_id: this.state.conversationId,
        call_id: this.state.callId,
        sdp: answer.sdp,
      })) throw new Error('signaling unavailable')
      this.pendingOffer = null
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

  async selectAudioOutput(deviceId: string): Promise<void> {
    const allowed = deviceId === '' || this.state.audioOutputs.some(item => (
      item.deviceId === deviceId
    ))
    if (!allowed || !this.state.audioOutputSupported) return
    const audio = this.remoteAudio
    if (!audio?.setSinkId) return
    try {
      await audio.setSinkId(deviceId)
      this.update({ ...this.state, selectedAudioOutputId: deviceId, notice: null })
    } catch {
      this.update({ ...this.state, notice: 'Браузер не разрешил выбрать этот аудиовыход' })
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
        this.send({
          type: 'call_rejected',
          version: 1,
          conversation_id: frame.conversationId,
          call_id: frame.callId,
          reason: 'busy',
        })
        return
      }
      this.cleanup()
      this.caller = false
      this.offerSent = false
      this.summaryRecorded = false
      this.connectedAt = null
      this.pendingOffer = frame.sdp
      this.update({
        phase: 'incoming',
        conversationId: frame.conversationId,
        callId: frame.callId,
        muted: false,
        startedAt: null,
        notice: 'Входящий голосовой звонок',
        audioOutputSupported: false,
        audioOutputs: [],
        selectedAudioOutputId: '',
      })
      this.tones.startIncoming()
      navigator.vibrate?.([280, 140, 280])
      this.armRingTimeout()
      return
    }
    if (frame.callId !== this.state.callId) return
    if (frame.type === 'call_answer' && this.peer && frame.sdp) {
      this.tones.stop()
      this.clearRingTimeout()
      await this.peer.setRemoteDescription({ type: 'answer', sdp: frame.sdp })
      await this.flushCandidates()
      this.update({ ...this.state, phase: 'connecting', notice: 'Соединяем…' })
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
    const peer = new RTCPeerConnection(loaded.configuration)
    this.peer = peer
    for (const track of this.localStream.getAudioTracks()) peer.addTrack(track, this.localStream)
    this.remoteAudio = new Audio()
    this.remoteAudio.autoplay = true
    await this.refreshAudioOutputs()
    if (!this.listeningForDeviceChanges) {
      navigator.mediaDevices.addEventListener?.('devicechange', this.handleDeviceChange)
      this.listeningForDeviceChanges = true
    }
    peer.addEventListener('track', event => {
      const [stream] = event.streams
      if (stream && this.remoteAudio) {
        this.remoteAudio.srcObject = stream
        void this.remoteAudio.play().catch(() => {
          this.update({ ...this.state, notice: 'Нажмите на экран, чтобы включить звук' })
        })
      }
    })
    peer.addEventListener('icecandidate', event => {
      if (!event.candidate || !this.state.conversationId || !this.state.callId) return
      this.send({
        type: 'ice_candidate',
        version: 1,
        conversation_id: this.state.conversationId,
        call_id: this.state.callId,
        candidate: JSON.stringify(event.candidate.toJSON()),
      })
    })
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'connected') {
        this.tones.stop()
        this.connectedAt = Date.now()
        this.update({ ...this.state, phase: 'active', startedAt: this.connectedAt, notice: null })
      } else if (peer.connectionState === 'failed') {
        this.finish('Не удалось установить соединение', 'failed')
      }
    })
    return peer
  }

  private async flushCandidates(): Promise<void> {
    if (!this.peer) return
    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.peer.addIceCandidate(candidate)
    }
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
      version: 1,
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

  private fail(notice: string, notifyPeer = false): void {
    if (notifyPeer) this.sendTerminal('call_ended', 'media_error')
    this.recordSummary('failed')
    this.cleanup()
    this.update({ ...this.state, phase: 'error', notice, startedAt: null })
  }

  private finish(notice: string, outcome: VoiceCallSummary['outcome']): void {
    this.recordSummary(outcome)
    this.cleanup()
    this.update({ ...this.state, phase: 'ended', notice, startedAt: null })
  }

  private cleanup(): void {
    this.tones.stop()
    navigator.vibrate?.(0)
    this.clearRingTimeout()
    this.peer?.close()
    this.peer = null
    for (const track of this.localStream?.getTracks() ?? []) track.stop()
    this.localStream = null
    if (this.remoteAudio) this.remoteAudio.srcObject = null
    this.remoteAudio = null
    this.pendingOffer = null
    this.pendingCandidates = []
    if (this.listeningForDeviceChanges) {
      navigator.mediaDevices?.removeEventListener?.('devicechange', this.handleDeviceChange)
      this.listeningForDeviceChanges = false
    }
  }

  private readonly handleDeviceChange = (): void => {
    void this.refreshAudioOutputs()
  }

  private async refreshAudioOutputs(): Promise<void> {
    const audio = this.remoteAudio
    const supported = typeof audio?.setSinkId === 'function'
      && typeof navigator.mediaDevices?.enumerateDevices === 'function'
    if (!supported) {
      this.update({
        ...this.state,
        audioOutputSupported: false,
        audioOutputs: [],
        selectedAudioOutputId: '',
      })
      return
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const seen = new Set<string>()
      const outputs = devices.filter(device => (
        device.kind === 'audiooutput'
        && device.deviceId.length > 0
        && !seen.has(device.deviceId)
        && seen.add(device.deviceId)
      )).map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Аудиовыход ${index + 1}`,
      }))
      const selected = outputs.some(item => item.deviceId === this.state.selectedAudioOutputId)
        ? this.state.selectedAudioOutputId
        : ''
      if (selected !== this.state.selectedAudioOutputId) await audio.setSinkId('')
      this.update({
        ...this.state,
        audioOutputSupported: true,
        audioOutputs: outputs,
        selectedAudioOutputId: selected,
      })
    } catch {
      this.update({ ...this.state, audioOutputSupported: false, audioOutputs: [] })
    }
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
