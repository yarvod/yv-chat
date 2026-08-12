<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { MediaCacheStatistics } from '../../application/ports/media-cache'

const props = defineProps<{
  ownerUserId: string
  ownerDeviceId: string
}>()
const { $frontend } = useNuxtApp()
const statistics = ref<MediaCacheStatistics | null>(null)
const loading = ref(false)
const clearing = ref(false)
const confirming = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

const usedPercent = computed(() => {
  const current = statistics.value
  if (!current || current.limitBytes <= 0) return 0
  return Math.min(100, current.usedBytes / current.limitBytes * 100)
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const units = ['КиБ', 'МиБ', 'ГиБ'] as const
  let value = bytes / 1024
  let unit: typeof units[number] = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index] ?? unit
  }
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)} ${unit}`
}

function fileCountLabel(count: number): string {
  const lastTwo = count % 100
  const last = count % 10
  if (last === 1 && lastTwo !== 11) return `${count} локальный файл`
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} локальных файла`
  }
  return `${count} локальных файлов`
}

async function refresh(): Promise<void> {
  if (loading.value || clearing.value) return
  loading.value = true
  error.value = null
  try {
    statistics.value = await $frontend.inspectDeviceMediaCache.execute(
      props.ownerUserId,
      props.ownerDeviceId,
    )
  } catch {
    error.value = 'Не удалось прочитать локальный медиакэш на этом устройстве.'
  } finally {
    loading.value = false
  }
}

async function clearCache(): Promise<void> {
  if (clearing.value) return
  const releasedBytes = statistics.value?.usedBytes ?? 0
  clearing.value = true
  error.value = null
  message.value = null
  try {
    statistics.value = await $frontend.clearDeviceMediaCache.execute(
      props.ownerUserId,
      props.ownerDeviceId,
    )
    confirming.value = false
    message.value = releasedBytes > 0
      ? `Локальный медиакэш очищен. Освобождено ${formatBytes(releasedBytes)}.`
      : 'Локальный медиакэш уже пуст.'
    $frontend.haptics.perform('success')
  } catch {
    error.value = 'Не удалось очистить медиакэш. Переписки и ключи не затронуты.'
  } finally {
    clearing.value = false
  }
}

onMounted(() => void refresh())
</script>

<template>
  <article class="settings-card settings-card--wide device-storage-card">
    <div class="settings-card__heading">
      <span class="settings-icon">▤</span>
      <div>
        <h2>Данные на устройстве</h2>
        <p>Управление локальными копиями уже открытых фото, видео и файлов.</p>
      </div>
    </div>

    <div v-if="statistics" class="storage-usage">
      <div>
        <strong>{{ formatBytes(statistics.usedBytes) }}</strong>
        <span>из {{ formatBytes(statistics.limitBytes) }}</span>
      </div>
      <div
        class="storage-usage__track"
        role="progressbar"
        aria-label="Использование локального медиакэша"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(usedPercent)"
      >
        <span :style="{ width: `${usedPercent}%` }" />
      </div>
      <small>{{ fileCountLabel(statistics.entryCount) }}</small>
    </div>
    <p v-else-if="loading" class="settings-message" role="status">Считаем локальные данные…</p>

    <p class="storage-safety-note">
      Очистка удаляет только повторно загружаемый медиакэш этого аккаунта и устройства.
      Переписки, offline-очередь, текущая сессия, device identity и ключи MLS остаются.
    </p>

    <p v-if="message" class="settings-message" role="status">{{ message }}</p>
    <p v-if="error" class="settings-message danger-text" role="alert">{{ error }}</p>

    <div v-if="confirming" class="settings-confirm">
      <div>
        <strong>Очистить локальные копии медиа?</strong>
        <p>При следующем открытии доступные файлы скачаются с сервера заново.</p>
      </div>
      <div class="settings-confirm__actions">
        <button class="secondary-button" type="button" :disabled="clearing" @click="confirming = false">Отмена</button>
        <button class="danger-button" type="button" :disabled="clearing" @click="clearCache">
          {{ clearing ? 'Очищаем…' : 'Да, очистить' }}
        </button>
      </div>
    </div>
    <div v-else class="settings-inline-actions">
      <button
        class="danger-button"
        type="button"
        :disabled="loading || clearing || statistics?.entryCount === 0"
        @click="confirming = true"
      >
        Очистить медиакэш
      </button>
      <button class="text-button" type="button" :disabled="loading || clearing" @click="refresh">
        {{ loading ? 'Обновляем…' : 'Обновить размер' }}
      </button>
    </div>
  </article>
</template>
