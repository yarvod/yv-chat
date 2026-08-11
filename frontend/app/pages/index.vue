<script setup lang="ts">
import { useAuth } from '../presentation/composables/useAuth'

definePageMeta({ layout: false })
const auth = useAuth()
await auth.bootstrap()
await navigateTo(auth.isAuthenticated.value ? '/chat' : '/login', { replace: true })
</script>

<template><div /></template>
