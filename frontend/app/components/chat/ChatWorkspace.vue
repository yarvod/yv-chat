<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useMessenger } from '../../composables/useMessenger'
import type { CurrentAccount } from '../../domain/accounts/account'
import ConversationSidebar from './ConversationSidebar.vue'
import MessagePanel from './MessagePanel.vue'

const props = defineProps<{ user: CurrentAccount }>()
const emit = defineEmits<{ sessionExpired: [] }>()
const messenger = useMessenger(props.user.userId, () => emit('sessionExpired'))
let pollTimer: ReturnType<typeof setInterval> | null = null
const mobilePane = ref<'list' | 'conversation'>('list')

function selectConversation(conversationId: string): void {
  void messenger.selectConversation(conversationId)
  mobilePane.value = 'conversation'
}

onMounted(async () => {
  await messenger.load()
  pollTimer = setInterval(() => void messenger.poll(), 3000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <section class="messenger-shell" :class="`messenger-shell--${mobilePane}`">
    <ConversationSidebar
      :user="user"
      :conversations="messenger.state.conversations"
      :directory="messenger.state.directory"
      :active-conversation-id="messenger.state.activeConversationId"
      :creating="messenger.state.creating"
      @select="selectConversation"
      @direct="messenger.createDirect"
      @group="messenger.createGroup"
    />

    <div v-if="messenger.state.phase === 'loading'" class="conversation-placeholder" aria-live="polite">
      <span class="brand-mark large">Y</span>
      <p>Загружаем диалоги…</p>
    </div>
    <div v-else class="workspace-main">
      <p v-if="messenger.state.message" class="workspace-message" role="alert">
        {{ messenger.state.message }}
        <button v-if="messenger.state.phase === 'offline'" type="button" @click="messenger.poll">Повторить</button>
      </p>
      <MessagePanel
        :conversation="messenger.activeConversation.value"
        :messages="messenger.state.messages"
        :actor-user-id="user.userId"
        :sending="messenger.state.sending"
        :codec="messenger.codec"
        :send-message="messenger.send"
        @back="mobilePane = 'list'"
      />
    </div>
  </section>
</template>
