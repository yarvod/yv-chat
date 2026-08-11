<script setup lang="ts">
import { computed } from 'vue'

import AppIcon from '../components/ui/AppIcon.vue'
import { selectedConversationId } from '../presentation/chat/conversation-route'
import type { AppIconName } from '../presentation/icons'
import { useAuth } from '../presentation/composables/useAuth'
import {
  deviceCryptoIssueMessage,
  deviceCryptoIssueNeedsReconnect,
  useDeviceCryptoLifecycle,
} from '../presentation/composables/useDeviceCryptoLifecycle'
import { usePreferences } from '../presentation/composables/usePreferences'

const auth = useAuth()
const deviceCrypto = useDeviceCryptoLifecycle(auth.user)
usePreferences()
const route = useRoute()
interface NavigationItem {
  to: string
  label: string
  icon: AppIconName
}
const items = computed<NavigationItem[]>(() => [
  { to: '/chat', label: 'Чаты', icon: 'chat' },
  { to: '/settings', label: 'Настройки', icon: 'settings' },
  ...(auth.user.value?.isAdmin ? [{ to: '/admin/users', label: 'Люди', icon: 'users' as const }] : []),
])
const conversationFocused = computed(() => (
  route.path === '/chat' && selectedConversationId(route.query.conversation) !== null
))

async function logout(): Promise<void> {
  await auth.logout()
  await navigateTo('/login')
}

async function reconnectDevice(): Promise<void> {
  await logout()
}
</script>

<template>
  <main class="product-shell" :class="{ 'product-shell--conversation': conversationFocused }">
    <p
      v-if="deviceCrypto.state.status === 'unavailable'"
      class="device-crypto-warning"
      role="alert"
    >
      {{ deviceCryptoIssueMessage(deviceCrypto.state.issue) }}
      Защищённые функции отключены.
      <button
        v-if="deviceCryptoIssueNeedsReconnect(deviceCrypto.state.issue)"
        type="button"
        @click="reconnectDevice"
      >
        Переподключить
      </button>
      <button v-else type="button" @click="deviceCrypto.retry">Повторить</button>
    </p>
    <aside class="app-rail">
      <NuxtLink class="rail-brand" to="/chat" aria-label="yv-chat">Y</NuxtLink>
      <nav class="rail-nav" aria-label="Основная навигация">
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="rail-link"
          :class="{ active: route.path.startsWith(item.to) }"
        >
          <AppIcon :name="item.icon" /><small>{{ item.label }}</small>
        </NuxtLink>
      </nav>
      <button class="rail-account" type="button" title="Выйти" @click="logout">
        {{ auth.user.value?.displayName.slice(0, 1).toUpperCase() ?? 'Y' }}
      </button>
    </aside>
    <section class="product-content"><slot /></section>
    <nav class="mobile-tabs" aria-label="Основная навигация">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="mobile-tab"
        :class="{ active: route.path.startsWith(item.to) }"
      >
        <AppIcon :name="item.icon" /><small>{{ item.label }}</small>
      </NuxtLink>
    </nav>
  </main>
</template>
