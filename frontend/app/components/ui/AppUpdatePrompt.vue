<script setup lang="ts">
defineProps<{
  busy: boolean
  failed: boolean
}>()

defineEmits<{
  activate: []
}>()
</script>

<template>
  <section class="app-update-prompt" role="status" aria-live="polite">
    <div>
      <strong>{{ failed ? 'Не удалось обновить' : 'Доступна новая версия' }}</strong>
      <span>
        {{ failed
          ? 'Текущая версия продолжает работать. Повторите, когда будет удобно.'
          : 'Приложение перезапустится только после вашего нажатия.' }}
      </span>
    </div>
    <button type="button" :disabled="busy" @click="$emit('activate')">
      {{ busy ? 'Обновляем…' : failed ? 'Повторить' : 'Обновить сейчас' }}
    </button>
  </section>
</template>

<style scoped>
.app-update-prompt {
  position: fixed;
  z-index: 90;
  inset-inline-end: max(1rem, env(safe-area-inset-right));
  inset-block-end: max(1rem, env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 1rem;
  width: min(520px, calc(100vw - 2rem));
  padding: 0.85rem 0.9rem 0.85rem 1rem;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-solid) 96%, transparent);
  box-shadow: var(--shadow);
  color: var(--text);
  backdrop-filter: blur(18px);
}

.app-update-prompt div {
  display: grid;
  flex: 1;
  gap: 0.18rem;
  min-width: 0;
}

.app-update-prompt strong { font-size: 0.86rem; }
.app-update-prompt span { color: var(--text-soft); font-size: 0.75rem; line-height: 1.35; }
.app-update-prompt button { flex: none; white-space: nowrap; }

@media (max-width: 700px) {
  .app-update-prompt {
    inset-inline: 0.75rem;
    inset-block-end: calc(5rem + env(safe-area-inset-bottom));
    width: auto;
    align-items: stretch;
    flex-direction: column;
    gap: 0.65rem;
  }
}
</style>
