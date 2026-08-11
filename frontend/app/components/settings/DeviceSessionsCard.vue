<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { DeviceSession } from '../../domain/accounts/security'

const { $frontend } = useNuxtApp()
const devices = ref<DeviceSession[]>([])
const loading = ref(true)
const busy = ref(false)
const message = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingName = ref('')
const pending = ref<{ kind: 'device', device: DeviceSession } | { kind: 'others' } | null>(null)
const otherCount = computed(() => devices.value.filter(item => !item.isCurrent).length)

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function load(): Promise<void> {
  loading.value = true
  message.value = null
  try {
    devices.value = await $frontend.listDeviceSessions.execute()
  } catch {
    message.value = 'Не удалось загрузить активные устройства.'
  } finally {
    loading.value = false
  }
}

function beginRename(device: DeviceSession): void {
  editingId.value = device.deviceId
  editingName.value = device.deviceName
}

async function rename(device: DeviceSession): Promise<void> {
  const name = editingName.value.trim()
  if (!name) return
  busy.value = true
  message.value = null
  try {
    await $frontend.renameDevice.execute(device.deviceId, name)
    editingId.value = null
    editingName.value = ''
    await load()
  } catch {
    message.value = 'Не удалось переименовать устройство.'
  } finally {
    busy.value = false
  }
}

async function confirmPending(): Promise<void> {
  const action = pending.value
  if (!action || busy.value) return
  pending.value = null
  busy.value = true
  message.value = null
  try {
    if (action.kind === 'device') {
      await $frontend.revokeDevice.execute(action.device.deviceId)
      message.value = 'Устройство отозвано.'
    } else {
      const count = await $frontend.revokeOtherSessions.execute()
      message.value = `Завершено сеансов: ${count}.`
    }
    await load()
  } catch {
    message.value = 'Не удалось завершить сеанс.'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <article class="settings-card settings-card--wide">
    <div class="settings-card__heading">
      <span class="settings-icon">◇</span>
      <div><h2>Активные устройства</h2><p>Сеансы привязаны к устройствам и отзываются мгновенно.</p></div>
      <button v-if="otherCount > 0" class="text-button" type="button" :disabled="busy" @click="pending = { kind: 'others' }">Завершить остальные</button>
    </div>
    <p v-if="message" class="settings-message" role="status">{{ message }}</p>
    <p v-if="loading" class="muted">Загружаем устройства…</p>
    <div v-else class="device-session-list">
      <section v-for="item in devices" :key="item.sessionId" class="device-session-row" :class="{ current: item.isCurrent }">
        <span class="device-session-icon">{{ item.isCurrent ? '●' : '○' }}</span>
        <div class="device-session-main">
          <form v-if="editingId === item.deviceId" class="device-rename-form" @submit.prevent="rename(item)">
            <input v-model="editingName" required maxlength="80" aria-label="Новое имя устройства">
            <button class="button button--primary button--compact" type="submit" :disabled="busy">Сохранить</button>
            <button class="text-button" type="button" @click="editingId = null; editingName = ''">Отмена</button>
          </form>
          <template v-else>
            <strong>{{ item.deviceName }}</strong><span v-if="item.isCurrent" class="status-pill active">текущее</span>
            <small>Последняя активность: {{ formatDate(item.lastSeenAt) }}</small>
            <small>IP приблизительно: {{ item.lastIp ?? 'не определён' }}</small>
          </template>
        </div>
        <div v-if="editingId !== item.deviceId" class="device-session-actions">
          <button class="text-button" type="button" :disabled="busy" @click="beginRename(item)">Переименовать</button>
          <button v-if="!item.isCurrent" class="text-button danger-text" type="button" :disabled="busy" @click="pending = { kind: 'device', device: item }">Отозвать</button>
        </div>
      </section>
      <p v-if="devices.length === 0" class="muted">Активных устройств нет.</p>
    </div>
    <section v-if="pending" class="settings-confirm" role="alertdialog" aria-label="Подтвердите завершение сеансов">
      <p>{{ pending.kind === 'others' ? 'Завершить все сеансы, кроме текущего?' : `Отозвать устройство «${pending.device.deviceName}»?` }}</p>
      <div class="inline-actions"><button class="text-button" type="button" @click="pending = null">Отмена</button><button class="button button--primary button--compact" type="button" @click="confirmPending">Подтвердить</button></div>
    </section>
    <small class="muted">IP и данные браузера приблизительны и не являются фактором авторизации.</small>
  </article>
</template>
