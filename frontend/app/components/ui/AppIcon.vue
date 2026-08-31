<script setup lang="ts">
import type { AppIconName } from '../../presentation/icons'

defineProps<{ name: AppIconName }>()
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'chat'">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.5 9.5 0 0 1-3.8-.8L3 21l1.7-4.6A8.4 8.4 0 1 1 21 11.5Z" />
      <path d="M8.2 11.8h.01M12 11.8h.01M15.8 11.8h.01" stroke-width="2.8" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </template>
    <template v-else-if="name === 'users'">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </template>
    <template v-else-if="name === 'add'">
      <path d="M12 4.5v15M4.5 12h15" stroke-width="2" />
    </template>
    <template v-else-if="name === 'attachment'">
      <path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />
    </template>
    <template v-else-if="name === 'media'">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4.5 17 4.7-4.8 3.3 3.1 2.2-2.2 4.8 4.9" />
    </template>
    <template v-else-if="name === 'music'">
      <path d="M9 18V5l10-2v13" />
      <ellipse cx="6" cy="18" rx="3" ry="2.4" />
      <ellipse cx="16" cy="16" rx="3" ry="2.4" />
      <path d="M9 9l10-2" />
    </template>
    <template v-else-if="name === 'play'">
      <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'pause'">
      <path d="M8 5v14M16 5v14" stroke-width="2.8" />
    </template>
    <template v-else-if="name === 'previous'">
      <path d="M6 5v14M18 6l-9 6 9 6Z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'next'">
      <path d="M18 5v14M6 6l9 6-9 6Z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'repeat'">
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </template>
    <template v-else-if="name === 'list'">
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3" />
    </template>
    <template v-else-if="name === 'pin'">
      <path d="m14 4 6 6-3 1-4 4-1 5-2.5-5.5L4 12l5-1 4-4Z" />
      <path d="m9.5 14.5-5 5" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M6 2h8l4 4v16H6Z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </template>
    <template v-else-if="name === 'back'">
      <path d="m15 18-6-6 6-6" />
    </template>
    <template v-else-if="name === 'collapse'">
      <path d="m6 9 6 6 6-6" />
    </template>
    <template v-else-if="name === 'expand'">
      <path d="m6 15 6-6 6 6" />
    </template>
    <template v-else-if="name === 'send'">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </template>
    <template v-else-if="name === 'volume-off'">
      <path d="M11 5 6.5 9H3v6h3.5l4.5 4Z" />
      <path d="m16.5 9.5 5 5M21.5 9.5l-5 5" />
    </template>
    <template v-else-if="name === 'speaker'">
      <path d="M11 5 6.5 9H3v6h3.5l4.5 4Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </template>
    <template v-else-if="name === 'headphones'">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2ZM20 14h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z" />
    </template>
    <template v-else-if="name === 'bluetooth'">
      <path d="m7 7 10 10-5 4V3l5 4L7 17" />
    </template>
    <template v-else-if="name === 'phone'">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1Z" />
    </template>
    <template v-else-if="name === 'phone-off'">
      <path d="m3 3 18 18M8.5 8.5 8.1 9.9a16 16 0 0 0 6 6l1.3-1.3M5.2 2H4.1a2 2 0 0 0-2 2.2 19.8 19.8 0 0 0 3.1 8.6 19.5 19.5 0 0 0 6 6 19.8 19.8 0 0 0 8.6 3.1 2 2 0 0 0 2.2-2v-3a2 2 0 0 0-1.7-2.1c-1-.1-1.9-.4-2.8-.7" />
    </template>
    <template v-else-if="name === 'camera'">
      <rect x="3" y="6" width="14" height="12" rx="3" />
      <path d="m17 10 4-2v8l-4-2Z" />
    </template>
    <template v-else-if="name === 'camera-off'">
      <path d="m3 3 18 18M10.5 6H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 2.3-1.1M17 13.5V10l4-2v8l-1.7-.9" />
    </template>
    <template v-else-if="name === 'camera-switch'">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M9 9 7 11l2 2M15 13l2-2-2-2M7 11h10" />
    </template>
    <template v-else-if="name === 'screen-share'">
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M8 21h8M12 17v4M8.5 11.5 12 8l3.5 3.5M12 8v6" />
    </template>
    <template v-else-if="name === 'microphone'">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </template>
    <template v-else-if="name === 'microphone-off'">
      <path d="m3 3 18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.8-1M5 10a7 7 0 0 0 11.9 5M12 17v5M8 22h8" />
    </template>
    <template v-else>
      <path d="M18 6 6 18M6 6l12 12" />
    </template>
  </svg>
</template>
