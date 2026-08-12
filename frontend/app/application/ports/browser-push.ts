import type {
  BrowserPushSubscriptionData,
  PushPermissionState,
} from '../../domain/notifications/push'

export interface BrowserPush {
  isSupported(): boolean
  permission(): PushPermissionState
  requestPermission(): Promise<PushPermissionState>
  currentSubscription(): Promise<BrowserPushSubscriptionData | null>
  subscribe(applicationServerKey: string): Promise<BrowserPushSubscriptionData>
  unsubscribe(): Promise<void>
  promptDismissed(): boolean
  dismissPrompt(): void
}
