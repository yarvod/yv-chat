<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import type { MessageCodec } from '../../application/ports/message-codec'
import type { Conversation, OpaqueMessage } from '../../domain/messaging/models'

const props = defineProps<{
  conversation: Conversation | null
  messages: readonly OpaqueMessage[]
  actorUserId: string
  sending: boolean
  codec: MessageCodec
  sendMessage: (plaintext: string) => Promise<boolean>
  typingActorIds: readonly string[]
  onlineActorIds: readonly string[]
  setTyping: (conversationId: string, active: boolean) => void
}>()
const emit = defineEmits<{ back: [] }>()

const draft = ref('')
const timeline = ref<HTMLElement | null>(null)

const typingLabel = computed(() => {
  const names = props.typingActorIds
    .map(actorId => props.conversation?.members.find(member => member.userId === actorId)?.displayName)
    .filter((name): name is string => Boolean(name))
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} печатает`
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают`
  return `${names.length} участника печатают`
})

const presenceLabel = computed(() => {
  if (!props.conversation) return ''
  if (props.conversation.conversationType === 'direct') {
    return props.onlineActorIds.length > 0 ? 'В сети' : 'Не в сети'
  }
  return props.onlineActorIds.length > 0
    ? `${props.onlineActorIds.length} в сети`
    : `${props.conversation.members.length} участников`
})

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

watch(draft, value => {
  if (props.conversation) props.setTyping(props.conversation.conversationId, value.trim().length > 0)
})

watch(
  () => props.conversation?.conversationId,
  (conversationId, previousConversationId) => {
    if (previousConversationId) props.setTyping(previousConversationId, false)
    if (conversationId !== previousConversationId) draft.value = ''
  },
)

onBeforeUnmount(() => {
  if (props.conversation) props.setTyping(props.conversation.conversationId, false)
})
</script>

<template>
  <section v-if="conversation" class="message-panel">
    <header class="conversation-header">
      <button class="mobile-back" type="button" aria-label="К списку диалогов" @click="emit('back')">‹</button>
      <div>
        <h2>{{ conversationName(conversation) }}</h2>
        <p v-if="typingLabel" class="typing-label" aria-live="polite">
          {{ typingLabel }}<span aria-hidden="true">…</span>
        </p>
        <p v-else>{{ presenceLabel }}</p>
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
