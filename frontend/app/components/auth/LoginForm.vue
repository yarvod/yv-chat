<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  busy: boolean
  message: string | null
  offline: boolean
  deviceLabel: string
  activationComplete?: boolean
  passwordResetComplete?: boolean
}>()
const emit = defineEmits<{
  submit: [payload: { username: string, password: string }]
  retry: []
}>()
const username = ref('')
const password = ref('')
const canSubmit = computed(() => !props.busy && username.value.trim().length >= 3 && password.value.length > 0)

function submit(): void {
  if (!canSubmit.value) return
  const submittedPassword = password.value
  password.value = ''
  emit('submit', { username: username.value.trim().toLowerCase(), password: submittedPassword })
}
</script>

<template>
  <form class="auth-card" @submit.prevent="submit">
    <header class="auth-card__header">
      <p class="eyebrow">Защищённое пространство</p>
      <h1>С возвращением</h1>
      <p>Войдите в аккаунт, созданный администратором.</p>
    </header>

    <p v-if="activationComplete" class="notice notice--success" role="status">
      Аккаунт активирован. Теперь войдите с новым паролем.
    </p>
    <p v-else-if="passwordResetComplete" class="notice notice--success" role="status">
      Пароль изменён, старые сеансы завершены. Войдите заново.
    </p>

    <label class="field">
      <span>Имя пользователя</span>
      <input v-model="username" name="username" autocomplete="username" required minlength="3" maxlength="32">
    </label>
    <label class="field">
      <span>Пароль</span>
      <input v-model="password" name="password" type="password" autocomplete="current-password" required maxlength="128">
    </label>

    <div class="device-hint" aria-label="Устройство определяется автоматически">
      <span class="device-hint__icon">◈</span>
      <span><small>Это устройство</small><strong>{{ deviceLabel }}</strong></span>
      <span class="device-hint__auto">авто</span>
    </div>

    <p v-if="message" class="notice notice--error" role="alert">{{ message }}</p>
    <button v-if="offline" class="button button--secondary" type="button" @click="emit('retry')">
      Повторить подключение
    </button>
    <button class="button button--primary" type="submit" :disabled="!canSubmit">
      {{ busy ? 'Входим…' : 'Войти' }}
    </button>
    <NuxtLink class="text-link" to="/activate">У меня есть приглашение</NuxtLink>
  </form>
</template>
