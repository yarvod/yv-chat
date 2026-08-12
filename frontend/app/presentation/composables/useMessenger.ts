import { computed, reactive, readonly } from 'vue'

import { ApplicationError } from '../../application/errors'
import { DeviceCryptoError } from '../../application/device-crypto/errors'
import type { ReconcileConversationCryptoResult } from '../../application/conversation-crypto/reconcile-conversation-crypto'
import {
  ConversationHistory,
  type ConversationHistoryWindow,
} from '../../application/messaging/conversation-history'
import type { ListConversationReadStates } from '../../application/messaging/list-conversation-read-states'
import type { DeleteMessageForEveryone } from '../../application/messaging/delete-message-for-everyone'
import type { AddGroupMember } from '../../application/conversations/add-group-member'
import type { LeaveGroup } from '../../application/conversations/leave-group'
import type { RemoveGroupMember } from '../../application/conversations/remove-group-member'
import type { RenameGroup } from '../../application/conversations/rename-group'
import type { ListParticipantDeliveryStates } from '../../application/messaging/list-participant-delivery-states'
import type { MarkConversationDelivered } from '../../application/messaging/mark-conversation-delivered'
import type { MarkConversationRead } from '../../application/messaging/mark-conversation-read'
import type { ProtocolMessageProtection } from '../../application/messaging/message-protection'
import {
  conversationProtectionLabel as protectionLabelForConversation,
  conversationUsesEndToEndEncryption,
  outgoingProtocolVersion,
} from '../../application/messaging/conversation-message-policy'
import type { TimelineMessage } from '../../application/messaging/timeline-message'
import {
  encodeGroupMessageContent,
} from '../../application/messaging/group-message-content'
import {
  encodeTextMessageContent,
  type MessageInteractionContext,
} from '../../application/messaging/text-message-content'
import type {
  GroupAttachmentSource,
  UploadGroupAttachment,
} from '../../application/messaging/upload-group-attachment'
import type { DownloadGroupAttachment } from '../../application/messaging/download-group-attachment'
import type { MessageArchive } from '../../application/ports/message-archive'
import type {
  ConversationViewportAnchor,
  MessengerSnapshot,
  MessengerSnapshotStore,
} from '../../application/ports/messenger-snapshot-store'
import type { MessagingGateway } from '../../application/ports/messaging-gateway'
import type { PageVisibility } from '../../application/ports/page-visibility'
import type { Clock } from '../../application/ports/clock'
import type {
  Conversation,
  ConversationReadState,
  DirectoryUser,
  MessageAttachment,
  MessageReactionSummary,
  OpaqueMessage,
  ParticipantDeliveryState,
  SendMessageReceipt,
} from '../../domain/messaging/models'
import type { OutboxMessage } from '../../domain/messaging/outbox'
import {
  useMessageOutbox,
  type MessageOutboxDependencies,
} from './useMessageOutbox'

type MessengerPhase = 'loading' | 'ready' | 'offline' | 'error'
type ConversationCryptoPhase = 'checking' | 'ready' | 'pending' | 'blocked' | 'unavailable'
const MAX_HOT_CONVERSATION_WINDOWS = 12
const TARGET_CONTEXT_MESSAGES = 8

interface MessengerState {
  phase: MessengerPhase
  conversations: Conversation[]
  directory: DirectoryUser[]
  activeConversationId: string | null
  messages: TimelineMessage[]
  historyHasMore: boolean
  historyHasNewer: boolean
  loadingOlder: boolean
  archiveStatus: 'ready' | 'unavailable'
  readStates: ConversationReadState[]
  deliveryStates: ParticipantDeliveryState[]
  viewportAnchors: ConversationViewportAnchor[]
  syncCursor: number
  creating: boolean
  deletingMessageId: string | null
  groupMutating: boolean
  uploadingAttachment: boolean
  attachmentUploadCompleted: number
  attachmentUploadTotal: number
  attachmentUploadBytesSent: number
  attachmentUploadBytesTotal: number
  reactionSummaries: MessageReactionSummary[]
  conversationCryptoPhase: ConversationCryptoPhase
  conversationCryptoBlockReason: string | null
  message: string | null
}

export interface MessengerDependencies extends MessageOutboxDependencies {
  gateway: MessagingGateway
  messageArchive: MessageArchive
  messengerSnapshotStore: MessengerSnapshotStore
  messageProtection: ProtocolMessageProtection
  clock: Clock
  listConversationReadStates: ListConversationReadStates
  markConversationRead: MarkConversationRead
  listParticipantDeliveryStates: ListParticipantDeliveryStates
  markConversationDelivered: MarkConversationDelivered
  deleteMessageForEveryone: DeleteMessageForEveryone
  addGroupMember: AddGroupMember
  removeGroupMember: RemoveGroupMember
  renameGroup: RenameGroup
  leaveGroup: LeaveGroup
  pageVisibility: PageVisibility
  uploadGroupAttachment?: UploadGroupAttachment
  downloadGroupAttachment?: DownloadGroupAttachment
  initializeDeviceCrypto?: () => Promise<unknown>
  reconcileConversationCrypto?: (
    conversationId: string,
  ) => Promise<ReconcileConversationCryptoResult>
  invalidateConversationCrypto?: (conversationId: string) => void
}

export function useMessenger(
  actorUserId: string,
  actorDeviceId: string,
  onUnauthorized: () => void,
  suppliedDependencies?: MessengerDependencies,
) {
  const dependencies = suppliedDependencies ?? (() => {
    const { $frontend } = useNuxtApp()
    return {
      gateway: $frontend.messagingGateway,
      messageArchive: $frontend.messageArchive,
      messengerSnapshotStore: $frontend.messengerSnapshotStore,
      messageProtection: $frontend.messageProtection,
      clock: $frontend.clock,
      haptics: $frontend.haptics,
      listOutboxMessages: $frontend.listOutboxMessages,
      queueOutgoingMessage: $frontend.queueOutgoingMessage,
      deliverOutboxMessage: $frontend.deliverOutboxMessage,
      acknowledgeOutboxMessage: $frontend.acknowledgeOutboxMessage,
      retryOutboxMessage: $frontend.retryOutboxMessage,
      listConversationReadStates: $frontend.listConversationReadStates,
      markConversationRead: $frontend.markConversationRead,
      listParticipantDeliveryStates: $frontend.listParticipantDeliveryStates,
      markConversationDelivered: $frontend.markConversationDelivered,
      deleteMessageForEveryone: $frontend.deleteMessageForEveryone,
      addGroupMember: $frontend.addGroupMember,
      removeGroupMember: $frontend.removeGroupMember,
      renameGroup: $frontend.renameGroup,
      leaveGroup: $frontend.leaveGroup,
      pageVisibility: $frontend.pageVisibility,
      uploadGroupAttachment: $frontend.uploadGroupAttachment,
      downloadGroupAttachment: $frontend.downloadGroupAttachment,
      initializeDeviceCrypto: () => $frontend.deviceCryptoSession.initialize({
        userId: actorUserId,
        deviceId: actorDeviceId,
      }),
      reconcileConversationCrypto: conversationId => (
        $frontend.deviceCryptoSession.reconcileConversation(conversationId)
      ),
      invalidateConversationCrypto: conversationId => (
        $frontend.deviceCryptoSession.invalidateConversation(conversationId)
      ),
    }
  })()
  const {
    gateway,
    messageArchive,
    messengerSnapshotStore,
    messageProtection,
    clock,
    listConversationReadStates,
    markConversationRead,
    listParticipantDeliveryStates,
    markConversationDelivered,
    deleteMessageForEveryone,
    addGroupMember,
    removeGroupMember,
    renameGroup,
    leaveGroup,
    pageVisibility,
    uploadGroupAttachment,
    downloadGroupAttachment,
  } = dependencies
  const state = reactive<MessengerState>({
    phase: 'loading',
    conversations: [],
    directory: [],
    activeConversationId: null,
    messages: [],
    historyHasMore: false,
    historyHasNewer: false,
    loadingOlder: false,
    archiveStatus: 'ready',
    readStates: [],
    deliveryStates: [],
    viewportAnchors: [],
    syncCursor: 0,
    creating: false,
    deletingMessageId: null,
    groupMutating: false,
    uploadingAttachment: false,
    attachmentUploadCompleted: 0,
    attachmentUploadTotal: 0,
    attachmentUploadBytesSent: 0,
    attachmentUploadBytesTotal: 0,
    reactionSummaries: [],
    conversationCryptoPhase: 'checking',
    conversationCryptoBlockReason: null,
    message: null,
  })
  const history = new ConversationHistory(
    actorUserId,
    gateway,
    messageArchive,
    messageProtection,
  )
  let polling = false
  let snapshotAvailable = true
  let snapshotPersistQueue = Promise.resolve()
  const readAdvances = new Map<string, number>()
  const deliveryAdvances = new Map<string, number>()
  const hotHistoryWindows = new Map<string, ConversationHistoryWindow>()

  const activeConversation = computed(() => (
    state.conversations.find(item => item.conversationId === state.activeConversationId) ?? null
  ))
  const outbox = useMessageOutbox(actorUserId, actorDeviceId, dependencies, {
    reconcile: reconcileSent,
    unauthorized: onUnauthorized,
    failed: fail,
  })
  const activeOutgoingMessages = computed(() => outbox.state.messages.filter(message => (
    message.conversationId === state.activeConversationId
  )))
  const activeViewportAnchor = computed(() => state.viewportAnchors.find(anchor => (
    anchor.conversationId === state.activeConversationId
  )) ?? null)
  const conversationProtectionSecure = computed(() => (
    activeConversation.value !== null
    && conversationUsesEndToEndEncryption(activeConversation.value.conversationType)
    && messageProtection.isSecure(outgoingProtocolVersion(activeConversation.value.conversationType))
    && state.conversationCryptoPhase === 'ready'
  ))
  const conversationProtectionLabel = computed(() => {
    const conversation = activeConversation.value
    if (!conversation) return 'Выберите диалог'
    if (!conversationUsesEndToEndEncryption(conversation.conversationType)) {
      return protectionLabelForConversation(conversation.conversationType)
    }
    if (state.conversationCryptoPhase === 'ready') return 'MLS E2EE готово'
    if (state.conversationCryptoPhase === 'pending') return 'Шифрование личного чата обновляется'
    if (state.conversationCryptoPhase === 'blocked') {
      if (state.conversationCryptoBlockReason === 'local_state_lost') {
        return 'Локальные ключи этого личного чата потеряны на устройстве'
      }
      return state.conversationCryptoBlockReason === 'missing_key_package'
        ? 'Не хватает одноразового ключа одного из устройств'
        : state.conversationCryptoBlockReason === 'missing_identity'
          ? 'Одно из устройств ещё не подготовило криптомодуль'
          : state.conversationCryptoBlockReason === 'device_roster_changed'
            ? 'Ожидаем подтверждение от уже подключённого устройства'
          : 'Шифрование личного чата требует восстановления'
    }
    if (state.conversationCryptoPhase === 'checking') return 'Проверяем E2EE личного чата'
    return 'E2EE личного чата недоступно на этом устройстве'
  })

  async function refreshConversationCrypto(conversationId: string): Promise<void> {
    if (state.activeConversationId !== conversationId) return
    const conversation = state.conversations.find(item => item.conversationId === conversationId)
    if (!conversation || !conversationUsesEndToEndEncryption(conversation.conversationType)) {
      state.conversationCryptoPhase = 'unavailable'
      state.conversationCryptoBlockReason = null
      return
    }
    const reconcile = dependencies.reconcileConversationCrypto
    if (!messageProtection.isSecure(outgoingProtocolVersion(conversation.conversationType)) || !reconcile) {
      state.conversationCryptoPhase = 'unavailable'
      state.conversationCryptoBlockReason = null
      return
    }
    state.conversationCryptoPhase = 'checking'
    state.conversationCryptoBlockReason = null
    try {
      const result = await reconcile(conversationId)
      if (state.activeConversationId !== conversationId) return
      state.conversationCryptoPhase = result.status
      state.conversationCryptoBlockReason = result.blockReason
    } catch (error) {
      if (state.activeConversationId !== conversationId) return
      if (error instanceof DeviceCryptoError && error.code === 'local-state-lost') {
        state.conversationCryptoPhase = 'blocked'
        state.conversationCryptoBlockReason = 'local_state_lost'
      } else {
        state.conversationCryptoPhase = 'unavailable'
        state.conversationCryptoBlockReason = null
      }
    }
  }

  async function reconcileDirectConversations(
    conversationIds: Iterable<string>,
  ): Promise<void> {
    const reconcile = dependencies.reconcileConversationCrypto
    if (!reconcile) return
    const requested = new Set(conversationIds)
    const directIds = state.conversations
      .filter(item => (
        item.conversationType === 'direct'
        && requested.has(item.conversationId)
      ))
      .map(item => item.conversationId)
    const activeId = state.activeConversationId
    directIds.sort((left, right) => (
      left === activeId ? -1 : right === activeId ? 1 : left.localeCompare(right)
    ))
    for (const conversationId of directIds) {
      if (conversationId === activeId) {
        await refreshConversationCrypto(conversationId)
        continue
      }
      try {
        await reconcile(conversationId)
      } catch {
        // An inactive conversation remains fail-closed. Its next durable sync
        // event or foreground selection retries reconciliation without making
        // an unrelated chat unavailable.
      }
    }
  }

  async function reconcileAllDirectConversations(): Promise<void> {
    await reconcileDirectConversations(
      state.conversations.map(item => item.conversationId),
    )
  }

  function fail(error: unknown): void {
    if (error instanceof ApplicationError && error.status === 401) {
      onUnauthorized()
      return
    }
    state.phase = error instanceof ApplicationError && error.kind === 'network' ? 'offline' : 'error'
    state.message = state.phase === 'offline'
      ? outbox.state.status === 'ready'
        ? 'Соединение потеряно. Новые сообщения сохраняются в локальной очереди.'
        : 'Соединение потеряно, локальная очередь отправки недоступна.'
      : 'Не удалось обновить данные мессенджера.'
  }

  function replaceReadState(next: ConversationReadState): void {
    state.readStates = [
      ...state.readStates.filter(item => item.conversationId !== next.conversationId),
      next,
    ]
  }

  async function reloadReadStates(): Promise<void> {
    state.readStates = await listConversationReadStates.execute()
  }

  async function reloadDeliveryStates(): Promise<void> {
    state.deliveryStates = await listParticipantDeliveryStates.execute()
  }

  function replaceDeliveryState(next: ParticipantDeliveryState): void {
    state.deliveryStates = [
      ...state.deliveryStates.filter(item => (
        item.conversationId !== next.conversationId || item.userId !== next.userId
      )),
      next,
    ]
  }

  async function advanceDelivery(conversationId: string): Promise<void> {
    const sequence = state.messages.at(-1)?.sequence ?? 0
    if (sequence <= 0) return
    const persisted = state.deliveryStates.find(item => (
      item.conversationId === conversationId && item.userId === actorUserId
    ))?.deliveredSequence ?? 0
    const submitted = deliveryAdvances.get(conversationId) ?? 0
    if (sequence <= Math.max(persisted, submitted)) return
    deliveryAdvances.set(conversationId, sequence)
    try {
      const result = await markConversationDelivered.execute(conversationId, sequence)
      replaceDeliveryState({
        conversationId,
        userId: actorUserId,
        deliveredSequence: result.lastDeliveredSequence,
      })
    } catch (error) {
      deliveryAdvances.delete(conversationId)
      throw error
    }
  }

  async function advanceActiveReadIfVisible(): Promise<void> {
    const conversationId = state.activeConversationId
    const sequence = state.messages.at(-1)?.sequence ?? 0
    if (!conversationId || sequence <= 0 || !pageVisibility.isVisible()) return
    const persisted = state.readStates.find(item => item.conversationId === conversationId)
      ?.lastReadSequence ?? 0
    const submitted = readAdvances.get(conversationId) ?? 0
    if (sequence <= Math.max(persisted, submitted)) return
    readAdvances.set(conversationId, sequence)
    try {
      const result = await markConversationRead.execute(conversationId, sequence)
      const current = state.readStates.find(item => item.conversationId === conversationId)
      replaceReadState({
        conversationId,
        lastReadSequence: result.lastReadSequence,
        latestSequence: Math.max(current?.latestSequence ?? 0, sequence),
        unreadCount: 0,
      })
    } catch (error) {
      readAdvances.delete(conversationId)
      throw error
    }
  }

  function rememberHotHistoryWindow(
    conversationId: string,
    window: ConversationHistoryWindow,
  ): ConversationHistoryWindow {
    const remembered = {
      messages: [...window.messages],
      hasMore: window.hasMore,
      hasNewer: window.hasNewer,
    }
    hotHistoryWindows.delete(conversationId)
    hotHistoryWindows.set(conversationId, remembered)
    while (hotHistoryWindows.size > MAX_HOT_CONVERSATION_WINDOWS) {
      const oldestConversationId = hotHistoryWindows.keys().next().value
      if (typeof oldestConversationId !== 'string') break
      hotHistoryWindows.delete(oldestConversationId)
    }
    return remembered
  }

  function hotHistoryWindow(conversationId: string): ConversationHistoryWindow | null {
    const window = hotHistoryWindows.get(conversationId)
    if (!window) return null
    return rememberHotHistoryWindow(conversationId, window)
  }

  function rememberActiveHistoryWindow(): void {
    const conversationId = state.activeConversationId
    if (!conversationId || state.messages.length === 0) return
    rememberHotHistoryWindow(conversationId, {
      messages: state.messages,
      hasMore: state.historyHasMore,
      hasNewer: state.historyHasNewer,
    })
  }

  function applyHistoryWindow(
    window: ConversationHistoryWindow,
    conversationId: string | null = state.activeConversationId,
  ): void {
    if (!conversationId) return
    const remembered = rememberHotHistoryWindow(conversationId, window)
    if (state.activeConversationId !== conversationId) return
    state.messages = remembered.messages
    state.historyHasMore = remembered.hasMore
    state.historyHasNewer = remembered.hasNewer
    void reloadActiveReactions()
  }

  async function reloadActiveReactions(): Promise<void> {
    const conversationId = state.activeConversationId
    const listReactions = gateway.listMessageReactions
    if (!conversationId || !listReactions) {
      state.reactionSummaries = []
      return
    }
    const messageIds = state.messages
      .filter(message => message.deletedAt === null)
      .slice(-100)
      .map(message => message.messageId)
    if (messageIds.length === 0) {
      state.reactionSummaries = []
      return
    }
    try {
      const summaries = await listReactions.call(gateway, conversationId, messageIds)
      if (state.activeConversationId === conversationId) state.reactionSummaries = summaries
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 401) onUnauthorized()
    }
  }

  async function toggleReaction(
    messageId: string,
    reaction: string,
    active: boolean,
  ): Promise<boolean> {
    const conversationId = state.activeConversationId
    const setReaction = gateway.setMessageReaction
    if (!conversationId || !setReaction) return false
    try {
      const updated = await setReaction.call(
        gateway,
        conversationId,
        messageId,
        reaction,
        active,
      )
      state.reactionSummaries = [
        ...state.reactionSummaries.filter(item => item.messageId !== messageId),
        ...updated,
      ]
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  function syncArchiveStatus(): void {
    state.archiveStatus = history.archiveStatus === 'ready' && snapshotAvailable
      ? 'ready'
      : 'unavailable'
  }

  function bumpConversationActivity(conversationId: string, activityAt: string): void {
    const activityTime = Date.parse(activityAt)
    if (Number.isNaN(activityTime)) return
    state.conversations = state.conversations.map(conversation => (
      conversation.conversationId === conversationId
      && activityTime > Date.parse(conversation.updatedAt)
        ? { ...conversation, updatedAt: activityAt }
        : conversation
    )).sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || left.conversationId.localeCompare(right.conversationId)
    ))
  }

  async function reconcileSent(
    message: OutboxMessage,
    receipt: SendMessageReceipt,
  ): Promise<void> {
    bumpConversationActivity(message.conversationId, receipt.createdAt)
    if (message.conversationId === state.activeConversationId) {
      const authoritative: OpaqueMessage = {
        ...receipt,
        ciphertextBase64: message.ciphertextBase64,
        deletionReason: null,
        deletedAt: null,
      }
      const window = await history.acceptAuthoritativeOutgoing(
        authoritative,
        state.messages,
        state.historyHasMore,
        state.historyHasNewer,
      )
      syncArchiveStatus()
      applyHistoryWindow(window)
      await advanceDelivery(message.conversationId)
      await advanceActiveReadIfVisible()
    }
  }

  async function persistSnapshot(): Promise<void> {
    // Never persist an advanced sync cursor when the encrypted message archive is
    // unavailable. Otherwise a later startup could trust that cursor while the
    // corresponding message envelopes were never stored locally.
    if (!snapshotAvailable || history.archiveStatus !== 'ready') return
    const snapshot: MessengerSnapshot = {
      ownerUserId: actorUserId,
      directory: [...state.directory],
      conversations: [...state.conversations],
      readStates: [...state.readStates],
      deliveryStates: [...state.deliveryStates],
      viewportAnchors: [...state.viewportAnchors],
      syncCursor: state.syncCursor,
      savedAt: new Date(clock.nowMilliseconds()).toISOString(),
    }
    try {
      const save = () => messengerSnapshotStore.save(snapshot)
      snapshotPersistQueue = snapshotPersistQueue.then(save, save)
      await snapshotPersistQueue
    } catch {
      snapshotAvailable = false
      syncArchiveStatus()
    }
  }

  async function hydrateSnapshot(preferredConversationId: string | null = null): Promise<boolean> {
    let snapshot: MessengerSnapshot | null
    try {
      snapshot = await messengerSnapshotStore.load(actorUserId)
    } catch {
      snapshotAvailable = false
      syncArchiveStatus()
      return false
    }
    if (!snapshot) return false
    state.directory = [...snapshot.directory]
    state.conversations = [...snapshot.conversations]
    state.readStates = [...snapshot.readStates]
    state.deliveryStates = [...snapshot.deliveryStates]
    const conversationIds = new Set(snapshot.conversations.map(item => item.conversationId))
    state.viewportAnchors = (snapshot.viewportAnchors ?? []).filter(anchor => (
      conversationIds.has(anchor.conversationId)
    ))
    state.syncCursor = snapshot.syncCursor
    state.activeConversationId = state.conversations.some(item => (
      item.conversationId === preferredConversationId
    ))
      ? preferredConversationId
      : state.conversations[0]?.conversationId ?? null
    resetHistoryWindow()
    if (state.activeConversationId) {
      const anchor = state.viewportAnchors.find(item => (
        item.conversationId === state.activeConversationId
      ))
      const cached = anchor && !anchor.atLatest
        ? await history.loadCachedEndingAtSequence(state.activeConversationId, anchor.sequence)
        : await history.loadCachedLatest(state.activeConversationId)
      syncArchiveStatus()
      if (cached) applyHistoryWindow(cached)
    }
    state.phase = 'ready'
    return true
  }

  async function loadLatestHistory(conversationId: string): Promise<void> {
    let window: ConversationHistoryWindow
    try {
      window = await history.loadLatest(conversationId, cached => {
        syncArchiveStatus()
        if (state.activeConversationId !== conversationId) return
        applyHistoryWindow(cached)
        state.phase = 'ready'
      })
    } finally {
      syncArchiveStatus()
    }
    if (state.activeConversationId !== conversationId) return
    applyHistoryWindow(window)
    await advanceDelivery(conversationId)
    await advanceActiveReadIfVisible()
  }

  async function loadForwardMessages(conversationId: string): Promise<void> {
    let window: ConversationHistoryWindow
    try {
      window = await history.loadForward(
        conversationId,
        state.messages,
        state.historyHasMore,
      )
    } finally {
      syncArchiveStatus()
    }
    if (state.activeConversationId !== conversationId) return
    applyHistoryWindow(window)
    await advanceDelivery(conversationId)
    await advanceActiveReadIfVisible()
  }

  async function loadOlder(): Promise<void> {
    const conversationId = state.activeConversationId
    const beforeSequence = state.messages[0]?.sequence
    if (
      !conversationId
      || beforeSequence === undefined
      || !state.historyHasMore
      || state.loadingOlder
    ) return
    state.loadingOlder = true
    try {
      const window = await history.loadBefore(
        conversationId,
        beforeSequence,
        state.messages,
        state.historyHasNewer,
        cached => {
          if (state.activeConversationId === conversationId) applyHistoryWindow(cached)
        },
      )
      if (state.activeConversationId !== conversationId) return
      applyHistoryWindow(window)
      state.phase = 'ready'
      state.message = null
    } catch (error) {
      fail(error)
    } finally {
      syncArchiveStatus()
      state.loadingOlder = false
    }
  }

  async function returnToLatest(): Promise<void> {
    const conversationId = state.activeConversationId
    if (!conversationId) return
    state.message = null
    try {
      await loadLatestHistory(conversationId)
      state.phase = 'ready'
    } catch (error) {
      fail(error)
    }
  }

  function resetHistoryWindow(): void {
    state.messages = []
    state.historyHasMore = false
    state.historyHasNewer = false
    state.loadingOlder = false
  }

  async function reloadConversations(): Promise<void> {
    const [directory, conversations] = await Promise.all([
      gateway.listDirectory(),
      gateway.listConversations(),
    ])
    state.directory = directory
    state.conversations = conversations
    const conversationIds = new Set(conversations.map(item => item.conversationId))
    for (const conversationId of hotHistoryWindows.keys()) {
      if (!conversationIds.has(conversationId)) hotHistoryWindows.delete(conversationId)
    }
    state.viewportAnchors = state.viewportAnchors.filter(anchor => (
      conversationIds.has(anchor.conversationId)
    ))
    if (!state.conversations.some(item => item.conversationId === state.activeConversationId)) {
      state.activeConversationId = state.conversations[0]?.conversationId ?? null
      resetHistoryWindow()
      if (state.activeConversationId) await loadLatestHistory(state.activeConversationId)
    }
  }

  async function load(
    preferredConversationId: string | null = null,
    targetMessageId: string | null = null,
  ): Promise<void> {
    state.phase = 'loading'
    state.message = null
    try {
      try {
        await dependencies.initializeDeviceCrypto?.()
      } catch {
        // Group v1 does not depend on OpenMLS. Direct conversations remain
        // fail-closed because their reconciliation/send paths still require v2.
      }
      await outbox.load()
      if (await hydrateSnapshot(preferredConversationId)) {
        await reconcileAllDirectConversations()
        await poll()
        if (
          state.activeConversationId
          && state.messages.length === 0
        ) {
          await loadLatestHistory(state.activeConversationId)
        }
        if (state.activeConversationId) {
          await selectConversation(state.activeConversationId, targetMessageId)
        }
        return
      }
      const syncBaseline = await gateway.listSync(0)
      const [directory, conversations, readStates, deliveryStates] = await Promise.all([
        gateway.listDirectory(),
        gateway.listConversations(),
        listConversationReadStates.execute(),
        listParticipantDeliveryStates.execute(),
      ])
      state.directory = directory
      state.conversations = conversations
      state.readStates = readStates
      state.deliveryStates = deliveryStates
      state.activeConversationId = conversations.some(item => (
        item.conversationId === preferredConversationId
      ))
        ? preferredConversationId
        : conversations[0]?.conversationId ?? null
      resetHistoryWindow()
      await reconcileAllDirectConversations()
      if (state.activeConversationId) await loadLatestHistory(state.activeConversationId)
      if (state.activeConversationId && targetMessageId) {
        await selectConversation(state.activeConversationId, targetMessageId)
      }
      state.syncCursor = syncBaseline.streamCursor
      state.phase = 'ready'
      await persistSnapshot()
      await outbox.flush()
    } catch (error) {
      fail(error)
    }
  }

  async function selectConversation(
    conversationId: string,
    targetMessageId: string | null = null,
  ): Promise<void> {
    const changed = conversationId !== state.activeConversationId
    let hotWindow: ConversationHistoryWindow | null = null
    if (changed) {
      rememberActiveHistoryWindow()
      state.activeConversationId = conversationId
      hotWindow = hotHistoryWindow(conversationId)
      if (hotWindow) applyHistoryWindow(hotWindow, conversationId)
      else resetHistoryWindow()
    }
    state.message = null
    try {
      const targetIndex = targetMessageId === null
        ? -1
        : state.messages.findIndex(message => message.messageId === targetMessageId)
      const target = targetIndex < 0 ? null : state.messages[targetIndex] ?? null
      const targetLoaded = target !== null
        && targetIndex >= Math.min(TARGET_CONTEXT_MESSAGES, target.sequence - 1)
        && (
          state.messages.length - targetIndex - 1 >= TARGET_CONTEXT_MESSAGES
          || !state.historyHasNewer
        )
      const anchor = state.viewportAnchors.find(item => item.conversationId === conversationId)
      const anchorLoaded = anchor !== undefined
        && state.messages.some(message => message.messageId === anchor.messageId)
      if (targetMessageId && !targetLoaded) {
        applyHistoryWindow(
          await history.loadMessageWindow(conversationId, targetMessageId),
          conversationId,
        )
      } else if (!targetMessageId && anchor && !anchor.atLatest && !anchorLoaded) {
        applyHistoryWindow(await history.loadEndingAtSequence(
          conversationId,
          anchor.sequence,
          cached => {
            if (state.activeConversationId !== conversationId) return
            applyHistoryWindow(cached, conversationId)
            state.phase = 'ready'
          },
        ), conversationId)
      } else if (changed && hotWindow) {
        state.phase = 'ready'
        if (!hotWindow.hasNewer) await loadForwardMessages(conversationId)
      } else if (changed) {
        const cached = await history.loadCachedLatest(conversationId)
        syncArchiveStatus()
        if (cached) {
          applyHistoryWindow(cached, conversationId)
          state.phase = 'ready'
          await loadForwardMessages(conversationId)
        } else {
          await loadLatestHistory(conversationId)
        }
      } else {
        await refreshConversationCrypto(conversationId)
        return
      }
      syncArchiveStatus()
      await refreshConversationCrypto(conversationId)
      state.phase = 'ready'
    } catch (error) {
      if (state.activeConversationId === conversationId) fail(error)
    }
  }

  async function rememberViewport(anchor: ConversationViewportAnchor): Promise<void> {
    if (anchor.conversationId !== state.activeConversationId) return
    const message = state.messages.find(item => item.messageId === anchor.messageId)
    if (
      !message
      || message.sequence !== anchor.sequence
      || !Number.isFinite(anchor.offset)
      || Math.abs(anchor.offset) > 100_000
      || Number.isNaN(Date.parse(anchor.savedAt))
    ) return
    state.viewportAnchors = [
      ...state.viewportAnchors.filter(item => item.conversationId !== anchor.conversationId),
      anchor,
    ].slice(-1_000)
    await persistSnapshot()
  }

  async function createDirect(otherUserId: string): Promise<void> {
    state.creating = true
    state.message = null
    try {
      const conversation = await gateway.createDirect(otherUserId)
      await reloadConversations()
      await selectConversation(conversation.conversationId)
      await persistSnapshot()
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 409) {
        state.message = 'Прямой диалог с этим участником уже существует.'
      } else {
        fail(error)
      }
    } finally {
      state.creating = false
    }
  }

  async function createGroup(title: string, memberUserIds: string[]): Promise<void> {
    state.creating = true
    state.message = null
    try {
      const conversation = await gateway.createGroup(title, memberUserIds)
      await reloadConversations()
      await selectConversation(conversation.conversationId)
      await persistSnapshot()
    } catch (error) {
      fail(error)
    } finally {
      state.creating = false
    }
  }

  async function mutateGroup(operation: () => Promise<Conversation>): Promise<boolean> {
    if (state.groupMutating) return false
    state.groupMutating = true
    state.message = null
    try {
      const conversation = await operation()
      state.conversations = state.conversations.map(item => (
        item.conversationId === conversation.conversationId ? conversation : item
      ))
      await persistSnapshot()
      if (state.activeConversationId === conversation.conversationId) {
        await refreshConversationCrypto(conversation.conversationId)
      }
      state.phase = 'ready'
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      state.groupMutating = false
    }
  }

  function renameActiveGroup(title: string): Promise<boolean> {
    const conversationId = state.activeConversationId
    if (!conversationId) return Promise.resolve(false)
    return mutateGroup(() => renameGroup.execute(conversationId, title))
  }

  function addActiveGroupMember(userId: string): Promise<boolean> {
    const conversationId = state.activeConversationId
    if (!conversationId) return Promise.resolve(false)
    return mutateGroup(() => addGroupMember.execute(conversationId, userId))
  }

  function removeActiveGroupMember(userId: string): Promise<boolean> {
    const conversationId = state.activeConversationId
    if (!conversationId) return Promise.resolve(false)
    return mutateGroup(() => removeGroupMember.execute(conversationId, userId))
  }

  async function leaveActiveGroup(): Promise<boolean> {
    const conversationId = state.activeConversationId
    if (!conversationId || state.groupMutating) return false
    state.groupMutating = true
    state.message = null
    try {
      await leaveGroup.execute(conversationId)
      await reloadConversations()
      await persistSnapshot()
      state.phase = 'ready'
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      state.groupMutating = false
    }
  }

  async function send(
    plaintext: string,
    attachments: readonly GroupAttachmentSource[] = [],
    interaction: MessageInteractionContext = {},
  ): Promise<boolean> {
    const conversationId = state.activeConversationId
    const conversation = activeConversation.value
    const normalized = plaintext.trim()
    if (
      !conversationId
      || !conversation
      || (!normalized && attachments.length === 0)
      || normalized.length > 4000
      || attachments.length > 10
    ) {
      return false
    }
    if (attachments.length > 0 && conversation.conversationType !== 'group') {
      state.message = 'Файлы в личных чатах появятся после отдельного E2EE media flow.'
      return false
    }
    if (
      conversationUsesEndToEndEncryption(conversation.conversationType)
      && state.conversationCryptoPhase !== 'ready'
    ) {
      state.message = 'Личный диалог недоступен до восстановления MLS E2EE.'
      return false
    }
    state.message = null
    state.uploadingAttachment = attachments.length > 0
    state.attachmentUploadCompleted = 0
    state.attachmentUploadTotal = attachments.length
    state.attachmentUploadBytesSent = 0
    state.attachmentUploadBytesTotal = attachments.reduce(
      (total, attachment) => total + attachment.size,
      0,
    )
    try {
      const uploaded: MessageAttachment[] = []
      if (attachments.length > 0 && !uploadGroupAttachment) {
        state.message = 'Загрузка файлов на этом устройстве недоступна.'
        return false
      }
      let completedBytes = 0
      for (const attachment of attachments) {
        let currentUploadedBytes = 0
        uploaded.push(await uploadGroupAttachment!.execute(
          conversationId,
          conversation.conversationType,
          attachment,
          progress => {
            currentUploadedBytes = Math.max(
              currentUploadedBytes,
              Math.max(0, Math.min(attachment.size, progress.uploadedBytes)),
            )
            state.attachmentUploadBytesSent = completedBytes + currentUploadedBytes
          },
        ))
        completedBytes += attachment.size
        state.attachmentUploadBytesSent = completedBytes
        state.attachmentUploadCompleted = uploaded.length
      }
      const interactionContent = {
        replyToMessageId: interaction.replyToMessageId ?? null,
        mentionedUserIds: interaction.mentionedUserIds ?? [],
      }
      const content = conversation.conversationType === 'group'
        ? encodeGroupMessageContent({
            text: normalized,
            attachments: uploaded,
            ...interactionContent,
          })
        : encodeTextMessageContent({ text: normalized, ...interactionContent })
      return await outbox.enqueue(
        conversationId,
        conversation.conversationType,
        content,
        uploaded.map(item => item.attachmentId),
      )
    } catch (error) {
      if (attachments.length > 0) {
        state.message = error instanceof ApplicationError && error.status === 413
          ? 'Один из файлов превышает допустимый размер или доступную квоту.'
          : 'Не удалось загрузить файлы. Проверьте соединение и повторите.'
      } else {
        fail(error)
      }
      return false
    } finally {
      state.uploadingAttachment = false
      state.attachmentUploadCompleted = 0
      state.attachmentUploadTotal = 0
      state.attachmentUploadBytesSent = 0
      state.attachmentUploadBytesTotal = 0
    }
  }

  async function loadAttachment(
    conversationId: string,
    attachment: MessageAttachment,
  ): Promise<Blob> {
    if (!downloadGroupAttachment) throw new TypeError('attachment download unavailable')
    try {
      return await downloadGroupAttachment.execute(conversationId, attachment)
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 401) onUnauthorized()
      throw error
    }
  }

  async function retryOutgoing(clientMessageId: string): Promise<boolean> {
    try {
      return await outbox.retry(clientMessageId)
    } catch (error) {
      fail(error)
      return false
    }
  }

  async function searchActiveConversation(query: string): Promise<readonly TimelineMessage[]> {
    const conversationId = state.activeConversationId
    if (!conversationId) return []
    try {
      const results = await history.search(conversationId, query)
      syncArchiveStatus()
      return results
    } catch (error) {
      fail(error)
      return []
    }
  }

  async function deleteMessage(messageId: string): Promise<boolean> {
    const conversationId = state.activeConversationId
    if (!conversationId || !messageId || state.deletingMessageId !== null) return false
    state.deletingMessageId = messageId
    state.message = null
    try {
      const result = await deleteMessageForEveryone.execute(conversationId, messageId)
      state.messages = state.messages.map(message => (
        message.messageId === result.messageId
          ? {
              ...message,
              ciphertextBase64: null,
              deletionReason: result.deletionReason,
              deletedAt: result.deletedAt,
              contentState: 'deleted' as const,
              displayBody: null,
              contentSecure: false,
            }
          : message
      ))
      rememberActiveHistoryWindow()
      const tombstone = state.messages.find(message => message.messageId === result.messageId)
      if (tombstone) {
        await history.persist(conversationId, [tombstone])
        syncArchiveStatus()
      }
      state.phase = 'ready'
      return true
    } catch (error) {
      fail(error)
      return false
    } finally {
      state.deletingMessageId = null
    }
  }

  async function poll(): Promise<void> {
    if (polling || state.phase === 'loading') return
    polling = true
    try {
      await outbox.flush()
      let pages = 0
      let hasMore = true
      let conversationsChanged = false
      const cryptoChangedConversationIds = new Set<string>()
      let activeMessagesChanged = false
      const deletedMessageEvents = new Map<
        string,
        { conversationId: string, messageId: string }
      >()
      let readStatesChanged = false
      let deliveryStatesChanged = false
      let reactionsChanged = false
      while (hasMore && pages < 10) {
        const page = await gateway.listSync(state.syncCursor)
        if (page.resetRequired) {
          await reloadConversations()
          await Promise.all([reloadReadStates(), reloadDeliveryStates()])
          await reconcileAllDirectConversations()
          if (state.activeConversationId) {
            resetHistoryWindow()
            await loadLatestHistory(state.activeConversationId)
          }
          state.syncCursor = page.streamCursor
          await persistSnapshot()
          state.phase = 'ready'
          return
        }
        for (const event of page.events) {
          if (event.eventType === 'message_created') {
            bumpConversationActivity(event.conversationId, event.createdAt)
          }
          if (event.eventType === 'conversation_updated') {
            dependencies.invalidateConversationCrypto?.(event.conversationId)
            cryptoChangedConversationIds.add(event.conversationId)
          }
          conversationsChanged ||= event.eventType === 'conversation_updated'
          activeMessagesChanged ||= (
            event.eventType === 'message_created'
            && event.conversationId === state.activeConversationId
          )
          if (event.eventType === 'message_deleted' && event.messageId !== null) {
            deletedMessageEvents.set(event.messageId, {
              conversationId: event.conversationId,
              messageId: event.messageId,
            })
          }
          readStatesChanged ||= event.eventType === 'message_created'
            || event.eventType === 'message_deleted'
            || event.eventType === 'read_receipt'
          deliveryStatesChanged ||= event.eventType === 'message_created'
            || event.eventType === 'delivery_receipt'
          reactionsChanged ||= event.eventType === 'message_reaction_updated'
            && event.conversationId === state.activeConversationId
        }
        state.syncCursor = page.nextCursor
        hasMore = page.hasMore
        pages += 1
      }
      if (conversationsChanged) await reloadConversations()
      await reconcileDirectConversations(cryptoChangedConversationIds)
      for (const event of deletedMessageEvents.values()) {
        let tombstone: TimelineMessage
        try {
          tombstone = await history.fetchTombstone(event.conversationId, event.messageId)
        } finally {
          syncArchiveStatus()
        }
        if (
          event.conversationId === state.activeConversationId
          && state.messages.some(message => message.messageId === event.messageId)
        ) {
          state.messages = state.messages.map(message => (
            message.messageId === event.messageId ? tombstone : message
          ))
          rememberActiveHistoryWindow()
        } else {
          const inactiveWindow = hotHistoryWindows.get(event.conversationId)
          if (inactiveWindow?.messages.some(message => message.messageId === event.messageId)) {
            rememberHotHistoryWindow(event.conversationId, {
              ...inactiveWindow,
              messages: inactiveWindow.messages.map(message => (
                message.messageId === event.messageId ? tombstone : message
              )),
            })
          }
        }
      }
      if (activeMessagesChanged && state.activeConversationId) {
        if (!state.historyHasNewer) {
          await loadForwardMessages(state.activeConversationId)
        }
        await refreshConversationCrypto(state.activeConversationId)
      }
      if (readStatesChanged) await reloadReadStates()
      if (deliveryStatesChanged) await reloadDeliveryStates()
      if (reactionsChanged) await reloadActiveReactions()
      await persistSnapshot()
      state.phase = 'ready'
      state.message = null
    } catch (error) {
      fail(error)
    } finally {
      polling = false
    }
  }

  async function markActiveRead(): Promise<void> {
    try {
      await advanceActiveReadIfVisible()
    } catch (error) {
      fail(error)
    }
  }

  return {
    state: readonly(state),
    outbox,
    activeConversation,
    activeOutgoingMessages,
    activeViewportAnchor,
    actorUserId,
    protection: {
      secure: conversationProtectionSecure,
      label: conversationProtectionLabel,
    },
    load,
    poll,
    selectConversation,
    createDirect,
    createGroup,
    renameActiveGroup,
    addActiveGroupMember,
    removeActiveGroupMember,
    leaveActiveGroup,
    send,
    loadAttachment,
    retryOutgoing,
    searchActiveConversation,
    toggleReaction,
    deleteMessage,
    loadOlder,
    returnToLatest,
    rememberViewport,
    markActiveRead,
  }
}
