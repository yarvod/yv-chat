import { ActivateAccount } from '../application/accounts/activate-account'
import { ChangePassword } from '../application/accounts/change-password'
import { BuildInvitationLink, ConsumeActivationFragment } from '../application/accounts/invitation-links'
import { InviteUser } from '../application/accounts/invite-user'
import { IssuePasswordReset } from '../application/accounts/issue-password-reset'
import { ListManagedUsers } from '../application/accounts/list-managed-users'
import { ListDeviceSessions } from '../application/accounts/list-device-sessions'
import { ListSecurityEvents } from '../application/accounts/list-security-events'
import {
  BuildPasswordResetLink,
  ConsumePasswordResetFragment,
} from '../application/accounts/password-reset-links'
import { ReissueActivation } from '../application/accounts/reissue-activation'
import { RenameDevice } from '../application/accounts/rename-device'
import { ResetPassword } from '../application/accounts/reset-password'
import { RevokeDevice } from '../application/accounts/revoke-device'
import { RevokeOtherSessions } from '../application/accounts/revoke-other-sessions'
import { SecurityReset } from '../application/accounts/security-reset'
import { SetManagedUserActive } from '../application/accounts/set-user-active'
import { UpdateProfile } from '../application/accounts/update-profile'
import { RealtimeSyncService } from '../application/messaging/realtime-sync-service'
import { TypingIndicatorService } from '../application/messaging/typing-indicator-service'
import { PresenceIndicatorService } from '../application/messaging/presence-indicator-service'
import type { TypingTransport } from '../application/ports/typing-transport'
import { ListConversationReadStates } from '../application/messaging/list-conversation-read-states'
import { ListParticipantDeliveryStates } from '../application/messaging/list-participant-delivery-states'
import { MarkConversationDelivered } from '../application/messaging/mark-conversation-delivered'
import { MarkConversationRead } from '../application/messaging/mark-conversation-read'
import { LoadCurrentAccount } from '../application/auth/load-current-account'
import { Login } from '../application/auth/login'
import { Logout } from '../application/auth/logout'
import { BrowserClipboard } from '../infrastructure/browser/clipboard'
import { BrowserClock } from '../infrastructure/browser/clock'
import { BrowserClientIdGenerator } from '../infrastructure/browser/client-id-generator'
import { BrowserDeviceInfo } from '../infrastructure/browser/device-info'
import { BrowserHaptics } from '../infrastructure/browser/haptics'
import { BrowserLocation } from '../infrastructure/browser/browser-location'
import { BrowserPageVisibility } from '../infrastructure/browser/page-visibility'
import { BrowserScheduler } from '../infrastructure/browser/scheduler'
import { BrowserThemePreferences } from '../infrastructure/browser/theme-preferences'
import { syntheticMessageCodec } from '../infrastructure/crypto/synthetic-message-codec'
import { HttpAdminAccountsGateway } from '../infrastructure/http/admin-accounts-gateway'
import { HttpAccountSecurityGateway } from '../infrastructure/http/account-security-gateway'
import { ApiClient } from '../infrastructure/http/api-client'
import { HttpAuthGateway } from '../infrastructure/http/auth-gateway'
import { HttpMessagingGateway } from '../infrastructure/http/messaging-gateway'
import { HttpConversationReadStateGateway } from '../infrastructure/http/conversation-read-state-gateway'
import { HttpConversationDeliveryStateGateway } from '../infrastructure/http/conversation-delivery-state-gateway'
import { BrowserRealtimeGateway } from '../infrastructure/realtime/browser-realtime-gateway'

export default defineNuxtPlugin(() => {
  const apiClient = new ApiClient()
  const authGateway = new HttpAuthGateway(apiClient)
  const adminAccountsGateway = new HttpAdminAccountsGateway(apiClient)
  const accountSecurityGateway = new HttpAccountSecurityGateway(apiClient)
  const messagingGateway = new HttpMessagingGateway(apiClient)
  const readStateGateway = new HttpConversationReadStateGateway(apiClient)
  const deliveryStateGateway = new HttpConversationDeliveryStateGateway(apiClient)
  const deviceInfo = new BrowserDeviceInfo()
  const haptics = new BrowserHaptics()
  const realtimeGateway = new BrowserRealtimeGateway()
  const scheduler = new BrowserScheduler()
  const clock = new BrowserClock()
  const themePreferences = new BrowserThemePreferences()
  const browserLocation = new BrowserLocation()
  const pageVisibility = new BrowserPageVisibility()
  const themePreference = themePreferences.load()
  themePreferences.apply(themePreference)

  return {
    provide: {
      frontend: {
        messagingGateway,
        listConversationReadStates: new ListConversationReadStates(readStateGateway),
        markConversationRead: new MarkConversationRead(readStateGateway),
        listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
        markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
        pageVisibility,
        messageCodec: syntheticMessageCodec,
        deviceInfo,
        haptics,
        themePreferences,
        clipboard: new BrowserClipboard(),
        clientIdGenerator: new BrowserClientIdGenerator(),
        loadCurrentAccount: new LoadCurrentAccount(authGateway),
        login: new Login(authGateway, deviceInfo, haptics),
        logout: new Logout(authGateway),
        activateAccount: new ActivateAccount(authGateway, haptics),
        listManagedUsers: new ListManagedUsers(adminAccountsGateway),
        inviteUser: new InviteUser(adminAccountsGateway, haptics),
        setManagedUserActive: new SetManagedUserActive(adminAccountsGateway, haptics),
        reissueActivation: new ReissueActivation(adminAccountsGateway, haptics),
        issuePasswordReset: new IssuePasswordReset(adminAccountsGateway, haptics),
        resetPassword: new ResetPassword(authGateway, haptics),
        buildInvitationLink: new BuildInvitationLink(browserLocation),
        consumeActivationFragment: new ConsumeActivationFragment(browserLocation),
        buildPasswordResetLink: new BuildPasswordResetLink(browserLocation),
        consumePasswordResetFragment: new ConsumePasswordResetFragment(browserLocation),
        updateProfile: new UpdateProfile(accountSecurityGateway),
        listDeviceSessions: new ListDeviceSessions(accountSecurityGateway),
        renameDevice: new RenameDevice(accountSecurityGateway),
        revokeDevice: new RevokeDevice(accountSecurityGateway),
        revokeOtherSessions: new RevokeOtherSessions(accountSecurityGateway),
        changePassword: new ChangePassword(accountSecurityGateway),
        securityReset: new SecurityReset(accountSecurityGateway),
        listSecurityEvents: new ListSecurityEvents(accountSecurityGateway),
        createRealtimeSync: () => new RealtimeSyncService(realtimeGateway, scheduler),
        createTypingIndicators: (transport: TypingTransport) => (
          new TypingIndicatorService(transport, scheduler, clock)
        ),
        createPresenceIndicators: () => new PresenceIndicatorService(),
      },
    },
  }
})
