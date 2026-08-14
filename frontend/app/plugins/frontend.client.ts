import { ActivateAccount } from '../application/accounts/activate-account'
import { ChangePassword } from '../application/accounts/change-password'
import { BuildInvitationLink, ConsumeActivationFragment } from '../application/accounts/invitation-links'
import { InviteUser } from '../application/accounts/invite-user'
import {
  CreateRegistrationInvitation,
  ListRegistrationInvitations,
  RevokeRegistrationInvitation,
} from '../application/accounts/manage-registration-invitations'
import { RegisterAccount } from '../application/accounts/register-account'
import { IssuePasswordReset } from '../application/accounts/issue-password-reset'
import { ListManagedUsers } from '../application/accounts/list-managed-users'
import { ListDeviceSessions } from '../application/accounts/list-device-sessions'
import { DevicePairingService } from '../application/accounts/device-pairing'
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
import { DeleteMessageForEveryone } from '../application/messaging/delete-message-for-everyone'
import { AddGroupMember } from '../application/conversations/add-group-member'
import { LeaveGroup } from '../application/conversations/leave-group'
import { RemoveGroupMember } from '../application/conversations/remove-group-member'
import { RenameGroup } from '../application/conversations/rename-group'
import { AcknowledgeOutboxMessage } from '../application/messaging/acknowledge-outbox-message'
import { DeliverOutboxMessage } from '../application/messaging/deliver-outbox-message'
import { ListOutboxMessages } from '../application/messaging/list-outbox-messages'
import { QueueOutgoingMessage } from '../application/messaging/queue-outgoing-message'
import { UploadGroupAttachment } from '../application/messaging/upload-group-attachment'
import { DownloadGroupAttachment } from '../application/messaging/download-group-attachment'
import { ClearDeviceMediaCache } from '../application/storage/clear-device-media-cache'
import { InspectDeviceMediaCache } from '../application/storage/inspect-device-media-cache'
import { RetryOutboxMessage } from '../application/messaging/retry-outbox-message'
import { GetDeviceCryptoRegistration } from '../application/device-crypto/get-device-crypto-registration'
import { ListDeviceKeyPackages } from '../application/device-crypto/list-device-key-packages'
import { ReplenishDeviceKeyPackages } from '../application/device-crypto/replenish-device-key-packages'
import { RegisterDeviceCrypto } from '../application/device-crypto/register-device-crypto'
import { EnrollLinkedDevice } from '../application/device-crypto/enroll-linked-device'
import { SynchronizeDeviceHistory } from '../application/device-crypto/synchronize-device-history'
import { ConversationHistory } from '../application/messaging/conversation-history'
import { ProtocolMessageProtection } from '../application/messaging/message-protection'
import { PresenceIndicatorService } from '../application/messaging/presence-indicator-service'
import { RealtimeSyncService } from '../application/messaging/realtime-sync-service'
import { ListConversationReadStates } from '../application/messaging/list-conversation-read-states'
import { ListParticipantDeliveryStates } from '../application/messaging/list-participant-delivery-states'
import { MarkConversationDelivered } from '../application/messaging/mark-conversation-delivered'
import { MarkConversationRead } from '../application/messaging/mark-conversation-read'
import { TypingIndicatorService } from '../application/messaging/typing-indicator-service'
import type { TypingTransport } from '../application/ports/typing-transport'
import { DeviceCryptoSession } from '../bootstrap/device-crypto-session'
import { LoadCurrentAccount } from '../application/auth/load-current-account'
import { Login } from '../application/auth/login'
import { Logout } from '../application/auth/logout'
import { BrowserClipboard } from '../infrastructure/browser/clipboard'
import { BrowserClock } from '../infrastructure/browser/clock'
import { BrowserClientIdGenerator } from '../infrastructure/browser/client-id-generator'
import { BrowserDeviceInfo } from '../infrastructure/browser/device-info'
import { BrowserDevicePairingSecretStore } from '../infrastructure/browser/device-pairing-secrets'
import { BrowserHaptics } from '../infrastructure/browser/haptics'
import { BrowserLocation } from '../infrastructure/browser/browser-location'
import { BrowserNetworkStatus } from '../infrastructure/browser/browser-network-status'
import { BrowserPageVisibility } from '../infrastructure/browser/page-visibility'
import { BrowserScheduler } from '../infrastructure/browser/scheduler'
import { BrowserThemePreferences } from '../infrastructure/browser/theme-preferences'
import { BrowserVideoNoteRecorder } from '../infrastructure/browser/video-note-recorder'
import { IndexedDbMessageArchive } from '../infrastructure/storage/indexeddb-message-archive'
import { IndexedDbMessengerSnapshotStore } from '../infrastructure/storage/indexeddb-messenger-snapshot-store'
import { IndexedDbMessageOutbox } from '../infrastructure/storage/indexeddb-message-outbox'
import { BrowserDeviceHistorySyncJobStore } from '../infrastructure/storage/browser-device-history-sync-jobs'
import { EncryptedMediaCache } from '../infrastructure/storage/encrypted-media-cache'
import { SyntheticMessageProtocol } from '../infrastructure/crypto/synthetic-message-protocol'
import { MlsMessageProtocol } from '../infrastructure/crypto/mls-message-protocol'
import { HttpAdminAccountsGateway } from '../infrastructure/http/admin-accounts-gateway'
import { HttpAccountSecurityGateway } from '../infrastructure/http/account-security-gateway'
import { ApiClient } from '../infrastructure/http/api-client'
import { HttpAuthGateway } from '../infrastructure/http/auth-gateway'
import { HttpMessagingGateway } from '../infrastructure/http/messaging-gateway'
import { HttpAttachmentGateway } from '../infrastructure/http/attachment-gateway'
import { HttpServerHealthGateway } from '../infrastructure/http/http-server-health-gateway'
import { HttpConversationReadStateGateway } from '../infrastructure/http/conversation-read-state-gateway'
import { HttpConversationDeliveryStateGateway } from '../infrastructure/http/conversation-delivery-state-gateway'
import { HttpDeviceCryptoRegistryGateway } from '../infrastructure/http/device-crypto-registry-gateway'
import { HttpDevicePairingGateway } from '../infrastructure/http/device-pairing-gateway'
import { HttpDeviceKeyPackageGateway } from '../infrastructure/http/device-key-package-gateway'
import { HttpConversationCryptoGateway } from '../infrastructure/http/conversation-crypto-gateway'
import { BrowserRealtimeGateway } from '../infrastructure/realtime/browser-realtime-gateway'
import { CryptoWorkerClient } from '../infrastructure/crypto/crypto-worker-client'
import { IndexedDbConversationCryptoState } from '../infrastructure/storage/indexeddb-conversation-crypto-state'
import { ConnectionMonitor } from '../application/connectivity/connection-monitor'
import { PushNotificationManager } from '../application/notifications/push-notification-manager'
import { BrowserPushAdapter } from '../infrastructure/browser/browser-push'
import { HttpPushRegistrationGateway } from '../infrastructure/http/push-registration-gateway'

export default defineNuxtPlugin(() => {
  const apiClient = new ApiClient()
  const authGateway = new HttpAuthGateway(apiClient)
  const adminAccountsGateway = new HttpAdminAccountsGateway(apiClient)
  const accountSecurityGateway = new HttpAccountSecurityGateway(apiClient)
  const messagingGateway = new HttpMessagingGateway(apiClient)
  const attachmentGateway = new HttpAttachmentGateway(apiClient)
  const readStateGateway = new HttpConversationReadStateGateway(apiClient)
  const deliveryStateGateway = new HttpConversationDeliveryStateGateway(apiClient)
  const deviceCryptoRegistryGateway = new HttpDeviceCryptoRegistryGateway(apiClient)
  const devicePairingGateway = new HttpDevicePairingGateway(apiClient)
  const deviceKeyPackageGateway = new HttpDeviceKeyPackageGateway(apiClient)
  const conversationCryptoGateway = new HttpConversationCryptoGateway(apiClient)
  const deviceInfo = new BrowserDeviceInfo()
  const devicePairing = new DevicePairingService(
    devicePairingGateway,
    new BrowserDevicePairingSecretStore(),
    authGateway,
    deviceInfo,
    window.location.origin,
  )
  const haptics = new BrowserHaptics()
  const realtimeGateway = new BrowserRealtimeGateway()
  const scheduler = new BrowserScheduler()
  const clock = new BrowserClock()
  const clientIdGenerator = new BrowserClientIdGenerator()
  const themePreferences = new BrowserThemePreferences()
  const browserLocation = new BrowserLocation()
  const pageVisibility = new BrowserPageVisibility()
  const networkStatus = new BrowserNetworkStatus()
  const serverHealthGateway = new HttpServerHealthGateway(apiClient)
  const pushRegistrationGateway = new HttpPushRegistrationGateway(apiClient)
  const themePreference = themePreferences.load()
  const messageArchive = new IndexedDbMessageArchive()
  const messengerSnapshotStore = new IndexedDbMessengerSnapshotStore()
  const messageOutbox = new IndexedDbMessageOutbox()
  const mediaCache = new EncryptedMediaCache()
  const downloadGroupAttachment = new DownloadGroupAttachment(attachmentGateway, mediaCache)
  const conversationCryptoState = new IndexedDbConversationCryptoState()
  const deviceCryptoSession = new DeviceCryptoSession(
    deviceCryptoRegistryGateway,
    deviceKeyPackageGateway,
    conversationCryptoGateway,
    conversationCryptoState,
    clientIdGenerator,
    () => new CryptoWorkerClient(),
  )
  const messageProtection = new ProtocolMessageProtection(
    [new SyntheticMessageProtocol(), new MlsMessageProtocol(deviceCryptoSession)],
  )
  const epochHistories = new Map<string, ConversationHistory>()
  const linkedDeviceEnrollment = new EnrollLinkedDevice(
    messagingGateway,
    conversationCryptoGateway,
    deviceCryptoSession,
    scheduler,
    async (ownerUserId, conversationId) => {
      let history = epochHistories.get(ownerUserId)
      if (!history) {
        history = new ConversationHistory(
          ownerUserId,
          messagingGateway,
          messageArchive,
          messageProtection,
        )
        epochHistories.set(ownerUserId, history)
      }
      await history.cacheRetainedBeforeEpochAdvance(conversationId)
    },
  )
  const deviceHistorySync = new SynchronizeDeviceHistory(
    devicePairingGateway,
    messagingGateway,
    messageArchive,
    messageProtection,
    new BrowserDeviceHistorySyncJobStore(),
    scheduler,
    12,
    (ownerUserId, targetDeviceId, onProgress, ensureActive) => (
      linkedDeviceEnrollment.enroll(
        ownerUserId,
        targetDeviceId,
        onProgress,
        ensureActive,
      )
    ),
  )
  themePreferences.apply(themePreference)

  return {
    provide: {
      frontend: {
        messagingGateway,
        uploadGroupAttachment: new UploadGroupAttachment(attachmentGateway, clientIdGenerator),
        downloadGroupAttachment,
        inspectDeviceMediaCache: new InspectDeviceMediaCache(mediaCache),
        clearDeviceMediaCache: new ClearDeviceMediaCache(mediaCache, downloadGroupAttachment),
        deleteMessageForEveryone: new DeleteMessageForEveryone(messagingGateway),
        addGroupMember: new AddGroupMember(messagingGateway),
        removeGroupMember: new RemoveGroupMember(messagingGateway),
        renameGroup: new RenameGroup(messagingGateway),
        leaveGroup: new LeaveGroup(messagingGateway),
        listConversationReadStates: new ListConversationReadStates(readStateGateway),
        markConversationRead: new MarkConversationRead(readStateGateway),
        listParticipantDeliveryStates: new ListParticipantDeliveryStates(deliveryStateGateway),
        markConversationDelivered: new MarkConversationDelivered(deliveryStateGateway),
        pageVisibility,
        clock,
        messageProtection,
        messageArchive,
        messengerSnapshotStore,
        listOutboxMessages: new ListOutboxMessages(messageOutbox),
        queueOutgoingMessage: new QueueOutgoingMessage(
          messageOutbox,
          messageProtection,
          clientIdGenerator,
          clock,
        ),
        deliverOutboxMessage: new DeliverOutboxMessage(messageOutbox, messagingGateway, clock),
        acknowledgeOutboxMessage: new AcknowledgeOutboxMessage(messageOutbox),
        retryOutboxMessage: new RetryOutboxMessage(messageOutbox, clock),
        deviceInfo,
        haptics,
        themePreferences,
        clipboard: new BrowserClipboard(),
        clientIdGenerator,
        loadCurrentAccount: new LoadCurrentAccount(authGateway),
        login: new Login(authGateway, deviceInfo, haptics),
        logout: new Logout(authGateway),
        activateAccount: new ActivateAccount(authGateway, haptics),
        registerAccount: new RegisterAccount(authGateway, deviceInfo, haptics),
        listManagedUsers: new ListManagedUsers(adminAccountsGateway),
        inviteUser: new InviteUser(adminAccountsGateway, haptics),
        listRegistrationInvitations: new ListRegistrationInvitations(adminAccountsGateway),
        createRegistrationInvitation: new CreateRegistrationInvitation(
          adminAccountsGateway,
          haptics,
        ),
        revokeRegistrationInvitation: new RevokeRegistrationInvitation(
          adminAccountsGateway,
          haptics,
        ),
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
        devicePairing,
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
        createConnectionMonitor: () => new ConnectionMonitor(
          serverHealthGateway,
          networkStatus,
          scheduler,
        ),
        pushNotifications: new PushNotificationManager(
          new BrowserPushAdapter(),
          pushRegistrationGateway,
        ),
        videoNoteRecorder: new BrowserVideoNoteRecorder(),
        deviceCryptoSession,
        linkedDeviceEnrollment,
        deviceHistorySync,
        getDeviceCryptoRegistration: new GetDeviceCryptoRegistration(deviceCryptoRegistryGateway),
        registerDeviceCrypto: new RegisterDeviceCrypto(deviceCryptoRegistryGateway),
        listDeviceKeyPackages: new ListDeviceKeyPackages(deviceKeyPackageGateway),
        replenishDeviceKeyPackages: new ReplenishDeviceKeyPackages(deviceKeyPackageGateway),
      },
    },
  }
})
