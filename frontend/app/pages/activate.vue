<script setup lang="ts">
import { onMounted, ref } from 'vue'

import ActivationForm from '../components/auth/ActivationForm.vue'
import { useAuth } from '../presentation/composables/useAuth'

definePageMeta({ layout: 'auth' })
const { $frontend } = useNuxtApp()
const auth = useAuth()
const initialSecret = ref('')

onMounted(() => {
  initialSecret.value = $frontend.consumeActivationFragment.execute() ?? ''
})

async function register(username: string, displayName: string, password: string): Promise<void> {
  const secret = initialSecret.value
  const account = await $frontend.registerAccount.execute({
    activationSecret: secret,
    username,
    displayName,
    password,
  })
  initialSecret.value = ''
  auth.replaceCurrentUser(account)
}
</script>

<template>
  <ActivationForm
    :has-invitation="initialSecret.length > 0"
    :register="register"
    @cancel="navigateTo('/login')"
    @registered="navigateTo('/chat')"
  />
</template>
