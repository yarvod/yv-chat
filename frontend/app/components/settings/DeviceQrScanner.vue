<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const emit = defineEmits<{ decoded: [value: string], cancel: [] }>()
const video = ref<HTMLVideoElement | null>(null)
const manualValue = ref('')
const running = ref(false)
const error = ref<string | null>(null)
let scanner: import('qr-scanner').default | null = null

async function start(): Promise<void> {
  if (running.value || !video.value) return
  error.value = null
  try {
    const { default: QrScanner } = await import('qr-scanner')
    scanner = new QrScanner(
      video.value,
      (result) => finish(result.data),
      {
        preferredCamera: 'environment',
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 10,
      },
    )
    await scanner.start()
    running.value = true
  } catch {
    scanner?.destroy()
    scanner = null
    running.value = false
    error.value = 'Камера недоступна. Разрешите доступ или вставьте данные QR вручную.'
  }
}

function finish(value: string): void {
  if (!value.trim()) return
  scanner?.stop()
  running.value = false
  emit('decoded', value.trim())
}

function cancel(): void {
  scanner?.destroy()
  scanner = null
  running.value = false
  emit('cancel')
}

onBeforeUnmount(() => scanner?.destroy())
</script>

<template>
  <section class="pairing-scanner" aria-label="Сканирование QR-кода">
    <video ref="video" playsinline muted aria-label="Изображение с камеры" />
    <button v-if="!running" class="button button--primary" type="button" @click="start">
      Включить камеру
    </button>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <label class="field">
      <span>Или вставьте данные QR</span>
      <textarea v-model="manualValue" rows="3" autocomplete="off" spellcheck="false" />
    </label>
    <div class="pairing-actions">
      <button class="button button--secondary" type="button" @click="cancel">Отмена</button>
      <button
        class="button button--primary"
        type="button"
        :disabled="manualValue.trim().length === 0"
        @click="finish(manualValue)"
      >
        Продолжить
      </button>
    </div>
  </section>
</template>
