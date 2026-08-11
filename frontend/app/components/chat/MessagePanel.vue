<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { RealtimeConnectionState } from '../../application/messaging/realtime-sync-service'
import type {
  Conversation,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'

const props = defineProps<{
  conversation: Conversation | null
  messages: readonly TimelineMessage[]
  actorUserId: string
  sending: boolean
  protectionSecure: boolean
  protectionLabel: string
  sendMessage: (plaintext: string) => Promise<boolean>
  deleteMessage: (messageId: string) => Promise<boolean>
  deletingMessageId: string | null
  typingActorIds: readonly string[]
  onlineActorIds: readonly string[]
  deliveryStates: readonly ParticipantDeliveryState[]
  connectionState: RealtimeConnectionState
  setTyping: (conversationId: string, active: boolean) => void
}>()
const emit = defineEmits<{ back: [] }>()

const draft = ref('')
const deleteCandidateId = ref<string | null>(null)
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

const connectionLabel = computed(() => ({
  connecting: 'Подключаем синхронизацию',
  connected: 'Синхронизация активна',
  reconnecting: 'Переподключаем синхронизацию',
  stopped: 'Синхронизация остановлена',
})[props.connectionState])

function conversationName(conversation: Conversation): string {
  if (conversation.conversationType === 'group') return conversation.title ?? 'Группа'
  return conversation.members.find(member => member.userId !== props.actorUserId)?.displayName
    ?? 'Личный диалог'
}

function senderName(message: TimelineMessage): string {
  if (message.senderUserId === props.actorUserId) return 'Вы'
  return props.conversation?.members.find(member => member.userId === message.senderUserId)?.displayName
    ?? 'Участник'
}

function deliveryLabel(message: TimelineMessage): string | null {
  if (
    message.senderUserId !== props.actorUserId
    || message.deletedAt !== null
    || !props.conversation
  ) return null
  const recipients = props.conversation.members.filter(member => (
    member.userId !== props.actorUserId && member.leftAt === null
  ))
  const delivered = recipients.filter(member => (
    props.deliveryStates.some(state => (
      state.conversationId === message.conversationId
      && state.userId === member.userId
      && state.deliveredSequence >= message.sequence
    ))
  )).length
  if (props.conversation.conversationType === 'direct') {
    return delivered > 0 ? 'Доставлено' : 'Отправлено'
  }
  return delivered > 0 ? `Доставлено: ${delivered}/${recipients.length}` : 'Отправлено'
}

function canDelete(message: TimelineMessage): boolean {
  if (message.deletedAt !== null || !props.conversation) return false
  if (message.senderUserId === props.actorUserId) return true
  if (props.conversation.conversationType !== 'group') return false
  const actor = props.conversation.members.find(member => (
    member.userId === props.actorUserId && member.leftAt === null
  ))
  return actor?.role === 'owner' || actor?.role === 'admin'
}

async function confirmDelete(messageId: string): Promise<void> {
  if (await props.deleteMessage(messageId)) deleteCandidateId.value = null
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
    if (conversationId !== previousConversationId) {
      draft.value = ''
      deleteCandidateId.value = null
    }
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
      <span
        class="connection-dot"
        :class="`connection-dot--${connectionState}`"
        :title="connectionLabel"
        :aria-label="connectionLabel"
      />
    </header>

    <p v-if="!protectionSecure" class="security-warning" role="status">
      {{ protectionLabel }}. Не отправляйте чувствительные данные.
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
        <p v-if="message.contentState === 'available'">
          {{ message.displayBody }}
        </p>
        <p v-else-if="message.contentState === 'deleted'" class="message-tombstone">
          {{ message.deletionReason === 'expired' ? 'Срок хранения сообщения истёк' : 'Сообщение удалено для всех' }}
        </p>
        <p v-else class="message-unavailable" role="status">
          {{ message.displayBody }}
        </p>
        <div v-if="canDelete(message)" class="message-actions">
          <template v-if="deleteCandidateId === message.messageId">
            <span>Удалить без возможности восстановления?</span>
            <button
              type="button"
              :disabled="deletingMessageId === message.messageId"
              @click="confirmDelete(message.messageId)"
            >
              {{ deletingMessageId === message.messageId ? 'Удаляем…' : 'Да, удалить' }}
            </button>
            <button type="button" @click="deleteCandidateId = null">Отмена</button>
          </template>
          <button
            v-else
            type="button"
            @click="deleteCandidateId = message.messageId"
          >
            Удалить у всех
          </button>
        </div>
        <small>
          #{{ message.sequence }} · {{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          <template v-if="deliveryLabel(message)"> · {{ deliveryLabel(message) }}</template>
        </small>
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
