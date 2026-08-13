<script setup lang="ts">
import { computed, ref } from 'vue'

import AppUpdatePrompt from './components/ui/AppUpdatePrompt.vue'

const nuxtApp = useNuxtApp()
const activatingUpdate = ref(false)
const updateFailed = ref(false)
const updateAvailable = computed(() => Boolean(nuxtApp.$pwa?.needRefresh))

async function activateUpdate(): Promise<void> {
  if (activatingUpdate.value || !nuxtApp.$pwa) return
  activatingUpdate.value = true
  updateFailed.value = false
  try {
    await nuxtApp.$pwa.updateServiceWorker(true)
  } catch {
    activatingUpdate.value = false
    updateFailed.value = true
  }
}
</script>

<template>
  <div class="app-root">
    <AppUpdatePrompt
      v-if="updateAvailable"
      :busy="activatingUpdate"
      :failed="updateFailed"
      @activate="activateUpdate"
    />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
