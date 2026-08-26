import type { CurrentAccount } from '../../domain/accounts/account'

export type OfflineAccountStoreErrorKind = 'corrupt' | 'storage-unavailable'

export class OfflineAccountStoreError extends Error {
  constructor(readonly kind: OfflineAccountStoreErrorKind) {
    super(`offline account store: ${kind}`)
    this.name = 'OfflineAccountStoreError'
  }
}

export interface OfflineAccountStore {
  load(): Promise<CurrentAccount | null>
  save(account: CurrentAccount): Promise<void>
  clear(): Promise<void>
  close(): void
}
