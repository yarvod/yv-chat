export type StoragePersistenceResult = 'persistent' | 'denied' | 'unsupported'

interface StorageManagerLike {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

export class BrowserStoragePersistence {
  constructor(private readonly storage: StorageManagerLike | undefined = navigator.storage) {}

  async request(): Promise<StoragePersistenceResult> {
    if (
      typeof this.storage?.persisted !== 'function'
      || typeof this.storage.persist !== 'function'
    ) return 'unsupported'
    try {
      if (await this.storage.persisted()) return 'persistent'
      return await this.storage.persist() ? 'persistent' : 'denied'
    } catch {
      return 'denied'
    }
  }
}
