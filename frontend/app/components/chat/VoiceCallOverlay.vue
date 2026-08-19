<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { VoiceCallAudioOutput, VoiceCallState } from '../../domain/calls/voice-call'
import { voiceCallStatus } from '../../presentation/calls/voice-call-status'
import type { AppIconName } from '../../presentation/icons'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  state: VoiceCallState
  peerName: string
  accept: () => Promise<void>
  reject: () => void
  hangup: () => void
  toggleMute: () => void
  toggleCamera: () => Promise<void>
  switchCamera: () => Promise<void>
  attachVideoElements: (
    local: HTMLVideoElement | null,
    remote: HTMLVideoElement | null,
  ) => void
  selectAudioOutput: (deviceId: string) => Promise<void>
  requestAudioOutput: () => Promise<void>
  resumeAudio: () => void
  minimize: () => void
  dismiss: () => void
}>()

const now = ref(Date.now())
const localVideo = ref<HTMLVideoElement | null>(null)
const remoteVideo = ref<HTMLVideoElement | null>(null)
const audioRoutingOpen = ref(false)
const timer = setInterval(() => { now.value = Date.now() }, 1_000)
const stopVideoAttachment = watch(
  [localVideo, remoteVideo],
  ([local, remote]) => props.attachVideoElements(local, remote),
  { flush: 'post', immediate: true },
)
onBeforeUnmount(() => {
  clearInterval(timer)
  stopVideoAttachment()
  props.attachVideoElements(null, null)
})

const status = computed(() => voiceCallStatus(props.state, now.value))
const minimizable = computed(() => (
  props.state.phase === 'incoming'
  || props.state.phase === 'outgoing'
  || props.state.phase === 'connecting'
  || props.state.phase === 'active'
))

const audioRoutingAvailable = computed(() => (
  props.state.phase === 'outgoing'
  || props.state.phase === 'connecting'
  || props.state.phase === 'active'
))

watch(
  () => props.state.phase,
  phase => {
    if (phase === 'incoming' || phase === 'ended' || phase === 'error') {
      audioRoutingOpen.value = false
    }
  },
)

async function chooseAudioOutput(deviceId: string): Promise<void> {
  await props.selectAudioOutput(deviceId)
  audioRoutingOpen.value = false
}

function outputTitle(kind: VoiceCallAudioOutput['kind']): string {
  return {
    speaker: 'Громкая связь',
    earpiece: 'Телефон',
    headphones: 'Наушники',
    bluetooth: 'Bluetooth',
    other: 'Аудиовыход',
  }[kind]
}

function outputIcon(kind: VoiceCallAudioOutput['kind']): AppIconName {
  if (kind === 'earpiece') return 'phone'
  if (kind === 'headphones') return 'headphones'
  if (kind === 'bluetooth') return 'bluetooth'
  return 'speaker'
}
</script>

<template>
  <aside
    class="voice-call"
    :class="{ 'voice-call--remote-video': state.remoteVideoEnabled }"
    role="dialog"
    aria-modal="true"
    aria-label="Аудио- или видеозвонок"
    @pointerdown="resumeAudio"
  >
    <section class="voice-call__stage" aria-label="Видео звонка">
      <video
        ref="remoteVideo"
        class="voice-call__remote-video"
        autoplay
        muted
        playsinline
      />
      <div v-if="!state.remoteVideoEnabled" class="voice-call__video-placeholder">
        <span>{{ peerName.slice(0, 1).toUpperCase() }}</span>
        <small>{{ state.phase === 'connecting' ? 'Устанавливаем защищённое видео…' : 'Камера собеседника выключена' }}</small>
      </div>
      <video
        v-if="state.cameraEnabled"
        ref="localVideo"
        class="voice-call__local-video"
        :class="{ 'voice-call__local-video--mirrored': state.cameraFacingMode === 'user' }"
        autoplay
        muted
        playsinline
      />
    </section>
    <div class="voice-call__scrim" aria-hidden="true" />
    <header class="voice-call__topbar">
      <button
        v-if="minimizable"
        class="voice-call__minimize"
        type="button"
        aria-label="Свернуть звонок"
        @click.stop="minimize"
      >
        <AppIcon name="collapse" />
      </button>
      <div class="voice-call__identity">
        <h2>{{ peerName }}</h2>
        <p aria-live="polite">{{ status }}</p>
        <span class="voice-call__security">
          <span aria-hidden="true">🔒</span>
          {{ state.identityVerified ? 'Защищённый звонок · MLS' : 'Проверяем устройство…' }}
        </span>
        <span v-if="state.verificationCode" class="voice-call__verification">
          Код сверки: {{ state.verificationCode }}
        </span>
      </div>
    </header>
    <section
      v-if="audioRoutingOpen && audioRoutingAvailable"
      class="voice-call__routing"
      aria-labelledby="audio-routing-title"
      @pointerdown.stop
    >
      <div class="voice-call__routing-head">
        <strong id="audio-routing-title">Куда выводить звук</strong>
        <button type="button" aria-label="Закрыть выбор аудиовыхода" @click="audioRoutingOpen = false">×</button>
      </div>
      <div v-if="state.audioOutputSupported" class="voice-call__routes">
        <button
          class="voice-call__route"
          :class="{ 'voice-call__route--selected': state.selectedAudioOutputId === '' }"
          type="button"
          :aria-pressed="state.selectedAudioOutputId === ''"
          @click="chooseAudioOutput('')"
        >
          <AppIcon name="speaker" />
          <span><b>Система</b><small>Маршрут телефона</small></span>
        </button>
        <button
          v-for="output in state.audioOutputs"
          :key="output.deviceId"
          class="voice-call__route"
          :class="{ 'voice-call__route--selected': state.selectedAudioOutputId === output.deviceId }"
          type="button"
          :aria-pressed="state.selectedAudioOutputId === output.deviceId"
          @click="chooseAudioOutput(output.deviceId)"
        >
          <AppIcon :name="outputIcon(output.kind)" />
          <span><b>{{ outputTitle(output.kind) }}</b><small>{{ output.label }}</small></span>
        </button>
        <button
          v-if="state.audioOutputPickerSupported"
          class="voice-call__route voice-call__route--picker"
          type="button"
          @click="requestAudioOutput"
        >
          <AppIcon name="headphones" />
          <span><b>Выбрать устройство…</b><small>Наушники или Bluetooth</small></span>
        </button>
      </div>
      <small v-else class="voice-call__routing-note">
        На этой платформе маршрут выбирается в системном меню звука: телефон,
        громкая связь или подключённые наушники.
      </small>
    </section>
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
        :class="{ 'voice-call__action--muted': !state.cameraEnabled }"
        type="button"
        :disabled="!state.cameraSupported || state.cameraBusy || !state.identityVerified"
        :aria-label="state.cameraEnabled ? 'Выключить камеру' : 'Включить камеру'"
        @click="toggleCamera"
      >
        <AppIcon :name="state.cameraEnabled ? 'camera' : 'camera-off'" />
      </button>
      <button
        v-if="state.cameraEnabled"
        class="voice-call__action"
        type="button"
        :disabled="state.cameraBusy"
        aria-label="Переключить камеру"
        @click="switchCamera"
      >
        <AppIcon name="camera-switch" />
      </button>
      <button
        class="voice-call__action"
        :class="{ 'voice-call__action--muted': state.muted }"
        type="button"
        :aria-label="state.muted ? 'Включить микрофон' : 'Выключить микрофон'"
        @click="toggleMute"
      >
        <AppIcon :name="state.muted ? 'microphone-off' : 'microphone'" />
      </button>
      <button
        v-if="audioRoutingAvailable"
        class="voice-call__action"
        :class="{ 'voice-call__action--selected': audioRoutingOpen }"
        type="button"
        aria-label="Выбрать аудиовыход"
        :aria-expanded="audioRoutingOpen"
        @click.stop="audioRoutingOpen = !audioRoutingOpen"
      >
        <AppIcon name="speaker" />
      </button>
      <button class="voice-call__action voice-call__action--reject" type="button" aria-label="Завершить" @click="hangup">
        <AppIcon name="phone-off" />
      </button>
    </div>
  </aside>
</template>
