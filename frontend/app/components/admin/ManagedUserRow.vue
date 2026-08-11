<script setup lang="ts">
import { computed } from 'vue'

import type { ManagedUser } from '../../domain/accounts/managed-user'

const props = defineProps<{
  item: ManagedUser
  currentUserId: string | null
  busy: boolean
}>()
defineEmits<{ toggle: [item: ManagedUser], reissue: [item: ManagedUser], reset: [item: ManagedUser] }>()

const isSelf = computed(() => props.item.userId === props.currentUserId)
</script>

<template>
  <article class="managed-user-row">
    <span class="avatar">{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
    <span class="managed-user-identity">
      <strong>{{ item.displayName }}</strong>
      <small>@{{ item.username }}</small>
      <small>{{ item.activeSessions }} активных {{ item.activeSessions === 1 ? 'сеанс' : 'сеансов' }}</small>
    </span>
    <span class="status-pill" :class="{ active: item.isActive }">
      {{ item.isAdmin ? 'admin' : item.isActive ? 'active' : item.activationPending ? 'invited' : 'disabled' }}
    </span>
    <div class="managed-user-actions">
      <button v-if="item.activationPending" class="text-button" type="button" :disabled="busy" @click="$emit('reissue', item)">Новая ссылка</button>
      <button v-else-if="!isSelf" class="text-button" type="button" :disabled="busy" @click="$emit('reset', item)">Сбросить пароль</button>
      <button v-if="!isSelf && !item.activationPending" class="button button--secondary button--compact" type="button" :disabled="busy" @click="$emit('toggle', item)">
        {{ item.isActive ? 'Заблокировать' : 'Разблокировать' }}
      </button>
      <small v-if="isSelf" class="muted">Текущий аккаунт</small>
    </div>
  </article>
</template>
