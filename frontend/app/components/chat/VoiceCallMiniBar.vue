<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import type { VoiceCallState } from '../../domain/calls/voice-call'
import { voiceCallStatus } from '../../presentation/calls/voice-call-status'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  state: VoiceCallState
  peerName: string
  expand: () => void
  accept: () => Promise<void>
  reject: () => void
  hangup: () => void
  toggleMute: () => void
  toggleCamera: () => Promise<void>
  resumeAudio: () => void
}>()

const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1_000)
onBeforeUnmount(() => clearInterval(timer))

const status = computed(() => voiceCallStatus(props.state, now.value))
</script>

<template>
  <aside
    class="voice-call-mini"
    role="region"
    aria-label="Текущий звонок"
    @pointerdown="resumeAudio"
  >
    <button
      class="voice-call-mini__main"
      type="button"
      :aria-label="`Развернуть звонок с ${peerName}`"
      @click="expand"
    >
      <span class="voice-call-mini__avatar" aria-hidden="true">
        {{ peerName.slice(0, 1).toUpperCase() }}
      </span>
      <span class="voice-call-mini__copy">
        <strong>{{ peerName }}</strong>
        <small aria-live="polite">{{ status }}</small>
      </span>
      <AppIcon name="expand" />
    </button>

    <div v-if="state.phase === 'incoming'" class="voice-call-mini__actions">
      <button
        class="voice-call-mini__action voice-call-mini__action--reject"
        type="button"
        aria-label="Отклонить звонок"
        @click="reject"
      >
        <AppIcon name="phone-off" />
      </button>
      <button
        class="voice-call-mini__action voice-call-mini__action--accept"
        type="button"
        aria-label="Ответить на звонок"
        @click="accept"
      >
        <AppIcon name="phone" />
      </button>
    </div>
    <div v-else class="voice-call-mini__actions">
      <button
        class="voice-call-mini__action"
        :class="{ 'voice-call-mini__action--muted': !state.cameraEnabled }"
        type="button"
        :disabled="!state.cameraSupported || state.cameraBusy || !state.identityVerified"
        :aria-label="state.cameraEnabled ? 'Выключить камеру' : 'Включить камеру'"
        @click="toggleCamera"
      >
        <AppIcon :name="state.cameraEnabled ? 'camera' : 'camera-off'" />
      </button>
      <button
        class="voice-call-mini__action"
        :class="{ 'voice-call-mini__action--muted': state.muted }"
        type="button"
        :aria-label="state.muted ? 'Включить микрофон' : 'Выключить микрофон'"
        @click="toggleMute"
      >
        <AppIcon :name="state.muted ? 'microphone-off' : 'microphone'" />
      </button>
      <button
        class="voice-call-mini__action voice-call-mini__action--reject"
        type="button"
        aria-label="Завершить звонок"
        @click="hangup"
      >
        <AppIcon name="phone-off" />
      </button>
    </div>
  </aside>
</template>
