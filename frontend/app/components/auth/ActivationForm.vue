<script setup lang="ts">
import { ref } from 'vue'

import { ApplicationError } from '../../application/errors'

const props = defineProps<{
  hasInvitation: boolean
  register: (
    username: string,
    displayName: string,
    password: string,
  ) => Promise<void>
}>()
const emit = defineEmits<{ cancel: [], registered: [] }>()
const username = ref('')
const displayName = ref('')
const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

async function submit(): Promise<void> {
  if (!props.hasInvitation) {
    message.value = 'Ссылка приглашения отсутствует или уже была очищена.'
    return
  }
  if (password.value !== confirmation.value) {
    message.value = 'Пароли не совпадают.'
    return
  }
  const submittedPassword = password.value
  password.value = ''
  confirmation.value = ''
  busy.value = true
  message.value = null
  try {
    await props.register(
      username.value.trim().toLowerCase(),
      displayName.value.trim(),
      submittedPassword,
    )
    emit('registered')
  } catch (error) {
    if (error instanceof ApplicationError && error.kind === 'network') {
      message.value = 'Сервер недоступен. Повторите попытку.'
    } else if (error instanceof ApplicationError && error.status === 409) {
      message.value = 'Этот username уже занят. Выберите другой — приглашение сохранено.'
    } else if (error instanceof ApplicationError && error.status === 429) {
      message.value = 'Слишком много попыток. Подождите минуту и попробуйте снова.'
    } else {
      message.value = 'Не удалось принять приглашение. Возможно, ссылка истекла или отозвана.'
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="auth-card" @submit.prevent="submit">
    <header>
      <p class="eyebrow">Регистрация по приглашению</p>
      <h2>Создайте аккаунт</h2>
      <p>Выберите свой username, имя и пароль. После регистрации вход выполнится автоматически.</p>
    </header>
    <p v-if="!hasInvitation" class="notice notice--error" role="alert">
      Откройте полную одноразовую ссылку, которую выдал администратор.
    </p>
    <template v-else>
      <label class="field">
        <span>Username</span>
        <input
          v-model="username"
          name="username"
          required
          minlength="3"
          maxlength="32"
          pattern="[a-zA-Z0-9_.-]+"
          autocapitalize="none"
          spellcheck="false"
          autocomplete="username"
        >
      </label>
      <label class="field">
        <span>Отображаемое имя</span>
        <input v-model="displayName" name="name" required maxlength="80" autocomplete="name">
      </label>
      <label class="field">
        <span>Новый пароль</span>
        <input v-model="password" name="new-password" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
      </label>
      <label class="field">
        <span>Повторите пароль</span>
        <input v-model="confirmation" name="password-confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
      </label>
    </template>
    <p v-if="message" class="notice notice--error" role="alert">{{ message }}</p>
    <button v-if="hasInvitation" class="button button--primary" type="submit" :disabled="busy">
      {{ busy ? 'Создаём аккаунт…' : 'Зарегистрироваться' }}
    </button>
    <button class="text-link text-link--button" type="button" @click="emit('cancel')">Вернуться ко входу</button>
  </form>
</template>
