<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { usePushNotifications } from '../../presentation/composables/usePushNotifications'

const push = usePushNotifications()
const dismissed = ref(true)

onMounted(async () => {
  dismissed.value = push.promptDismissed()
  await push.inspect()
})

function dismiss(): void {
  dismissed.value = true
  push.dismissPrompt()
}
</script>

<template>
  <aside
    v-if="!dismissed && push.state.value.status === 'prompt'"
    class="push-permission-prompt"
    role="status"
    aria-label="Настройка уведомлений"
  >
    <div>
      <strong>Не пропускайте звонки и сообщения</strong>
      <span>Включить системные уведомления на этом устройстве?</span>
    </div>
    <div class="push-permission-prompt__actions">
      <button type="button" class="text-button" @click="dismiss">Не сейчас</button>
      <button
        type="button"
        class="primary-button"
        :disabled="push.state.value.busy"
        @click="push.enable"
      >
        {{ push.state.value.busy ? 'Подключаем…' : 'Включить' }}
      </button>
    </div>
  </aside>
</template>
