<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import type { MessageCodec } from '../../services/messaging/syntheticCodec'
import type { Conversation, OpaqueMessage } from '../../services/messaging/types'

const props = defineProps<{
  conversation: Conversation | null
  messages: readonly OpaqueMessage[]
  actorUserId: string
  sending: boolean
  codec: MessageCodec
  sendMessage: (plaintext: string) => Promise<boolean>
}>()

const draft = ref('')
const timeline = ref<HTMLElement | null>(null)

function conversationName(conversation: Conversation): string {
  if (conversation.conversationType === 'group') return conversation.title ?? 'Группа'
  return conversation.members.find(member => member.userId !== props.actorUserId)?.displayName
    ?? 'Личный диалог'
}

function senderName(message: OpaqueMessage): string {
  if (message.senderUserId === props.actorUserId) return 'Вы'
  return props.conversation?.members.find(member => member.userId === message.senderUserId)?.displayName
    ?? 'Участник'
}

async function submit(): Promise<void> {
  const value = draft.value
  if (await props.sendMessage(value)) draft.value = ''
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    timeline.value?.scrollTo({ top: timeline.value.scrollHeight })
  },
)
</script>

<template>
  <section v-if="conversation" class="message-panel">
    <header class="conversation-header">
      <div>
        <h2>{{ conversationName(conversation) }}</h2>
        <p>{{ conversation.conversationType === 'group' ? `${conversation.members.length} участников` : 'Личный диалог' }}</p>
      </div>
      <span class="connection-dot" title="Синхронизация активна" />
    </header>

    <p v-if="!codec.secure" class="security-warning" role="status">
      {{ codec.label }}. Не отправляйте чувствительные данные.
    </p>

    <div ref="timeline" class="message-timeline" aria-live="polite">
      <div v-if="messages.length === 0" class="empty-timeline">
        <span>✦</span>
        <h3>Начните разговор</h3>
        <p>Первое сообщение появится у всех участников после синхронизации.</p>
      </div>
      <article
        v-for="message in messages"
        :key="message.messageId"
        class="message-bubble"
        :class="{ own: message.senderUserId === actorUserId }"
      >
        <strong>{{ senderName(message) }}</strong>
        <p>{{ codec.decode(message.ciphertextBase64) }}</p>
        <small>#{{ message.sequence }} · {{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</small>
      </article>
    </div>

    <form class="composer" @submit.prevent="submit">
      <label class="sr-only" for="message-draft">Сообщение</label>
      <textarea
        id="message-draft"
        v-model="draft"
        maxlength="4000"
        rows="1"
        placeholder="Напишите сообщение…"
        @keydown.enter.exact.prevent="submit"
      />
      <button class="send-button" type="submit" :disabled="sending || draft.trim().length === 0" aria-label="Отправить">
        {{ sending ? '…' : '↑' }}
      </button>
    </form>
  </section>

  <section v-else class="conversation-placeholder">
    <span class="brand-mark large">Y</span>
    <h2>Выберите диалог</h2>
    <p>Или создайте новый с помощью кнопки «+».</p>
  </section>
</template>
