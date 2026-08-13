import type {
  ActivationReissue,
  Invitation,
  ManagedUsersPage,
  ManagedUserUpdate,
  PasswordResetIssue,
} from '../../domain/accounts/managed-user'
import type {
  CreatedRegistrationInvitation,
  RegistrationInvitationsPage,
} from '../../domain/accounts/registration-invitation'

export interface AdminAccountsGateway {
  list(search: string | null, limit: number, offset: number): Promise<ManagedUsersPage>
  invite(username: string, displayName: string): Promise<Invitation>
  setActive(userId: string, isActive: boolean): Promise<ManagedUserUpdate>
  reissueActivation(userId: string): Promise<ActivationReissue>
  issuePasswordReset(userId: string): Promise<PasswordResetIssue>
  listInvitations(limit: number, offset: number): Promise<RegistrationInvitationsPage>
  createInvitation(label: string | null): Promise<CreatedRegistrationInvitation>
  revokeInvitation(invitationId: string): Promise<void>
}
