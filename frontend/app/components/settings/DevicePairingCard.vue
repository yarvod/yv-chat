<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'
import { computed, onBeforeUnmount, ref } from 'vue'

import type { DisplayedPairing } from '../../application/accounts/device-pairing'
import type { LinkedDeviceEnrollmentProgress } from '../../application/device-crypto/enroll-linked-device'
import type { DevicePairingView } from '../../domain/accounts/device-pairing'
import { useAuth } from '../../presentation/composables/useAuth'
import DeviceQrScanner from './DeviceQrScanner.vue'

const { $frontend } = useNuxtApp()
const auth = useAuth()
const isPhone = computed(() => $frontend.deviceInfo.current().deviceClass !== 'desktop')
const displayed = ref<DisplayedPairing | null>(null)
const view = ref<DevicePairingView | null>(null)
const scanning = ref(false)
const busy = ref(false)
const message = ref<string | null>(null)
let pollTimer: number | null = null
let activePairingId: string | null = null
const activeRole = ref<'trusted' | 'existing_candidate' | null>(null)

function stopPolling(): void {
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer = null
}

function scheduleTrustedPoll(pairingId: string): void {
  if (activePairingId !== pairingId) return
  stopPolling()
  pollTimer = window.setTimeout(() => pollTrusted(pairingId), 1400)
}

function scheduleExistingCandidatePoll(pairingId: string): void {
  if (activePairingId !== pairingId) return
  stopPolling()
  pollTimer = window.setTimeout(() => pollExistingCandidate(pairingId), 1400)
}

async function pollTrusted(pairingId: string): Promise<void> {
  if (activePairingId !== pairingId) return
  try {
    view.value = await $frontend.devicePairing.trustedStatus(pairingId)
    if (activePairingId !== pairingId) return
    if (view.value.status === 'authorized') {
      const linked = view.value
      message.value = `Устройство «${linked.candidateDeviceName ?? 'новое устройство'}» подключено. Готовим защищённые чаты…`
      displayed.value = null
      activePairingId = null
      stopPolling()
      startLinkedSync(linked)
      return
    }
    if (!['cancelled', 'expired'].includes(view.value.status)) scheduleTrustedPoll(pairingId)
  } catch {
    scheduleTrustedPoll(pairingId)
  }
}

async function pollExistingCandidate(pairingId: string): Promise<void> {
  if (activePairingId !== pairingId) return
  try {
    view.value = await $frontend.devicePairing.existingCandidateStatus(pairingId)
    if (activePairingId !== pairingId) return
    if (view.value.status === 'authorized') {
      const linked = view.value
      message.value = `Компьютер «${linked.trustedDeviceName ?? 'доверенное устройство'}» подтвердил синхронизацию.`
      activePairingId = null
      stopPolling()
      startExistingHistorySync(linked)
      return
    }
    if (!['cancelled', 'expired'].includes(view.value.status)) {
      scheduleExistingCandidatePoll(pairingId)
    }
  } catch {
    scheduleExistingCandidatePoll(pairingId)
  }
}

function enrollmentMessage(progress: LinkedDeviceEnrollmentProgress): string {
  if (progress.complete) {
    return progress.totalConversations === 0
      ? 'Устройство подключено. Личных чатов для синхронизации пока нет.'
      : `Устройство подключено к ${progress.totalConversations} защищённым чатам.`
  }
  return `Подключаем защищённые чаты: ${progress.readyConversations} из ${progress.totalConversations}.`
}

function historyJob(linked: DevicePairingView, targetDeviceId: string) {
  const owner = auth.user.value
  if (!owner) return null
  return {
    ownerUserId: owner.userId,
    currentDeviceId: owner.deviceId,
    pairingId: linked.pairingId,
    targetDeviceId,
    expiresAt: new Date(Date.parse(linked.expiresAt) + 86_400_000).toISOString(),
  }
}

function startExistingHistorySync(linked: DevicePairingView): void {
  const owner = auth.user.value
  const targetDeviceId = owner?.deviceId === linked.trustedDeviceId
    ? linked.authorizedDeviceId
    : linked.trustedDeviceId
  if (!targetDeviceId) {
    message.value = 'Устройства связаны, но counterpart для истории не подтверждён.'
    return
  }
  const job = historyJob(linked, targetDeviceId)
  if (!job) return
  $frontend.deviceHistorySync.queue(job)
  void $frontend.deviceHistorySync.synchronize(job, history => {
    message.value = history.complete
      ? `История объединена: получено ${history.importedRecords}, отправлено ${history.exportedRecords}${history.gaps ? `, пропусков ${history.gaps}` : ''}.`
      : `Синхронизация истории: получено ${history.importedRecords}, отправлено ${history.exportedRecords}.`
  }).catch(() => {
    message.value = 'Устройства связаны; перенос истории продолжится в фоне.'
  })
}

function startLinkedSync(linked: DevicePairingView): void {
  if (linked.candidateDeviceId) {
    startExistingHistorySync(linked)
    return
  }
  startEnrollment(linked)
}

function startEnrollment(linked: DevicePairingView): void {
  const owner = auth.user.value
  const targetDeviceId = linked.authorizedDeviceId
  if (!owner || !targetDeviceId) {
    message.value = 'Сессия устройства создана, но MLS enrollment ещё не подтверждён.'
    return
  }
  const job = historyJob(linked, targetDeviceId)
  if (!job) return
  $frontend.deviceHistorySync.queue(job)
  void $frontend.linkedDeviceEnrollment.enroll(
    owner.userId,
    targetDeviceId,
    progress => { message.value = enrollmentMessage(progress) },
  ).then((progress) => {
    message.value = progress.complete
      ? enrollmentMessage(progress)
      : `Сессия создана; ${progress.pendingConversationIds.length} чатов продолжат безопасный retry при следующей синхронизации.`
    if (progress.complete) {
      void $frontend.deviceHistorySync.synchronize(job, history => {
        message.value = history.complete
          ? `История объединена: получено ${history.importedRecords}, отправлено ${history.exportedRecords}${history.gaps ? `, пропусков ${history.gaps}` : ''}.`
          : `Синхронизация истории: получено ${history.importedRecords}, отправлено ${history.exportedRecords}.`
      }).catch(() => {
        message.value = 'Защищённые чаты готовы; перенос истории продолжится в фоне.'
      })
    }
  }).catch(() => {
    message.value = 'Сессия создана; MLS enrollment продолжится при следующей синхронизации.'
  })
}

async function createOffer(): Promise<void> {
  busy.value = true
  message.value = null
  try {
    displayed.value = await $frontend.devicePairing.createOffer()
    view.value = null
    activePairingId = displayed.value.created.pairingId
    activeRole.value = 'trusted'
    scheduleTrustedPoll(displayed.value.created.pairingId)
  } catch {
    message.value = 'Не удалось создать QR для телефона.'
  } finally {
    busy.value = false
  }
}

async function scanned(raw: string): Promise<void> {
  busy.value = true
  message.value = null
  try {
    view.value = await $frontend.devicePairing.scan(raw, true)
    scanning.value = false
    activePairingId = view.value.pairingId
    if (view.value.purpose === 'enrollment_offer') {
      activeRole.value = 'existing_candidate'
      scheduleExistingCandidatePoll(view.value.pairingId)
    } else {
      activeRole.value = 'trusted'
      scheduleTrustedPoll(view.value.pairingId)
    }
  } catch {
    message.value = 'QR недействителен, истёк или принадлежит другому аккаунту/устройству.'
  } finally {
    busy.value = false
  }
}

async function approve(): Promise<void> {
  if (!view.value || busy.value) return
  busy.value = true
  message.value = null
  try {
    view.value = await $frontend.devicePairing.approve(view.value.pairingId)
    scheduleTrustedPoll(view.value.pairingId)
  } catch {
    message.value = 'Не удалось подтвердить устройство. QR мог истечь.'
  } finally {
    busy.value = false
  }
}

async function close(): Promise<void> {
  activePairingId = null
  stopPolling()
  const pairingId = displayed.value?.created.pairingId ?? view.value?.pairingId
  if (pairingId) {
    const cancel = activeRole.value === 'existing_candidate'
      ? $frontend.devicePairing.cancelExistingCandidate(pairingId)
      : $frontend.devicePairing.cancelTrusted(pairingId)
    await cancel.catch(() => undefined)
  }
  displayed.value = null
  view.value = null
  scanning.value = false
  activeRole.value = null
}

onBeforeUnmount(() => {
  activePairingId = null
  stopPolling()
})
</script>

<template>
  <article class="settings-card settings-card--wide">
    <div class="settings-card__heading">
      <span class="settings-icon">▣</span>
      <div><h2>Подключить или синхронизировать по QR</h2><p>Один QR подключает новое устройство либо объединяет историю уже авторизованных устройств.</p></div>
    </div>
    <p v-if="message" class="settings-message" role="status">{{ message }}</p>
    <div v-if="!displayed && !view && !scanning" class="settings-inline-actions">
      <button v-if="!isPhone" class="button button--primary button--compact" type="button" :disabled="busy" @click="createOffer">Показать QR</button>
      <button v-if="isPhone" class="button button--secondary button--compact" type="button" :disabled="busy" @click="scanning = true">Сканировать QR компьютера</button>
    </div>
    <DeviceQrScanner v-else-if="scanning" @decoded="scanned" @cancel="scanning = false" />
    <section v-else-if="displayed" class="pairing-workspace">
      <div class="pairing-qr"><QrcodeVue :value="displayed.qrValue" :size="210" level="M" render-as="svg" /></div>
      <div>
        <h3>Сканируйте этот QR телефоном</h3>
        <p>На новом телефоне сканируйте со страницы входа; на уже авторизованном — из Настройки → Устройства.</p>
        <div v-if="view?.authenticationCode" class="pairing-code"><small>Сверьте на телефоне</small><strong>{{ view.authenticationCode }}</strong></div>
        <p class="pairing-status">{{ view?.status === 'confirmation_pending' ? `Телефон найден: ${view.candidateDeviceName}` : 'Ждём сканирования…' }}</p>
        <div class="pairing-actions">
          <button class="button button--secondary" type="button" @click="close">Отмена</button>
          <button v-if="view?.status === 'confirmation_pending'" class="button button--primary" type="button" :disabled="busy" @click="approve">Подтвердить телефон</button>
        </div>
      </div>
    </section>
    <section v-else-if="view" class="pairing-workspace">
      <div class="pairing-code"><small>Сверьте на компьютере</small><strong>{{ view.authenticationCode }}</strong></div>
      <div>
        <h3>{{ view.candidateDeviceName }}</h3>
        <p>Подтвердите только если на компьютере показан тот же код.</p>
        <div class="pairing-actions">
          <button class="button button--secondary" type="button" @click="close">Отмена</button>
          <button v-if="view.status === 'confirmation_pending' && view.purpose === 'enrollment_request'" class="button button--primary" type="button" :disabled="busy" @click="approve">Подтвердить компьютер</button>
          <span v-else-if="view.status === 'confirmation_pending'" class="status-pill active">Ждём подтверждения на компьютере…</span>
          <span v-else class="status-pill active">Подтверждено, завершаем вход…</span>
        </div>
      </div>
    </section>
    <small class="muted">Устройство получает отдельную сессию и independent MLS leaf. Доступная локальная история объединяется в обе стороны через зашифрованный MLS relay.</small>
  </article>
</template>
