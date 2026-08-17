import { notificationNavigationTarget } from '../presentation/chat/conversation-route'

export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return

  const handleNavigation = (event: MessageEvent<unknown>): void => {
    const target = notificationNavigationTarget(event.data)
    if (!target) return
    void navigateTo({
      path: '/chat',
      query: {
        conversation: target.conversationId,
        message: target.messageId,
      },
    })
  }

  navigator.serviceWorker.addEventListener('message', handleNavigation)
})
