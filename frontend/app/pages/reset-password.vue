<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import PasswordResetForm from '../components/auth/PasswordResetForm.vue'

definePageMeta({ layout: 'auth', middleware: 'guest' })
const { $frontend } = useNuxtApp()
const initialSecret = ref('')

onMounted(() => {
  initialSecret.value = $frontend.consumePasswordResetFragment.execute() ?? ''
})

onBeforeUnmount(() => {
  initialSecret.value = ''
})

async function resetPassword(secret: string, password: string): Promise<void> {
  await $frontend.resetPassword.execute(secret, password)
}
</script>

<template>
  <PasswordResetForm
    :initial-secret="initialSecret"
    :reset-password="resetPassword"
    @cancel="navigateTo('/login')"
    @completed="navigateTo('/login?reset=1')"
  />
</template>
