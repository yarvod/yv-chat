<script setup lang="ts">
import { computed } from 'vue'

import LoginForm from '../components/auth/LoginForm.vue'
import { useAuth } from '../presentation/composables/useAuth'

definePageMeta({ layout: 'auth', middleware: 'guest' })
const auth = useAuth()
const { $frontend } = useNuxtApp()
const route = useRoute()
const busy = computed(() => auth.state.value.phase === 'submitting')
const deviceLabel = $frontend.deviceInfo.current().label

async function login(payload: { username: string, password: string }): Promise<void> {
  if (await auth.login(payload)) await navigateTo('/chat')
}

async function retrySession(): Promise<void> {
  await auth.bootstrap(true)
  if (auth.isAuthenticated.value) await navigateTo('/chat')
}
</script>

<template>
  <LoginForm
    :busy="busy"
    :message="auth.state.value.message"
    :offline="auth.state.value.phase === 'offline'"
    :device-label="deviceLabel"
    :activation-complete="route.query.activated === '1'"
    :password-reset-complete="route.query.reset === '1'"
    :security-reset-complete="route.query['security-reset'] === '1'"
    @submit="login"
    @retry="retrySession"
  />
</template>
