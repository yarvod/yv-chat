<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { MessageAttachment } from '../../domain/messaging/models'
import AppIcon from '../ui/AppIcon.vue'

interface MediaState {
  phase: 'loading' | 'ready' | 'unavailable'
  blob?: Blob
  url?: string
}

const props = defineProps<{
  conversationId: string
  expiresAt: string
  attachments: readonly MessageAttachment[]
  loadAttachment: (
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ) => Promise<Blob>
}>()

const mediaStates = ref(new Map<string, MediaState>())
const playbackFailures = ref(new Set<string>())
const playingVideoNotes = ref(new Set<string>())
const videoNoteProgress = ref(new Map<string, number>())
const videoNoteElapsed = ref(new Map<string, number>())
const expandedVideoNoteId = ref<string | null>(null)
const galleryRoot = ref<HTMLElement | null>(null)
const viewerRoot = ref<HTMLElement | null>(null)
const viewerImage = ref<HTMLImageElement | null>(null)
const activeMediaIndex = ref<number | null>(null)
const imageZoom = ref(1)
const imagePanX = ref(0)
const imagePanY = ref(0)
const pending = new Map<string, Promise<MediaState>>()
const visibleVideoNoteIds = new Set<string>()
let mediaObserver: IntersectionObserver | null = null
let videoNoteObserver: IntersectionObserver | null = null
let touchStartX: number | null = null
let touchStartY: number | null = null
let pinchStartDistance: number | null = null
let pinchStartZoom = 1
let panStartX = 0
let panStartY = 0
let disposed = false

const mediaAttachments = computed(() => (
  props.attachments.filter(item => item.kind === 'image' || item.kind === 'video')
))
const activeMedia = computed(() => activeMediaIndex.value === null
  ? null
  : mediaAttachments.value[activeMediaIndex.value] ?? null)

function stateFor(attachmentId: string): MediaState | undefined {
  return mediaStates.value.get(attachmentId)
}

function setState(attachmentId: string, state: MediaState): void {
  if (!disposed) mediaStates.value = new Map(mediaStates.value).set(attachmentId, state)
}

function playbackFailed(attachmentId: string): boolean {
  return playbackFailures.value.has(attachmentId)
}

function markPlaybackFailure(attachmentId: string): void {
  playbackFailures.value = new Set(playbackFailures.value).add(attachmentId)
}

function videoNoteStyle(attachmentId: string): Record<string, string> {
  const progress = videoNoteProgress.value.get(attachmentId) ?? 0
  return { '--video-note-progress': `${Math.round(progress * 360)}deg` }
}

function videoNoteTimeLabel(attachment: MessageAttachment): string {
  const duration = Math.max(1, Math.min(60, attachment.durationSeconds ?? 1))
  const elapsed = videoNoteElapsed.value.get(attachment.attachmentId) ?? 0
  const remaining = Math.max(0, Math.ceil(duration - elapsed))
  return `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
}

async function toggleVideoNote(attachmentId: string, event: MouseEvent): Promise<void> {
  const button = event.currentTarget as HTMLButtonElement
  const video = button.querySelector('video')
  if (!video) return
  if (expandedVideoNoteId.value === attachmentId) {
    expandedVideoNoteId.value = null
    video.muted = true
    video.loop = true
    try {
      await video.play()
    } catch {
      // Muted autoplay can still be denied by device power/data-saving policy.
    }
    return
  }
  for (const candidate of galleryRoot.value?.querySelectorAll('video') ?? []) {
    if (candidate === video) continue
    candidate.muted = true
    candidate.loop = true
  }
  expandedVideoNoteId.value = attachmentId
  video.loop = false
  video.muted = false
  video.currentTime = 0
  try {
    await video.play()
  } catch {
    expandedVideoNoteId.value = null
    video.muted = true
    video.loop = true
    markPlaybackFailure(attachmentId)
  }
}

function updateVideoNotePlayback(attachmentId: string, event: Event): void {
  const video = event.currentTarget as HTMLVideoElement
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1
  videoNoteProgress.value = new Map(videoNoteProgress.value).set(
    attachmentId,
    Math.max(0, Math.min(1, video.currentTime / duration)),
  )
  videoNoteElapsed.value = new Map(videoNoteElapsed.value).set(
    attachmentId,
    Math.max(0, video.currentTime),
  )
}

function setVideoNotePlaying(attachmentId: string, playing: boolean): void {
  const next = new Set(playingVideoNotes.value)
  if (playing) next.add(attachmentId)
  else next.delete(attachmentId)
  playingVideoNotes.value = next
}

function videoNoteElement(attachmentId: string): HTMLVideoElement | null {
  for (const shell of galleryRoot.value?.querySelectorAll<HTMLElement>(
    '.message-video-note-shell[data-attachment-id]',
  ) ?? []) {
    if (shell.dataset.attachmentId === attachmentId) return shell.querySelector('video')
  }
  return null
}

async function syncVideoNotePlayback(attachmentId: string): Promise<void> {
  const video = videoNoteElement(attachmentId)
  if (!video) return
  if (!visibleVideoNoteIds.has(attachmentId)) {
    video.pause()
    return
  }
  if (expandedVideoNoteId.value !== attachmentId) {
    video.muted = true
    video.loop = true
  }
  try {
    await video.play()
  } catch {
    // Muted autoplay may be denied by device power/data-saving policy.
  }
}

function finishVideoNotePlayback(attachmentId: string, event: Event): void {
  setVideoNotePlaying(attachmentId, false)
  if (expandedVideoNoteId.value !== attachmentId) return
  const video = event.currentTarget as HTMLVideoElement
  expandedVideoNoteId.value = null
  video.muted = true
  video.loop = true
  video.currentTime = 0
  if (visibleVideoNoteIds.has(attachmentId)) void video.play().catch(() => undefined)
}

async function load(attachment: MessageAttachment): Promise<MediaState> {
  const existing = stateFor(attachment.attachmentId)
  if (existing?.phase === 'ready') return existing
  const running = pending.get(attachment.attachmentId)
  if (running) return await running
  setState(attachment.attachmentId, { phase: 'loading' })
  const request = props.loadAttachment(props.conversationId, attachment, props.expiresAt)
    .then(blob => {
      const url = URL.createObjectURL(blob)
      if (disposed) {
        URL.revokeObjectURL(url)
        return { phase: 'unavailable' as const }
      }
      const state = { phase: 'ready' as const, blob, url }
      setState(attachment.attachmentId, state)
      if (attachment.presentation === 'video_note') {
        void nextTick().then(() => syncVideoNotePlayback(attachment.attachmentId))
      }
      return state
    })
    .catch(() => {
      const state = { phase: 'unavailable' as const }
      setState(attachment.attachmentId, state)
      return state
    })
    .finally(() => pending.delete(attachment.attachmentId))
  pending.set(attachment.attachmentId, request)
  return await request
}

function pauseViewerVideo(): void {
  for (const video of viewerRoot.value?.querySelectorAll('video') ?? []) {
    if (!video.paused) video.pause()
  }
}

async function openMedia(attachment: MessageAttachment): Promise<void> {
  const state = await load(attachment)
  if (state.phase !== 'ready') return
  const index = mediaAttachments.value.findIndex(item => (
    item.attachmentId === attachment.attachmentId
  ))
  if (index >= 0) activeMediaIndex.value = index
}

function closeViewer(): void {
  pauseViewerVideo()
  resetImageTransform()
  activeMediaIndex.value = null
}

function resetImageTransform(): void {
  imageZoom.value = 1
  imagePanX.value = 0
  imagePanY.value = 0
  touchStartX = null
  touchStartY = null
  pinchStartDistance = null
}

function setImageZoom(value: number): void {
  imageZoom.value = Math.max(1, Math.min(5, value))
  if (imageZoom.value === 1) {
    imagePanX.value = 0
    imagePanY.value = 0
  }
}

function toggleImageZoom(): void {
  setImageZoom(imageZoom.value > 1 ? 1 : 2.5)
}

function imageTransformStyle(): Record<string, string> {
  return {
    transform: `translate3d(${imagePanX.value}px, ${imagePanY.value}px, 0) scale(${imageZoom.value})`,
  }
}

async function moveViewer(direction: -1 | 1): Promise<void> {
  if (activeMediaIndex.value === null || mediaAttachments.value.length < 2) return
  pauseViewerVideo()
  resetImageTransform()
  const nextIndex = (
    activeMediaIndex.value + direction + mediaAttachments.value.length
  ) % mediaAttachments.value.length
  const attachment = mediaAttachments.value[nextIndex]
  if (!attachment) return
  const state = await load(attachment)
  if (state.phase === 'ready') activeMediaIndex.value = nextIndex
}

function handleViewerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeViewer()
  else if (event.key === 'ArrowLeft') void moveViewer(-1)
  else if (event.key === 'ArrowRight') void moveViewer(1)
}

function handleViewerTouchStart(event: TouchEvent): void {
  touchStartX = event.changedTouches[0]?.clientX ?? null
}

function handleViewerTouchEnd(event: TouchEvent): void {
  if (imageZoom.value > 1) return
  const endX = event.changedTouches[0]?.clientX
  if (touchStartX === null || endX === undefined) return
  const distance = endX - touchStartX
  touchStartX = null
  if (Math.abs(distance) < 50) return
  void moveViewer(distance > 0 ? -1 : 1)
}

function touchDistance(first: Touch, second: Touch): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
}

function handleImageTouchStart(event: TouchEvent): void {
  if (event.touches.length === 2) {
    const first = event.touches[0]
    const second = event.touches[1]
    if (!first || !second) return
    pinchStartDistance = touchDistance(first, second)
    pinchStartZoom = imageZoom.value
    return
  }
  const touch = event.touches[0]
  if (!touch) return
  touchStartX = touch.clientX
  touchStartY = touch.clientY
  panStartX = imagePanX.value
  panStartY = imagePanY.value
}

function handleImageTouchMove(event: TouchEvent): void {
  if (event.touches.length === 2 && pinchStartDistance !== null) {
    const first = event.touches[0]
    const second = event.touches[1]
    if (!first || !second) return
    setImageZoom(pinchStartZoom * touchDistance(first, second) / pinchStartDistance)
    return
  }
  const touch = event.touches[0]
  if (!touch || touchStartX === null || touchStartY === null || imageZoom.value <= 1) return
  imagePanX.value = panStartX + touch.clientX - touchStartX
  imagePanY.value = panStartY + touch.clientY - touchStartY
}

function handleImageTouchEnd(event: TouchEvent): void {
  if (event.touches.length > 0) return
  const end = event.changedTouches[0]
  const startX = touchStartX
  const startY = touchStartY
  pinchStartDistance = null
  touchStartX = null
  touchStartY = null
  if (!end || startX === null || startY === null || imageZoom.value > 1) return
  const horizontal = end.clientX - startX
  const vertical = end.clientY - startY
  if (Math.abs(horizontal) >= 50 && Math.abs(horizontal) > Math.abs(vertical)) {
    void moveViewer(horizontal > 0 ? -1 : 1)
  }
}

function handleImageWheel(event: WheelEvent): void {
  const direction = event.deltaY < 0 ? 0.25 : -0.25
  setImageZoom(imageZoom.value + direction)
}

async function downloadFile(attachment: MessageAttachment): Promise<void> {
  const state = await load(attachment)
  if (state.phase !== 'ready' || !state.url) return
  const anchor = document.createElement('a')
  anchor.href = state.url
  anchor.download = attachment.name
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} КБ`
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}

function observeVisibleMedia(): void {
  mediaObserver?.disconnect()
  mediaObserver = null
  const root = galleryRoot.value
  if (!root) return
  if (!('IntersectionObserver' in window)) {
    for (const attachment of mediaAttachments.value) void load(attachment)
    return
  }
  mediaObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const attachmentId = (entry.target as HTMLElement).dataset.attachmentId
      const attachment = mediaAttachments.value.find(item => item.attachmentId === attachmentId)
      if (attachment) void load(attachment)
      mediaObserver?.unobserve(entry.target)
    }
  }, { rootMargin: '500px 0px' })
  for (const element of root.querySelectorAll<HTMLElement>('[data-attachment-id]')) {
    mediaObserver.observe(element)
  }
}

function observeVideoNotePlayback(): void {
  videoNoteObserver?.disconnect()
  videoNoteObserver = null
  visibleVideoNoteIds.clear()
  const root = galleryRoot.value
  if (!root) return
  for (const video of root.querySelectorAll<HTMLVideoElement>('.message-video-note video')) {
    video.pause()
  }
  if (!('IntersectionObserver' in window)) return
  videoNoteObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const attachmentId = (entry.target as HTMLElement).dataset.attachmentId
      if (!attachmentId) continue
      if (entry.isIntersecting) visibleVideoNoteIds.add(attachmentId)
      else visibleVideoNoteIds.delete(attachmentId)
      void syncVideoNotePlayback(attachmentId)
    }
  }, { threshold: 0.01 })
  for (const element of root.querySelectorAll<HTMLElement>('.message-video-note-shell')) {
    videoNoteObserver.observe(element)
  }
}

watch(
  () => props.attachments,
  async attachments => {
    const currentIds = new Set(attachments.map(item => item.attachmentId))
    const nextStates = new Map(mediaStates.value)
    for (const [attachmentId, state] of nextStates) {
      if (currentIds.has(attachmentId)) continue
      if (state.url) URL.revokeObjectURL(state.url)
      nextStates.delete(attachmentId)
    }
    mediaStates.value = nextStates
    playingVideoNotes.value = new Set(
      [...playingVideoNotes.value].filter(attachmentId => currentIds.has(attachmentId)),
    )
    videoNoteProgress.value = new Map(
      [...videoNoteProgress.value].filter(([attachmentId]) => currentIds.has(attachmentId)),
    )
    videoNoteElapsed.value = new Map(
      [...videoNoteElapsed.value].filter(([attachmentId]) => currentIds.has(attachmentId)),
    )
    if (expandedVideoNoteId.value && !currentIds.has(expandedVideoNoteId.value)) {
      expandedVideoNoteId.value = null
    }
    if (
      activeMediaIndex.value !== null
      && activeMediaIndex.value >= mediaAttachments.value.length
    ) closeViewer()
    await nextTick()
    observeVisibleMedia()
    observeVideoNotePlayback()
  },
)

onMounted(() => {
  observeVisibleMedia()
  observeVideoNotePlayback()
})

watch(activeMediaIndex, (current, previous) => {
  if (current !== previous) resetImageTransform()
  if (previous === null && current !== null) window.addEventListener('keydown', handleViewerKeydown)
  if (previous !== null && current === null) window.removeEventListener('keydown', handleViewerKeydown)
})

onBeforeUnmount(() => {
  disposed = true
  mediaObserver?.disconnect()
  videoNoteObserver?.disconnect()
  visibleVideoNoteIds.clear()
  window.removeEventListener('keydown', handleViewerKeydown)
  pauseViewerVideo()
  for (const video of galleryRoot.value?.querySelectorAll('video') ?? []) video.pause()
  for (const state of mediaStates.value.values()) {
    if (state.url) URL.revokeObjectURL(state.url)
  }
})
</script>

<template>
  <div
    ref="galleryRoot"
    class="message-attachments"
    :class="{ 'message-attachments--gallery': mediaAttachments.length > 1 }"
  >
    <template v-for="attachment in attachments" :key="attachment.attachmentId">
      <div
        v-if="attachment.kind === 'image'"
        class="message-photo-shell"
        :data-attachment-id="attachment.attachmentId"
      >
        <button
          v-if="stateFor(attachment.attachmentId)?.phase === 'ready'"
          class="message-photo"
          type="button"
          :aria-label="`Открыть изображение ${attachment.name}`"
          @click="openMedia(attachment)"
        >
          <img :src="stateFor(attachment.attachmentId)?.url" :alt="attachment.name">
        </button>
        <div
          v-else-if="stateFor(attachment.attachmentId)?.phase !== 'unavailable'"
          class="message-photo-loading"
          role="status"
          aria-label="Загружаем изображение"
        >
          <span class="loading-orbit" aria-hidden="true" />
        </div>
        <div v-else class="attachment-unavailable" role="status">
          <span>Медиа недоступно или срок хранения истёк.</span>
          <button type="button" @click="load(attachment)">Повторить</button>
        </div>
      </div>

      <div
        v-else-if="attachment.kind === 'video' && attachment.presentation === 'video_note'"
        class="message-video-note-shell"
        :class="{ 'is-expanded': expandedVideoNoteId === attachment.attachmentId }"
        :data-attachment-id="attachment.attachmentId"
      >
        <template v-if="stateFor(attachment.attachmentId)?.phase === 'ready'">
          <div v-if="playbackFailed(attachment.attachmentId)" class="message-video-note-unavailable">
            <span>Видео не поддерживается.</span>
            <button type="button" @click="downloadFile(attachment)">Скачать</button>
          </div>
          <button
            v-else
            class="message-video-note"
            :class="{ 'is-expanded': expandedVideoNoteId === attachment.attachmentId }"
            type="button"
            :style="videoNoteStyle(attachment.attachmentId)"
            :aria-label="expandedVideoNoteId === attachment.attachmentId
              ? `Свернуть видеокружок и выключить звук ${attachment.name}`
              : `Увеличить видеокружок и включить звук ${attachment.name}`"
            @click="toggleVideoNote(attachment.attachmentId, $event)"
          >
            <span class="message-video-note__inner">
              <video
                :src="stateFor(attachment.attachmentId)?.url"
                muted
                loop
                playsinline
                preload="metadata"
                @play="setVideoNotePlaying(attachment.attachmentId, true)"
                @pause="setVideoNotePlaying(attachment.attachmentId, false)"
                @ended="finishVideoNotePlayback(attachment.attachmentId, $event)"
                @timeupdate="updateVideoNotePlayback(attachment.attachmentId, $event)"
                @error="markPlaybackFailure(attachment.attachmentId)"
              />
              <span v-if="!playingVideoNotes.has(attachment.attachmentId)" class="message-video-note__play" aria-hidden="true">▶</span>
            </span>
            <span
              v-if="expandedVideoNoteId !== attachment.attachmentId"
              class="message-video-note__muted"
              aria-hidden="true"
            ><AppIcon name="volume-off" /></span>
            <span class="message-video-note__timer" aria-hidden="true">
              <span>{{ videoNoteTimeLabel(attachment) }}</span>
              <i />
            </span>
          </button>
        </template>
        <div
          v-else-if="stateFor(attachment.attachmentId)?.phase !== 'unavailable'"
          class="message-video-note-loading"
          role="status"
          aria-label="Загружаем видеокружок"
        >
          <span class="loading-orbit" aria-hidden="true" />
        </div>
        <div v-else class="message-video-note-unavailable" role="status">
          <span>Видеокружок недоступен или срок хранения истёк.</span>
          <button type="button" @click="load(attachment)">Повторить</button>
        </div>
      </div>

      <div
        v-else-if="attachment.kind === 'video'"
        class="message-video-shell"
        :data-attachment-id="attachment.attachmentId"
      >
        <template v-if="stateFor(attachment.attachmentId)?.phase === 'ready'">
          <div v-if="playbackFailed(attachment.attachmentId)" class="message-video-fallback">
            <AppIcon name="file" />
            <strong>{{ attachment.name }}</strong>
            <small>Этот формат нельзя воспроизвести здесь.</small>
            <button type="button" @click="downloadFile(attachment)">Скачать файл</button>
          </div>
          <template v-else>
            <video
              class="message-video"
              :src="stateFor(attachment.attachmentId)?.url"
              controls
              playsinline
              preload="metadata"
              :aria-label="attachment.name"
              @error="markPlaybackFailure(attachment.attachmentId)"
            />
            <button
              class="message-video__open"
              type="button"
              :aria-label="`Открыть видео ${attachment.name} на весь экран`"
              @click="openMedia(attachment)"
            >
              <AppIcon name="media" />
            </button>
          </template>
        </template>
        <div
          v-else-if="stateFor(attachment.attachmentId)?.phase !== 'unavailable'"
          class="message-photo-loading"
          role="status"
          aria-label="Загружаем видео"
        >
          <span class="loading-orbit" aria-hidden="true" />
        </div>
        <div v-else class="attachment-unavailable" role="status">
          <span>Видео недоступно, не поддерживается или срок хранения истёк.</span>
          <button type="button" @click="load(attachment)">Повторить</button>
        </div>
      </div>

      <button
        v-else
        class="message-file"
        type="button"
        :disabled="stateFor(attachment.attachmentId)?.phase === 'loading'"
        @click="downloadFile(attachment)"
      >
        <span class="message-file__icon"><AppIcon name="file" /></span>
        <span>
          <strong>{{ attachment.name }}</strong>
          <small v-if="stateFor(attachment.attachmentId)?.phase === 'unavailable'">
            Не удалось скачать · повторить
          </small>
          <small v-else-if="stateFor(attachment.attachmentId)?.phase === 'loading'">
            Загружаем…
          </small>
          <small v-else>{{ formatBytes(attachment.byteSize) }} · скачать</small>
        </span>
      </button>
    </template>
  </div>

  <Teleport to="body">
    <Transition name="media-viewer">
      <div
        v-if="activeMedia && activeMediaIndex !== null"
        ref="viewerRoot"
        class="media-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="`Просмотр ${activeMedia.name}`"
        @click.self="closeViewer"
        @touchstart.passive="handleViewerTouchStart"
        @touchend.passive="handleViewerTouchEnd"
      >
        <button class="media-viewer__close" type="button" aria-label="Закрыть" @click="closeViewer">
          <AppIcon name="close" />
        </button>
        <button
          v-if="mediaAttachments.length > 1"
          class="media-viewer__previous"
          type="button"
          aria-label="Предыдущее медиа"
          @click="moveViewer(-1)"
        >
          ‹
        </button>
        <img
          v-if="activeMedia.kind === 'image'"
          ref="viewerImage"
          class="media-viewer__image"
          :src="stateFor(activeMedia.attachmentId)?.url"
          :alt="activeMedia.name"
          :style="imageTransformStyle()"
          @click.stop
          @dblclick.stop="toggleImageZoom"
          @wheel.stop.prevent="handleImageWheel"
          @touchstart.stop="handleImageTouchStart"
          @touchmove.stop.prevent="handleImageTouchMove"
          @touchend.stop="handleImageTouchEnd"
        >
        <div v-else-if="playbackFailed(activeMedia.attachmentId)" class="media-viewer__unsupported">
          <AppIcon name="file" />
          <strong>{{ activeMedia.name }}</strong>
          <span>Браузер не поддерживает кодек этого видео.</span>
          <button type="button" @click="downloadFile(activeMedia)">Скачать файл</button>
        </div>
        <video
          v-else
          :key="activeMedia.attachmentId"
          :src="stateFor(activeMedia.attachmentId)?.url"
          controls
          autoplay
          playsinline
          preload="metadata"
          :aria-label="activeMedia.name"
          @click.stop
          @touchstart.stop
          @touchend.stop
          @error="markPlaybackFailure(activeMedia.attachmentId)"
        />
        <button
          v-if="mediaAttachments.length > 1"
          class="media-viewer__next"
          type="button"
          aria-label="Следующее медиа"
          @click="moveViewer(1)"
        >
          ›
        </button>
        <div v-if="activeMedia.kind === 'image'" class="media-viewer__zoom" aria-label="Масштаб изображения">
          <button type="button" aria-label="Уменьшить" :disabled="imageZoom <= 1" @click="setImageZoom(imageZoom - 0.5)">−</button>
          <span>{{ Math.round(imageZoom * 100) }}%</span>
          <button type="button" aria-label="Увеличить" :disabled="imageZoom >= 5" @click="setImageZoom(imageZoom + 0.5)">+</button>
        </div>
        <p>{{ activeMediaIndex + 1 }} / {{ mediaAttachments.length }} · {{ activeMedia.name }}</p>
      </div>
    </Transition>
  </Teleport>
</template>
