export function selectedConversationId(queryValue: unknown): string | null {
  return typeof queryValue === 'string' && queryValue.length > 0 ? queryValue : null
}

export function selectedMessageId(queryValue: unknown): string | null {
  return selectedConversationId(queryValue)
}
