<script setup lang="ts">
import { ref } from 'vue'

import { attachmentDownloadUrl } from '../../application/messaging/group-message-content'
import type { MessageAttachment } from '../../domain/messaging/models'
import AppIcon from '../ui/AppIcon.vue'

defineProps<{
  conversationId: string
  attachments: readonly MessageAttachment[]
}>()

const unavailable = ref(new Set<string>())

function markUnavailable(attachmentId: string): void {
  unavailable.value = new Set([...unavailable.value, attachmentId])
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} КБ`
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}
</script>

<template>
  <div class="message-attachments">
    <template v-for="attachment in attachments" :key="attachment.attachmentId">
      <p v-if="unavailable.has(attachment.attachmentId)" class="attachment-unavailable" role="status">
        Медиа недоступно или срок хранения истёк.
      </p>
      <a
        v-else-if="attachment.kind === 'image'"
        class="message-photo"
        :href="attachmentDownloadUrl(conversationId, attachment.attachmentId)"
        target="_blank"
        rel="noopener"
        :aria-label="`Открыть изображение ${attachment.name}`"
      >
        <img
          :src="attachmentDownloadUrl(conversationId, attachment.attachmentId)"
          :alt="attachment.name"
          loading="lazy"
          @error="markUnavailable(attachment.attachmentId)"
        >
      </a>
      <a
        v-else
        class="message-file"
        :href="attachmentDownloadUrl(conversationId, attachment.attachmentId)"
        :download="attachment.name"
      >
        <span class="message-file__icon"><AppIcon name="attachment" /></span>
        <span>
          <strong>{{ attachment.name }}</strong>
          <small>{{ formatBytes(attachment.byteSize) }}</small>
        </span>
      </a>
    </template>
  </div>
</template>
