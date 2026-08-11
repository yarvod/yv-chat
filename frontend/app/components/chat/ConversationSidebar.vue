<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CurrentAccount } from '../../domain/accounts/account'
import type {
  Conversation,
  ConversationReadState,
  DirectoryUser,
} from '../../domain/messaging/models'
import type { PresenceIndicator } from '../../application/messaging/presence-indicator-service'
import AppIcon from '../ui/AppIcon.vue'
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
const query = ref('')

const filteredConversations = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase('ru-RU')
  if (!normalized) return props.conversations
  return props.conversations.filter(conversation => (
    conversationName(conversation).toLocaleLowerCase('ru-RU').includes(normalized)
  ))
})

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

function conversationSummary(conversation: Conversation): string {
  if (isConversationOnline(conversation) && conversation.conversationType === 'direct') {
    return 'В сети'
  }
  if (conversation.conversationType === 'group') {
    const activeMembers = conversation.members.filter(member => member.leftAt === null).length
    return `${activeMembers} участников`
  }
  return 'Личный диалог'
}

function updatedTime(conversation: Conversation): string {
  return new Date(conversation.updatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
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
    <div class="sidebar-actions">
      <button class="new-chat-button" type="button" aria-label="Новый диалог" @click="creatingNew = true">
        <AppIcon name="add" />
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

    <template v-else>
      <div class="conversation-search" role="search">
        <label class="sr-only" for="conversation-search-input">Найти диалог</label>
        <AppIcon name="search" />
        <input
          id="conversation-search-input"
          v-model="query"
          type="search"
          placeholder="Поиск"
          autocomplete="off"
        >
        <button v-if="query" type="button" aria-label="Очистить поиск" @click="query = ''">
          <AppIcon name="close" />
        </button>
        <span v-else aria-hidden="true" />
      </div>
      <nav class="conversation-list" aria-label="Диалоги">
        <button
          v-for="conversation in filteredConversations"
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
            <small :class="{ online: isConversationOnline(conversation) }">
              {{ conversationSummary(conversation) }}
            </small>
          </span>
          <span class="conversation-meta">
            <time :datetime="conversation.updatedAt">{{ updatedTime(conversation) }}</time>
            <span
              v-if="unreadCount(conversation.conversationId) > 0"
              class="unread-badge"
              :aria-label="`${unreadCount(conversation.conversationId)} непрочитанных`"
            >
              {{ unreadCount(conversation.conversationId) > 99 ? '99+' : unreadCount(conversation.conversationId) }}
            </span>
          </span>
        </button>
        <div v-if="filteredConversations.length === 0" class="empty-conversations">
          <span class="empty-icon">◎</span>
          <h2>{{ query ? 'Ничего не найдено' : 'Пока нет диалогов' }}</h2>
          <p v-if="query">Попробуйте изменить запрос.</p>
          <p v-else>Нажмите «+», чтобы начать личный диалог или создать группу.</p>
        </div>
      </nav>
    </template>
  </aside>
</template>
