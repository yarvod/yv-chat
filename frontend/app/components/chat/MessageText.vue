<script setup lang="ts">
import { computed } from 'vue'

import type { ConversationMember } from '../../domain/messaging/models'
import { buildMessageTextSegments } from '../../presentation/chat/message-text-segments'

const props = withDefaults(defineProps<{
  body: string
  members?: readonly ConversationMember[]
  mentionedUserIds?: readonly string[]
  actorUserId?: string
}>(), {
  members: () => [],
  mentionedUserIds: () => [],
  actorUserId: '',
})

const segments = computed(() => buildMessageTextSegments(
  props.body,
  props.members,
  props.mentionedUserIds,
  props.actorUserId,
))
</script>

<template>
  <p class="message-text">
    <template v-for="(segment, index) in segments" :key="index">
      <a
        v-if="segment.kind === 'link'"
        class="message-link"
        :href="segment.href"
        target="_blank"
        rel="noopener noreferrer external"
      >{{ segment.text }}</a>
      <span
        v-else
        :class="{
          mention: segment.kind === 'mention',
          'mention--own': segment.kind === 'mention' && segment.own,
        }"
      >{{ segment.text }}</span>
    </template>
  </p>
</template>
