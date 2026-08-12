export type PushPermissionState = 'default' | 'denied' | 'granted'

export interface BrowserPushSubscriptionData {
  endpoint: string
  p256dh: string
  auth: string
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
