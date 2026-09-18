export interface DeliveredMessageNotification {
  id: string
  conversationId: string
  messageId: string
}

/** Only opaque routing identifiers cross the system notification boundary. */
export interface DeliveredNotifications {
  listMessages(): Promise<DeliveredMessageNotification[]>
  dismissMessages(notifications: readonly DeliveredMessageNotification[]): Promise<void>
}
