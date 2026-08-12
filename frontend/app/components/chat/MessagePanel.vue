<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { GroupAttachmentSource } from '../../application/messaging/upload-group-attachment'
import {
  attachmentKindFor,
  GROUP_ATTACHMENT_LIMIT,
  maximumAttachmentBytes,
} from '../../application/messaging/group-attachment-policy'
import type { OutgoingMessageView } from '../../application/messaging/outgoing-message-view'
import type { RealtimeConnectionState } from '../../application/messaging/realtime-sync-service'
import type {
  Conversation,
  MessageAttachment,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'
import { buildTimelineLayout } from '../../presentation/chat/timeline-layout'
import AppIcon from '../ui/AppIcon.vue'
import MessageAttachments from './MessageAttachments.vue'

const props = withDefaults(defineProps<{
  conversation: Conversation | null
  messages: readonly TimelineMessage[]
  outgoingMessages?: readonly OutgoingMessageView[]
  historyHasMore?: boolean
  historyHasNewer?: boolean
  loadingOlder?: boolean
  archiveStatus?: 'ready' | 'unavailable'
  outboxStatus?: 'ready' | 'unavailable'
  actorUserId: string
  sending: boolean
  attachmentUploadCompleted?: number
  attachmentUploadTotal?: number
  attachmentUploadBytesSent?: number
  attachmentUploadBytesTotal?: number
  protectionSecure: boolean
  protectionLabel: string
  sendMessage: (plaintext: string, attachments?: readonly GroupAttachmentSource[]) => Promise<boolean>
  loadAttachment?: (conversationId: string, attachment: MessageAttachment) => Promise<Blob>
  retryOutgoing?: (clientMessageId: string) => Promise<boolean>
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
  outboxStatus: 'ready',
  outgoingMessages: () => [],
  attachmentUploadCompleted: 0,
  attachmentUploadTotal: 0,
  attachmentUploadBytesSent: 0,
  attachmentUploadBytesTotal: 0,
  retryOutgoing: async () => false,
  loadOlder: async () => undefined,
  returnToLatest: async () => undefined,
  loadAttachment: async () => { throw new TypeError('attachment download unavailable') },
})
const emit = defineEmits<{ back: []; groupDetails: [] }>()

const draft = ref('')
const deleteCandidateId = ref<string | null>(null)
const timeline = ref<HTMLElement | null>(null)
const composerInput = ref<HTMLTextAreaElement | null>(null)
const mediaInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
interface SelectedAttachment {
  file: File
  kind: 'image' | 'video' | 'file'
  previewUrl: string | null
}
const selectedAttachments = ref<SelectedAttachment[]>([])
const attachmentError = ref<string | null>(null)
const attachmentMenuOpen = ref(false)
const showScrollToLatest = ref(false)

function boundedPercent(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.round(Math.max(0, Math.min(1, completed / total)) * 100)
}

const overallAttachmentUploadPercent = computed(() => boundedPercent(
  props.attachmentUploadBytesSent,
  props.attachmentUploadBytesTotal,
))

function attachmentUploadPercent(index: number): number | null {
  if (!props.sending || props.attachmentUploadTotal <= 0) return null
  if (index < props.attachmentUploadCompleted) return 100
  if (index > props.attachmentUploadCompleted) return 0
  if (props.attachmentUploadCompleted >= props.attachmentUploadTotal) return 100
  const item = selectedAttachments.value[index]
  if (!item) return 0
  const completedBytes = selectedAttachments.value
    .slice(0, index)
    .reduce((total, attachment) => total + attachment.file.size, 0)
  return boundedPercent(
    Math.max(0, props.attachmentUploadBytesSent - completedBytes),
    item.file.size,
  )
}

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
    : `${props.conversation.members.filter(member => member.leftAt === null).length} участников`
})

const connectionLabel = computed(() => ({
  connecting: 'Подключаем синхронизацию',
  connected: 'Синхронизация активна',
  reconnecting: 'Переподключаем синхронизацию',
  stopped: 'Синхронизация остановлена',
})[props.connectionState])

function outgoingStatusLabel(message: OutgoingMessageView): string {
  if (message.status === 'pending') return 'В очереди'
  if (message.status === 'sending') return 'Отправляем…'
  if (message.status === 'sent') return 'Подтверждено сервером…'
  if (message.failureCode === 'conflict') return 'Конфликт идентификатора'
  if (message.failureCode === 'forbidden') return 'Нет доступа к диалогу'
  if (message.failureCode === 'unauthorized') return 'Нужно войти заново'
  return 'Не отправлено'
}

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
  if (props.sending || (draft.value.trim().length === 0 && selectedAttachments.value.length === 0)) return
  const value = draft.value
  const attachments = selectedAttachments.value.map(({ file }) => ({
    name: file.name,
    type: file.type,
    size: file.size,
    body: file,
  }))
  const sent = attachments.length === 0
    ? await props.sendMessage(value)
    : await props.sendMessage(value, attachments)
  if (sent) {
    draft.value = ''
    clearAttachments()
    await nextTick()
    resizeComposer()
    scrollToLatest('smooth')
  }
}

function clearAttachments(): void {
  for (const item of selectedAttachments.value) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }
  selectedAttachments.value = []
  attachmentError.value = null
  attachmentMenuOpen.value = false
  if (mediaInput.value) mediaInput.value.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function chooseAttachment(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  attachmentError.value = null
  attachmentMenuOpen.value = false
  if (files.length === 0) return
  if (selectedAttachments.value.length + files.length > GROUP_ATTACHMENT_LIMIT) {
    attachmentError.value = 'В одном сообщении можно отправить не больше 10 файлов.'
    return
  }
  for (const file of files) {
    const kind = attachmentKindFor(file.type)
    const maximum = maximumAttachmentBytes(kind)
    if (file.size <= 0 || file.size > maximum) {
      const limitLabel = kind === 'image' ? '12 МБ' : kind === 'video' ? '100 МБ' : '25 МБ'
      const kindLabel = kind === 'image' ? 'изображение' : kind === 'video' ? 'видео' : 'файл'
      attachmentError.value = `«${file.name}»: ${kindLabel} должно быть не больше ${limitLabel}.`
      return
    }
  }
  selectedAttachments.value = [
    ...selectedAttachments.value,
    ...files.map(file => {
      const kind = attachmentKindFor(file.type)
      return {
        file,
        kind,
        previewUrl: kind === 'file' ? null : URL.createObjectURL(file),
      }
    }),
  ]
}

function openAttachmentPicker(kind: 'media' | 'file'): void {
  attachmentMenuOpen.value = false
  if (kind === 'media') mediaInput.value?.click()
  else fileInput.value?.click()
}

function removeAttachment(index: number): void {
  const item = selectedAttachments.value[index]
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
  selectedAttachments.value = selectedAttachments.value.filter((_, itemIndex) => itemIndex !== index)
  attachmentError.value = null
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
    outgoingLength: props.outgoingMessages.length,
    outgoingNewest: props.outgoingMessages.at(-1)?.clientMessageId ?? null,
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
      || current.outgoingLength > (previous?.outgoingLength ?? 0)
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
      clearAttachments()
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
  clearAttachments()
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
      <button
        v-if="conversation.conversationType === 'group'"
        class="group-info-button"
        type="button"
        aria-label="Информация о группе"
        @click="emit('groupDetails')"
      >
        <AppIcon name="users" />
      </button>
    </header>

    <div v-if="!protectionSecure || archiveStatus === 'unavailable' || outboxStatus === 'unavailable'" class="timeline-notices">
      <p v-if="!protectionSecure" class="security-warning" role="status">
        {{ protectionLabel }}. Не отправляйте чувствительные данные.
      </p>
      <p v-if="archiveStatus === 'unavailable'" class="storage-warning" role="status">
        Локальная история недоступна. Online-синхронизация продолжает работать.
      </p>
      <p v-if="outboxStatus === 'unavailable'" class="storage-warning" role="alert">
        Надёжная очередь отправки недоступна. Новые сообщения не будут отправлены в обход неё.
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
      <div v-if="messages.length === 0 && outgoingMessages.length === 0" class="empty-timeline">
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
          <MessageAttachments
            v-if="item.message.contentState === 'available' && (item.message.displayAttachments?.length ?? 0) > 0"
            :conversation-id="item.message.conversationId"
            :attachments="item.message.displayAttachments ?? []"
            :load-attachment="loadAttachment"
          />
          <p v-if="item.message.contentState === 'available' && item.message.displayBody">
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
      <article
        v-for="message in outgoingMessages"
        :key="`outbox-${message.clientMessageId}`"
        class="message-bubble own outbox-message"
        :class="`outbox-message--${message.status}`"
      >
        <div v-if="(message.displayAttachments?.length ?? 0) > 0" class="outbox-attachment">
          <AppIcon name="attachment" />
          <span>
            {{ message.displayAttachments?.[0]?.name }}
            <template v-if="(message.displayAttachments?.length ?? 0) > 1">
              и ещё {{ (message.displayAttachments?.length ?? 1) - 1 }}
            </template>
          </span>
        </div>
        <p v-if="message.displayBody">{{ message.displayBody }}</p>
        <small class="message-meta outbox-meta">
          <time :datetime="message.createdAt">
            {{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          </time>
          <span role="status">{{ outgoingStatusLabel(message) }}</span>
          <button
            v-if="message.status === 'failed'"
            type="button"
            :aria-label="'Повторить отправку сообщения'"
            @click="retryOutgoing(message.clientMessageId)"
          >
            Повторить
          </button>
        </small>
      </article>
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
      <div v-if="selectedAttachments.length > 0" class="composer-attachments">
        <div class="composer-attachments__heading">
          <span v-if="sending && attachmentUploadBytesTotal > 0" aria-live="polite">
            {{ attachmentUploadCompleted < attachmentUploadTotal
              ? `Загрузка ${overallAttachmentUploadPercent}% · ${attachmentUploadCompleted + 1} из ${attachmentUploadTotal}`
              : 'Сохраняем сообщение… 100%' }}
          </span>
          <span v-else>{{ selectedAttachments.length }} из 10 · хранение до 30 дней · не E2EE</span>
          <button type="button" :disabled="sending" @click="clearAttachments">Убрать все</button>
        </div>
        <div class="composer-attachments__strip">
          <div
            v-for="(item, index) in selectedAttachments"
            :key="`${item.file.name}-${item.file.lastModified}-${index}`"
            class="composer-attachment"
          >
            <img
              v-if="item.previewUrl && item.kind === 'image'"
              :src="item.previewUrl"
              :alt="`Предпросмотр ${item.file.name}`"
            >
            <video
              v-else-if="item.previewUrl && item.kind === 'video'"
              :src="item.previewUrl"
              muted
              playsinline
              preload="metadata"
              :aria-label="`Предпросмотр ${item.file.name}`"
            />
            <span v-else class="composer-attachment__icon"><AppIcon name="attachment" /></span>
            <span class="composer-attachment__copy">
              <strong>{{ item.file.name }}</strong>
              <small>
                {{ Math.max(1, Math.ceil(item.file.size / 1024)) }} КБ
                <template v-if="attachmentUploadPercent(index) !== null">
                  · {{ attachmentUploadPercent(index) }}%
                </template>
              </small>
            </span>
            <button
              type="button"
              :disabled="sending"
              :aria-label="`Убрать ${item.file.name}`"
              @click="removeAttachment(index)"
            >
              <AppIcon name="close" />
            </button>
            <div
              v-if="attachmentUploadPercent(index) !== null"
              class="composer-attachment__progress"
              role="progressbar"
              :aria-label="`Загрузка ${item.file.name}`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="attachmentUploadPercent(index) ?? 0"
            >
              <span :style="{ width: `${attachmentUploadPercent(index) ?? 0}%` }" />
            </div>
          </div>
        </div>
      </div>
      <p v-if="attachmentError" class="composer-attachment-error" role="alert">
        {{ attachmentError }}
      </p>
      <div class="attachment-picker" @keydown.esc="attachmentMenuOpen = false">
        <button
          class="attach-button"
          :class="{ disabled: conversation.conversationType !== 'group' || sending }"
          type="button"
          :disabled="conversation.conversationType !== 'group' || sending"
          :aria-expanded="attachmentMenuOpen"
          aria-controls="attachment-picker-menu"
          :title="conversation.conversationType === 'group'
            ? 'Прикрепить медиа или файл'
            : 'Вложения в личных чатах появятся после E2EE media flow'"
          @click="attachmentMenuOpen = !attachmentMenuOpen"
        >
          <AppIcon name="attachment" />
          <span class="sr-only">Прикрепить медиа или файл</span>
        </button>
        <input
          ref="mediaInput"
          data-picker="media"
          type="file"
          multiple
          accept="image/*,video/*"
          :disabled="conversation.conversationType !== 'group' || sending"
          @change="chooseAttachment"
        >
        <input
          ref="fileInput"
          data-picker="file"
          type="file"
          multiple
          :disabled="conversation.conversationType !== 'group' || sending"
          @change="chooseAttachment"
        >
        <Transition name="attachment-menu">
          <div v-if="attachmentMenuOpen" id="attachment-picker-menu" class="attachment-picker-menu">
            <button type="button" @click="openAttachmentPicker('media')">
              <AppIcon name="media" />
              <span><strong>Фото или видео</strong><small>Открыть системную галерею</small></span>
            </button>
            <button type="button" @click="openAttachmentPicker('file')">
              <AppIcon name="file" />
              <span><strong>Файл</strong><small>Выбрать любой тип до 25 МБ</small></span>
            </button>
          </div>
        </Transition>
      </div>
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
      <button class="send-button" type="submit" :disabled="sending || (draft.trim().length === 0 && selectedAttachments.length === 0)" aria-label="Отправить">
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
