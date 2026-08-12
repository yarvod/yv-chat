<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  VIDEO_NOTE_MAX_DURATION_MS,
  type RecordedVideoNote,
  type VideoNoteFacingMode,
  type VideoNoteRecorder,
  type VideoNoteRecordingSession,
} from '../../application/ports/video-note-recorder'

type CapturePhase = 'idle' | 'opening' | 'recording' | 'locked' | 'finishing'

const props = defineProps<{
  recorder: VideoNoteRecorder
  disabled: boolean
}>()
const emit = defineEmits<{
  recorded: [recording: RecordedVideoNote]
  error: [message: string]
}>()

const phase = ref<CapturePhase>('idle')
const previewVideo = ref<HTMLVideoElement | null>(null)
const previewStream = ref<MediaStream | null>(null)
const facingMode = ref<VideoNoteFacingMode>('user')
const elapsedMilliseconds = ref(0)
const cancelArmed = ref(false)
const switchingCamera = ref(false)
let session: VideoNoteRecordingSession | null = null
let pointerId: number | null = null
let pointerStartX = 0
let pointerStartY = 0
let pointerReleasedWhileOpening = false
let lockRequestedWhileOpening = false
let startedAt = 0
let maximumTimer: ReturnType<typeof setTimeout> | null = null
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let operationId = 0

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (code === 'unsupported') return 'Этот браузер не поддерживает запись видеокружков.'
    if (code === 'permission') {
      return 'Доступ к камере или микрофону не выдан. Если системный запрос не появился, разрешите оба устройства в настройках установленной PWA или сайта, затем снова удерживайте кнопку.'
    }
    if (code === 'too-large') return 'Запись получилась слишком большой. Попробуйте записать короче.'
  }
  return 'Не удалось записать видеокружок. Проверьте камеру и повторите.'
}

function formattedElapsed(): string {
  const totalSeconds = Math.min(60, Math.floor(elapsedMilliseconds.value / 1_000))
  return `0:${String(totalSeconds).padStart(2, '0')}`
}

async function attachPreview(): Promise<void> {
  await nextTick()
  if (!previewVideo.value || !previewStream.value) return
  previewVideo.value.srcObject = previewStream.value
  try {
    await previewVideo.value.play()
  } catch {
    // The stream was opened from a user gesture; browser UI still owns autoplay policy.
  }
}

function startTimers(): void {
  startedAt = performance.now()
  elapsedMilliseconds.value = 0
  elapsedTimer = setInterval(() => {
    elapsedMilliseconds.value = Math.min(
      VIDEO_NOTE_MAX_DURATION_MS,
      performance.now() - startedAt,
    )
  }, 100)
  maximumTimer = setTimeout(() => {
    void finishRecording()
  }, VIDEO_NOTE_MAX_DURATION_MS)
}

function clearTimers(): void {
  if (maximumTimer !== null) clearTimeout(maximumTimer)
  if (elapsedTimer !== null) clearInterval(elapsedTimer)
  maximumTimer = null
  elapsedTimer = null
}

function addPointerListeners(): void {
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerCancel)
}

function removePointerListeners(): void {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerCancel)
}

async function beginRecording(event: PointerEvent): Promise<void> {
  if (props.disabled || phase.value !== 'idle' || !props.recorder.isSupported()) {
    if (!props.recorder.isSupported()) emit('error', errorMessage({ code: 'unsupported' }))
    return
  }
  event.preventDefault()
  pointerId = event.pointerId
  pointerStartX = event.clientX
  pointerStartY = event.clientY
  pointerReleasedWhileOpening = false
  lockRequestedWhileOpening = false
  cancelArmed.value = false
  phase.value = 'opening'
  addPointerListeners()
  const currentOperation = ++operationId
  try {
    const opened = await props.recorder.open(facingMode.value)
    if (currentOperation !== operationId) {
      await opened.cancel()
      return
    }
    session = opened
    previewStream.value = opened.previewStream
    facingMode.value = opened.facingMode
    await attachPreview()
    opened.start()
    phase.value = lockRequestedWhileOpening ? 'locked' : 'recording'
    startTimers()
    if (pointerReleasedWhileOpening) await finishRecording()
  } catch (error) {
    await resetCapture()
    emit('error', errorMessage(error))
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerId !== pointerId || (phase.value !== 'opening' && phase.value !== 'recording')) return
  event.preventDefault()
  const horizontal = event.clientX - pointerStartX
  const vertical = event.clientY - pointerStartY
  cancelArmed.value = horizontal <= -72 && Math.abs(horizontal) > Math.abs(vertical)
  if (!cancelArmed.value && vertical <= -72 && Math.abs(vertical) >= Math.abs(horizontal)) {
    if (phase.value === 'opening') lockRequestedWhileOpening = true
    else phase.value = 'locked'
    pointerId = null
    removePointerListeners()
  }
}

function handlePointerUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return
  pointerId = null
  removePointerListeners()
  if (phase.value === 'opening') {
    if (cancelArmed.value) void cancelRecording()
    else pointerReleasedWhileOpening = true
    return
  }
  if (phase.value !== 'recording') return
  if (cancelArmed.value) void cancelRecording()
  else void finishRecording()
}

function handlePointerCancel(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return
  void cancelRecording()
}

async function switchCamera(): Promise<void> {
  if (!session || (phase.value !== 'locked' && phase.value !== 'recording') || switchingCamera.value) return
  switchingCamera.value = true
  try {
    previewStream.value = await session.switchCamera()
    facingMode.value = session.facingMode
    await attachPreview()
  } catch (error) {
    emit('error', errorMessage(error))
  } finally {
    switchingCamera.value = false
  }
}

async function finishRecording(): Promise<void> {
  const activeSession = session
  if (!activeSession || (phase.value !== 'recording' && phase.value !== 'locked')) return
  phase.value = 'finishing'
  pointerId = null
  removePointerListeners()
  elapsedMilliseconds.value = Math.min(
    VIDEO_NOTE_MAX_DURATION_MS,
    performance.now() - startedAt,
  )
  clearTimers()
  try {
    if (elapsedMilliseconds.value < 700) {
      await activeSession.cancel()
      emit('error', 'Удерживайте кнопку чуть дольше, чтобы записать видеокружок.')
    } else {
      emit('recorded', await activeSession.stop())
    }
  } catch (error) {
    emit('error', errorMessage(error))
  } finally {
    await resetCapture(false)
  }
}

async function cancelRecording(): Promise<void> {
  const activeSession = session
  ++operationId
  clearTimers()
  pointerId = null
  removePointerListeners()
  phase.value = 'finishing'
  try {
    await activeSession?.cancel()
  } finally {
    await resetCapture(false)
  }
}

async function resetCapture(invalidateOperation = true): Promise<void> {
  if (invalidateOperation) ++operationId
  clearTimers()
  removePointerListeners()
  pointerId = null
  pointerReleasedWhileOpening = false
  lockRequestedWhileOpening = false
  cancelArmed.value = false
  switchingCamera.value = false
  const activeSession = session
  session = null
  if (invalidateOperation) await activeSession?.cancel()
  if (previewVideo.value) previewVideo.value.srcObject = null
  previewStream.value = null
  phase.value = 'idle'
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden' && phase.value !== 'idle') {
    void cancelRecording()
  }
}

watch(() => props.disabled, disabled => {
  if (disabled && phase.value !== 'idle') void cancelRecording()
})

onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange))

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  ++operationId
  clearTimers()
  removePointerListeners()
  void session?.cancel()
})
</script>

<template>
  <div class="video-note-capture">
    <button
      class="video-note-button"
      type="button"
      :disabled="disabled"
      aria-label="Удерживайте, чтобы записать видеокружок"
      title="Удерживайте для записи · влево отмена · вверх фиксация"
      @touchstart.prevent
      @pointerdown="beginRecording"
      @contextmenu.prevent
      @selectstart.prevent
      @dragstart.prevent
    >
      <span aria-hidden="true" />
    </button>

    <Teleport to="body">
      <Transition name="video-note-overlay">
        <div
          v-if="phase !== 'idle'"
          class="video-note-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Запись видеокружка"
        >
          <div class="video-note-recorder" :class="{ 'is-cancel-armed': cancelArmed }">
            <div class="video-note-recorder__preview">
              <video
                ref="previewVideo"
                muted
                autoplay
                playsinline
                :class="{ mirrored: facingMode === 'user' }"
              />
              <span v-if="phase === 'opening'" class="loading-orbit" aria-hidden="true" />
              <span v-else class="video-note-recorder__time">{{ formattedElapsed() }}</span>
            </div>
            <p v-if="phase === 'opening'">Подключаем камеру…</p>
            <p v-else-if="cancelArmed" class="video-note-recorder__cancel-hint">Отпустите, чтобы отменить</p>
            <p v-else-if="phase === 'locked'">Запись зафиксирована</p>
            <p v-else>← отмена · ↑ зафиксировать</p>
            <div v-if="phase === 'locked'" class="video-note-recorder__actions">
              <button type="button" class="danger" @click="cancelRecording">Отмена</button>
              <button
                type="button"
                :disabled="switchingCamera"
                aria-label="Переключить камеру"
                @click="switchCamera"
              >
                {{ switchingCamera ? '…' : '↻' }}
              </button>
              <button type="button" class="primary" @click="finishRecording">Отправить</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
