<script setup lang="ts">
import { ref } from 'vue'

import { activationService } from '../../services/accounts/api'
import { ApiError } from '../../services/api'

const emit = defineEmits<{ cancel: [], activated: [] }>()
const activationSecret = ref('')
const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

async function submit(): Promise<void> {
  if (password.value !== confirmation.value) {
    message.value = 'Пароли не совпадают.'
    return
  }
  const submittedSecret = activationSecret.value.trim()
  const submittedPassword = password.value
  password.value = ''
  confirmation.value = ''
  busy.value = true
  message.value = null
  try {
    await activationService.activate(submittedSecret, submittedPassword)
    activationSecret.value = ''
    emit('activated')
  } catch (error) {
    message.value = error instanceof ApiError && error.kind === 'network'
      ? 'Сервер недоступен. Повторите попытку.'
      : 'Не удалось активировать приглашение. Проверьте код и пароль.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="login-card" @submit.prevent="submit">
    <header>
      <p class="eyebrow">Активация</p>
      <h2>Принять приглашение</h2>
      <p>Вставьте одноразовый код администратора и задайте пароль.</p>
    </header>
    <label>
      <span>Код активации</span>
      <textarea v-model="activationSecret" name="activation-secret" required minlength="32" maxlength="512" rows="3" autocomplete="off" />
    </label>
    <label>
      <span>Новый пароль</span>
      <input v-model="password" name="new-password" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
    </label>
    <label>
      <span>Повторите пароль</span>
      <input v-model="confirmation" name="password-confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
    </label>
    <p v-if="message" class="form-message" role="alert">{{ message }}</p>
    <button class="primary-button" type="submit" :disabled="busy">{{ busy ? 'Активируем…' : 'Активировать' }}</button>
    <button class="text-button auth-switch" type="button" @click="emit('cancel')">Вернуться ко входу</button>
  </form>
</template>
