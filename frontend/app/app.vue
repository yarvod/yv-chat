<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ActivationForm from './components/auth/ActivationForm.vue'
import ChatWorkspace from './components/chat/ChatWorkspace.vue'
import { useAuth } from './composables/useAuth'

const auth = useAuth()
const username = ref('')
const password = ref('')
const deviceName = ref('Этот браузер')
const authMode = ref<'login' | 'activate'>('login')
const activationComplete = ref(false)
const busy = computed(() => auth.state.phase === 'submitting')

onMounted(() => auth.bootstrap())

async function submitLogin(): Promise<void> {
  const submittedPassword = password.value
  password.value = ''
  await auth.login({
    username: username.value.trim(),
    password: submittedPassword,
    deviceName: deviceName.value.trim(),
  })
}

function activationCompleted(): void {
  activationComplete.value = true
  authMode.value = 'login'
}
</script>

<template>
  <main class="app-shell">
    <section
      v-if="auth.state.phase === 'booting'"
      class="state-card"
      aria-live="polite"
    >
      <span class="brand-mark">Y</span>
      <p>Проверяем сессию…</p>
    </section>

    <section
      v-else-if="auth.state.phase !== 'authenticated'"
      class="login-layout"
    >
      <div class="login-intro">
        <span class="brand-mark">Y</span>
        <p class="eyebrow">Private space</p>
        <h1>yv-chat</h1>
        <p class="summary">
          Закрытый мессенджер для небольшой доверенной команды.
        </p>
      </div>

      <ActivationForm
        v-if="authMode === 'activate'"
        @cancel="authMode = 'login'"
        @activated="activationCompleted"
      />

      <form
        v-else
        class="login-card"
        @submit.prevent="submitLogin"
      >
        <header>
          <p class="eyebrow">Вход</p>
          <h2>С возвращением</h2>
          <p>Аккаунты создаёт администратор пространства.</p>
        </header>

        <p v-if="activationComplete" class="success-message" role="status">
          Аккаунт активирован. Теперь войдите с новым паролем.
        </p>

        <label>
          <span>Имя пользователя</span>
          <input
            v-model="username"
            name="username"
            autocomplete="username"
            required
            minlength="3"
            maxlength="32"
          >
        </label>
        <label>
          <span>Пароль</span>
          <input
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            minlength="1"
            maxlength="128"
          >
        </label>
        <label>
          <span>Название устройства</span>
          <input
            v-model="deviceName"
            name="device-name"
            autocomplete="off"
            required
            maxlength="80"
          >
        </label>

        <p
          v-if="auth.state.message"
          class="form-message"
          role="alert"
        >
          {{ auth.state.message }}
        </p>
        <button
          v-if="auth.state.phase === 'offline'"
          class="secondary-button"
          type="button"
          @click="auth.bootstrap"
        >
          Повторить подключение
        </button>
        <button
          class="primary-button"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? 'Входим…' : 'Войти' }}
        </button>
        <button class="text-button auth-switch" type="button" @click="authMode = 'activate'">
          У меня есть код приглашения
        </button>
      </form>
    </section>

    <ChatWorkspace
      v-else-if="auth.state.user"
      :user="auth.state.user"
      @logout="auth.logout"
      @session-expired="auth.sessionExpired"
    />
  </main>
</template>
