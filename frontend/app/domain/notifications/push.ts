export type PushPermissionState = 'default' | 'denied' | 'granted'
export type PushProvider = 'web' | 'apns' | 'fcm'

export interface BrowserPushSubscriptionData {
  provider: 'web'
  endpoint: string
  p256dh: string
  auth: string
}

export interface NativePushSubscriptionData {
  provider: 'apns' | 'fcm'
  token: string
}

export type PushSubscriptionData = BrowserPushSubscriptionData | NativePushSubscriptionData

export interface PushNavigationTarget {
  conversationId: string
  messageId?: string
}

export type PushNotificationStatus =
  | 'loading'
  | 'unsupported'
  | 'server-disabled'
  | 'prompt'
  | 'denied'
  | 'enabled'
  | 'error'

export interface PushNotificationState {
  status: PushNotificationStatus
  busy: boolean
  message: string | null
}
