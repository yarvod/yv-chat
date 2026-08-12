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
  attachments: readonly MessageAttachment[]
  loadAttachment: (conversationId: string, attachment: MessageAttachment) => Promise<Blob>
}>()

const mediaStates = ref(new Map<string, MediaState>())
const playbackFailures = ref(new Set<string>())
const galleryRoot = ref<HTMLElement | null>(null)
const viewerRoot = ref<HTMLElement | null>(null)
const activeMediaIndex = ref<number | null>(null)
const pending = new Map<string, Promise<MediaState>>()
let mediaObserver: IntersectionObserver | null = null
let touchStartX: number | null = null
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

async function load(attachment: MessageAttachment): Promise<MediaState> {
  const existing = stateFor(attachment.attachmentId)
  if (existing?.phase === 'ready') return existing
  const running = pending.get(attachment.attachmentId)
  if (running) return await running
  setState(attachment.attachmentId, { phase: 'loading' })
  const request = props.loadAttachment(props.conversationId, attachment)
    .then(blob => {
      const url = URL.createObjectURL(blob)
      if (disposed) {
        URL.revokeObjectURL(url)
        return { phase: 'unavailable' as const }
      }
      const state = { phase: 'ready' as const, blob, url }
      setState(attachment.attachmentId, state)
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
  activeMediaIndex.value = null
}

async function moveViewer(direction: -1 | 1): Promise<void> {
  if (activeMediaIndex.value === null || mediaAttachments.value.length < 2) return
  pauseViewerVideo()
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
  const endX = event.changedTouches[0]?.clientX
  if (touchStartX === null || endX === undefined) return
  const distance = endX - touchStartX
  touchStartX = null
  if (Math.abs(distance) < 50) return
  void moveViewer(distance > 0 ? -1 : 1)
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
    if (
      activeMediaIndex.value !== null
      && activeMediaIndex.value >= mediaAttachments.value.length
    ) closeViewer()
    await nextTick()
    observeVisibleMedia()
  },
)

onMounted(() => {
  observeVisibleMedia()
})

watch(activeMediaIndex, (current, previous) => {
  if (previous === null && current !== null) window.addEventListener('keydown', handleViewerKeydown)
  if (previous !== null && current === null) window.removeEventListener('keydown', handleViewerKeydown)
})

onBeforeUnmount(() => {
  disposed = true
  mediaObserver?.disconnect()
  window.removeEventListener('keydown', handleViewerKeydown)
  pauseViewerVideo()
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
          :src="stateFor(activeMedia.attachmentId)?.url"
          :alt="activeMedia.name"
          @click.stop
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
        <p>{{ activeMediaIndex + 1 }} / {{ mediaAttachments.length }} · {{ activeMedia.name }}</p>
      </div>
    </Transition>
  </Teleport>
</template>
