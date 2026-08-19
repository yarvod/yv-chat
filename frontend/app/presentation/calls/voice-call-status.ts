import type { VoiceCallState } from '../../domain/calls/voice-call'

type VoiceCallStatusState = Pick<VoiceCallState, 'notice' | 'phase' | 'startedAt'>

export function formatVoiceCallDuration(startedAt: number | null, now: number): string | null {
  if (startedAt === null) return null
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000))
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`
}

export function voiceCallStatus(state: VoiceCallStatusState, now: number): string {
  return formatVoiceCallDuration(state.startedAt, now) ?? state.notice ?? (
    state.phase === 'incoming'
      ? 'Входящий звонок'
      : state.phase === 'outgoing'
        ? 'Вызываем…'
        : state.phase === 'connecting'
          ? 'Соединяем…'
          : 'Голосовой звонок'
  )
}
