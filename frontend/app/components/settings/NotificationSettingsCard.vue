<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { usePushNotifications } from '../../presentation/composables/usePushNotifications'

const push = usePushNotifications()
const enabled = computed(() => push.state.value.status === 'enabled')
const statusLabel = computed(() => {
  switch (push.state.value.status) {
    case 'enabled': return 'Включены на этом устройстве'
    case 'denied': return 'Заблокированы в настройках браузера'
    case 'unsupported': return 'Не поддерживаются этим браузером'
    case 'server-disabled': return 'Временно недоступны на сервере'
    case 'error': return push.state.value.message ?? 'Не удалось проверить состояние'
    case 'loading': return 'Проверяем…'
    default: return 'Выключены на этом устройстве'
  }
})

onMounted(() => void push.inspect())
</script>

<template>
  <article class="settings-card settings-card--wide notification-settings-card">
    <div class="settings-card__heading">
      <span class="settings-icon">◉</span>
      <div>
        <h2>Системные уведомления</h2>
        <p>{{ statusLabel }}</p>
      </div>
    </div>
    <p class="notification-privacy-note">
      Push содержит только технические идентификаторы сообщения или звонка. Имя
      отправителя, текст, SDP и аудио не передаются службе уведомлений.
    </p>
    <p v-if="push.state.value.status === 'unsupported'" class="settings-message">
      На iPhone и iPad сначала добавьте yv-chat на экран «Домой» и откройте его как PWA.
    </p>
    <div class="settings-inline-actions">
      <button
        v-if="enabled"
        type="button"
        class="secondary-button"
        :disabled="push.state.value.busy"
        @click="push.disable"
      >
        {{ push.state.value.busy ? 'Выключаем…' : 'Выключить' }}
      </button>
      <button
        v-else
        type="button"
        class="primary-button"
        :disabled="push.state.value.busy || ['unsupported', 'denied', 'server-disabled'].includes(push.state.value.status)"
        @click="push.enable"
      >
        {{ push.state.value.busy ? 'Подключаем…' : 'Разрешить уведомления' }}
      </button>
      <button
        type="button"
        class="text-button"
        :disabled="push.state.value.busy"
        @click="push.inspect(true)"
      >
        Обновить статус
      </button>
    </div>
  </article>
</template>
