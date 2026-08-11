<script setup lang="ts">
import { onMounted, ref } from 'vue'

import ActivationForm from '../components/auth/ActivationForm.vue'

definePageMeta({ layout: 'auth' })
const { $frontend } = useNuxtApp()
const initialSecret = ref('')

onMounted(() => {
  initialSecret.value = $frontend.consumeActivationFragment.execute() ?? ''
})

async function activate(secret: string, password: string): Promise<void> {
  await $frontend.activateAccount.execute(secret, password)
}
</script>

<template>
  <ActivationForm
    :initial-secret="initialSecret"
    :activate="activate"
    @cancel="navigateTo('/login')"
    @activated="navigateTo('/login?activated=1')"
  />
</template>
