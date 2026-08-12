<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useMessenger } from '../../composables/useMessenger'
import type { CurrentAccount } from '../../domain/accounts/account'
import type { TypingIndicator } from '../../application/messaging/typing-indicator-service'
import type { PresenceIndicator } from '../../application/messaging/presence-indicator-service'
import type { RealtimeConnectionState } from '../../application/messaging/realtime-sync-service'
import {
  selectedConversationId,
  selectedMessageId,
} from '../../presentation/chat/conversation-route'
import ConversationSidebar from './ConversationSidebar.vue'
import MessagePanel from './MessagePanel.vue'
import GroupDetailsPanel from './GroupDetailsPanel.vue'

const props = defineProps<{ user: CurrentAccount }>()
const emit = defineEmits<{ sessionExpired: [] }>()
const messenger = useMessenger(
  props.user.userId,
  props.user.deviceId,
  () => emit('sessionExpired'),
)
const { $frontend } = useNuxtApp()
const route = useRoute()
const realtime = $frontend.createRealtimeSync()
const typing = $frontend.createTypingIndicators(realtime)
const presence = $frontend.createPresenceIndicators()
const typingIndicators = ref<readonly TypingIndicator[]>([])
const presenceIndicators = ref<readonly PresenceIndicator[]>([])
const connectionState = ref<RealtimeConnectionState>('connecting')
const groupDetailsOpen = ref(false)
const mobilePane = computed<'list' | 'conversation'>(() => (
  selectedConversationId(route.query.conversation) ? 'conversation' : 'list'
))
let unsubscribeVisibility: (() => void) | null = null
let unsubscribeTyping: (() => void) | null = null
let unsubscribePresence: (() => void) | null = null
let routeSelectionReady = false

const activeTypingActorIds = computed(() => typingIndicators.value
  .filter(item => item.conversationId === messenger.state.activeConversationId)
  .map(item => item.actorUserId))
const activeOnlineActorIds = computed(() => presenceIndicators.value
  .filter(item => item.conversationId === messenger.state.activeConversationId)
  .map(item => item.userId))
const workspaceNotice = computed(() => messenger.state.message ?? messenger.outbox.state.notice)
const targetMessageId = computed(() => (
  selectedConversationId(route.query.conversation) === messenger.state.activeConversationId
    ? selectedMessageId(route.query.message)
    : null
))

async function applyRouteSelection(): Promise<void> {
  const requestedConversation = selectedConversationId(route.query.conversation)
  const requestedMessage = selectedMessageId(route.query.message)
  if (!requestedConversation) {
    if (requestedMessage) await navigateTo('/chat', { replace: true })
    return
  }
  if (!messenger.state.conversations.some(item => item.conversationId === requestedConversation)) {
    await navigateTo('/chat', { replace: true })
    return
  }
  await messenger.selectConversation(requestedConversation, requestedMessage)
}

async function selectConversation(conversationId: string): Promise<void> {
  groupDetailsOpen.value = false
  await messenger.selectConversation(conversationId)
  await navigateTo(
    { path: '/chat', query: { conversation: conversationId } },
    { replace: selectedConversationId(route.query.conversation) !== null },
  )
}

async function openMessage(messageId: string): Promise<void> {
  const conversationId = messenger.state.activeConversationId
  if (!conversationId) return
  await messenger.selectConversation(conversationId, messageId)
  await navigateTo(
    { path: '/chat', query: { conversation: conversationId, message: messageId } },
    { replace: true },
  )
}

async function leaveGroup(): Promise<boolean> {
  const left = await messenger.leaveActiveGroup()
  if (left) await navigateTo('/chat', { replace: true })
  return left
}

async function createDirect(userId: string): Promise<void> {
  await messenger.createDirect(userId)
  if (messenger.state.activeConversationId) {
    await selectConversation(messenger.state.activeConversationId)
  }
}

async function createGroup(title: string, userIds: string[]): Promise<void> {
  await messenger.createGroup(title, userIds)
  if (messenger.state.activeConversationId) {
    await selectConversation(messenger.state.activeConversationId)
  }
}

async function closeConversation(): Promise<void> {
  await navigateTo('/chat', { replace: true })
}

onMounted(async () => {
  const requestedConversation = selectedConversationId(route.query.conversation)
  const requestedMessage = selectedMessageId(route.query.message)
  await messenger.load(requestedConversation, requestedMessage)
  await applyRouteSelection()
  routeSelectionReady = true
  unsubscribeTyping = typing.subscribe(indicators => {
    typingIndicators.value = indicators
  })
  unsubscribePresence = presence.subscribe(indicators => {
    presenceIndicators.value = indicators
  })
  unsubscribeVisibility = $frontend.pageVisibility.subscribe(() => {
    void messenger.markActiveRead()
  })
  realtime.start(
    messenger.poll,
    () => emit('sessionExpired'),
    frame => {
      if (frame.type === 'typing') typing.apply(frame)
      else presence.apply(frame)
    },
    () => {
      typing.clearRemote()
      presence.clear()
    },
    state => {
      connectionState.value = state
    },
  )
})

watch(
  () => [route.query.conversation, route.query.message] as const,
  () => {
    if (routeSelectionReady) void applyRouteSelection()
  },
)

onBeforeUnmount(() => {
  messenger.dispose()
  typing.clear()
  unsubscribeTyping?.()
  unsubscribePresence?.()
  presence.clear()
  realtime.stop()
  unsubscribeVisibility?.()
})
</script>

<template>
  <section class="messenger-shell" :class="`messenger-shell--${mobilePane}`">
    <ConversationSidebar
      :user="user"
      :conversations="messenger.state.conversations"
      :directory="messenger.state.directory"
      :active-conversation-id="messenger.state.activeConversationId"
      :read-states="messenger.state.readStates"
      :presence-indicators="presenceIndicators"
      :creating="messenger.state.creating"
      @select="selectConversation"
      @direct="createDirect"
      @group="createGroup"
    />

    <div v-if="messenger.state.phase === 'loading'" class="conversation-placeholder" aria-live="polite">
      <span class="loading-orbit" aria-hidden="true" />
      <p>Загружаем диалоги…</p>
    </div>
    <div v-else class="workspace-main">
      <p v-if="workspaceNotice" class="workspace-message" role="alert">
        {{ workspaceNotice }}
        <button v-if="messenger.state.phase === 'offline'" type="button" @click="messenger.poll">Повторить</button>
      </p>
      <MessagePanel
        :conversation="messenger.activeConversation.value"
        :messages="messenger.state.messages"
        :outgoing-messages="messenger.activeOutgoingMessages.value"
        :history-has-more="messenger.state.historyHasMore"
        :history-has-newer="messenger.state.historyHasNewer"
        :loading-older="messenger.state.loadingOlder"
        :archive-status="messenger.state.archiveStatus"
        :outbox-status="messenger.outbox.state.status"
        :actor-user-id="user.userId"
        :sending="messenger.outbox.state.sending || messenger.state.uploadingAttachment"
        :attachment-upload-completed="messenger.state.attachmentUploadCompleted"
        :attachment-upload-total="messenger.state.attachmentUploadTotal"
        :attachment-upload-bytes-sent="messenger.state.attachmentUploadBytesSent"
        :attachment-upload-bytes-total="messenger.state.attachmentUploadBytesTotal"
        :protection-secure="messenger.protection.secure.value"
        :protection-label="messenger.protection.label.value"
        :send-message="messenger.send"
        :search-messages="messenger.searchActiveConversation"
        :open-message="openMessage"
        :load-attachment="messenger.loadAttachment"
        :retry-outgoing="messenger.retryOutgoing"
        :load-older="messenger.loadOlder"
        :return-to-latest="messenger.returnToLatest"
        :delete-message="messenger.deleteMessage"
        :deleting-message-id="messenger.state.deletingMessageId"
        :typing-actor-ids="activeTypingActorIds"
        :online-actor-ids="activeOnlineActorIds"
        :delivery-states="messenger.state.deliveryStates"
        :reaction-summaries="messenger.state.reactionSummaries"
        :toggle-reaction="messenger.toggleReaction"
        :connection-state="connectionState"
        :set-typing="typing.setLocal.bind(typing)"
        :viewport-anchor="messenger.activeViewportAnchor.value"
        :target-message-id="targetMessageId"
        :save-viewport="messenger.rememberViewport"
        @back="closeConversation"
        @group-details="groupDetailsOpen = true"
      />
      <GroupDetailsPanel
        v-if="groupDetailsOpen && messenger.activeConversation.value?.conversationType === 'group'"
        :conversation="messenger.activeConversation.value"
        :directory="messenger.state.directory"
        :actor-user-id="user.userId"
        :busy="messenger.state.groupMutating"
        :notice="workspaceNotice"
        :rename-group="messenger.renameActiveGroup"
        :add-member="messenger.addActiveGroupMember"
        :remove-member="messenger.removeActiveGroupMember"
        :leave-group="leaveGroup"
        @close="groupDetailsOpen = false"
      />
    </div>
  </section>
</template>
