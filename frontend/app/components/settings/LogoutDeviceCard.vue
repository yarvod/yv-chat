<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  busy: boolean
  error: string | null
}>()
const emit = defineEmits<{ confirm: [] }>()
const confirming = ref(false)

function cancel(): void {
  if (props.busy) return
  confirming.value = false
}
</script>

<template>
  <article class="settings-card settings-card--wide danger-zone">
    <div class="settings-card__heading">
      <span class="settings-icon settings-icon--danger">↪</span>
      <div>
        <h2>Выйти с этого устройства</h2>
        <p>Текущий сеанс и device identity будут отозваны на сервере.</p>
      </div>
    </div>
    <p class="logout-history-warning">
      Ключи MLS привязаны к этому устройству. После выхода новая сессия получит новый
      device identity и может не открыть старую E2EE-историю, доступную только здесь.
      История на других уже подключённых устройствах не удаляется.
    </p>
    <p v-if="error && !confirming" class="settings-message danger-text" role="alert">{{ error }}</p>
    <button class="danger-button" type="button" :disabled="busy" @click="confirming = true">
      Выйти с этого устройства
    </button>
  </article>
  <div v-if="confirming" class="modal-backdrop" @click.self="cancel">
    <section class="logout-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-title">
      <div>
        <strong id="logout-title">Точно выйти?</strong>
        <p>Это действие отзовёт именно текущее устройство и не переносит его ключи.</p>
        <p v-if="error" class="settings-message danger-text" role="alert">{{ error }}</p>
      </div>
      <div class="settings-confirm__actions">
        <button class="secondary-button" type="button" :disabled="busy" @click="cancel">Отмена</button>
        <button class="danger-button" type="button" :disabled="busy" @click="emit('confirm')">
          {{ busy ? 'Выходим…' : 'Да, выйти' }}
        </button>
      </div>
    </section>
  </div>
</template>
