<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { DeviceHistorySyncProgress } from '../../application/device-crypto/synchronize-device-history'
import { useAuth } from '../../presentation/composables/useAuth'

const { $frontend } = useNuxtApp()
const auth = useAuth()
const statuses = ref<readonly DeviceHistorySyncProgress[]>([])
let unsubscribe: (() => void) | null = null

function refresh(): void {
  const owner = auth.user.value
  statuses.value = owner
    ? $frontend.deviceHistorySync.current(owner.userId, owner.deviceId)
    : []
}

const current = computed(() => (
  [...statuses.value].reverse().find(progress => !progress.complete)
  ?? statuses.value.at(-1)
  ?? null
))

const label = computed(() => {
  const progress = current.value
  if (!progress) return null
  if (progress.stage === 'queued') return 'Синхронизация устройств в очереди'
  if (progress.stage === 'preparing_crypto') {
    const processed = progress.readyConversations + (progress.skippedConversations ?? 0)
    return `Подготовка E2EE: ${processed}/${progress.totalConversations}`
  }
  if (progress.stage === 'waiting_peer') {
    return `Ждём второе устройство: ${progress.confirmedConversations}/${progress.totalConversations}`
  }
  if (progress.stage === 'retrying') return 'Синхронизация прервалась — повторяем'
  if (progress.stage === 'cancelling') return 'Останавливаем синхронизацию устройств'
  if (progress.stage === 'cancelled') return 'Синхронизация устройств остановлена'
  if (progress.stage === 'failed') return 'Синхронизацию нужно запустить заново'
  if (progress.complete) {
    return (progress.skippedConversations ?? 0) > 0
      ? `История синхронизирована частично: пропущено ${progress.skippedConversations}`
      : 'История устройств синхронизирована'
  }
  return `Перенос истории: +${progress.importedRecords} получено`
})

onMounted(() => {
  refresh()
  unsubscribe = $frontend.deviceHistorySync.subscribe(refresh)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <NuxtLink
    v-if="current && label"
    class="device-history-sync-banner"
    :class="{ 'device-history-sync-banner--complete': current.complete }"
    to="/settings"
    role="status"
    aria-live="polite"
  >
    <i aria-hidden="true" />
    <span>{{ label }}</span>
    <small>Подробнее</small>
  </NuxtLink>
</template>
