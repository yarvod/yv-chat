<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  busy: boolean
  message: string | null
}>()
const emit = defineEmits<{
  submit: [password: string]
  cancel: []
}>()
const password = ref('')
const canSubmit = computed(() => !props.busy && password.value.length > 0)

function submit(): void {
  if (!canSubmit.value) return
  const submittedPassword = password.value
  password.value = ''
  emit('submit', submittedPassword)
}

function cancel(): void {
  password.value = ''
  emit('cancel')
}
</script>

<template>
  <form class="device-reenrollment" @submit.prevent="submit">
    <p>
      Safari и установленная PWA хранят E2EE-ключи отдельно. Подтвердите пароль,
      чтобы зарегистрировать эту PWA как новое устройство, не отключая Safari.
    </p>
    <label class="field">
      <span>Пароль аккаунта</span>
      <input
        v-model="password"
        name="device-reenrollment-password"
        type="password"
        autocomplete="current-password"
        required
        maxlength="128"
        autofocus
      >
    </label>
    <p v-if="message" class="notice notice--error" role="alert">{{ message }}</p>
    <div class="device-reenrollment__actions">
      <button class="button button--primary" type="submit" :disabled="!canSubmit">
        {{ busy ? 'Подключаем…' : 'Подключить эту PWA' }}
      </button>
      <button class="button button--secondary" type="button" :disabled="busy" @click="cancel">
        Отмена
      </button>
    </div>
  </form>
</template>
