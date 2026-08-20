<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'
import { computed, onBeforeUnmount, ref } from 'vue'

import type { DisplayedPairing } from '../../application/accounts/device-pairing'
import type { DevicePairingView } from '../../domain/accounts/device-pairing'
import { useAuth } from '../../presentation/composables/useAuth'
import DeviceQrScanner from '../settings/DeviceQrScanner.vue'

const emit = defineEmits<{ authorized: [] }>()
const { $frontend } = useNuxtApp()
const auth = useAuth()
const isPhone = computed(() => $frontend.deviceInfo.current().deviceClass !== 'desktop')
const displayed = ref<DisplayedPairing | null>(null)
const view = ref<DevicePairingView | null>(null)
const scanning = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
let pollTimer: number | null = null
let activePairingId: string | null = null
let completing = false

function stopPolling(): void {
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer = null
}

function scheduleCandidatePoll(pairingId: string): void {
  if (activePairingId !== pairingId) return
  stopPolling()
  pollTimer = window.setTimeout(() => pollCandidate(pairingId), 1400)
}

async function pollCandidate(pairingId: string): Promise<void> {
  if (activePairingId !== pairingId) return
  try {
    const status = await $frontend.devicePairing.candidateStatus(pairingId)
    if (activePairingId !== pairingId) return
    view.value = status
    if (status.status === 'approved') {
      await authorize(pairingId)
      return
    }
    if (!['authorized', 'cancelled', 'expired'].includes(status.status)) {
      scheduleCandidatePoll(pairingId)
    }
  } catch {
    scheduleCandidatePoll(pairingId)
  }
}

async function authorize(pairingId: string): Promise<void> {
  if (completing) return
  completing = true
  busy.value = true
  error.value = null
  try {
    const authorized = await $frontend.devicePairing.authorize(pairingId)
    auth.replaceCurrentUser(authorized.account)
    const trustedDeviceId = authorized.pairing.trustedDeviceId
    if (trustedDeviceId) {
      $frontend.deviceHistorySync.queue({
        ownerUserId: authorized.account.userId,
        currentDeviceId: authorized.account.deviceId,
        pairingId,
        targetDeviceId: trustedDeviceId,
        expiresAt: new Date(Date.parse(authorized.pairing.expiresAt) + 86_400_000).toISOString(),
        // The newly authorized candidate must consume its targeted Welcome and
        // align every local group with the exact server generation before relay.
        // The trusted approver performs the same barrier from the other side.
        prepareTarget: true,
        peerCompletedConversationIds: [],
      })
    }
    activePairingId = null
    stopPolling()
    emit('authorized')
  } catch {
    completing = false
    error.value = 'Подтверждение получено, но вход пока не завершён. Повторяем…'
    scheduleCandidatePoll(pairingId)
  } finally {
    busy.value = false
  }
}

async function createRequest(): Promise<void> {
  busy.value = true
  error.value = null
  scanning.value = false
  try {
    displayed.value = await $frontend.devicePairing.createRequest()
    view.value = null
    activePairingId = displayed.value.created.pairingId
    scheduleCandidatePoll(displayed.value.created.pairingId)
  } catch {
    error.value = 'Не удалось создать QR. Проверьте соединение и повторите.'
  } finally {
    busy.value = false
  }
}

async function scanned(raw: string): Promise<void> {
  busy.value = true
  error.value = null
  try {
    view.value = await $frontend.devicePairing.scan(raw, false)
    scanning.value = false
    activePairingId = view.value.pairingId
    scheduleCandidatePoll(view.value.pairingId)
  } catch {
    error.value = 'Этот QR недействителен, истёк или предназначен доверенному устройству.'
  } finally {
    busy.value = false
  }
}

async function close(): Promise<void> {
  activePairingId = null
  stopPolling()
  const pairingId = displayed.value?.created.pairingId ?? view.value?.pairingId
  if (pairingId) await $frontend.devicePairing.cancelCandidate(pairingId).catch(() => undefined)
  displayed.value = null
  view.value = null
  scanning.value = false
  error.value = null
}

onBeforeUnmount(() => {
  activePairingId = null
  stopPolling()
})
</script>

<template>
  <section class="auth-card pairing-login-card">
    <header>
      <p class="eyebrow">Связанное устройство</p>
      <h2>Войти без пароля</h2>
      <p>Компьютер показывает QR, телефон сканирует. Ключи и пароль в QR не передаются.</p>
    </header>
    <template v-if="!displayed && !view && !scanning">
      <button v-if="!isPhone" class="button button--secondary" type="button" :disabled="busy" @click="createRequest">
        Показать QR на этом компьютере
      </button>
      <button v-if="isPhone" class="button button--secondary" type="button" :disabled="busy" @click="scanning = true">
        Сканировать QR с компьютера
      </button>
    </template>
    <DeviceQrScanner v-else-if="scanning" @decoded="scanned" @cancel="scanning = false" />
    <template v-else-if="displayed">
      <div class="pairing-qr"><QrcodeVue :value="displayed.qrValue" :size="210" level="M" render-as="svg" /></div>
      <p class="pairing-hint">Откройте на уже доверенном телефоне: Настройки → Устройства → Сканировать QR.</p>
      <div v-if="view?.authenticationCode" class="pairing-code"><small>Сверьте на обоих экранах</small><strong>{{ view.authenticationCode }}</strong></div>
      <p class="pairing-status">{{ busy ? 'Завершаем вход…' : view?.status === 'confirmation_pending' ? 'Ждём подтверждения на телефоне…' : 'Ждём сканирования…' }}</p>
      <button class="text-button" type="button" @click="close">Отмена</button>
    </template>
    <template v-else-if="view">
      <div class="pairing-code"><small>Сверьте с компьютером</small><strong>{{ view.authenticationCode }}</strong></div>
      <p class="pairing-status">Аккаунт: {{ view.accountDisplayName }}. Подтвердите тот же код на компьютере.</p>
      <button class="text-button" type="button" @click="close">Отмена</button>
    </template>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  </section>
</template>
