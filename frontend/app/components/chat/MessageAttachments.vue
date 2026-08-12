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
const galleryRoot = ref<HTMLElement | null>(null)
const activeImageIndex = ref<number | null>(null)
const pending = new Map<string, Promise<MediaState>>()
let imageObserver: IntersectionObserver | null = null
let touchStartX: number | null = null
const imageAttachments = computed(() => props.attachments.filter(item => item.kind === 'image'))
const activeImage = computed(() => activeImageIndex.value === null
  ? null
  : imageAttachments.value[activeImageIndex.value] ?? null)

function stateFor(attachmentId: string): MediaState | undefined {
  return mediaStates.value.get(attachmentId)
}

function setState(attachmentId: string, state: MediaState): void {
  mediaStates.value = new Map(mediaStates.value).set(attachmentId, state)
}

async function load(attachment: MessageAttachment): Promise<MediaState> {
  const existing = stateFor(attachment.attachmentId)
  if (existing?.phase === 'ready') return existing
  const running = pending.get(attachment.attachmentId)
  if (running) return await running
  setState(attachment.attachmentId, { phase: 'loading' })
  const request = props.loadAttachment(props.conversationId, attachment)
    .then(blob => {
      const state = { phase: 'ready' as const, blob, url: URL.createObjectURL(blob) }
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

async function openImage(attachment: MessageAttachment): Promise<void> {
  const state = await load(attachment)
  if (state.phase !== 'ready') return
  const index = imageAttachments.value.findIndex(item => (
    item.attachmentId === attachment.attachmentId
  ))
  if (index >= 0) activeImageIndex.value = index
}

function closeViewer(): void {
  activeImageIndex.value = null
}

async function moveViewer(direction: -1 | 1): Promise<void> {
  if (activeImageIndex.value === null || imageAttachments.value.length < 2) return
  const nextIndex = (
    activeImageIndex.value + direction + imageAttachments.value.length
  ) % imageAttachments.value.length
  const attachment = imageAttachments.value[nextIndex]
  if (!attachment) return
  const state = await load(attachment)
  if (state.phase === 'ready') activeImageIndex.value = nextIndex
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

function observeVisibleImages(): void {
  imageObserver?.disconnect()
  imageObserver = null
  const root = galleryRoot.value
  if (!root) return
  if (!('IntersectionObserver' in window)) {
    for (const attachment of imageAttachments.value) void load(attachment)
    return
  }
  imageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const attachmentId = (entry.target as HTMLElement).dataset.attachmentId
      const attachment = imageAttachments.value.find(item => item.attachmentId === attachmentId)
      if (attachment) void load(attachment)
      imageObserver?.unobserve(entry.target)
    }
  }, { rootMargin: '500px 0px' })
  for (const element of root.querySelectorAll<HTMLElement>('[data-attachment-id]')) {
    imageObserver.observe(element)
  }
}

watch(
  () => props.attachments,
  async attachments => {
    const currentIds = new Set(attachments.map(item => item.attachmentId))
    for (const [attachmentId, state] of mediaStates.value) {
      if (currentIds.has(attachmentId)) continue
      if (state.url) URL.revokeObjectURL(state.url)
      mediaStates.value.delete(attachmentId)
    }
    await nextTick()
    observeVisibleImages()
  },
)

onMounted(() => {
  observeVisibleImages()
})

watch(activeImageIndex, (current, previous) => {
  if (previous === null && current !== null) window.addEventListener('keydown', handleViewerKeydown)
  if (previous !== null && current === null) window.removeEventListener('keydown', handleViewerKeydown)
})

onBeforeUnmount(() => {
  imageObserver?.disconnect()
  window.removeEventListener('keydown', handleViewerKeydown)
  for (const state of mediaStates.value.values()) {
    if (state.url) URL.revokeObjectURL(state.url)
  }
})
</script>

<template>
  <div
    ref="galleryRoot"
    class="message-attachments"
    :class="{ 'message-attachments--gallery': imageAttachments.length > 1 }"
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
          @click="openImage(attachment)"
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

      <button
        v-else
        class="message-file"
        type="button"
        :disabled="stateFor(attachment.attachmentId)?.phase === 'loading'"
        @click="downloadFile(attachment)"
      >
        <span class="message-file__icon"><AppIcon name="attachment" /></span>
        <span>
          <strong>{{ attachment.name }}</strong>
          <small v-if="stateFor(attachment.attachmentId)?.phase === 'unavailable'">
            Не удалось скачать · повторить
          </small>
          <small v-else-if="stateFor(attachment.attachmentId)?.phase === 'loading'">
            Загружаем…
          </small>
          <small v-else>{{ formatBytes(attachment.byteSize) }}</small>
        </span>
      </button>
    </template>
  </div>

  <Teleport to="body">
    <Transition name="media-viewer">
      <div
        v-if="activeImage && activeImageIndex !== null"
        class="media-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="`Просмотр ${activeImage.name}`"
        @click.self="closeViewer"
        @touchstart.passive="handleViewerTouchStart"
        @touchend.passive="handleViewerTouchEnd"
      >
        <button class="media-viewer__close" type="button" aria-label="Закрыть" @click="closeViewer">
          <AppIcon name="close" />
        </button>
        <button
          v-if="imageAttachments.length > 1"
          class="media-viewer__previous"
          type="button"
          aria-label="Предыдущее фото"
          @click="moveViewer(-1)"
        >
          ‹
        </button>
        <img
          :src="stateFor(activeImage.attachmentId)?.url"
          :alt="activeImage.name"
          @click.stop
        >
        <button
          v-if="imageAttachments.length > 1"
          class="media-viewer__next"
          type="button"
          aria-label="Следующее фото"
          @click="moveViewer(1)"
        >
          ›
        </button>
        <p>{{ activeImageIndex + 1 }} / {{ imageAttachments.length }} · {{ activeImage.name }}</p>
      </div>
    </Transition>
  </Teleport>
</template>
