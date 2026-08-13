<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { ApplicationError } from '../../application/errors'
import type { ManagedUser } from '../../domain/accounts/managed-user'
import type { RegistrationInvitation } from '../../domain/accounts/registration-invitation'
import ManagedUserRow from './ManagedUserRow.vue'
import TransientCredentialCard from './TransientCredentialCard.vue'

withDefaults(defineProps<{ embedded?: boolean, currentUserId?: string | null }>(), {
  embedded: false,
  currentUserId: null,
})
const emit = defineEmits<{ close: [] }>()
const { $frontend } = useNuxtApp()
const users = ref<ManagedUser[]>([])
const invitationLabel = ref('')
const invitations = ref<RegistrationInvitation[]>([])
const invitationsTotal = ref(0)
const invitationOffset = ref(0)
const invitationPageSize = 20
const invitationsLoading = ref(true)
const invitationBusyId = ref<string | null>(null)
const search = ref('')
const total = ref(0)
const offset = ref(0)
const pageSize = 20
const loading = ref(true)
const busyUserId = ref<string | null>(null)
const inviteBusy = ref(false)
const message = ref<string | null>(null)
const copied = ref(false)
const credential = ref<{
  title: string
  description: string
  link: string
  expiresAt: string
} | null>(null)
const pendingAction = ref<{ kind: 'toggle' | 'reset', item: ManagedUser } | null>(null)
const pendingInvitation = ref<RegistrationInvitation | null>(null)

function clearCredential(): void {
  credential.value = null
  copied.value = false
}

async function load(nextOffset = offset.value): Promise<void> {
  loading.value = true
  message.value = null
  try {
    const page = await $frontend.listManagedUsers.execute(
      search.value.trim() || null,
      pageSize,
      nextOffset,
    )
    users.value = page.items
    total.value = page.total
    offset.value = page.offset
  } catch {
    message.value = 'Не удалось загрузить пользователей.'
  } finally {
    loading.value = false
  }
}

async function loadInvitations(nextOffset = invitationOffset.value): Promise<void> {
  invitationsLoading.value = true
  try {
    const page = await $frontend.listRegistrationInvitations.execute(
      invitationPageSize,
      nextOffset,
    )
    invitations.value = page.items
    invitationsTotal.value = page.total
    invitationOffset.value = page.offset
  } catch {
    message.value = 'Не удалось загрузить приглашения.'
  } finally {
    invitationsLoading.value = false
  }
}

async function createInvitation(): Promise<void> {
  inviteBusy.value = true
  message.value = null
  clearCredential()
  try {
    const invitation = await $frontend.createRegistrationInvitation.execute(
      invitationLabel.value.trim() || null,
    )
    credential.value = {
      title: invitation.label
        ? `Одноразовое приглашение: ${invitation.label}`
        : 'Одноразовое приглашение',
      description: 'Ссылка и QR показываются только сейчас. После закрытия их нельзя восстановить.',
      link: $frontend.buildInvitationLink.execute(invitation.activationSecret),
      expiresAt: invitation.expiresAt,
    }
    invitationLabel.value = ''
    await loadInvitations(0)
  } catch {
    message.value = 'Не удалось создать приглашение.'
  } finally {
    inviteBusy.value = false
  }
}

async function revokeInvitation(): Promise<void> {
  const invitation = pendingInvitation.value
  if (!invitation) return
  pendingInvitation.value = null
  invitationBusyId.value = invitation.invitationId
  message.value = null
  try {
    await $frontend.revokeRegistrationInvitation.execute(invitation.invitationId)
    await loadInvitations()
  } catch {
    message.value = 'Не удалось отозвать приглашение.'
  } finally {
    invitationBusyId.value = null
  }
}

async function reissueActivation(item: ManagedUser): Promise<void> {
  busyUserId.value = item.userId
  message.value = null
  clearCredential()
  try {
    const result = await $frontend.reissueActivation.execute(item.userId)
    credential.value = {
      title: `Новое приглашение для @${item.username}`,
      description: 'Предыдущая ссылка отозвана. Передайте пользователю только эту ссылку.',
      link: $frontend.buildInvitationLink.execute(result.activationSecret),
      expiresAt: result.expiresAt,
    }
  } catch {
    message.value = 'Не удалось перевыпустить приглашение.'
  } finally {
    busyUserId.value = null
  }
}

function requestToggle(item: ManagedUser): void {
  pendingAction.value = { kind: 'toggle', item }
}

function requestReset(item: ManagedUser): void {
  pendingAction.value = { kind: 'reset', item }
}

async function executePending(): Promise<void> {
  const action = pendingAction.value
  if (!action) return
  pendingAction.value = null
  busyUserId.value = action.item.userId
  message.value = null
  clearCredential()
  try {
    if (action.kind === 'toggle') {
      await $frontend.setManagedUserActive.execute(action.item.userId, !action.item.isActive)
      await load(offset.value)
      return
    }
    const result = await $frontend.issuePasswordReset.execute(action.item.userId)
    credential.value = {
      title: `Восстановление доступа для @${action.item.username}`,
      description: `Все сеансы пользователя завершены (${result.revokedSessions}). Администратор не задаёт и не видит новый пароль.`,
      link: $frontend.buildPasswordResetLink.execute(result.resetSecret),
      expiresAt: result.expiresAt,
    }
  } catch (error) {
    message.value = error instanceof ApplicationError && error.status === 409
      ? 'Операция конфликтует с текущим состоянием аккаунта.'
      : 'Не удалось выполнить действие.'
  } finally {
    busyUserId.value = null
  }
}

function close(): void {
  clearCredential()
  emit('close')
}

async function copyCredential(): Promise<void> {
  if (!credential.value) return
  try {
    await $frontend.clipboard.writeText(credential.value.link)
    copied.value = true
    $frontend.haptics.perform('success')
  } catch {
    message.value = 'Не удалось скопировать ссылку. Выделите её вручную.'
  }
}

onMounted(() => Promise.all([load(), loadInvitations()]))
onBeforeUnmount(clearCredential)
</script>

<template>
  <div :class="embedded ? 'admin-page-wrap' : 'modal-backdrop'" role="presentation" @click.self="!embedded && close()">
    <section class="admin-panel" :class="{ 'admin-panel--embedded': embedded }" :role="embedded ? undefined : 'dialog'" :aria-modal="embedded ? undefined : 'true'" aria-labelledby="admin-title">
      <header class="admin-header">
        <div>
          <p class="eyebrow">Администрирование</p>
          <h2 id="admin-title">Пользователи</h2>
        </div>
        <button v-if="!embedded" class="icon-button" type="button" aria-label="Закрыть" @click="close">×</button>
      </header>

      <section class="admin-subsection" aria-labelledby="invitations-title">
        <div class="admin-subsection-heading">
          <div>
            <h3 id="invitations-title">Приглашения</h3>
            <p>Пользователь сам выберет username, имя и пароль.</p>
          </div>
          <small>{{ invitationsTotal }} всего</small>
        </div>
        <form class="invite-form invite-form--standalone" @submit.prevent="createInvitation">
          <label>
            <span>Метка для себя (необязательно)</span>
            <input v-model="invitationLabel" maxlength="80" placeholder="Например, для Васи" autocomplete="off">
          </label>
          <button class="primary-button compact" type="submit" :disabled="inviteBusy">
            {{ inviteBusy ? 'Создаём…' : 'Создать ссылку и QR' }}
          </button>
        </form>

        <p v-if="invitationsLoading" class="muted">Загружаем приглашения…</p>
        <div v-else class="registration-invitations">
          <p v-if="invitations.length === 0" class="muted">Приглашений пока нет.</p>
          <article v-for="item in invitations" v-else :key="item.invitationId" class="registration-invitation-row">
            <span class="managed-user-identity">
              <strong>{{ item.label || 'Без метки' }}</strong>
              <small>Создал @{{ item.createdByUsername }} · {{ new Date(item.createdAt).toLocaleString() }}</small>
              <small v-if="item.registeredUsername">Аккаунт: @{{ item.registeredUsername }}</small>
              <small v-else>Истекает {{ new Date(item.expiresAt).toLocaleString() }}</small>
            </span>
            <span class="status-pill" :class="{ active: item.status === 'active' }">
              {{ item.status === 'active' ? 'активно' : item.status === 'used' ? 'использовано' : item.status === 'expired' ? 'истекло' : 'отозвано' }}
            </span>
            <button
              v-if="item.status === 'active'"
              class="text-button"
              type="button"
              :disabled="invitationBusyId === item.invitationId"
              @click="pendingInvitation = item"
            >Отозвать</button>
          </article>
        </div>
        <nav v-if="invitationsTotal > invitationPageSize" class="admin-pagination" aria-label="Страницы приглашений">
          <button class="button button--secondary button--compact" type="button" :disabled="invitationOffset === 0 || invitationsLoading" @click="loadInvitations(Math.max(0, invitationOffset - invitationPageSize))">Назад</button>
          <span>{{ invitationOffset + 1 }}–{{ Math.min(invitationOffset + invitations.length, invitationsTotal) }} из {{ invitationsTotal }}</span>
          <button class="button button--secondary button--compact" type="button" :disabled="invitationOffset + invitationPageSize >= invitationsTotal || invitationsLoading" @click="loadInvitations(invitationOffset + invitationPageSize)">Дальше</button>
        </nav>
      </section>

      <p v-if="message" class="form-message notice" role="alert">{{ message }}</p>

      <TransientCredentialCard
        v-if="credential"
        :title="credential.title"
        :description="credential.description"
        :link="credential.link"
        :expires-at="credential.expiresAt"
        :copied="copied"
        @copy="copyCredential"
        @hide="clearCredential"
      />

      <section v-if="pendingAction" class="admin-confirm" role="alertdialog" aria-labelledby="confirm-title">
        <div>
          <strong id="confirm-title">
            {{ pendingAction.kind === 'reset' ? 'Завершить все сеансы пользователя?' : pendingAction.item.isActive ? 'Заблокировать пользователя?' : 'Разблокировать пользователя?' }}
          </strong>
          <p v-if="pendingAction.kind === 'reset'">@{{ pendingAction.item.username }} сразу выйдет на всех устройствах. Затем передайте одноразовую ссылку.</p>
          <p v-else>Аккаунт @{{ pendingAction.item.username }} {{ pendingAction.item.isActive ? 'потеряет доступ до явной разблокировки' : 'снова сможет входить' }}.</p>
        </div>
        <div class="inline-actions">
          <button class="text-button" type="button" @click="pendingAction = null">Отмена</button>
          <button class="button button--primary button--compact" type="button" @click="executePending">Подтвердить</button>
        </div>
      </section>

      <section v-if="pendingInvitation" class="admin-confirm" role="alertdialog" aria-labelledby="revoke-invitation-title">
        <div>
          <strong id="revoke-invitation-title">Отозвать приглашение?</strong>
          <p>Открытая у получателя форма сразу перестанет работать. Вернуть эту ссылку будет нельзя.</p>
        </div>
        <div class="inline-actions">
          <button class="text-button" type="button" @click="pendingInvitation = null">Отмена</button>
          <button class="button button--primary button--compact" type="button" @click="revokeInvitation">Отозвать</button>
        </div>
      </section>

      <form class="admin-search" role="search" @submit.prevent="load(0)">
        <label>
          <span class="sr-only">Поиск пользователей</span>
          <input v-model="search" type="search" maxlength="80" placeholder="Поиск по имени или логину" autocomplete="off">
        </label>
        <button class="button button--secondary button--compact" type="submit">Найти</button>
      </form>

      <div class="managed-users" aria-live="polite">
        <p v-if="loading">Загружаем пользователей…</p>
        <p v-else-if="users.length === 0" class="muted">Пользователи не найдены.</p>
        <ManagedUserRow
          v-for="item in users"
          v-else
          :key="item.userId"
          :item="item"
          :current-user-id="currentUserId"
          :busy="busyUserId === item.userId"
          @toggle="requestToggle"
          @reissue="reissueActivation"
          @reset="requestReset"
        />
      </div>
      <nav v-if="total > pageSize" class="admin-pagination" aria-label="Страницы пользователей">
        <button class="button button--secondary button--compact" type="button" :disabled="offset === 0 || loading" @click="load(Math.max(0, offset - pageSize))">Назад</button>
        <span>{{ offset + 1 }}–{{ Math.min(offset + users.length, total) }} из {{ total }}</span>
        <button class="button button--secondary button--compact" type="button" :disabled="offset + pageSize >= total || loading" @click="load(offset + pageSize)">Дальше</button>
      </nav>
    </section>
  </div>
</template>
