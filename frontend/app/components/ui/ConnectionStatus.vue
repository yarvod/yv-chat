<script setup lang="ts">
import { computed } from 'vue'

import { useConnectionStatus } from '../../presentation/composables/useConnectionStatus'

const connection = useConnectionStatus()
const label = computed(() => ({
  checking: 'Проверяем соединение…',
  connected: null,
  updating: 'Обновляем…',
  reconnecting: 'Переподключаемся…',
  offline: 'Нет соединения',
})[connection.state.value])
</script>

<template>
  <div
    v-if="label"
    class="global-connection"
    :class="`global-connection--${connection.state.value}`"
    role="status"
    aria-live="polite"
  >
    <i aria-hidden="true" />
    <span>{{ label }}</span>
  </div>
</template>
