import type { CallRealtimeFrame } from '../../domain/messaging/realtime'
import type { OutgoingCallSignal } from '../../application/ports/realtime-gateway'
import type { VoiceCallState } from '../../domain/calls/voice-call'

interface CallSignalingTransport {
  sendCallSignal(signal: OutgoingCallSignal): boolean
}

interface CallConfigGateway {
  load(): Promise<{ enabled: boolean, configuration: RTCConfiguration }>
}

const IDLE_STATE: VoiceCallState = {
  phase: 'idle',
  conversationId: null,
  callId: null,
  muted: false,
  startedAt: null,
  notice: null,
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

  constructor(
    private readonly signaling: CallSignalingTransport,
    private readonly config: CallConfigGateway,
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
    const callId = crypto.randomUUID()
    this.update({
      phase: 'connecting',
      conversationId,
      callId,
      muted: false,
      startedAt: null,
      notice: 'Подключаем микрофон…',
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
      this.update({ ...this.state, phase: 'outgoing', notice: 'Вызываем…' })
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
    this.finish('Звонок отклонён')
  }

  hangup(): void {
    if (this.state.phase === 'idle') return
    this.sendTerminal('call_ended', 'hangup')
    this.finish('Звонок завершён')
  }

  toggleMute(): void {
    const next = !this.state.muted
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !next
    this.update({ ...this.state, muted: next })
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
      this.pendingOffer = frame.sdp
      this.update({
        phase: 'incoming',
        conversationId: frame.conversationId,
        callId: frame.callId,
        muted: false,
        startedAt: null,
        notice: 'Входящий голосовой звонок',
      })
      this.armRingTimeout()
      return
    }
    if (frame.callId !== this.state.callId) return
    if (frame.type === 'call_answer' && this.peer && frame.sdp) {
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
      this.finish(frame.reason === 'busy' ? 'Собеседник занят' : 'Звонок отклонён')
      return
    }
    if (frame.type === 'call_ended') {
      this.finish(frame.reason === 'answered_elsewhere' ? 'Принято на другом устройстве' : 'Звонок завершён')
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
        this.update({ ...this.state, phase: 'active', startedAt: Date.now(), notice: null })
      } else if (peer.connectionState === 'failed') {
        this.finish('Не удалось установить соединение')
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
      this.finish('Нет ответа')
    }, 60_000)
  }

  private clearRingTimeout(): void {
    if (this.ringTimer !== null) clearTimeout(this.ringTimer)
    this.ringTimer = null
  }

  private fail(notice: string, notifyPeer = false): void {
    if (notifyPeer) this.sendTerminal('call_ended', 'media_error')
    this.cleanup()
    this.update({ ...this.state, phase: 'error', notice, startedAt: null })
  }

  private finish(notice: string): void {
    this.cleanup()
    this.update({ ...this.state, phase: 'ended', notice, startedAt: null })
  }

  private cleanup(): void {
    this.clearRingTimeout()
    this.peer?.close()
    this.peer = null
    for (const track of this.localStream?.getTracks() ?? []) track.stop()
    this.localStream = null
    if (this.remoteAudio) this.remoteAudio.srcObject = null
    this.remoteAudio = null
    this.pendingOffer = null
    this.pendingCandidates = []
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
