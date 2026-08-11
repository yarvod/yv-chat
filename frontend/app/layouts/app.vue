<script setup lang="ts">
import { computed } from 'vue'

import { useAuth } from '../presentation/composables/useAuth'
import { usePreferences } from '../presentation/composables/usePreferences'

const auth = useAuth()
usePreferences()
const route = useRoute()
const items = computed(() => [
  { to: '/chat', label: 'Чаты', icon: '◫' },
  { to: '/settings', label: 'Настройки', icon: '◇' },
  ...(auth.user.value?.isAdmin ? [{ to: '/admin/users', label: 'Люди', icon: '♙' }] : []),
])

async function logout(): Promise<void> {
  await auth.logout()
  await navigateTo('/login')
}
</script>

<template>
  <main class="product-shell">
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
          <span aria-hidden="true">{{ item.icon }}</span><small>{{ item.label }}</small>
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
        <span aria-hidden="true">{{ item.icon }}</span><small>{{ item.label }}</small>
      </NuxtLink>
    </nav>
  </main>
</template>
