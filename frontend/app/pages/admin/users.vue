<script setup lang="ts">
import AdminUsersPanel from '../../components/admin/AdminUsersPanel.vue'

definePageMeta({ layout: 'app', middleware: 'admin' })
</script>

<template>
  <div class="page-view admin-view">
    <AdminUsersPanel embedded />
  </div>
</template>
