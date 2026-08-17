const YV_PUSH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function yvPushPayload(value) {
  if (
    typeof value !== 'object'
    || value === null
    || value.version !== 1
    || value.sync_required !== true
    || !YV_PUSH_UUID.test(value.event_id)
    || !YV_PUSH_UUID.test(value.conversation_id)
    || !YV_PUSH_UUID.test(value.message_id)
  ) return null
  return value
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = null
    try {
      payload = yvPushPayload(event.data?.json())
    } catch {
      return
    }
    if (!payload) return
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some(client => client.visibilityState === 'visible')) return
    const tag = `yv-message-${payload.event_id}`
    if ((await self.registration.getNotifications({ tag })).length > 0) return
    await self.registration.showNotification('Новое сообщение', {
      body: 'Откройте yv-chat, чтобы прочитать.',
      icon: '/icons/icon-v3-any-192.png',
      tag,
      renotify: false,
      data: {
        conversationId: payload.conversation_id,
        messageId: payload.message_id,
      },
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const conversationId = event.notification.data?.conversationId
    const messageId = event.notification.data?.messageId
    if (
      typeof conversationId !== 'string'
      || typeof messageId !== 'string'
      || !YV_PUSH_UUID.test(conversationId)
      || !YV_PUSH_UUID.test(messageId)
    ) return
    const target = `/chat?conversation=${encodeURIComponent(conversationId)}&message=${encodeURIComponent(messageId)}`
    const navigation = {
      type: 'yv-notification-navigation',
      conversationId,
      messageId,
    }
    const windows = [
      ...await self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
    ].sort((left, right) => {
      const leftPriority = Number(left.visibilityState === 'visible') + Number(left.focused)
      const rightPriority = Number(right.visibilityState === 'visible') + Number(right.focused)
      return rightPriority - leftPriority
    })
    for (const existing of windows) {
      try {
        // Android may return a discarded task from matchAll(). Focusing first
        // gives the OS a chance to restore it before route navigation.
        const focused = await existing.focus()
        const navigated = 'navigate' in focused ? await focused.navigate(target) : null
        if (navigated === null) throw new Error('window client navigation was rejected')
        navigated.postMessage?.(navigation)
        return
      } catch {
        // Try another live task before opening a new scoped window.
      }
    }
    const opened = await self.clients.openWindow(target)
    if (opened) {
      try {
        const focused = await opened.focus()
        focused.postMessage?.(navigation)
      } catch {
        // openWindow already initiated the cold-start navigation.
      }
    }
  })())
})
