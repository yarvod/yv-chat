<script setup lang="ts">
import { computed, ref } from 'vue'

import DeviceReenrollmentForm from '../components/auth/DeviceReenrollmentForm.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BrandMark from '../components/ui/BrandMark.vue'
import ConnectionStatus from '../components/ui/ConnectionStatus.vue'
import PushPermissionPrompt from '../components/ui/PushPermissionPrompt.vue'
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
const reenrollmentVisible = ref(false)
const reenrollmentBusy = ref(false)
const reenrollmentMessage = ref<string | null>(null)
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

function openReenrollment(): void {
  reenrollmentMessage.value = null
  reenrollmentVisible.value = true
}

function closeReenrollment(): void {
  if (reenrollmentBusy.value) return
  reenrollmentMessage.value = null
  reenrollmentVisible.value = false
}

async function enrollReplacementDevice(password: string): Promise<void> {
  if (reenrollmentBusy.value) return
  reenrollmentBusy.value = true
  reenrollmentMessage.value = null
  try {
    if (!await auth.enrollReplacementDevice(password)) {
      reenrollmentMessage.value = 'Сессия изменилась. Обновите приложение и повторите попытку.'
      return
    }
    reenrollmentVisible.value = false
  } catch {
    reenrollmentMessage.value = 'Пароль не подошёл или сервер недоступен. Текущая сессия сохранена.'
  } finally {
    reenrollmentBusy.value = false
  }
}
</script>

<template>
  <main class="product-shell" :class="{ 'product-shell--conversation': conversationFocused }">
    <ConnectionStatus />
    <PushPermissionPrompt />
    <section
      v-if="deviceCrypto.state.status === 'unavailable'"
      class="device-crypto-warning"
      role="alert"
    >
      <p>
        {{ deviceCryptoIssueMessage(deviceCrypto.state.issue) }}
        Защищённые функции отключены.
      </p>
      <DeviceReenrollmentForm
        v-if="deviceCryptoIssueNeedsReconnect(deviceCrypto.state.issue) && reenrollmentVisible"
        :busy="reenrollmentBusy"
        :message="reenrollmentMessage"
        @submit="enrollReplacementDevice"
        @cancel="closeReenrollment"
      />
      <button
        v-else-if="deviceCryptoIssueNeedsReconnect(deviceCrypto.state.issue)"
        type="button"
        @click="openReenrollment"
      >
        Подключить эту PWA
      </button>
      <button v-else type="button" @click="deviceCrypto.retry">Повторить</button>
    </section>
    <aside class="app-rail">
      <NuxtLink class="rail-brand" to="/chat" aria-label="Открыть чаты">
        <BrandMark size="rail" />
      </NuxtLink>
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
