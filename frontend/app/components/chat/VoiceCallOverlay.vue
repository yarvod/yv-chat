<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'

import type { ScreenShareQuality, VoiceCallAudioOutput, VoiceCallState } from '../../domain/calls/voice-call'
import { SCREEN_SHARE_FRAME_RATES, SCREEN_SHARE_RESOLUTIONS } from '../../domain/calls/voice-call'
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
  toggleScreenShare: () => Promise<void>
  setScreenShareQuality: (quality: ScreenShareQuality) => Promise<void>
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
const overlay = ref<HTMLElement | null>(null)
const localVideo = ref<HTMLVideoElement | null>(null)
const remoteVideo = ref<HTMLVideoElement | null>(null)
const remoteVideoContained = ref(false)
const audioRoutingOpen = ref(false)
const screenQualityOpen = ref(false)
const controlsHidden = ref(false)
const controlsHovered = ref(false)
const controlsFocused = ref(false)
const keyboardInteraction = ref(false)
let hideControlsTimer: ReturnType<typeof setTimeout> | null = null
let previousFocus: HTMLElement | null = null
let unmounting = false
if (typeof document !== 'undefined') {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
}
const remoteVideoVisible = computed(() => (
  props.state.remoteVideoEnabled && !props.state.screenSharing
))
const canHideControls = computed(() => (
  props.state.phase === 'active'
  && remoteVideoVisible.value
  && !audioRoutingOpen.value
  && !screenQualityOpen.value
  && !props.state.cameraBusy
  && !props.state.notice
  && !controlsHovered.value
  && !(keyboardInteraction.value && controlsFocused.value)
))

function revealControls(): void {
  if (unmounting) return
  controlsHidden.value = false
  if (hideControlsTimer !== null) clearTimeout(hideControlsTimer)
  hideControlsTimer = null
  if (canHideControls.value) {
    hideControlsTimer = setTimeout(() => {
      hideControlsTimer = null
      controlsHidden.value = true
    }, 3_000)
  }
}

function pointerActivity(event: PointerEvent): void {
  controlsHovered.value = event.pointerType !== 'touch'
    && event.target instanceof Element
    && event.target.closest('[data-call-controls]') !== null
  revealControls()
}

function pointerDown(event: PointerEvent): void {
  keyboardInteraction.value = false
  pointerActivity(event)
  props.resumeAudio()
}

function keyboardActivity(event: KeyboardEvent): void {
  keyboardInteraction.value = true
  if (event.key === 'Escape') {
    audioRoutingOpen.value = false
    screenQualityOpen.value = false
  }
  revealControls()
}

function focusActivity(event: FocusEvent): void {
  const focused = event.type === 'focusin' ? event.target : event.relatedTarget
  controlsFocused.value = focused instanceof Element
    && focused.closest('[data-call-controls]') !== null
  revealControls()
}

watch(canHideControls, revealControls, { immediate: true })
watch([audioRoutingOpen, screenQualityOpen], () => {
  if (audioRoutingOpen.value || screenQualityOpen.value) return
  // A removed panel can no longer be hovered/focused, even if the pointer
  // has not moved since its close button was clicked.
  controlsHovered.value = false
  const focused = document.activeElement
  controlsFocused.value = focused instanceof Element
    && overlay.value?.contains(focused) === true
    && focused.closest('[data-call-controls]') !== null
  revealControls()
}, { flush: 'post' })
const timer = setInterval(() => { now.value = Date.now() }, 1_000)
const stopVideoAttachment = watch(
  [localVideo, remoteVideo],
  ([local, remote]) => props.attachVideoElements(local, remote),
  { flush: 'post', immediate: true },
)
const stopRemoteFitWatch = watch(
  [remoteVideo, remoteVideoVisible],
  () => syncRemoteVideoFit(),
  { flush: 'post' },
)
onMounted(() => {
  window.addEventListener('resize', syncRemoteVideoFit)
  overlay.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  unmounting = true
  stopVideoAttachment()
  stopRemoteFitWatch()
  window.removeEventListener('resize', syncRemoteVideoFit)
  props.attachVideoElements(null, null)
  clearInterval(timer)
  if (hideControlsTimer !== null) clearTimeout(hideControlsTimer)
})
onUnmounted(() => {
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
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

function syncRemoteVideoFit(): void {
  const video = remoteVideo.value
  if (
    !video
    || !remoteVideoVisible.value
    || video.videoWidth <= 0
    || video.videoHeight <= 0
    || video.clientWidth <= 0
    || video.clientHeight <= 0
  ) {
    remoteVideoContained.value = false
    return
  }
  const mediaAspect = video.videoWidth / video.videoHeight
  const stageAspect = video.clientWidth / video.clientHeight
  const cropRatio = Math.max(mediaAspect / stageAspect, stageAspect / mediaAspect)
  remoteVideoContained.value = cropRatio > 1.3
}

watch(
  () => props.state.phase,
  phase => {
    if (phase === 'incoming' || phase === 'ended' || phase === 'error') {
      audioRoutingOpen.value = false
      screenQualityOpen.value = false
    }
  },
)

async function chooseAudioOutput(deviceId: string): Promise<void> {
  await props.selectAudioOutput(deviceId)
  audioRoutingOpen.value = false
}

function toggleAudioRouting(): void {
  screenQualityOpen.value = false
  audioRoutingOpen.value = !audioRoutingOpen.value
}

function toggleScreenQuality(): void {
  audioRoutingOpen.value = false
  screenQualityOpen.value = !screenQualityOpen.value
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
    ref="overlay"
    class="voice-call"
    :class="{
      'voice-call--remote-video': remoteVideoVisible,
      'voice-call--controls-hidden': controlsHidden,
    }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label="Аудио- или видеозвонок"
    @pointerdown="pointerDown"
    @pointermove="pointerActivity"
    @pointerleave="controlsHovered = false; revealControls()"
    @keydown="keyboardActivity"
    @focusin="focusActivity"
    @focusout="focusActivity"
  >
    <section class="voice-call__stage" aria-label="Видео звонка">
      <video
        ref="remoteVideo"
        class="voice-call__remote-video"
        :class="{
          'voice-call__remote-video--contained': remoteVideoContained,
          'voice-call__remote-video--suppressed': state.screenSharing,
        }"
        :aria-hidden="!remoteVideoVisible"
        autoplay
        muted
        playsinline
        @loadedmetadata="syncRemoteVideoFit"
        @resize="syncRemoteVideoFit"
      />
      <div v-if="!remoteVideoVisible" class="voice-call__video-placeholder">
        <span>{{ peerName.slice(0, 1).toUpperCase() }}</span>
        <small v-if="state.screenSharing">
          Видео собеседника скрыто, чтобы демонстрация экрана не зацикливалась
        </small>
        <small v-else>
          {{ state.phase === 'connecting' ? 'Устанавливаем защищённое видео…' : 'Камера собеседника выключена' }}
        </small>
      </div>
      <video
        v-if="state.cameraEnabled && !state.screenSharing"
        ref="localVideo"
        class="voice-call__local-video"
        :class="{ 'voice-call__local-video--mirrored': state.cameraFacingMode === 'user' }"
        autoplay
        muted
        playsinline
      />
    </section>
    <div class="voice-call__scrim" aria-hidden="true" />
    <header class="voice-call__topbar" data-call-controls>
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
        <span v-if="state.screenSharing" class="voice-call__sharing-status">
          Вы показываете экран · {{ state.screenShareQuality.resolution }}p · {{ state.screenShareQuality.frameRate }} fps
        </span>
      </div>
      <button
        v-if="state.screenShareSupported && state.identityVerified && audioRoutingAvailable"
        class="voice-call__minimize voice-call__quality-button"
        type="button"
        aria-label="Настроить качество демонстрации"
        :aria-expanded="screenQualityOpen"
        @click.stop="toggleScreenQuality"
      >
        <AppIcon name="settings" />
      </button>
    </header>
    <section
      v-if="screenQualityOpen && state.screenShareSupported && audioRoutingAvailable"
      class="voice-call__routing voice-call__screen-settings"
      aria-labelledby="screen-quality-title"
      data-call-controls
    >
      <div class="voice-call__routing-head">
        <strong id="screen-quality-title">Качество демонстрации</strong>
        <button type="button" aria-label="Закрыть настройки демонстрации" @click="screenQualityOpen = false">×</button>
      </div>
      <fieldset :disabled="state.cameraBusy" class="voice-call__quality-options">
        <legend>Разрешение</legend>
        <button
          v-for="resolution in SCREEN_SHARE_RESOLUTIONS"
          :key="resolution"
          type="button"
          :aria-pressed="state.screenShareQuality.resolution === resolution"
          @click="setScreenShareQuality({ ...state.screenShareQuality, resolution })"
        >
          {{ resolution }}p
        </button>
      </fieldset>
      <fieldset :disabled="state.cameraBusy" class="voice-call__quality-options">
        <legend>Кадров в секунду</legend>
        <button
          v-for="frameRate in SCREEN_SHARE_FRAME_RATES"
          :key="frameRate"
          type="button"
          :aria-pressed="state.screenShareQuality.frameRate === frameRate"
          @click="setScreenShareQuality({ ...state.screenShareQuality, frameRate })"
        >
          {{ frameRate }} fps
        </button>
      </fieldset>
      <p class="voice-call__quality-note">
        15 fps — меньше нагрузка. 60 fps — плавнее движение.
        Реальное качество зависит от экрана, устройства и соединения.
      </p>
      <button
        v-if="!state.screenSharing"
        class="voice-call__quality-start"
        type="button"
        :disabled="state.cameraBusy"
        @click="screenQualityOpen = false; toggleScreenShare()"
      >
        Показать экран · {{ state.screenShareQuality.resolution }}p / {{ state.screenShareQuality.frameRate }} fps
      </button>
    </section>
    <section
      v-if="audioRoutingOpen && audioRoutingAvailable"
      class="voice-call__routing"
      aria-labelledby="audio-routing-title"
      data-call-controls
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
    <div v-if="state.phase === 'incoming'" class="voice-call__actions" data-call-controls>
      <button class="voice-call__action voice-call__action--reject" type="button" aria-label="Отклонить" @click="reject">
        <AppIcon name="phone-off" />
      </button>
      <button class="voice-call__action voice-call__action--accept" type="button" aria-label="Ответить" @click="accept">
        <AppIcon name="phone" />
      </button>
    </div>
    <div v-else-if="state.phase === 'ended' || state.phase === 'error'" class="voice-call__actions" data-call-controls>
      <button class="voice-call__dismiss" type="button" @click="dismiss">Закрыть</button>
    </div>
    <div v-else class="voice-call__actions" data-call-controls>
      <button
        class="voice-call__action"
        :class="{ 'voice-call__action--muted': !state.cameraEnabled }"
        type="button"
        :disabled="!state.cameraSupported || state.cameraBusy || !state.identityVerified || state.screenSharing"
        :aria-label="state.cameraEnabled ? 'Выключить камеру' : 'Включить камеру'"
        @click="toggleCamera"
      >
        <AppIcon :name="state.cameraEnabled ? 'camera' : 'camera-off'" />
      </button>
      <button
        class="voice-call__action"
        :class="{ 'voice-call__action--sharing': state.screenSharing }"
        type="button"
        :disabled="!state.screenShareSupported || state.cameraBusy || !state.identityVerified"
        :aria-label="state.screenSharing ? 'Остановить демонстрацию экрана' : 'Показать экран'"
        :aria-pressed="state.screenSharing"
        @click="toggleScreenShare"
      >
        <AppIcon name="screen-share" />
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
        @click.stop="toggleAudioRouting"
      >
        <AppIcon name="speaker" />
      </button>
      <button class="voice-call__action voice-call__action--reject" type="button" aria-label="Завершить" @click="hangup">
        <AppIcon name="phone-off" />
      </button>
    </div>
  </aside>
</template>
