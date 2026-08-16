<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { MessageInteractionContext } from '../../application/messaging/text-message-content'
import type { GroupAttachmentSource } from '../../application/messaging/upload-group-attachment'
import type {
  RecordedVideoNote,
  VideoNoteRecorder,
} from '../../application/ports/video-note-recorder'
import {
  attachmentKindFor,
  GROUP_ATTACHMENT_LIMIT,
  maximumAttachmentBytes,
  maximumDirectAttachmentBytes,
} from '../../application/messaging/group-attachment-policy'
import type { OutgoingMessageView } from '../../application/messaging/outgoing-message-view'
import type { RealtimeConnectionState } from '../../application/messaging/realtime-sync-service'
import type { ConversationViewportAnchor } from '../../application/ports/messenger-snapshot-store'
import type {
  Conversation,
  MessageAttachment,
  MessageReactionSummary,
  MessagePinSummary,
  ParticipantDeliveryState,
} from '../../domain/messaging/models'
import { buildTimelineLayout } from '../../presentation/chat/timeline-layout'
import AppIcon from '../ui/AppIcon.vue'
import MessageAttachments from './MessageAttachments.vue'
import MessageText from './MessageText.vue'
import VideoNoteCapture from './VideoNoteCapture.vue'

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
  sendMessage: (
    plaintext: string,
    attachments?: readonly GroupAttachmentSource[],
    interaction?: MessageInteractionContext,
  ) => Promise<boolean>
  searchMessages?: (query: string) => Promise<readonly TimelineMessage[]>
  openMessage?: (messageId: string) => Promise<void>
  loadAttachment?: (
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ) => Promise<Blob>
  retryOutgoing?: (clientMessageId: string) => Promise<boolean>
  loadOlder?: () => Promise<void>
  returnToLatest?: () => Promise<void>
  deleteMessage: (messageId: string) => Promise<boolean>
  deletingMessageId: string | null
  typingActorIds: readonly string[]
  onlineActorIds: readonly string[]
  deliveryStates: readonly ParticipantDeliveryState[]
  reactionSummaries?: readonly MessageReactionSummary[]
  toggleReaction?: (messageId: string, reaction: string, active: boolean) => Promise<boolean>
  messagePins?: readonly MessagePinSummary[]
  togglePin?: (messageId: string, active: boolean) => Promise<boolean>
  pinningMessageId?: string | null
  copyText?: (value: string) => Promise<boolean>
  connectionState: RealtimeConnectionState
  setTyping: (conversationId: string, active: boolean) => void
  viewportAnchor?: ConversationViewportAnchor | null
  targetMessageId?: string | null
  saveViewport?: (anchor: ConversationViewportAnchor) => Promise<void>
  videoNoteRecorder?: VideoNoteRecorder
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
  searchMessages: async () => [],
  openMessage: async () => undefined,
  reactionSummaries: () => [],
  toggleReaction: async () => false,
  messagePins: () => [],
  togglePin: async () => false,
  pinningMessageId: null,
  copyText: async () => false,
  viewportAnchor: null,
  targetMessageId: null,
  saveViewport: async () => undefined,
  videoNoteRecorder: undefined,
})
const emit = defineEmits<{ back: []; groupDetails: [] }>()

const draft = ref('')
const replyingTo = ref<TimelineMessage | null>(null)
const searchOpen = ref(false)
const searchQuery = ref('')
const searchResults = ref<readonly TimelineMessage[]>([])
const searchResultIndex = ref(0)
const searching = ref(false)
const deleteCandidateId = ref<string | null>(null)
const unpinCandidateId = ref<string | null>(null)
const messageActionNotice = ref<string | null>(null)
const activePinIndex = ref(0)
const timeline = ref<HTMLElement | null>(null)
const composerInput = ref<HTMLTextAreaElement | null>(null)
const mediaInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const attachmentPicker = ref<HTMLElement | null>(null)
const contextMenuElement = ref<HTMLElement | null>(null)
interface SelectedAttachment {
  file: File
  kind: 'image' | 'video' | 'file'
  previewUrl: string | null
}
const selectedAttachments = ref<SelectedAttachment[]>([])
const attachmentError = ref<string | null>(null)
const attachmentMenuOpen = ref(false)
const attachmentDragActive = ref(false)
const showScrollToLatest = ref(false)
const restorationPending = ref(true)
const highlightedMessageId = ref<string | null>(null)
let viewportSaveTimer: ReturnType<typeof setTimeout> | null = null
let pendingViewportAnchor: ConversationViewportAnchor | null = null
let highlightTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null
let adjustingViewport = false
let composerFocused = false
let followComposerResize = false
let layoutAnchor: { messageId: string, offset: number } | null = null
let layoutAnchorExpiresAt = 0
let attachmentDragDepth = 0
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let messageActionNoticeTimer: ReturnType<typeof setTimeout> | null = null
interface MessageContextMenuState {
  messageId: string
  x: number
  y: number
  expandedReactions: boolean
}
interface MessageSwipeState {
  messageId: string
  pointerId: number
  startX: number
  startY: number
  offset: number
  longPressFired: boolean
}
const messageContextMenu = ref<MessageContextMenuState | null>(null)
const messageSwipe = ref<MessageSwipeState | null>(null)
const QUICK_REACTIONS = ['❤️', '👌', '🔥', '😁', '🤯', '💯', '👍'] as const
const ALL_REACTIONS = [
  ...QUICK_REACTIONS,
  '😂', '😮', '😢', '👎', '🎉', '👏', '🤔', '🙏', '🥰',
] as const
const activePin = computed(() => props.messagePins[activePinIndex.value] ?? props.messagePins[0])
const activePinnedMessage = computed(() => props.messages.find(message => (
  message.messageId === activePin.value?.messageId
)) ?? null)
const attachmentsAllowed = computed(() => (
  props.conversation?.conversationType === 'group'
  || (props.conversation?.conversationType === 'direct' && props.protectionSecure)
))
const contextMessage = computed(() => props.messages.find(message => (
  message.messageId === messageContextMenu.value?.messageId
)) ?? null)
const unpinCandidate = computed(() => props.messages.find(message => (
  message.messageId === unpinCandidateId.value
)) ?? null)
const unpinCandidatePin = computed(() => props.messagePins.find(pin => (
  pin.messageId === unpinCandidateId.value
)) ?? null)

const mentionMatch = computed(() => draft.value.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u))
const mentionSuggestions = computed(() => {
  const conversation = props.conversation
  const match = mentionMatch.value
  if (!conversation || !match) return []
  const query = (match[1] ?? '').toLocaleLowerCase('ru-RU')
  return conversation.members.filter(member => (
    member.leftAt === null
    && member.userId !== props.actorUserId
    && (
      member.username.toLocaleLowerCase('ru-RU').startsWith(query)
      || member.displayName.toLocaleLowerCase('ru-RU').startsWith(query)
    )
  )).slice(0, 8)
})

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
  if (message.failureCode === 'conflict') return 'Состояние диалога изменилось'
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

function isStandaloneVideoNote(message: TimelineMessage): boolean {
  const attachments = message.displayAttachments ?? []
  return message.contentState === 'available'
    && !message.displayBody?.trim()
    && attachments.length === 1
    && attachments[0]?.kind === 'video'
    && attachments[0].presentation === 'video_note'
}

function replyPreview(message: TimelineMessage | null): string {
  if (!message) return 'Сообщение'
  if (message.contentState === 'deleted') return 'Удалённое сообщение'
  return message.displayBody?.trim().slice(0, 120)
    || message.displayAttachments?.[0]?.name
    || `Сообщение #${message.sequence}`
}

function repliedMessage(message: TimelineMessage): TimelineMessage | null {
  if (!message.replyToMessageId) return null
  return props.messages.find(item => item.messageId === message.replyToMessageId) ?? null
}

function mentionedUserIds(): string[] {
  const text = draft.value.toLocaleLowerCase('ru-RU')
  return props.conversation?.members.filter(member => (
    member.leftAt === null
    && text.includes(`@${member.username.toLocaleLowerCase('ru-RU')}`)
  )).map(member => member.userId) ?? []
}

async function chooseMention(username: string): Promise<void> {
  const match = mentionMatch.value
  if (!match || match.index === undefined) return
  const atIndex = match.index + match[0].lastIndexOf('@')
  draft.value = `${draft.value.slice(0, atIndex)}@${username} ${draft.value.slice(atIndex + match[0].slice(match[0].lastIndexOf('@')).length)}`
  await nextTick()
  composerInput.value?.focus()
  resizeComposer()
}

async function runSearch(): Promise<void> {
  const query = searchQuery.value.trim()
  if (!query || searching.value) return
  searching.value = true
  try {
    searchResults.value = await props.searchMessages(query)
    searchResultIndex.value = Math.max(0, searchResults.value.length - 1)
    const result = searchResults.value[searchResultIndex.value]
    if (result) await props.openMessage(result.messageId)
  } finally {
    searching.value = false
  }
}

async function moveSearch(direction: -1 | 1): Promise<void> {
  if (searchResults.value.length === 0) return
  searchResultIndex.value = (
    searchResultIndex.value + direction + searchResults.value.length
  ) % searchResults.value.length
  const result = searchResults.value[searchResultIndex.value]
  if (result) await props.openMessage(result.messageId)
}

function closeSearch(): void {
  searchOpen.value = false
  searchQuery.value = ''
  searchResults.value = []
  searchResultIndex.value = 0
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

function reactionsFor(messageId: string): readonly MessageReactionSummary[] {
  return props.reactionSummaries.filter(item => item.messageId === messageId)
}

function canManagePins(): boolean {
  if (!props.conversation) return false
  if (props.conversation.conversationType === 'direct') return true
  const actor = props.conversation.members.find(member => (
    member.userId === props.actorUserId && member.leftAt === null
  ))
  return actor?.role === 'owner' || actor?.role === 'admin'
}

function isPinned(messageId: string): boolean {
  return props.messagePins.some(pin => pin.messageId === messageId)
}

function pinnedPreview(): string {
  const message = activePinnedMessage.value
  if (!message) return `Сообщение #${activePin.value?.sequence ?? ''}`
  if (message.contentState === 'deleted') return 'Сообщение удалено'
  if (message.displayBody?.trim()) return message.displayBody.trim()
  if ((message.displayAttachments?.length ?? 0) > 0) {
    return message.displayAttachments?.[0]?.presentation === 'video_note'
      ? 'Видеосообщение'
      : 'Вложение'
  }
  return `Сообщение #${message.sequence}`
}

function movePinned(delta: number): void {
  if (props.messagePins.length < 2) return
  activePinIndex.value = (
    activePinIndex.value + delta + props.messagePins.length
  ) % props.messagePins.length
}

async function openPinned(): Promise<void> {
  if (activePin.value) await props.openMessage(activePin.value.messageId)
}

async function changePin(messageId: string, active = !isPinned(messageId)): Promise<boolean> {
  return props.togglePin(messageId, active)
}

async function changeReaction(
  messageId: string,
  reaction: string,
  active: boolean,
): Promise<void> {
  if (await props.toggleReaction(messageId, reaction, active)) {
    messageContextMenu.value = null
  }
}

function reactedByActor(messageId: string, reaction: string): boolean {
  return props.reactionSummaries.some(item => (
    item.messageId === messageId
    && item.reaction === reaction
    && item.reactedByActor
  ))
}

function closeTransientSurfaces(): void {
  attachmentMenuOpen.value = false
  messageContextMenu.value = null
}

function requestUnpin(messageId: string): void {
  messageContextMenu.value = null
  unpinCandidateId.value = messageId
}

async function confirmUnpin(): Promise<void> {
  const messageId = unpinCandidateId.value
  if (!messageId) return
  if (await changePin(messageId, false)) unpinCandidateId.value = null
}

async function requestPinChange(message: TimelineMessage): Promise<void> {
  if (isPinned(message.messageId)) {
    requestUnpin(message.messageId)
    return
  }
  if (await changePin(message.messageId, true)) messageContextMenu.value = null
}

function startReply(message: TimelineMessage): void {
  replyingTo.value = message
  messageContextMenu.value = null
  void nextTick(() => composerInput.value?.focus())
}

function showMessageActionNotice(message: string): void {
  messageActionNotice.value = message
  if (messageActionNoticeTimer) clearTimeout(messageActionNoticeTimer)
  messageActionNoticeTimer = setTimeout(() => {
    messageActionNotice.value = null
    messageActionNoticeTimer = null
  }, 2_400)
}

async function copyMessageText(message: TimelineMessage): Promise<void> {
  const body = message.displayBody
  if (!body?.trim()) return
  if (await props.copyText(body)) {
    messageContextMenu.value = null
    showMessageActionNotice('Текст скопирован')
    return
  }
  showMessageActionNotice('Не удалось скопировать текст')
}

function openMessageContext(message: TimelineMessage, clientX: number, clientY: number): void {
  if (message.contentState !== 'available') return
  attachmentMenuOpen.value = false
  const menuWidth = 380
  const menuHeight = 430
  messageContextMenu.value = {
    messageId: message.messageId,
    x: Math.max(12, Math.min(clientX, window.innerWidth - menuWidth - 12)),
    y: Math.max(12, Math.min(clientY, window.innerHeight - menuHeight - 12)),
    expandedReactions: false,
  }
  void nextTick(() => contextMenuElement.value?.focus())
}

function handleMessageContextMenu(event: MouseEvent, message: TimelineMessage): void {
  event.preventDefault()
  openMessageContext(message, event.clientX, event.clientY)
}

function handleMessageKeydown(event: KeyboardEvent, message: TimelineMessage): void {
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
  event.preventDefault()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  openMessageContext(message, rect.left + Math.min(rect.width, 180), rect.top + 24)
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'button, input, textarea, video, audio, [role="button"], [contenteditable="true"]',
  ))
}

function clearLongPressTimer(): void {
  if (!longPressTimer) return
  clearTimeout(longPressTimer)
  longPressTimer = null
}

function resetMessageSwipe(): void {
  clearLongPressTimer()
  messageSwipe.value = null
}

function handleMessagePointerDown(event: PointerEvent, message: TimelineMessage): void {
  if (event.pointerType === 'mouse' || event.button !== 0 || isInteractiveTarget(event.target)) return
  messageSwipe.value = {
    messageId: message.messageId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offset: 0,
    longPressFired: false,
  }
  clearLongPressTimer()
  longPressTimer = setTimeout(() => {
    const swipe = messageSwipe.value
    if (!swipe || swipe.pointerId !== event.pointerId || swipe.offset > 8) return
    swipe.longPressFired = true
    openMessageContext(message, event.clientX, event.clientY)
  }, 480)
}

function handleMessagePointerMove(event: PointerEvent): void {
  const swipe = messageSwipe.value
  if (!swipe || swipe.pointerId !== event.pointerId) return
  const deltaX = event.clientX - swipe.startX
  const deltaY = event.clientY - swipe.startY
  if (Math.abs(deltaY) > Math.abs(deltaX) || deltaX < 0) {
    resetMessageSwipe()
    return
  }
  if (deltaX > 8) {
    clearLongPressTimer()
    event.preventDefault()
    swipe.offset = Math.min(76, deltaX * 0.72)
  }
}

function finishMessagePointer(event: PointerEvent, message: TimelineMessage): void {
  const swipe = messageSwipe.value
  if (!swipe || swipe.pointerId !== event.pointerId) return
  const shouldReply = !swipe.longPressFired && swipe.offset >= 56
  resetMessageSwipe()
  if (shouldReply) startReply(message)
}

function messageSwipeStyle(messageId: string): Record<string, string> | undefined {
  if (messageSwipe.value?.messageId !== messageId) return undefined
  return { '--message-swipe-offset': `${messageSwipe.value.offset}px` }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!attachmentMenuOpen.value) return
  const target = event.target
  if (target instanceof Node && attachmentPicker.value?.contains(target)) return
  attachmentMenuOpen.value = false
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  closeTransientSurfaces()
  deleteCandidateId.value = null
  unpinCandidateId.value = null
}

watch(
  () => props.messagePins.map(pin => pin.messageId).join(','),
  () => {
    if (activePinIndex.value >= props.messagePins.length) activePinIndex.value = 0
  },
)

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
    name: attachmentName(file),
    type: file.type,
    size: file.size,
    body: file,
  }))
  const interaction = {
    ...(replyingTo.value ? { replyToMessageId: replyingTo.value.messageId } : {}),
    ...(mentionedUserIds().length > 0 ? { mentionedUserIds: mentionedUserIds() } : {}),
  }
  const hasInteraction = Object.keys(interaction).length > 0
  const sent = attachments.length === 0
    ? hasInteraction
      ? await props.sendMessage(value, undefined, interaction)
      : await props.sendMessage(value)
    : hasInteraction
      ? await props.sendMessage(value, attachments, interaction)
      : await props.sendMessage(value, attachments)
  if (sent) {
    draft.value = ''
    replyingTo.value = null
    clearAttachments()
    await nextTick()
    resizeComposer()
    scrollToLatest('smooth')
  }
}

async function sendVideoNote(recording: RecordedVideoNote): Promise<void> {
  if (props.sending || !attachmentsAllowed.value) return
  attachmentError.value = null
  const extension = recording.contentType === 'video/mp4' ? 'mp4' : 'webm'
  const sent = await props.sendMessage('', [{
    name: `video-note-${Date.now()}.${extension}`,
    type: recording.contentType,
    size: recording.body.size,
    body: recording.body,
    presentation: 'video_note',
    durationSeconds: recording.durationSeconds,
  }])
  if (!sent) attachmentError.value = 'Не удалось отправить видеокружок. Запишите его ещё раз.'
}

function showVideoNoteError(message: string): void {
  attachmentError.value = message
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

function attachmentName(file: File): string {
  if (file.name.trim()) return file.name
  const extension = file.type.split('/')[1]?.replace(/[^a-z0-9.+-]/gi, '')
  return extension ? `Вставленное изображение.${extension}` : 'Вставленный файл'
}

function addAttachments(files: readonly File[]): boolean {
  attachmentError.value = null
  attachmentMenuOpen.value = false
  if (files.length === 0) return false
  if (props.sending) {
    attachmentError.value = 'Дождитесь завершения текущей отправки.'
    return false
  }
  if (!attachmentsAllowed.value) {
    attachmentError.value = 'Вложения доступны после готовности E2EE этого личного чата.'
    return false
  }
  if (selectedAttachments.value.length + files.length > GROUP_ATTACHMENT_LIMIT) {
    attachmentError.value = 'В одном сообщении можно отправить не больше 10 файлов.'
    return false
  }
  for (const file of files) {
    const kind = attachmentKindFor(file.type)
    const direct = props.conversation?.conversationType === 'direct'
    const maximum = direct
      ? maximumDirectAttachmentBytes(kind)
      : maximumAttachmentBytes(kind)
    if (file.size <= 0 || file.size > maximum) {
      const limitLabel = kind === 'image' ? '12 МБ' : direct ? '25 МБ' : kind === 'video' ? '100 МБ' : '25 МБ'
      const kindLabel = kind === 'image' ? 'изображение' : kind === 'video' ? 'видео' : 'файл'
      attachmentError.value = `«${attachmentName(file)}»: ${kindLabel} должно быть не больше ${limitLabel}.`
      return false
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
  return true
}

function chooseAttachment(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  addAttachments(files)
}

function clipboardFiles(event: ClipboardEvent): File[] {
  const itemFiles = Array.from(event.clipboardData?.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  return itemFiles.length > 0 ? itemFiles : Array.from(event.clipboardData?.files ?? [])
}

function handlePaste(event: ClipboardEvent): void {
  const files = clipboardFiles(event)
  if (files.length === 0) return
  event.preventDefault()
  addAttachments(files)
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function handleAttachmentDragEnter(event: DragEvent): void {
  if (!carriesFiles(event)) return
  event.preventDefault()
  attachmentDragDepth += 1
  attachmentDragActive.value = true
}

function handleAttachmentDragOver(event: DragEvent): void {
  if (!carriesFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleAttachmentDragLeave(event: DragEvent): void {
  if (!carriesFiles(event)) return
  attachmentDragDepth = Math.max(0, attachmentDragDepth - 1)
  if (attachmentDragDepth === 0) attachmentDragActive.value = false
}

function handleAttachmentDrop(event: DragEvent): void {
  if (!carriesFiles(event)) return
  event.preventDefault()
  attachmentDragDepth = 0
  attachmentDragActive.value = false
  addAttachments(Array.from(event.dataTransfer?.files ?? []))
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
  if (!element || element.clientHeight <= 0) return false
  return element.scrollHeight - element.scrollTop - element.clientHeight < 120
}

function handleTimelineScroll(): void {
  if (restorationPending.value) void restoreViewport(false)
  if (restorationPending.value) return
  showScrollToLatest.value = !isNearLatest() || props.historyHasNewer
  if (!adjustingViewport) scheduleViewportSave()
}

function scrollToLatest(behavior: ScrollBehavior = 'smooth'): void {
  const element = timeline.value
  if (!element || element.clientHeight <= 0) return
  element.scrollTo({ top: element.scrollHeight, behavior })
  showScrollToLatest.value = false
  restorationPending.value = false
  scheduleViewportSave()
}

function messageElements(): HTMLElement[] {
  return Array.from(timeline.value?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])
}

function messageElement(messageId: string): HTMLElement | null {
  return messageElements().find(element => element.dataset.messageId === messageId) ?? null
}

function currentViewportAnchor(): ConversationViewportAnchor | null {
  const element = timeline.value
  const conversation = props.conversation
  if (!element || !conversation || element.clientHeight <= 0) return null
  const candidates = messageElements()
  if (candidates.length === 0) return null
  const containerRect = element.getBoundingClientRect()
  const atLatest = isNearLatest() && !props.historyHasNewer
  const anchorElement = atLatest
    ? candidates.at(-1)
    : candidates.find(candidate => candidate.getBoundingClientRect().bottom > containerRect.top + 1)
      ?? candidates[0]
  const messageId = anchorElement?.dataset.messageId
  const sequence = Number(anchorElement?.dataset.sequence)
  if (!anchorElement || !messageId || !Number.isSafeInteger(sequence) || sequence <= 0) return null
  return {
    conversationId: conversation.conversationId,
    messageId,
    sequence,
    offset: anchorElement.getBoundingClientRect().top - containerRect.top,
    atLatest,
    savedAt: new Date().toISOString(),
  }
}

function persistViewport(conversationId?: string): void {
  if (viewportSaveTimer) {
    clearTimeout(viewportSaveTimer)
    viewportSaveTimer = null
  }
  const captured = pendingViewportAnchor
  pendingViewportAnchor = null
  const anchor = captured && (!conversationId || captured.conversationId === conversationId)
    ? captured
    : conversationId
      ? null
      : currentViewportAnchor()
  if (anchor) void props.saveViewport(anchor)
}

function scheduleViewportSave(): void {
  pendingViewportAnchor = currentViewportAnchor()
  if (!pendingViewportAnchor) return
  if (viewportSaveTimer) clearTimeout(viewportSaveTimer)
  viewportSaveTimer = setTimeout(persistViewport, 220)
}

function alignMessage(messageId: string, offset: number): boolean {
  const container = timeline.value
  const target = messageElement(messageId)
  if (!container || !target) return false
  const delta = target.getBoundingClientRect().top
    - container.getBoundingClientRect().top
    - offset
  adjustingViewport = true
  container.scrollTop += delta
  requestAnimationFrame(() => {
    adjustingViewport = false
  })
  return true
}

function observeTimelineLayout(): void {
  if (!resizeObserver || !timeline.value) return
  resizeObserver.disconnect()
  resizeObserver.observe(timeline.value)
  for (const element of messageElements()) resizeObserver.observe(element)
}

function lockLayoutAnchor(messageId: string, offset: number): void {
  layoutAnchor = { messageId, offset }
  layoutAnchorExpiresAt = Date.now() + 1_800
  observeTimelineLayout()
}

function releaseLayoutAnchor(): void {
  layoutAnchor = null
  layoutAnchorExpiresAt = 0
}

async function restoreViewport(waitForRender = true): Promise<void> {
  if (!restorationPending.value) return
  if (waitForRender) await nextTick()
  const container = timeline.value
  if (!container || container.clientHeight <= 0) return
  if (props.messages.length === 0) {
    if (!props.targetMessageId && !props.viewportAnchor) restorationPending.value = false
    return
  }
  const targetMessageId = props.targetMessageId
  if (targetMessageId) {
    const target = messageElement(targetMessageId)
    if (target) {
      const centeredOffset = Math.max(12, (container.clientHeight - target.getBoundingClientRect().height) / 2)
      alignMessage(targetMessageId, centeredOffset)
      lockLayoutAnchor(targetMessageId, centeredOffset)
      highlightedMessageId.value = targetMessageId
      if (highlightTimer) clearTimeout(highlightTimer)
      highlightTimer = setTimeout(() => {
        highlightedMessageId.value = null
      }, 1_800)
      restorationPending.value = false
      scheduleViewportSave()
      return
    }
    return
  }
  const anchor = props.viewportAnchor
  if (anchor && alignMessage(anchor.messageId, anchor.offset)) {
    lockLayoutAnchor(anchor.messageId, anchor.offset)
    restorationPending.value = false
    showScrollToLatest.value = !anchor.atLatest || props.historyHasNewer
    scheduleViewportSave()
    return
  }
  if (container.scrollTop > 0) {
    restorationPending.value = false
    showScrollToLatest.value = true
    scheduleViewportSave()
    return
  }
  scrollToLatest('auto')
}

function handleComposerFocus(): void {
  composerFocused = true
  followComposerResize = isNearLatest()
}

function handleComposerBlur(): void {
  composerFocused = false
  followComposerResize = false
}

function handleVisualViewportResize(): void {
  if (!composerFocused || !followComposerResize) return
  requestAnimationFrame(() => scrollToLatest('auto'))
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
    if (restorationPending.value) {
      await restoreViewport()
      return
    }
    observeTimelineLayout()
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
    if (previousConversationId) persistViewport(previousConversationId)
    if (previousConversationId) props.setTyping(previousConversationId, false)
    if (conversationId !== previousConversationId) {
      draft.value = ''
      replyingTo.value = null
      closeSearch()
      clearAttachments()
      deleteCandidateId.value = null
      unpinCandidateId.value = null
      messageContextMenu.value = null
      messageActionNotice.value = null
      if (messageActionNoticeTimer) clearTimeout(messageActionNoticeTimer)
      messageActionNoticeTimer = null
      resetMessageSwipe()
      showScrollToLatest.value = false
      restorationPending.value = true
      await nextTick()
      resizeComposer()
      await restoreViewport()
    }
  },
)

watch(
  () => props.targetMessageId,
  async () => {
    restorationPending.value = true
    await restoreViewport()
  },
)

onMounted(() => {
  resizeComposer()
  void restoreViewport(false)
  if (typeof ResizeObserver !== 'undefined' && timeline.value) {
    resizeObserver = new ResizeObserver(() => {
      if (restorationPending.value) void restoreViewport()
      else if (layoutAnchor && Date.now() < layoutAnchorExpiresAt) {
        alignMessage(layoutAnchor.messageId, layoutAnchor.offset)
      }
    })
    observeTimelineLayout()
  }
  window.visualViewport?.addEventListener('resize', handleVisualViewportResize)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  persistViewport()
  if (highlightTimer) clearTimeout(highlightTimer)
  resizeObserver?.disconnect()
  window.visualViewport?.removeEventListener('resize', handleVisualViewportResize)
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('keydown', handleDocumentKeydown)
  if (messageActionNoticeTimer) clearTimeout(messageActionNoticeTimer)
  resetMessageSwipe()
  clearAttachments()
  attachmentDragDepth = 0
  if (props.conversation) props.setTyping(props.conversation.conversationId, false)
})
</script>

<template>
  <section
    v-if="conversation"
    class="message-panel"
    @paste="handlePaste"
    @dragenter="handleAttachmentDragEnter"
    @dragover="handleAttachmentDragOver"
    @dragleave="handleAttachmentDragLeave"
    @drop="handleAttachmentDrop"
  >
    <div
      v-if="attachmentDragActive"
      class="attachment-drop-overlay"
      role="status"
      aria-live="polite"
    >
      <span class="attachment-drop-overlay__icon"><AppIcon name="attachment" /></span>
      <strong>Перетащите файлы в сообщение</strong>
      <small v-if="conversation.conversationType === 'group'">До 10 файлов за одну отправку</small>
      <small v-else-if="protectionSecure">Файлы будут зашифрованы до загрузки</small>
      <small v-else>Ожидаем готовности E2EE</small>
    </div>
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
        class="chat-search-button"
        type="button"
        aria-label="Поиск по чату"
        :aria-expanded="searchOpen"
        @click="searchOpen ? closeSearch() : searchOpen = true"
      >
        <AppIcon name="search" />
      </button>
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

    <form v-if="searchOpen" class="chat-search" role="search" @submit.prevent="runSearch">
      <AppIcon name="search" />
      <label class="sr-only" for="chat-search-input">Поиск по сообщениям</label>
      <input
        id="chat-search-input"
        v-model="searchQuery"
        type="search"
        maxlength="100"
        autocomplete="off"
        placeholder="Поиск по этому чату"
      >
      <span v-if="searchResults.length > 0">
        {{ searchResultIndex + 1 }} / {{ searchResults.length }}
      </span>
      <span v-else-if="searchQuery && !searching">Нет результатов</span>
      <button type="submit" :disabled="searching || !searchQuery.trim()">
        {{ searching ? 'Ищем…' : 'Найти' }}
      </button>
      <button type="button" :disabled="searchResults.length < 2" aria-label="Предыдущий результат" @click="moveSearch(-1)">↑</button>
      <button type="button" :disabled="searchResults.length < 2" aria-label="Следующий результат" @click="moveSearch(1)">↓</button>
      <button type="button" aria-label="Закрыть поиск" @click="closeSearch"><AppIcon name="close" /></button>
    </form>

    <div
      v-if="messagePins.length > 0 || !protectionSecure || archiveStatus === 'unavailable' || outboxStatus === 'unavailable'"
      class="timeline-notices"
    >
      <div v-if="activePin" class="pinned-message-bar">
        <button
          class="pinned-message-main"
          type="button"
          :aria-label="`Открыть закреплённое сообщение ${activePinIndex + 1} из ${messagePins.length}`"
          @click="openPinned"
        >
          <span class="pinned-message-icon"><AppIcon name="pin" /></span>
          <span class="pinned-message-copy">
            <strong>Закреплённое сообщение</strong>
            <small>{{ pinnedPreview() }}</small>
          </span>
        </button>
        <span v-if="messagePins.length > 1" class="pinned-message-count">
          {{ activePinIndex + 1 }}/{{ messagePins.length }}
        </span>
        <button
          v-if="messagePins.length > 1"
          type="button"
          aria-label="Предыдущее закреплённое сообщение"
          @click="movePinned(-1)"
        >↑</button>
        <button
          v-if="messagePins.length > 1"
          type="button"
          aria-label="Следующее закреплённое сообщение"
          @click="movePinned(1)"
        >↓</button>
        <button
          v-if="canManagePins()"
          class="pinned-message-close"
          type="button"
          :aria-label="`Открепить сообщение #${activePin.sequence}`"
          @click="requestUnpin(activePin.messageId)"
        ><AppIcon name="close" /></button>
      </div>
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

    <div
      ref="timeline"
      class="message-timeline"
      :class="{ 'message-timeline--restoring': restorationPending }"
      :aria-busy="restorationPending"
      aria-live="polite"
      @scroll.passive="handleTimelineScroll"
      @pointerdown.passive="releaseLayoutAnchor"
      @touchstart.passive="releaseLayoutAnchor"
      @wheel.passive="releaseLayoutAnchor"
    >
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
            targeted: item.message.messageId === highlightedMessageId,
            'message-bubble--video-note': isStandaloneVideoNote(item.message),
            'message-bubble--swiping': messageSwipe?.messageId === item.message.messageId,
          }"
          :style="messageSwipeStyle(item.message.messageId)"
          :tabindex="item.message.contentState === 'available' ? 0 : undefined"
          :aria-label="item.message.contentState === 'available'
            ? `Сообщение #${item.message.sequence}. Открыть действия: Shift+F10`
            : undefined"
          :data-message-id="item.message.messageId"
          :data-sequence="item.message.sequence"
          @contextmenu="handleMessageContextMenu($event, item.message)"
          @pointerdown="handleMessagePointerDown($event, item.message)"
          @pointermove="handleMessagePointerMove"
          @pointerup="finishMessagePointer($event, item.message)"
          @pointercancel="resetMessageSwipe"
          @keydown="handleMessageKeydown($event, item.message)"
        >
          <strong v-if="item.showSender">{{ senderName(item.message) }}</strong>
          <MessageAttachments
            v-if="item.message.contentState === 'available' && (item.message.displayAttachments?.length ?? 0) > 0"
            :conversation-id="item.message.conversationId"
            :attachments="item.message.displayAttachments ?? []"
            :expires-at="item.message.expiresAt"
            :load-attachment="loadAttachment"
          />
          <button
            v-if="item.message.replyToMessageId"
            class="message-reply-preview"
            type="button"
            @click="openMessage(item.message.replyToMessageId)"
          >
            <strong>{{ repliedMessage(item.message) ? senderName(repliedMessage(item.message)!) : 'Ответ' }}</strong>
            <span>{{ replyPreview(repliedMessage(item.message)) }}</span>
          </button>
          <MessageText
            v-if="item.message.contentState === 'available' && item.message.displayBody"
            :body="item.message.displayBody"
            :members="conversation.members"
            :mentioned-user-ids="item.message.mentionedUserIds ?? []"
            :actor-user-id="actorUserId"
          />
          <p v-else-if="item.message.contentState === 'deleted'" class="message-tombstone">
            {{ item.message.deletionReason === 'expired' ? 'Срок хранения сообщения истёк' : 'Сообщение удалено для всех' }}
          </p>
          <p v-else class="message-unavailable" role="status">
            {{ item.message.displayBody }}
          </p>
          <div v-if="reactionsFor(item.message.messageId).length > 0" class="message-reactions">
            <button
              v-for="summary in reactionsFor(item.message.messageId)"
              :key="summary.reaction"
              type="button"
              :class="{ active: summary.reactedByActor }"
              :aria-label="`${summary.reaction}: ${summary.count}`"
              @click="changeReaction(item.message.messageId, summary.reaction, !summary.reactedByActor)"
            >
              <span>{{ summary.reaction }}</span><small>{{ summary.count }}</small>
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
        <MessageText v-if="message.displayBody" :body="message.displayBody" />
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

    <p v-if="messageActionNotice" class="message-action-toast" role="status" aria-live="polite">
      {{ messageActionNotice }}
    </p>

    <form class="composer" @submit.prevent="submit">
      <div v-if="replyingTo" class="composer-reply">
        <span>
          <strong>Ответ {{ senderName(replyingTo) }}</strong>
          <small>{{ replyPreview(replyingTo) }}</small>
        </span>
        <button type="button" aria-label="Отменить ответ" @click="replyingTo = null"><AppIcon name="close" /></button>
      </div>
      <div v-if="selectedAttachments.length > 0" class="composer-attachments">
        <div class="composer-attachments__heading">
          <span v-if="sending && attachmentUploadBytesTotal > 0" aria-live="polite">
            {{ attachmentUploadCompleted < attachmentUploadTotal
              ? `Загрузка ${overallAttachmentUploadPercent}% · ${attachmentUploadCompleted + 1} из ${attachmentUploadTotal}`
              : 'Сохраняем сообщение… 100%' }}
          </span>
          <span v-else>
            {{ selectedAttachments.length }} из 10 · хранение до 30 дней ·
            {{ conversation.conversationType === 'direct' ? 'E2EE' : 'не E2EE' }}
          </span>
          <button type="button" :disabled="sending" @click="clearAttachments">Убрать все</button>
        </div>
        <div class="composer-attachments__strip">
          <div
            v-for="(item, index) in selectedAttachments"
            :key="`${attachmentName(item.file)}-${item.file.lastModified}-${index}`"
            class="composer-attachment"
          >
            <img
              v-if="item.previewUrl && item.kind === 'image'"
              :src="item.previewUrl"
              :alt="`Предпросмотр ${attachmentName(item.file)}`"
            >
            <video
              v-else-if="item.previewUrl && item.kind === 'video'"
              :src="item.previewUrl"
              muted
              playsinline
              preload="metadata"
              :aria-label="`Предпросмотр ${attachmentName(item.file)}`"
            />
            <span v-else class="composer-attachment__icon"><AppIcon name="attachment" /></span>
            <span class="composer-attachment__copy">
              <strong>{{ attachmentName(item.file) }}</strong>
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
              :aria-label="`Убрать ${attachmentName(item.file)}`"
              @click="removeAttachment(index)"
            >
              <AppIcon name="close" />
            </button>
            <div
              v-if="attachmentUploadPercent(index) !== null"
              class="composer-attachment__progress"
              role="progressbar"
              :aria-label="`Загрузка ${attachmentName(item.file)}`"
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
      <div ref="attachmentPicker" class="attachment-picker" @keydown.esc="attachmentMenuOpen = false">
        <button
          class="attach-button"
          :class="{ disabled: !attachmentsAllowed || sending }"
          type="button"
          :disabled="!attachmentsAllowed || sending"
          :aria-expanded="attachmentMenuOpen"
          aria-controls="attachment-picker-menu"
          :title="attachmentsAllowed
            ? 'Прикрепить медиа или файл'
            : 'Ожидаем готовности E2EE личного чата'"
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
          :disabled="!attachmentsAllowed || sending"
          @change="chooseAttachment"
        >
        <input
          ref="fileInput"
          data-picker="file"
          type="file"
          multiple
          :disabled="!attachmentsAllowed || sending"
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
      <div v-if="mentionSuggestions.length > 0" class="mention-suggestions" role="listbox" aria-label="Участники для упоминания">
        <button
          v-for="member in mentionSuggestions"
          :key="member.userId"
          type="button"
          role="option"
          @click="chooseMention(member.username)"
        >
          <strong>{{ member.displayName }}</strong>
          <small>@{{ member.username }}</small>
        </button>
      </div>
      <textarea
        id="message-draft"
        ref="composerInput"
        v-model="draft"
        maxlength="4000"
        rows="1"
        placeholder="Напишите сообщение…"
        @input="resizeComposer"
        @keydown="handleComposerKeydown"
        @focus="handleComposerFocus"
        @blur="handleComposerBlur"
      />
      <VideoNoteCapture
        v-if="attachmentsAllowed
          && videoNoteRecorder
          && draft.trim().length === 0
          && selectedAttachments.length === 0"
        :recorder="videoNoteRecorder"
        :disabled="sending"
        @recorded="sendVideoNote"
        @error="showVideoNoteError"
      />
      <button v-else class="send-button" type="submit" :disabled="sending || (draft.trim().length === 0 && selectedAttachments.length === 0)" aria-label="Отправить">
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

  <div
    v-if="messageContextMenu && contextMessage"
    class="message-context-backdrop"
    @pointerdown.self="messageContextMenu = null"
    @contextmenu.prevent.self="messageContextMenu = null"
  >
    <section
      ref="contextMenuElement"
      class="message-context-menu"
      role="menu"
      tabindex="-1"
      aria-label="Действия с сообщением"
      :style="{ left: `${messageContextMenu.x}px`, top: `${messageContextMenu.y}px` }"
    >
        <div class="context-quick-reactions" aria-label="Быстрые реакции">
          <button
            v-for="reaction in QUICK_REACTIONS"
            :key="reaction"
            type="button"
            :class="{ active: reactedByActor(contextMessage.messageId, reaction) }"
            :aria-label="`Реакция ${reaction}`"
            @click="changeReaction(
              contextMessage.messageId,
              reaction,
              !reactedByActor(contextMessage.messageId, reaction),
            )"
          >{{ reaction }}</button>
          <button
            class="context-reactions-expand"
            type="button"
            :aria-expanded="messageContextMenu.expandedReactions"
            aria-label="Показать больше реакций"
            @click="messageContextMenu.expandedReactions = !messageContextMenu.expandedReactions"
          >⌄</button>
        </div>
        <div
          v-if="messageContextMenu.expandedReactions"
          class="context-all-reactions"
          aria-label="Все реакции"
        >
          <button
            v-for="reaction in ALL_REACTIONS"
            :key="reaction"
            type="button"
            :class="{ active: reactedByActor(contextMessage.messageId, reaction) }"
            :aria-label="`Реакция ${reaction}`"
            @click="changeReaction(
              contextMessage.messageId,
              reaction,
              !reactedByActor(contextMessage.messageId, reaction),
            )"
          >{{ reaction }}</button>
        </div>
        <div class="context-message-actions">
          <button type="button" role="menuitem" @click="startReply(contextMessage)">
            <span aria-hidden="true">↩</span><strong>Ответить</strong>
          </button>
          <button
            v-if="contextMessage.displayBody?.trim()"
            type="button"
            role="menuitem"
            @click="copyMessageText(contextMessage)"
          >
            <span aria-hidden="true">⧉</span><strong>Копировать текст</strong>
          </button>
          <button
            v-if="canManagePins()"
            type="button"
            role="menuitem"
            :disabled="pinningMessageId === contextMessage.messageId"
            @click="requestPinChange(contextMessage)"
          >
            <AppIcon name="pin" />
            <strong>{{ isPinned(contextMessage.messageId) ? 'Открепить' : 'Закрепить' }}</strong>
          </button>
          <button
            v-if="canDelete(contextMessage)"
            class="danger"
            type="button"
            role="menuitem"
            @click="deleteCandidateId = contextMessage.messageId; messageContextMenu = null"
          >
            <span aria-hidden="true">⌫</span><strong>Удалить у всех</strong>
          </button>
        </div>
    </section>
  </div>

  <div v-if="unpinCandidateId" class="message-confirm-backdrop" @click.self="unpinCandidateId = null">
    <section role="alertdialog" aria-modal="true" aria-labelledby="unpin-message-title" class="message-confirm-dialog">
        <span class="message-confirm-icon"><AppIcon name="pin" /></span>
        <h3 id="unpin-message-title">Убрать из закреплённых?</h3>
        <p>{{ unpinCandidate?.displayBody?.trim() || `Сообщение #${unpinCandidatePin?.sequence ?? ''}` }}</p>
        <div>
          <button type="button" @click="unpinCandidateId = null">Отмена</button>
          <button
            class="danger"
            type="button"
            :disabled="pinningMessageId === unpinCandidateId"
            @click="confirmUnpin"
          >{{ pinningMessageId === unpinCandidateId ? 'Убираем…' : 'Убрать' }}</button>
        </div>
    </section>
  </div>

  <div v-if="deleteCandidateId" class="message-confirm-backdrop" @click.self="deleteCandidateId = null">
    <section role="alertdialog" aria-modal="true" aria-labelledby="delete-message-title" class="message-confirm-dialog">
        <h3 id="delete-message-title">Удалить сообщение у всех?</h3>
        <p>Сообщение исчезнет у всех участников без возможности восстановления.</p>
        <div>
          <button type="button" @click="deleteCandidateId = null">Отмена</button>
          <button
            class="danger"
            type="button"
            :disabled="deletingMessageId === deleteCandidateId"
            @click="confirmDelete(deleteCandidateId)"
          >{{ deletingMessageId === deleteCandidateId ? 'Удаляем…' : 'Удалить' }}</button>
        </div>
    </section>
  </div>
</template>
