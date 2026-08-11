<script setup lang="ts">
const { $pwa } = useNuxtApp()
const applyingUpdate = ref(false)

async function applyPwaUpdate(): Promise<void> {
  if (!$pwa || applyingUpdate.value) return
  applyingUpdate.value = true
  try {
    await $pwa.updateServiceWorker(true)
  } finally {
    applyingUpdate.value = false
  }
}
</script>

<template>
  <div class="app-root">
    <aside v-if="$pwa?.needRefresh" class="pwa-update-notice" role="status">
      <span>Готово обновление приложения. Локальные чаты и ключи сохранятся.</span>
      <button type="button" :disabled="applyingUpdate" @click="applyPwaUpdate">
        {{ applyingUpdate ? 'Обновляем…' : 'Обновить' }}
      </button>
    </aside>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
