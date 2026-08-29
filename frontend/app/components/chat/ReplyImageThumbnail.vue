<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { ImageThumbnail } from '../../application/ports/image-thumbnail'
import type { MessageAttachment } from '../../domain/messaging/models'

const props = defineProps<{
  conversationId: string
  expiresAt: string
  attachment: MessageAttachment
  loadAttachment: (
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ) => Promise<Blob>
  createThumbnail: (source: Blob, maximumEdge: number) => Promise<ImageThumbnail>
}>()

const root = ref<HTMLElement | null>(null)
const thumbnailUrl = ref<string | null>(null)
let observer: IntersectionObserver | null = null
let loadRevision = 0
let loading = false
let disposed = false

function revokeThumbnail(): void {
  if (thumbnailUrl.value) URL.revokeObjectURL(thumbnailUrl.value)
  thumbnailUrl.value = null
}

async function load(): Promise<void> {
  if (loading || thumbnailUrl.value || disposed) return
  loading = true
  const revision = ++loadRevision
  try {
    const source = await props.loadAttachment(
      props.conversationId,
      props.attachment,
      props.expiresAt,
    )
    const thumbnail = await props.createThumbnail(source, 96)
    if (disposed || revision !== loadRevision) return
    thumbnailUrl.value = URL.createObjectURL(thumbnail.body)
  } catch {
    // The compact placeholder remains when retained media is unavailable.
  } finally {
    if (revision === loadRevision) loading = false
  }
}

function observe(): void {
  observer?.disconnect()
  observer = null
  if (!root.value) return
  if (!('IntersectionObserver' in window)) {
    void load()
    return
  }
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    observer?.disconnect()
    observer = null
    void load()
  }, { rootMargin: '300px 0px' })
  observer.observe(root.value)
}

watch(
  () => `${props.conversationId}:${props.attachment.attachmentId}:${props.expiresAt}`,
  () => {
    loadRevision += 1
    loading = false
    revokeThumbnail()
    observe()
  },
)

onMounted(observe)

onBeforeUnmount(() => {
  disposed = true
  loadRevision += 1
  observer?.disconnect()
  revokeThumbnail()
})
</script>

<template>
  <span ref="root" class="message-reply-thumbnail" aria-hidden="true">
    <img
      v-if="thumbnailUrl"
      :src="thumbnailUrl"
      alt=""
      loading="lazy"
      decoding="async"
    >
  </span>
</template>
