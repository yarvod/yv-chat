import type {
  ActivationReissue,
  Invitation,
  ManagedUsersPage,
  ManagedUserUpdate,
  PasswordResetIssue,
} from '../../domain/accounts/managed-user'

export interface AdminAccountsGateway {
  list(search: string | null, limit: number, offset: number): Promise<ManagedUsersPage>
  invite(username: string, displayName: string): Promise<Invitation>
  setActive(userId: string, isActive: boolean): Promise<ManagedUserUpdate>
  reissueActivation(userId: string): Promise<ActivationReissue>
  issuePasswordReset(userId: string): Promise<PasswordResetIssue>
}
