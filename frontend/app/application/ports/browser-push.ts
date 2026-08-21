import type {
  PushNavigationTarget,
  PushPermissionState,
  PushProvider,
  PushSubscriptionData,
} from '../../domain/notifications/push'

export interface PushNotificationAdapter {
  readonly provider: PushProvider
  readonly refreshRegistrationOnInspect: boolean
  isSupported(): boolean
  permission(): Promise<PushPermissionState>
  requestPermission(): Promise<PushPermissionState>
  currentSubscription(): Promise<PushSubscriptionData | null>
  subscribe(applicationServerKey: string | null): Promise<PushSubscriptionData>
  unsubscribe(): Promise<void>
  promptDismissed(): boolean
  dismissPrompt(): void
  start(onNavigate: (target: PushNavigationTarget) => void): Promise<() => Promise<void>>
}

export type BrowserPush = PushNotificationAdapter
