<script setup lang="ts">
import ChatWorkspace from '../components/chat/ChatWorkspace.vue'
import { useAuth } from '../presentation/composables/useAuth'

definePageMeta({ layout: 'app', middleware: 'auth', keepalive: true })
const auth = useAuth()

async function sessionExpired(): Promise<void> {
  auth.sessionExpired()
  await navigateTo('/login')
}
</script>

<template>
  <ChatWorkspace v-if="auth.user.value" :user="auth.user.value" @session-expired="sessionExpired" />
</template>
