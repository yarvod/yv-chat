<script setup lang="ts">
import { computed, ref } from 'vue'

import DeviceSessionsCard from '../components/settings/DeviceSessionsCard.vue'
import DevicePairingCard from '../components/settings/DevicePairingCard.vue'
import DeviceStorageCard from '../components/settings/DeviceStorageCard.vue'
import PasswordSecurityCard from '../components/settings/PasswordSecurityCard.vue'
import ProfileCard from '../components/settings/ProfileCard.vue'
import SecurityEventsCard from '../components/settings/SecurityEventsCard.vue'
import NotificationSettingsCard from '../components/settings/NotificationSettingsCard.vue'
import LogoutDeviceCard from '../components/settings/LogoutDeviceCard.vue'
import { ApplicationError } from '../application/errors'
import type { CurrentAccount } from '../domain/accounts/account'
import type { ThemePreference } from '../domain/preferences/theme'
import { useAuth } from '../presentation/composables/useAuth'
import { usePreferences } from '../presentation/composables/usePreferences'

definePageMeta({ layout: 'app', middleware: 'auth' })
const auth = useAuth()
const preferences = usePreferences()
const { $frontend } = useNuxtApp()
const device = $frontend.deviceInfo.current()
const account = computed(() => auth.user.value)
const loggingOut = ref(false)
const logoutError = ref<string | null>(null)
const themes: { value: ThemePreference, label: string }[] = [
  { value: 'system', label: 'Системная' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]

function profileUpdated(updated: CurrentAccount): void {
  auth.replaceCurrentUser(updated)
}

async function securityResetCompleted(): Promise<void> {
  auth.securityResetCompleted()
  await navigateTo('/login?security-reset=1')
}

async function logoutCurrentDevice(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  logoutError.value = null
  try {
    await $frontend.pushNotifications.disable().catch(() => undefined)
    await auth.logout()
    await navigateTo('/login?logged-out=1')
  } catch (error) {
    logoutError.value = error instanceof ApplicationError && error.kind === 'network'
      ? 'Нет связи с сервером. Сеанс не завершён — подключитесь к сети и повторите.'
      : 'Не удалось завершить сеанс. Повторите попытку.'
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="page-view settings-view">
    <header class="page-header">
      <div><p class="eyebrow">Личное пространство</p><h1>Настройки</h1></div>
      <span class="page-avatar">{{ account?.displayName.slice(0, 1).toUpperCase() }}</span>
    </header>
    <section class="settings-grid">
      <ProfileCard v-if="account" :account="account" @updated="profileUpdated" />
      <article class="settings-card">
        <div class="settings-card__heading"><span class="settings-icon">◐</span><div><h2>Оформление</h2><p>Тема применяется ко всему приложению.</p></div></div>
        <div class="segmented-control" role="group" aria-label="Тема">
          <button v-for="item in themes" :key="item.value" type="button" :class="{ active: preferences.theme.value === item.value }" @click="preferences.applyTheme(item.value)">{{ item.label }}</button>
        </div>
      </article>
      <article class="settings-card">
        <div class="settings-card__heading"><span class="settings-icon">⌁</span><div><h2>Тактильный отклик</h2><p>{{ $frontend.platform.native ? 'Использует системный haptics engine устройства.' : 'Работает только там, где браузер поддерживает vibration/haptics.' }}</p></div></div>
        <label class="switch-row"><span>{{ preferences.hapticsEnabled.value ? 'Включён' : 'Выключен' }}</span><input type="checkbox" :checked="preferences.hapticsEnabled.value" @change="preferences.setHaptics(($event.target as HTMLInputElement).checked)"><i /></label>
      </article>
      <article class="settings-card settings-card--wide">
        <div class="settings-card__heading"><span class="settings-icon">⌘</span><div><h2>Метаданные браузера</h2><p>{{ device.label }}</p></div></div>
        <dl class="device-details"><div><dt>Браузер</dt><dd>{{ device.browser }}</dd></div><div><dt>Система</dt><dd>{{ device.operatingSystem }}</dd></div><div><dt>Класс</dt><dd>{{ device.deviceClass }}</dd></div></dl>
        <small class="muted">Информация приблизительная и не используется для авторизации.</small>
      </article>
      <DeviceSessionsCard />
      <DevicePairingCard />
      <DeviceStorageCard
        v-if="account"
        :owner-user-id="account.userId"
        :owner-device-id="account.deviceId"
      />
      <NotificationSettingsCard />
      <PasswordSecurityCard @security-reset="securityResetCompleted" />
      <SecurityEventsCard />
      <LogoutDeviceCard :busy="loggingOut" :error="logoutError" @confirm="logoutCurrentDevice" />
    </section>
  </div>
</template>
