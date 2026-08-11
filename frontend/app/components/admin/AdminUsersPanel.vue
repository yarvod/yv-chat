<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { ApplicationError } from '../../application/errors'
import type { ManagedUser } from '../../domain/accounts/managed-user'
import ManagedUserRow from './ManagedUserRow.vue'
import TransientCredentialCard from './TransientCredentialCard.vue'

withDefaults(defineProps<{ embedded?: boolean, currentUserId?: string | null }>(), {
  embedded: false,
  currentUserId: null,
})
const emit = defineEmits<{ close: [] }>()
const { $frontend } = useNuxtApp()
const users = ref<ManagedUser[]>([])
const username = ref('')
const displayName = ref('')
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

async function invite(): Promise<void> {
  inviteBusy.value = true
  message.value = null
  clearCredential()
  try {
    const invitation = await $frontend.inviteUser.execute(
      username.value.trim().toLowerCase(),
      displayName.value.trim(),
    )
    credential.value = {
      title: `Одноразовое приглашение для @${invitation.username}`,
      description: 'Секрет находится после # и не отправляется серверу при открытии ссылки.',
      link: $frontend.buildInvitationLink.execute(invitation.activationSecret),
      expiresAt: invitation.expiresAt,
    }
    username.value = ''
    displayName.value = ''
    await load(0)
  } catch (error) {
    message.value = error instanceof ApplicationError && error.status === 409
      ? 'Это имя пользователя уже занято.'
      : 'Не удалось создать приглашение.'
  } finally {
    inviteBusy.value = false
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

onMounted(load)
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

      <form class="invite-form" @submit.prevent="invite">
        <label>
          <span>Имя пользователя</span>
          <input v-model="username" required minlength="3" maxlength="32" pattern="[a-z0-9_.-]+" autocomplete="off">
        </label>
        <label>
          <span>Отображаемое имя</span>
          <input v-model="displayName" required maxlength="80" autocomplete="off">
        </label>
        <button class="primary-button compact" type="submit" :disabled="inviteBusy">
          {{ inviteBusy ? 'Создаём…' : 'Создать приглашение' }}
        </button>
      </form>

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
