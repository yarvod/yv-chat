<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { ApplicationError } from '../../application/errors'

const props = defineProps<{
  initialSecret?: string
  resetPassword: (secret: string, password: string) => Promise<void>
}>()
const emit = defineEmits<{ cancel: [], completed: [] }>()
const resetSecret = ref(props.initialSecret ?? '')
const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

async function submit(): Promise<void> {
  if (password.value !== confirmation.value) {
    message.value = 'Пароли не совпадают.'
    return
  }
  const submittedSecret = resetSecret.value.trim()
  const submittedPassword = password.value
  password.value = ''
  confirmation.value = ''
  busy.value = true
  message.value = null
  try {
    await props.resetPassword(submittedSecret, submittedPassword)
    resetSecret.value = ''
    emit('completed')
  } catch (error) {
    message.value = error instanceof ApplicationError && error.kind === 'network'
      ? 'Сервер недоступен. Повторите попытку.'
      : 'Ссылка недействительна или истекла. Запросите новую у администратора.'
  } finally {
    busy.value = false
  }
}

watch(() => props.initialSecret, value => {
  if (value) resetSecret.value = value
})

onBeforeUnmount(() => {
  resetSecret.value = ''
  password.value = ''
  confirmation.value = ''
})
</script>

<template>
  <form class="auth-card" @submit.prevent="submit">
    <header>
      <p class="eyebrow">Восстановление доступа</p>
      <h2>Задайте новый пароль</h2>
      <p>Одноразовая ссылка завершит все старые сеансы. Администратор не увидит ваш пароль.</p>
    </header>
    <label class="field">
      <span>Код восстановления</span>
      <textarea v-model="resetSecret" name="reset-secret" required minlength="32" maxlength="512" rows="3" autocomplete="off" />
    </label>
    <label class="field">
      <span>Новый пароль</span>
      <input v-model="password" name="new-password" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
    </label>
    <label class="field">
      <span>Повторите пароль</span>
      <input v-model="confirmation" name="password-confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
    </label>
    <p v-if="message" class="notice notice--error" role="alert">{{ message }}</p>
    <button class="button button--primary" type="submit" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сменить пароль' }}</button>
    <button class="text-link text-link--button" type="button" @click="emit('cancel')">Вернуться ко входу</button>
  </form>
</template>
