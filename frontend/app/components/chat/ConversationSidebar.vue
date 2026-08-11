<script setup lang="ts">
import { ref } from 'vue'

import type { CurrentAccount } from '../../domain/accounts/account'
import type {
  Conversation,
  ConversationReadState,
  DirectoryUser,
} from '../../domain/messaging/models'
import type { PresenceIndicator } from '../../application/messaging/presence-indicator-service'
import NewConversationForm from './NewConversationForm.vue'

const props = defineProps<{
  user: CurrentAccount
  conversations: readonly Conversation[]
  directory: readonly DirectoryUser[]
  activeConversationId: string | null
  readStates: readonly ConversationReadState[]
  presenceIndicators: readonly PresenceIndicator[]
  creating: boolean
}>()
const emit = defineEmits<{
  select: [conversationId: string]
  direct: [userId: string]
  group: [title: string, userIds: string[]]
}>()
const creatingNew = ref(false)

function conversationName(conversation: Conversation): string {
  if (conversation.conversationType === 'group') return conversation.title ?? 'Группа'
  return conversation.members.find(member => member.userId !== props.user.userId)?.displayName
    ?? 'Личный диалог'
}

function unreadCount(conversationId: string): number {
  return props.readStates.find(item => item.conversationId === conversationId)?.unreadCount ?? 0
}

function isConversationOnline(conversation: Conversation): boolean {
  const peerIds = new Set(
    conversation.members
      .filter(member => member.userId !== props.user.userId && member.leftAt === null)
      .map(member => member.userId),
  )
  return props.presenceIndicators.some(item => (
    item.conversationId === conversation.conversationId && peerIds.has(item.userId)
  ))
}

function createDirect(userId: string): void {
  emit('direct', userId)
  creatingNew.value = false
}

function createGroup(title: string, userIds: string[]): void {
  emit('group', title, userIds)
  creatingNew.value = false
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand-row">
      <span class="brand-mark small">Y</span>
      <strong>yv-chat</strong>
      <button class="new-chat-button" type="button" aria-label="Новый диалог" @click="creatingNew = true">
        +
      </button>
    </div>

    <NewConversationForm
      v-if="creatingNew"
      :users="directory"
      :actor-user-id="user.userId"
      :busy="creating"
      @cancel="creatingNew = false"
      @direct="createDirect"
      @group="createGroup"
    />

    <nav v-else class="conversation-list" aria-label="Диалоги">
      <button
        v-for="conversation in conversations"
        :key="conversation.conversationId"
        type="button"
        class="conversation-row"
        :class="{ active: conversation.conversationId === activeConversationId }"
        @click="emit('select', conversation.conversationId)"
      >
        <span class="conversation-avatar">
          {{ conversationName(conversation).slice(0, 1).toUpperCase() }}
          <i v-if="isConversationOnline(conversation)" class="presence-dot" aria-label="В сети" />
        </span>
        <span class="conversation-copy">
          <strong>{{ conversationName(conversation) }}</strong>
          <small>{{ conversation.conversationType === 'group' ? `${conversation.members.length} участников` : 'Личный диалог' }}</small>
        </span>
        <span
          v-if="unreadCount(conversation.conversationId) > 0"
          class="unread-badge"
          :aria-label="`${unreadCount(conversation.conversationId)} непрочитанных`"
        >
          {{ unreadCount(conversation.conversationId) > 99 ? '99+' : unreadCount(conversation.conversationId) }}
        </span>
      </button>
      <div v-if="conversations.length === 0" class="empty-conversations">
        <span class="empty-icon">◎</span>
        <h2>Пока нет диалогов</h2>
        <p>Нажмите «+», чтобы начать личный диалог или создать группу.</p>
      </div>
    </nav>

    <footer class="account-row">
      <span class="avatar">{{ user.displayName.slice(0, 1).toUpperCase() }}</span>
      <span>
        <strong>{{ user.displayName }}</strong>
        <small>@{{ user.username }}</small>
      </span>
    </footer>
  </aside>
</template>
