<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import type { ClipboardPort } from '../../application/ports/clipboard'
import type { ExternalLinks } from '../../application/ports/external-links'

const props = defineProps<{
  links: ExternalLinks
  clipboard: Pick<ClipboardPort, 'writeText'>
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const url = ref<string | null>(null)
const status = ref('')
const busy = ref(false)
let previousFocus: HTMLElement | null = null

function close(): void {
  dialog.value?.close()
  url.value = null
  status.value = ''
  busy.value = false
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
}

function click(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
    || event.shiftKey || event.altKey || !props.links.needsActionMenu()
    || !(event.target instanceof Element)) return
  const anchor = event.target.closest<HTMLAnchorElement>('a.message-link')
  const external = anchor && props.links.externalUrl(anchor.href)
  if (!external || !dialog.value?.showModal) return
  event.preventDefault()
  previousFocus = anchor
  url.value = external
  status.value = ''
  // Render the controls before the browser chooses the initial modal focus.
  void nextTick(() => { if (url.value) dialog.value?.showModal() })
}

async function copy(): Promise<void> {
  const current = url.value
  if (!current || busy.value) return
  busy.value = true
  try {
    await props.clipboard.writeText(current)
    if (url.value === current) status.value = 'Ссылка скопирована'
  } catch {
    if (url.value === current) status.value = 'Не удалось скопировать. Выделите адрес выше и скопируйте вручную.'
  } finally {
    if (url.value === current) busy.value = false
  }
}

async function share(): Promise<void> {
  const current = url.value
  if (!current || busy.value) return
  busy.value = true
  try {
    // Start synchronously in the gesture; do not await before the OS share sheet.
    await props.links.share(current)
    if (url.value === current) close()
  } catch (error) {
    if (url.value === current && !(error instanceof Error && error.name === 'AbortError')) {
      status.value = 'Не удалось поделиться. Можно скопировать ссылку.'
    }
  } finally {
    if (url.value === current) busy.value = false
  }
}

onMounted(() => document.addEventListener('click', click))
onBeforeUnmount(() => {
  document.removeEventListener('click', click)
  close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="external-link-menu"
    aria-labelledby="external-link-title"
    @cancel.prevent="close"
    @click.self="close"
  >
    <section v-if="url">
      <h2 id="external-link-title">Внешняя ссылка</h2>
      <p class="external-link-menu__url">{{ url }}</p>
      <p>При открытии Android может показать встроенный браузер. Можно скопировать ссылку или передать её другому приложению.</p>
      <div class="external-link-menu__actions">
        <button type="button" class="primary-button" :disabled="busy" @click="copy">Скопировать ссылку</button>
        <button v-if="links.canShare()" type="button" class="text-button" :disabled="busy" @click="share">Поделиться…</button>
        <a :href="url" target="_blank" rel="noopener noreferrer external" class="text-button" @click="close">Открыть ссылку</a>
        <button type="button" class="text-button" @click="close">Отмена</button>
      </div>
      <p v-if="status" role="status">{{ status }}</p>
    </section>
  </dialog>
</template>

<style scoped>
.external-link-menu { width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 22px; border: 1px solid var(--border); border-radius: 22px; color: var(--text); background: var(--surface-solid); box-shadow: var(--shadow); }
.external-link-menu::backdrop { background: rgb(0 0 0 / 55%); }
h2 { margin: 0 0 12px; font-size: 1.15rem; }
p { color: var(--text-soft); font-size: .9rem; line-height: 1.5; }
.external-link-menu__url { max-height: 6em; overflow: auto; overflow-wrap: anywhere; user-select: text; color: var(--text); }
.external-link-menu__actions { display: grid; gap: 8px; margin-top: 18px; }
.external-link-menu__actions > * { min-height: 44px; text-align: center; }
</style>
