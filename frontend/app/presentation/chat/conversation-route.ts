export function selectedConversationId(queryValue: unknown): string | null {
  return typeof queryValue === 'string' && queryValue.length > 0 ? queryValue : null
}

export function selectedMessageId(queryValue: unknown): string | null {
  return selectedConversationId(queryValue)
}

const notificationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface NotificationNavigationTarget {
  conversationId: string
  messageId: string
}

export function notificationNavigationTarget(value: unknown): NotificationNavigationTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.type !== 'yv-notification-navigation'
    || typeof candidate.conversationId !== 'string'
    || typeof candidate.messageId !== 'string'
    || !notificationUuid.test(candidate.conversationId)
    || !notificationUuid.test(candidate.messageId)
  ) return null
  return {
    conversationId: candidate.conversationId,
    messageId: candidate.messageId,
  }
}
