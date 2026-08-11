import { ActivateAccount } from '../application/accounts/activate-account'
import { BuildInvitationLink, ConsumeActivationFragment } from '../application/accounts/invitation-links'
import { InviteUser } from '../application/accounts/invite-user'
import { ListManagedUsers } from '../application/accounts/list-managed-users'
import { LoadCurrentAccount } from '../application/auth/load-current-account'
import { Login } from '../application/auth/login'
import { Logout } from '../application/auth/logout'
import { BrowserClipboard } from '../infrastructure/browser/clipboard'
import { BrowserClientIdGenerator } from '../infrastructure/browser/client-id-generator'
import { BrowserDeviceInfo } from '../infrastructure/browser/device-info'
import { BrowserHaptics } from '../infrastructure/browser/haptics'
import { BrowserLocation } from '../infrastructure/browser/browser-location'
import { BrowserThemePreferences } from '../infrastructure/browser/theme-preferences'
import { syntheticMessageCodec } from '../infrastructure/crypto/synthetic-message-codec'
import { HttpAdminAccountsGateway } from '../infrastructure/http/admin-accounts-gateway'
import { ApiClient } from '../infrastructure/http/api-client'
import { HttpAuthGateway } from '../infrastructure/http/auth-gateway'
import { HttpMessagingGateway } from '../infrastructure/http/messaging-gateway'

export default defineNuxtPlugin(() => {
  const apiClient = new ApiClient()
  const authGateway = new HttpAuthGateway(apiClient)
  const adminAccountsGateway = new HttpAdminAccountsGateway(apiClient)
  const messagingGateway = new HttpMessagingGateway(apiClient)
  const deviceInfo = new BrowserDeviceInfo()
  const haptics = new BrowserHaptics()
  const themePreferences = new BrowserThemePreferences()
  const browserLocation = new BrowserLocation()
  const themePreference = themePreferences.load()
  themePreferences.apply(themePreference)

  return {
    provide: {
      frontend: {
        messagingGateway,
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
        buildInvitationLink: new BuildInvitationLink(browserLocation),
        consumeActivationFragment: new ConsumeActivationFragment(browserLocation),
      },
    },
  }
})
