import { handleNotificationNavigation } from '../presentation/chat/conversation-route'

export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return

  const handleNavigation = (event: MessageEvent<unknown>): void => {
    handleNotificationNavigation(event, target => {
      void navigateTo({
        path: '/chat',
        query: {
          conversation: target.conversationId,
          ...(target.messageId ? { message: target.messageId } : {}),
        },
      })
    })
  }

  navigator.serviceWorker.addEventListener('message', handleNavigation)
})
