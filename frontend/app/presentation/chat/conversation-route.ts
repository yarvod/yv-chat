import type { PushNavigationTarget } from '../../domain/notifications/push'

export function selectedConversationId(queryValue: unknown): string | null {
  return typeof queryValue === 'string' && queryValue.length > 0 ? queryValue : null
}

export function selectedMessageId(queryValue: unknown): string | null {
  return selectedConversationId(queryValue)
}

const notificationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type NotificationNavigationTarget = PushNavigationTarget

export function nativeNavigationTarget(value: string): NotificationNavigationTarget | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const path = url.pathname.split('/').filter(Boolean)
  const conversationId = url.hostname === 'chat' ? path[0] : null
  const messageId = url.searchParams.get('message')
  if (
    url.protocol !== 'yvchat:'
    || path.length !== 1
    || !conversationId
    || !notificationUuid.test(conversationId)
    || (messageId !== null && !notificationUuid.test(messageId))
  ) return null
  return { conversationId, ...(messageId ? { messageId } : {}) }
}

export function notificationNavigationTarget(value: unknown): NotificationNavigationTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.type !== 'yv-notification-navigation'
    || typeof candidate.conversationId !== 'string'
    || !notificationUuid.test(candidate.conversationId)
    || (candidate.messageId !== undefined
      && (typeof candidate.messageId !== 'string' || !notificationUuid.test(candidate.messageId)))
  ) return null
  return {
    conversationId: candidate.conversationId,
    ...(typeof candidate.messageId === 'string' ? { messageId: candidate.messageId } : {}),
  }
}
