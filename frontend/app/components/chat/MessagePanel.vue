<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { RealtimeConnectionState } from '../../application/messaging/realtime-sync-service'
import type {
  Conversation,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'
import { buildTimelineLayout } from '../../presentation/chat/timeline-layout'
import AppIcon from '../ui/AppIcon.vue'

const props = withDefaults(defineProps<{
  conversation: Conversation | null
  messages: readonly TimelineMessage[]
  historyHasMore?: boolean
  historyHasNewer?: boolean
  loadingOlder?: boolean
  archiveStatus?: 'ready' | 'unavailable'
  actorUserId: string
  sending: boolean
  protectionSecure: boolean
  protectionLabel: string
  sendMessage: (plaintext: string) => Promise<boolean>
  loadOlder?: () => Promise<void>
  returnToLatest?: () => Promise<void>
  deleteMessage: (messageId: string) => Promise<boolean>
  deletingMessageId: string | null
  typingActorIds: readonly string[]
  onlineActorIds: readonly string[]
  deliveryStates: readonly ParticipantDeliveryState[]
  connectionState: RealtimeConnectionState
  setTyping: (conversationId: string, active: boolean) => void
}>(), {
  historyHasMore: false,
  historyHasNewer: false,
  loadingOlder: false,
  archiveStatus: 'ready',
  loadOlder: async () => undefined,
  returnToLatest: async () => undefined,
})
const emit = defineEmits<{ back: [] }>()

const draft = ref('')
const deleteCandidateId = ref<string | null>(null)
const timeline = ref<HTMLElement | null>(null)
const composerInput = ref<HTMLTextAreaElement | null>(null)
const showScrollToLatest = ref(false)

const timelineItems = computed(() => props.conversation
  ? buildTimelineLayout(
      props.messages,
      props.conversation.conversationType,
      props.actorUserId,
    )
  : [])

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
  if (props.sending || draft.value.trim().length === 0) return
  const value = draft.value
  if (await props.sendMessage(value)) {
    draft.value = ''
    await nextTick()
    resizeComposer()
    scrollToLatest('smooth')
  }
}

function isNearLatest(): boolean {
  const element = timeline.value
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight < 120
}

function handleTimelineScroll(): void {
  if (isNearLatest()) showScrollToLatest.value = false
}

function scrollToLatest(behavior: ScrollBehavior = 'smooth'): void {
  const element = timeline.value
  if (!element) return
  element.scrollTo({ top: element.scrollHeight, behavior })
  showScrollToLatest.value = false
}

async function loadOlderPreservingAnchor(): Promise<void> {
  const element = timeline.value
  if (!element || props.loadingOlder) return
  const previousHeight = element.scrollHeight
  const previousTop = element.scrollTop
  await props.loadOlder()
  await nextTick()
  element.scrollTop = previousTop + Math.max(0, element.scrollHeight - previousHeight)
}

async function goToLatest(): Promise<void> {
  if (props.historyHasNewer) {
    await props.returnToLatest()
    await nextTick()
  }
  scrollToLatest('smooth')
}

function resizeComposer(): void {
  const element = composerInput.value
  if (!element) return
  element.style.height = 'auto'
  const height = Math.min(element.scrollHeight, 128)
  element.style.height = `${height}px`
  element.style.overflowY = element.scrollHeight > 128 ? 'auto' : 'hidden'
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
}

watch(
  () => ({
    length: props.messages.length,
    oldest: props.messages[0]?.messageId ?? null,
    newest: props.messages.at(-1)?.messageId ?? null,
  }),
  async (current, previous) => {
    const previousLength = previous?.length ?? 0
    const prepended = previous !== undefined
      && current.oldest !== previous.oldest
      && current.newest === previous.newest
    if (prepended) return
    const shouldFollow = previousLength === 0
      || isNearLatest()
      || props.messages.at(-1)?.senderUserId === props.actorUserId
    await nextTick()
    if (shouldFollow) scrollToLatest(previousLength === 0 ? 'auto' : 'smooth')
    else if (current.length > previousLength) showScrollToLatest.value = true
  },
)

watch(draft, value => {
  if (props.conversation) props.setTyping(props.conversation.conversationId, value.trim().length > 0)
})

watch(
  () => props.conversation?.conversationId,
  async (conversationId, previousConversationId) => {
    if (previousConversationId) props.setTyping(previousConversationId, false)
    if (conversationId !== previousConversationId) {
      draft.value = ''
      deleteCandidateId.value = null
      showScrollToLatest.value = false
      await nextTick()
      resizeComposer()
      scrollToLatest('auto')
    }
  },
)

onMounted(() => {
  resizeComposer()
  scrollToLatest('auto')
})

onBeforeUnmount(() => {
  if (props.conversation) props.setTyping(props.conversation.conversationId, false)
})
</script>

<template>
  <section v-if="conversation" class="message-panel">
    <header class="conversation-header">
      <button class="mobile-back" type="button" aria-label="К списку диалогов" @click="emit('back')">
        <AppIcon name="back" />
      </button>
      <span class="conversation-header-avatar" aria-hidden="true">
        {{ conversationName(conversation).slice(0, 1).toUpperCase() }}
      </span>
      <div class="conversation-header-copy">
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

    <div v-if="!protectionSecure || archiveStatus === 'unavailable'" class="timeline-notices">
      <p v-if="!protectionSecure" class="security-warning" role="status">
        {{ protectionLabel }}. Не отправляйте чувствительные данные.
      </p>
      <p v-if="archiveStatus === 'unavailable'" class="storage-warning" role="status">
        Локальная история недоступна. Online-синхронизация продолжает работать.
      </p>
    </div>

    <div ref="timeline" class="message-timeline" aria-live="polite" @scroll.passive="handleTimelineScroll">
      <button
        v-if="historyHasMore && messages.length > 0"
        class="load-older"
        type="button"
        :disabled="loadingOlder"
        @click="loadOlderPreservingAnchor"
      >
        {{ loadingOlder ? 'Загружаем историю…' : 'Показать более ранние сообщения' }}
      </button>
      <div v-if="messages.length === 0" class="empty-timeline">
        <span>✦</span>
        <h3>Начните разговор</h3>
        <p>Первое сообщение появится у всех участников после синхронизации.</p>
      </div>
      <template v-for="item in timelineItems" :key="item.key">
        <div v-if="item.kind === 'day'" class="timeline-day">
          <span>{{ item.label }}</span>
        </div>
        <article
          v-else
          class="message-bubble"
          :class="{
            own: item.message.senderUserId === actorUserId,
            joined: item.joinedToPrevious,
          }"
        >
          <strong v-if="item.showSender">{{ senderName(item.message) }}</strong>
          <p v-if="item.message.contentState === 'available'">
            {{ item.message.displayBody }}
          </p>
          <p v-else-if="item.message.contentState === 'deleted'" class="message-tombstone">
            {{ item.message.deletionReason === 'expired' ? 'Срок хранения сообщения истёк' : 'Сообщение удалено для всех' }}
          </p>
          <p v-else class="message-unavailable" role="status">
            {{ item.message.displayBody }}
          </p>
          <div v-if="canDelete(item.message)" class="message-actions">
            <template v-if="deleteCandidateId === item.message.messageId">
              <span>Удалить без возможности восстановления?</span>
              <button
                type="button"
                :disabled="deletingMessageId === item.message.messageId"
                @click="confirmDelete(item.message.messageId)"
              >
                {{ deletingMessageId === item.message.messageId ? 'Удаляем…' : 'Да, удалить' }}
              </button>
              <button type="button" @click="deleteCandidateId = null">Отмена</button>
            </template>
            <button
              v-else
              type="button"
              :aria-label="`Удалить сообщение #${item.message.sequence} у всех`"
              @click="deleteCandidateId = item.message.messageId"
            >
              Удалить у всех
            </button>
          </div>
          <small class="message-meta">
            <time :datetime="item.message.createdAt">
              {{ new Date(item.message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
            </time>
            <span v-if="deliveryLabel(item.message)" class="delivery-state" :title="deliveryLabel(item.message) ?? undefined">
              <span aria-hidden="true">{{ deliveryLabel(item.message) === 'Отправлено' ? '✓' : '✓✓' }}</span>
              <span class="sr-only">{{ deliveryLabel(item.message) }}</span>
            </span>
          </small>
        </article>
      </template>
    </div>

    <button
      v-if="showScrollToLatest || historyHasNewer"
      class="scroll-to-latest"
      type="button"
      aria-label="Перейти к новым сообщениям"
      @click="goToLatest"
    >
      <AppIcon name="back" />
      <span aria-hidden="true">{{ historyHasNewer ? 'К последним' : 'Новые' }}</span>
    </button>

    <form class="composer" @submit.prevent="submit">
      <label class="sr-only" for="message-draft">Сообщение</label>
      <textarea
        id="message-draft"
        ref="composerInput"
        v-model="draft"
        maxlength="4000"
        rows="1"
        placeholder="Напишите сообщение…"
        @input="resizeComposer"
        @keydown="handleComposerKeydown"
      />
      <button class="send-button" type="submit" :disabled="sending || draft.trim().length === 0" aria-label="Отправить">
        <span v-if="sending" aria-hidden="true">…</span>
        <AppIcon v-else name="send" />
      </button>
    </form>
  </section>

  <section v-else class="conversation-placeholder">
    <span class="brand-mark large">Y</span>
    <h2>Выберите диалог</h2>
    <p>Или создайте новый с помощью кнопки «+».</p>
  </section>
</template>
