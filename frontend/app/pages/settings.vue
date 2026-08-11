<script setup lang="ts">
import { useAuth } from '../presentation/composables/useAuth'
import { usePreferences } from '../presentation/composables/usePreferences'
import type { ThemePreference } from '../domain/preferences/theme'

definePageMeta({ layout: 'app', middleware: 'auth' })
const auth = useAuth()
const preferences = usePreferences()
const { $frontend } = useNuxtApp()
const device = $frontend.deviceInfo.current()
const themes: { value: ThemePreference, label: string }[] = [
  { value: 'system', label: 'Системная' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]
</script>

<template>
  <div class="page-view settings-view">
    <header class="page-header">
      <div><p class="eyebrow">Личное пространство</p><h1>Настройки</h1></div>
      <span class="page-avatar">{{ auth.user.value?.displayName.slice(0, 1).toUpperCase() }}</span>
    </header>
    <section class="settings-grid">
      <article class="settings-card settings-card--profile">
        <span class="profile-avatar">{{ auth.user.value?.displayName.slice(0, 1).toUpperCase() }}</span>
        <div><h2>{{ auth.user.value?.displayName }}</h2><p>@{{ auth.user.value?.username }}</p></div>
        <span v-if="auth.user.value?.isAdmin" class="status-pill active">admin</span>
      </article>
      <article class="settings-card">
        <div class="settings-card__heading"><span class="settings-icon">◐</span><div><h2>Оформление</h2><p>Тема применяется ко всему приложению.</p></div></div>
        <div class="segmented-control" role="group" aria-label="Тема">
          <button v-for="item in themes" :key="item.value" type="button" :class="{ active: preferences.theme.value === item.value }" @click="preferences.applyTheme(item.value)">{{ item.label }}</button>
        </div>
      </article>
      <article class="settings-card">
        <div class="settings-card__heading"><span class="settings-icon">⌁</span><div><h2>Тактильный отклик</h2><p>Работает только там, где браузер поддерживает vibration/haptics.</p></div></div>
        <label class="switch-row"><span>{{ preferences.hapticsEnabled.value ? 'Включён' : 'Выключен' }}</span><input type="checkbox" :checked="preferences.hapticsEnabled.value" @change="preferences.setHaptics(($event.target as HTMLInputElement).checked)"><i /></label>
      </article>
      <article class="settings-card">
        <div class="settings-card__heading"><span class="settings-icon">◇</span><div><h2>Это устройство</h2><p>{{ device.label }}</p></div></div>
        <dl class="device-details"><div><dt>Браузер</dt><dd>{{ device.browser }}</dd></div><div><dt>Система</dt><dd>{{ device.operatingSystem }}</dd></div><div><dt>Класс</dt><dd>{{ device.deviceClass }}</dd></div></dl>
        <small class="muted">Информация приблизительная и не используется для авторизации.</small>
      </article>
      <article class="settings-card settings-card--security">
        <div class="settings-card__heading"><span class="settings-icon">◉</span><div><h2>Безопасность</h2><p>Устройства, смена пароля и завершение сессий появятся в следующем срезе.</p></div></div>
      </article>
    </section>
  </div>
</template>
