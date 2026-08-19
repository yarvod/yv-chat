<script setup lang="ts">
import { computed } from 'vue'

import type { VoiceCallSummary } from '../../domain/calls/voice-call'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  call: VoiceCallSummary
  outgoing: boolean
}>()

const title = computed(() => {
  if (props.call.outcome === 'completed') {
    return props.outgoing ? 'Исходящий звонок' : 'Входящий звонок'
  }
  if (props.call.outcome === 'missed') {
    return props.outgoing ? 'Не ответили' : 'Пропущенный звонок'
  }
  if (props.call.outcome === 'declined') return 'Звонок отклонён'
  if (props.call.outcome === 'busy') return 'Собеседник занят'
  if (props.call.outcome === 'cancelled') return 'Отменённый звонок'
  return 'Звонок не состоялся'
})

const details = computed(() => {
  if (props.call.outcome !== 'completed' || props.call.durationSeconds <= 0) {
    return props.outgoing ? 'Исходящий' : 'Входящий'
  }
  const minutes = Math.floor(props.call.durationSeconds / 60)
  const seconds = props.call.durationSeconds % 60
  return `Длительность ${minutes}:${seconds.toString().padStart(2, '0')}`
})
</script>

<template>
  <div class="call-history" :class="{ 'call-history--missed': call.outcome === 'missed' }">
    <span class="call-history__icon" aria-hidden="true"><AppIcon name="phone" /></span>
    <span>
      <strong>{{ title }}</strong>
      <small>{{ details }}</small>
    </span>
  </div>
</template>
