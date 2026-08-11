<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { accountAdminService } from '../../services/accounts/api'
import type { Invitation, ManagedUser } from '../../services/accounts/types'
import { ApiError } from '../../services/api'

const emit = defineEmits<{ close: [] }>()
const users = ref<ManagedUser[]>([])
const username = ref('')
const displayName = ref('')
const invitation = ref<Invitation | null>(null)
const loading = ref(true)
const busy = ref(false)
const message = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  message.value = null
  try {
    users.value = await accountAdminService.list()
  } catch {
    message.value = 'Не удалось загрузить пользователей.'
  } finally {
    loading.value = false
  }
}

async function invite(): Promise<void> {
  busy.value = true
  message.value = null
  invitation.value = null
  try {
    invitation.value = await accountAdminService.invite(
      username.value.trim().toLowerCase(),
      displayName.value.trim(),
    )
    username.value = ''
    displayName.value = ''
    await load()
  } catch (error) {
    message.value = error instanceof ApiError && error.status === 409
      ? 'Это имя пользователя уже занято.'
      : 'Не удалось создать приглашение.'
  } finally {
    busy.value = false
  }
}

function close(): void {
  invitation.value = null
  emit('close')
}

onMounted(load)
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="close">
    <section class="admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <header class="admin-header">
        <div>
          <p class="eyebrow">Администрирование</p>
          <h2 id="admin-title">Пользователи</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Закрыть" @click="close">×</button>
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
        <button class="primary-button compact" type="submit" :disabled="busy">
          {{ busy ? 'Создаём…' : 'Создать приглашение' }}
        </button>
      </form>

      <p v-if="message" class="form-message" role="alert">{{ message }}</p>

      <section v-if="invitation" class="invitation-result" aria-live="polite">
        <strong>Код для @{{ invitation.username }}</strong>
        <p>Показывается только сейчас. Передайте его пользователю безопасным каналом.</p>
        <code>{{ invitation.activationSecret }}</code>
        <small>Действует до {{ new Date(invitation.expiresAt).toLocaleString() }}</small>
        <button class="text-button" type="button" @click="invitation = null">Скрыть код</button>
      </section>

      <div class="managed-users" aria-live="polite">
        <p v-if="loading">Загружаем пользователей…</p>
        <article v-for="item in users" v-else :key="item.userId" class="managed-user-row">
          <span class="avatar">{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
          <span>
            <strong>{{ item.displayName }}</strong>
            <small>@{{ item.username }}</small>
          </span>
          <span class="status-pill" :class="{ active: item.isActive }">
            {{ item.isAdmin ? 'admin' : item.isActive ? 'active' : item.activationPending ? 'invited' : 'disabled' }}
          </span>
        </article>
      </div>
    </section>
  </div>
</template>
