<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { DisplayedPairing } from '../../application/accounts/device-pairing'
import type { DeviceHistorySyncProgress } from '../../application/device-crypto/synchronize-device-history'
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
const syncStatuses = ref<readonly DeviceHistorySyncProgress[]>([])
const stoppingPairingId = ref<string | null>(null)
let pollTimer: number | null = null
let activePairingId: string | null = null
let unsubscribeSync: (() => void) | null = null
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
      view.value = null
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
      view.value = null
      activePairingId = null
      stopPolling()
      startHistorySync(linked, false)
      return
    }
    if (!['cancelled', 'expired'].includes(view.value.status)) {
      scheduleExistingCandidatePoll(pairingId)
    }
  } catch {
    scheduleExistingCandidatePoll(pairingId)
  }
}

function historyJob(
  linked: DevicePairingView,
  targetDeviceId: string,
  prepareTarget: boolean,
) {
  const owner = auth.user.value
  if (!owner) return null
  return {
    ownerUserId: owner.userId,
    currentDeviceId: owner.deviceId,
    pairingId: linked.pairingId,
    targetDeviceId,
    expiresAt: new Date(Date.parse(linked.expiresAt) + 86_400_000).toISOString(),
    prepareTarget,
    peerCompletedConversationIds: [],
  }
}

function startHistorySync(linked: DevicePairingView, prepareTarget: boolean): void {
  const owner = auth.user.value
  const targetDeviceId = owner?.deviceId === linked.trustedDeviceId
    ? linked.authorizedDeviceId
    : linked.trustedDeviceId
  if (!targetDeviceId) {
    message.value = 'Устройства связаны, но counterpart для истории не подтверждён.'
    return
  }
  const job = historyJob(linked, targetDeviceId, prepareTarget)
  if (!job) return
  $frontend.deviceHistorySync.queue(job)
  $frontend.deviceHistorySync.resume(job.ownerUserId, job.currentDeviceId)
}

function startLinkedSync(linked: DevicePairingView): void {
  startHistorySync(linked, true)
}

function refreshSyncStatuses(): void {
  const owner = auth.user.value
  syncStatuses.value = owner
    ? $frontend.deviceHistorySync.current(owner.userId, owner.deviceId)
    : []
}

function syncTitle(progress: DeviceHistorySyncProgress): string {
  if (progress.stage === 'queued') return 'Синхронизация поставлена в очередь'
  if (progress.stage === 'preparing_crypto') {
    return `Подготавливаем защищённые чаты: ${progress.readyConversations} из ${progress.totalConversations}`
  }
  if (progress.stage === 'transferring') return 'Передаём и проверяем историю'
  if (progress.stage === 'waiting_peer') return 'Ждём второе устройство'
  if (progress.stage === 'retrying') return 'Временно не получилось — повторяем автоматически'
  if (progress.stage === 'cancelling') return 'Останавливаем синхронизацию на обоих устройствах'
  if (progress.stage === 'cancelled') return 'Синхронизация остановлена'
  if (progress.stage === 'failed') return 'Эта попытка больше не может продолжаться'
  return 'Синхронизация завершена на обоих устройствах'
}

function syncBadge(progress: DeviceHistorySyncProgress): string {
  if (progress.complete) return 'Готово'
  if (progress.stage === 'cancelled') return 'Остановлено'
  if (progress.stage === 'failed') return 'Ошибка'
  if (progress.stage === 'cancelling') return 'Остановка'
  return 'В процессе'
}

function syncDetails(progress: DeviceHistorySyncProgress): string {
  const transfer = `Доступно к отправке: ${progress.exportedRecords}; получено сейчас: ${progress.importedRecords}.`
  const chats = progress.totalConversations > 0
    ? ` Подтверждено вторым устройством: ${progress.confirmedConversations} из ${progress.totalConversations} чатов.`
    : ''
  const gaps = progress.gaps > 0 ? ` Недоступных источнику записей: ${progress.gaps}.` : ''
  const failure = progress.failure === 'network'
    ? ' Нет сети; запрос остановки или перенос повторится после восстановления связи.'
    : progress.failure === 'server'
      ? ' Сервер временно не завершил запрос; повторим без параллельного запуска.'
      : progress.failure === 'pairing_unavailable'
        ? ' QR-сессия истекла либо была заменена новой попыткой.'
        : progress.failure === 'stopped'
          ? ' Остановка подтверждена сервером и действует для обоих устройств.'
          : progress.failure === 'unknown'
            ? ' Получена непредвиденная ошибка; эту попытку можно убрать и запустить заново.'
            : ''
  if (progress.complete) return `${transfer}${chats}${gaps} Можно открыть чаты.`
  if (progress.stage === 'cancelled' || progress.stage === 'failed') {
    return `${transfer}${chats}${gaps}${failure}`
  }
  return `${transfer}${chats}${gaps}${failure} Можно уйти из настроек; перенос продолжится, пока приложение открыто.`
}

async function stopSync(progress: DeviceHistorySyncProgress): Promise<void> {
  if (progress.stage === 'cancelled' || progress.stage === 'failed') {
    $frontend.deviceHistorySync.dismiss(progress.pairingId)
    refreshSyncStatuses()
    return
  }
  stoppingPairingId.value = progress.pairingId
  try {
    await $frontend.deviceHistorySync.cancel(progress.pairingId)
  } finally {
    stoppingPairingId.value = null
    refreshSyncStatuses()
  }
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
  unsubscribeSync?.()
  unsubscribeSync = null
})

onMounted(() => {
  refreshSyncStatuses()
  unsubscribeSync = $frontend.deviceHistorySync.subscribe(() => refreshSyncStatuses())
})
</script>

<template>
  <article class="settings-card settings-card--wide">
    <div class="settings-card__heading">
      <span class="settings-icon">▣</span>
      <div><h2>Подключить или синхронизировать по QR</h2><p>Один QR подключает новое устройство либо объединяет историю уже авторизованных устройств.</p></div>
    </div>
    <p v-if="message" class="settings-message" role="status">{{ message }}</p>
    <section
      v-for="progress in syncStatuses"
      :key="progress.pairingId"
      class="pairing-sync-progress"
      :class="{ 'pairing-sync-progress--complete': progress.complete }"
      role="status"
      aria-live="polite"
    >
      <div class="pairing-sync-progress__title">
        <strong>{{ syncTitle(progress) }}</strong>
        <span>{{ syncBadge(progress) }}</span>
      </div>
      <progress
        v-if="progress.totalConversations > 0"
        :max="progress.totalConversations"
        :value="progress.stage === 'preparing_crypto' ? progress.readyConversations : progress.confirmedConversations"
      />
      <p>{{ syncDetails(progress) }}</p>
      <button
        v-if="!progress.complete"
        class="button button--secondary button--compact"
        type="button"
        :disabled="stoppingPairingId === progress.pairingId || progress.stage === 'cancelling'"
        @click="stopSync(progress)"
      >
        {{ progress.stage === 'cancelled' || progress.stage === 'failed' ? 'Убрать' : 'Остановить на обоих устройствах' }}
      </button>
    </section>
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
