<script setup lang="ts">
import { computed, ref } from 'vue'

import type { DirectoryUser } from '../../domain/messaging/models'

const props = defineProps<{
  users: readonly DirectoryUser[]
  actorUserId: string
  busy: boolean
}>()
const emit = defineEmits<{
  cancel: []
  direct: [userId: string]
  group: [title: string, userIds: string[]]
}>()

const mode = ref<'direct' | 'group'>('direct')
const directUserId = ref('')
const groupTitle = ref('')
const selectedUserIds = ref<string[]>([])
const candidates = computed(() => props.users.filter(user => user.userId !== props.actorUserId))

function submit(): void {
  if (mode.value === 'direct' && directUserId.value) {
    emit('direct', directUserId.value)
    return
  }
  const title = groupTitle.value.trim()
  if (mode.value === 'group' && title) emit('group', title, selectedUserIds.value)
}
</script>

<template>
  <form class="new-conversation" @submit.prevent="submit">
    <div class="segmented" aria-label="Тип диалога">
      <button type="button" :class="{ active: mode === 'direct' }" @click="mode = 'direct'">
        Личный
      </button>
      <button type="button" :class="{ active: mode === 'group' }" @click="mode = 'group'">
        Группа
      </button>
    </div>

    <label v-if="mode === 'direct'">
      <span>Участник</span>
      <select v-model="directUserId" required>
        <option value="" disabled>Выберите участника</option>
        <option v-for="user in candidates" :key="user.userId" :value="user.userId">
          {{ user.displayName }} · @{{ user.username }}
        </option>
      </select>
    </label>

    <template v-else>
      <label>
        <span>Название группы</span>
        <input v-model="groupTitle" required maxlength="100">
      </label>
      <fieldset>
        <legend>Участники</legend>
        <label v-for="user in candidates" :key="user.userId" class="check-row">
          <input v-model="selectedUserIds" type="checkbox" :value="user.userId">
          <span>{{ user.displayName }} <small>@{{ user.username }}</small></span>
        </label>
      </fieldset>
    </template>

    <div class="form-actions">
      <button class="text-button" type="button" @click="emit('cancel')">Отмена</button>
      <button class="primary-button compact" type="submit" :disabled="busy">
        {{ busy ? 'Создаём…' : 'Создать' }}
      </button>
    </div>
  </form>
</template>
