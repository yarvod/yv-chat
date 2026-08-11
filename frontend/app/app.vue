<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useAuth } from './composables/useAuth'

const auth = useAuth()
const username = ref('')
const password = ref('')
const deviceName = ref('Этот браузер')
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

      <form
        class="login-card"
        @submit.prevent="submitLogin"
      >
        <header>
          <p class="eyebrow">Вход</p>
          <h2>С возвращением</h2>
          <p>Аккаунты создаёт администратор пространства.</p>
        </header>

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
      </form>
    </section>

    <section
      v-else
      class="messenger-shell"
    >
      <aside class="sidebar">
        <div class="brand-row">
          <span class="brand-mark small">Y</span>
          <strong>yv-chat</strong>
        </div>
        <div class="empty-conversations">
          <span class="empty-icon">◎</span>
          <h2>Диалоги появятся здесь</h2>
          <p>Messaging UI подключается следующим этапом.</p>
        </div>
        <footer class="account-row">
          <span class="avatar">{{ auth.state.user?.displayName.slice(0, 1).toUpperCase() }}</span>
          <span>
            <strong>{{ auth.state.user?.displayName }}</strong>
            <small>@{{ auth.state.user?.username }}</small>
          </span>
          <button
            class="icon-button"
            type="button"
            aria-label="Выйти"
            @click="auth.logout"
          >
            ↗
          </button>
        </footer>
      </aside>
      <div class="conversation-placeholder">
        <span class="brand-mark large">Y</span>
        <h2>Приватное пространство готово</h2>
        <p>Сессия защищена HttpOnly cookie. Credential недоступен JavaScript.</p>
      </div>
    </section>
  </main>
</template>
