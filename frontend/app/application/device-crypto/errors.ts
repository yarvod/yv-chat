export type DeviceCryptoErrorCode =
  | 'conflict'
  | 'corrupt-state'
  | 'invalid-request'
  | 'invalid-key-package'
  | 'local-state-lost'
  | 'not-provisioned'
  | 'operation-failed'
  | 'rollback'
  | 'runtime-import-failed'
  | 'runtime-init-failed'
  | 'runtime-invalid-module'
  | 'runtime-unavailable'
  | 'worker-failed'
  | 'worker-protocol'
  | 'worker-timeout'
  | 'storage-unavailable'

export class DeviceCryptoError extends Error {
  constructor(readonly code: DeviceCryptoErrorCode) {
    super('device cryptography operation failed')
    this.name = 'DeviceCryptoError'
  }
}
