import { useAuth } from '../presentation/composables/useAuth'

export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuth()
  await auth.bootstrap()
  if (auth.isAuthenticated.value) return navigateTo('/chat')
})
