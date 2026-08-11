<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

import { ApplicationError } from '../../application/errors'

const emit = defineEmits<{ securityReset: [] }>()
const { $frontend } = useNuxtApp()
const currentPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const resetPassword = ref('')
const busy = ref(false)
const message = ref<string | null>(null)
const resetConfirmation = ref(false)

function clearPasswords(): void {
  currentPassword.value = ''
  newPassword.value = ''
  confirmation.value = ''
  resetPassword.value = ''
}

function errorMessage(error: unknown): string {
  if (error instanceof ApplicationError && error.status === 401) return 'Текущий пароль неверен.'
  if (error instanceof ApplicationError && error.status === 422) return 'Новый пароль должен содержать от 12 до 128 символов.'
  if (error instanceof ApplicationError && error.kind === 'network') return 'Сервер недоступен.'
  return 'Не удалось выполнить операцию.'
}

async function changePassword(): Promise<void> {
  if (newPassword.value !== confirmation.value) {
    message.value = 'Новые пароли не совпадают.'
    return
  }
  const submittedCurrent = currentPassword.value
  const submittedNew = newPassword.value
  clearPasswords()
  busy.value = true
  message.value = null
  try {
    const revoked = await $frontend.changePassword.execute(submittedCurrent, submittedNew)
    message.value = `Пароль изменён. Завершено других сеансов: ${revoked}.`
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}

async function performSecurityReset(): Promise<void> {
  if (!resetConfirmation.value) {
    resetConfirmation.value = true
    return
  }
  const submittedPassword = resetPassword.value
  clearPasswords()
  resetConfirmation.value = false
  busy.value = true
  message.value = null
  try {
    await $frontend.securityReset.execute(submittedPassword)
    emit('securityReset')
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(clearPasswords)
</script>

<template>
  <article class="settings-card settings-card--wide">
    <div class="settings-card__heading"><span class="settings-icon">◉</span><div><h2>Пароль и полный сброс</h2><p>Чувствительные действия требуют текущий пароль.</p></div></div>
    <p v-if="message" class="settings-message" role="status">{{ message }}</p>
    <div class="security-forms">
      <form @submit.prevent="changePassword">
        <h3>Сменить пароль</h3>
        <label><span>Текущий пароль</span><input v-model="currentPassword" name="current-password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <label><span>Новый пароль</span><input v-model="newPassword" name="new-password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
        <label><span>Повторите новый пароль</span><input v-model="confirmation" name="password-confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>
        <button class="button button--primary" type="submit" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сменить пароль' }}</button>
      </form>
      <form class="danger-zone" @submit.prevent="performSecurityReset">
        <h3>Завершить все сеансы</h3>
        <p>Все устройства, включая текущее, потеряют доступ. Это не сбрасывает будущие E2EE-ключи.</p>
        <label><span>Текущий пароль</span><input v-model="resetPassword" name="reset-current-password" type="password" required maxlength="128" autocomplete="current-password"></label>
        <p v-if="resetConfirmation" class="notice notice--error">Нажмите ещё раз, чтобы подтвердить полный сброс безопасности.</p>
        <button class="button button--secondary" type="submit" :disabled="busy">{{ resetConfirmation ? 'Подтвердить сброс' : 'Завершить все сеансы' }}</button>
        <button v-if="resetConfirmation" class="text-button" type="button" @click="resetConfirmation = false; resetPassword = ''">Отмена</button>
      </form>
    </div>
  </article>
</template>
