export type DeviceCryptoErrorCode =
  | 'conflict'
  | 'corrupt-state'
  | 'invalid-request'
  | 'invalid-key-package'
  | 'not-provisioned'
  | 'operation-failed'
  | 'rollback'
  | 'runtime-unavailable'
  | 'storage-unavailable'

export class DeviceCryptoError extends Error {
  constructor(readonly code: DeviceCryptoErrorCode) {
    super('device cryptography operation failed')
    this.name = 'DeviceCryptoError'
  }
}
