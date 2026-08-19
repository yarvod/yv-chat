<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import type { VoiceCallState } from '../../domain/calls/voice-call'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  state: VoiceCallState
  peerName: string
  accept: () => Promise<void>
  reject: () => void
  hangup: () => void
  toggleMute: () => void
  selectAudioOutput: (deviceId: string) => Promise<void>
  resumeAudio: () => void
  dismiss: () => void
}>()

const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1_000)
onBeforeUnmount(() => clearInterval(timer))

const duration = computed(() => {
  if (!props.state.startedAt) return null
  const seconds = Math.max(0, Math.floor((now.value - props.state.startedAt) / 1_000))
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`
})
const status = computed(() => duration.value ?? props.state.notice ?? (
  props.state.phase === 'outgoing' ? 'Вызываем…' : 'Голосовой звонок'
))

function changeAudioOutput(event: Event): void {
  void props.selectAudioOutput((event.target as HTMLSelectElement).value)
}
</script>

<template>
  <aside
    class="voice-call"
    role="dialog"
    aria-modal="true"
    aria-label="Голосовой звонок"
    @pointerdown="resumeAudio"
  >
    <div class="voice-call__glow" aria-hidden="true" />
    <div class="voice-call__avatar" aria-hidden="true">
      {{ peerName.slice(0, 1).toUpperCase() }}
    </div>
    <h2>{{ peerName }}</h2>
    <p aria-live="polite">{{ status }}</p>
    <span class="voice-call__security">
      <span aria-hidden="true">🔒</span> Аудио защищено WebRTC
    </span>
    <label
      v-if="state.audioOutputSupported && state.audioOutputs.length > 0"
      class="voice-call__output"
    >
      <AppIcon name="speaker" />
      <span class="sr-only">Аудиовыход</span>
      <select :value="state.selectedAudioOutputId" @change="changeAudioOutput">
        <option value="">Системный выбор</option>
        <option
          v-for="output in state.audioOutputs"
          :key="output.deviceId"
          :value="output.deviceId"
        >
          {{ output.label }}
        </option>
      </select>
    </label>
    <small
      v-else-if="state.phase === 'active'"
      class="voice-call__routing-note"
    >
      Динамик, телефон и Bluetooth переключаются средствами системы
    </small>
    <div v-if="state.phase === 'incoming'" class="voice-call__actions">
      <button class="voice-call__action voice-call__action--reject" type="button" aria-label="Отклонить" @click="reject">
        <AppIcon name="phone-off" />
      </button>
      <button class="voice-call__action voice-call__action--accept" type="button" aria-label="Ответить" @click="accept">
        <AppIcon name="phone" />
      </button>
    </div>
    <div v-else-if="state.phase === 'ended' || state.phase === 'error'" class="voice-call__actions">
      <button class="voice-call__dismiss" type="button" @click="dismiss">Закрыть</button>
    </div>
    <div v-else class="voice-call__actions">
      <button
        class="voice-call__action"
        :class="{ 'voice-call__action--muted': state.muted }"
        type="button"
        :aria-label="state.muted ? 'Включить микрофон' : 'Выключить микрофон'"
        @click="toggleMute"
      >
        <AppIcon :name="state.muted ? 'microphone-off' : 'microphone'" />
      </button>
      <button class="voice-call__action voice-call__action--reject" type="button" aria-label="Завершить" @click="hangup">
        <AppIcon name="phone-off" />
      </button>
    </div>
  </aside>
</template>
