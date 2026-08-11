<script setup lang="ts">
import { ref, watch } from 'vue'

import type { CurrentAccount } from '../../domain/accounts/account'

const props = defineProps<{ account: CurrentAccount }>()
const { $frontend } = useNuxtApp()
const emit = defineEmits<{ updated: [account: CurrentAccount] }>()
const displayName = ref(props.account.displayName)
const busy = ref(false)
const message = ref<string | null>(null)

watch(() => props.account.displayName, value => {
  displayName.value = value
})

async function save(): Promise<void> {
  const nextName = displayName.value.trim()
  if (!nextName || nextName === props.account.displayName) return
  busy.value = true
  message.value = null
  try {
    const updated = await $frontend.updateProfile.execute(nextName)
    emit('updated', updated)
    message.value = 'Профиль обновлён.'
  } catch {
    message.value = 'Не удалось обновить профиль.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="settings-card settings-card--profile-editor">
    <div class="settings-card__heading">
      <span class="profile-avatar">{{ account.displayName.slice(0, 1).toUpperCase() }}</span>
      <div><h2>Профиль</h2><p>@{{ account.username }}</p></div>
      <span v-if="account.isAdmin" class="status-pill active">admin</span>
    </div>
    <form class="settings-inline-form" @submit.prevent="save">
      <label><span>Отображаемое имя</span><input v-model="displayName" required maxlength="80" autocomplete="name"></label>
      <button class="button button--primary button--compact" type="submit" :disabled="busy || !displayName.trim() || displayName.trim() === account.displayName">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button>
    </form>
    <p v-if="message" class="settings-message" role="status">{{ message }}</p>
  </article>
</template>
