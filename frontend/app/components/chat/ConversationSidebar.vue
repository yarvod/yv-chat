<script setup lang="ts">
import { ref } from 'vue'

import type { CurrentAccount } from '../../services/parsers'
import type { Conversation, DirectoryUser } from '../../services/messaging/types'
import NewConversationForm from './NewConversationForm.vue'

const props = defineProps<{
  user: CurrentAccount
  conversations: readonly Conversation[]
  directory: readonly DirectoryUser[]
  activeConversationId: string | null
  creating: boolean
}>()
const emit = defineEmits<{
  select: [conversationId: string]
  direct: [userId: string]
  group: [title: string, userIds: string[]]
  manageUsers: []
  logout: []
}>()
const creatingNew = ref(false)

function conversationName(conversation: Conversation): string {
  if (conversation.conversationType === 'group') return conversation.title ?? 'Группа'
  return conversation.members.find(member => member.userId !== props.user.userId)?.displayName
    ?? 'Личный диалог'
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
      <button v-if="user.isAdmin" class="admin-button" type="button" aria-label="Управление пользователями" @click="emit('manageUsers')">♙</button>
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
        <span class="conversation-avatar">{{ conversationName(conversation).slice(0, 1).toUpperCase() }}</span>
        <span>
          <strong>{{ conversationName(conversation) }}</strong>
          <small>{{ conversation.conversationType === 'group' ? `${conversation.members.length} участников` : 'Личный диалог' }}</small>
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
      <button class="icon-button" type="button" aria-label="Выйти" @click="emit('logout')">↗</button>
    </footer>
  </aside>
</template>
