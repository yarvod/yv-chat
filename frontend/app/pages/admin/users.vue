<script setup lang="ts">
import { computed } from 'vue'

import AdminUsersPanel from '../../components/admin/AdminUsersPanel.vue'
import { useAuth } from '../../presentation/composables/useAuth'

definePageMeta({ layout: 'app', middleware: 'admin' })
const auth = useAuth()
const currentUserId = computed(() => auth.user.value?.userId ?? null)
</script>

<template>
  <div class="page-view admin-view">
    <AdminUsersPanel embedded :current-user-id="currentUserId" />
  </div>
</template>
