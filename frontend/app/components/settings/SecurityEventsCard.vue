<script setup lang="ts">
import { onMounted, ref } from 'vue'

import type { SecurityEvent, SecurityEventType } from '../../domain/accounts/security'

const { $frontend } = useNuxtApp()
const events = ref<SecurityEvent[]>([])
const loading = ref(true)
const message = ref<string | null>(null)
const labels: Record<SecurityEventType, string> = {
  login: 'Вход выполнен',
  logout: 'Выход выполнен',
  credential_replay: 'Обнаружено повторное использование сеанса',
  device_renamed: 'Устройство переименовано',
  device_revoked: 'Устройство отозвано',
  other_sessions_revoked: 'Другие сеансы завершены',
  password_changed: 'Пароль изменён',
  password_reset_issued: 'Администратор начал восстановление',
  password_reset_completed: 'Восстановление пароля завершено',
  security_reset: 'Все сеансы завершены',
}

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
    events.value = await $frontend.listSecurityEvents.execute(20)
  } catch {
    message.value = 'Не удалось загрузить события безопасности.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <article class="settings-card settings-card--wide">
    <div class="settings-card__heading"><span class="settings-icon">≋</span><div><h2>События безопасности</h2><p>Последние события из ограниченного списка типов — без секретов и произвольных данных.</p></div><button class="text-button" type="button" :disabled="loading" @click="load">Обновить</button></div>
    <p v-if="message" class="settings-message" role="alert">{{ message }}</p>
    <p v-if="loading" class="muted">Загружаем события…</p>
    <ol v-else class="security-event-list">
      <li v-for="event in events" :key="event.id"><span class="event-dot" /><div><strong>{{ labels[event.eventType] }}</strong><small>{{ formatDate(event.createdAt) }}</small></div></li>
      <li v-if="events.length === 0" class="muted">Событий пока нет.</li>
    </ol>
  </article>
</template>
