<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useMessenger } from '../../composables/useMessenger'
import type { CurrentAccount } from '../../domain/accounts/account'
import type { TypingIndicator } from '../../application/messaging/typing-indicator-service'
import type { PresenceIndicator } from '../../application/messaging/presence-indicator-service'
import ConversationSidebar from './ConversationSidebar.vue'
import MessagePanel from './MessagePanel.vue'

const props = defineProps<{ user: CurrentAccount }>()
const emit = defineEmits<{ sessionExpired: [] }>()
const messenger = useMessenger(props.user.userId, () => emit('sessionExpired'))
const { $frontend } = useNuxtApp()
const realtime = $frontend.createRealtimeSync()
const typing = $frontend.createTypingIndicators(realtime)
const presence = $frontend.createPresenceIndicators()
const typingIndicators = ref<readonly TypingIndicator[]>([])
const presenceIndicators = ref<readonly PresenceIndicator[]>([])
const mobilePane = ref<'list' | 'conversation'>('list')
let unsubscribeVisibility: (() => void) | null = null
let unsubscribeTyping: (() => void) | null = null
let unsubscribePresence: (() => void) | null = null

const activeTypingActorIds = computed(() => typingIndicators.value
  .filter(item => item.conversationId === messenger.state.activeConversationId)
  .map(item => item.actorUserId))
const activeOnlineActorIds = computed(() => presenceIndicators.value
  .filter(item => item.conversationId === messenger.state.activeConversationId)
  .map(item => item.userId))

function selectConversation(conversationId: string): void {
  void messenger.selectConversation(conversationId)
  mobilePane.value = 'conversation'
}

onMounted(async () => {
  await messenger.load()
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
  )
})

onBeforeUnmount(() => {
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
        :protection-secure="messenger.protection.secure"
        :protection-label="messenger.protection.label"
        :send-message="messenger.send"
        :delete-message="messenger.deleteMessage"
        :deleting-message-id="messenger.state.deletingMessageId"
        :typing-actor-ids="activeTypingActorIds"
        :online-actor-ids="activeOnlineActorIds"
        :delivery-states="messenger.state.deliveryStates"
        :set-typing="typing.setLocal.bind(typing)"
        @back="mobilePane = 'list'"
      />
    </div>
  </section>
</template>
