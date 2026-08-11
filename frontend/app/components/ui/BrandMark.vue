<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'default' | 'small' | 'large' | 'rail'
}>(), { size: 'default' })
</script>

<template>
  <span class="brand-mark" :class="`brand-mark--${size}`" aria-hidden="true">
    <img src="/brand/yv-chat-symbol.svg" alt="">
  </span>
</template>
