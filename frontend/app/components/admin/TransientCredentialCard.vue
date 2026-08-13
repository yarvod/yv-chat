<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'

defineProps<{
  title: string
  description: string
  link: string
  expiresAt: string
  copied: boolean
}>()
defineEmits<{ copy: [], hide: [] }>()
</script>

<template>
  <section class="invitation-result" aria-live="polite">
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <code>{{ link }}</code>
    <div class="invitation-qr" aria-label="QR-код одноразового приглашения">
      <QrcodeVue :value="link" :size="184" level="M" render-as="svg" />
    </div>
    <small>Действует до {{ new Date(expiresAt).toLocaleString() }}</small>
    <div class="inline-actions">
      <button class="button button--primary button--compact" type="button" @click="$emit('copy')">{{ copied ? 'Скопировано' : 'Скопировать ссылку' }}</button>
      <button class="text-button" type="button" @click="$emit('hide')">Скрыть</button>
    </div>
  </section>
</template>
