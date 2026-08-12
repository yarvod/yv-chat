import type { DeviceCryptoErrorCode } from '../../application/device-crypto/errors'
import type {
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
  GenerateDeviceKeyPackagesCommand,
  GeneratedDeviceKeyPackages,
  PublicKeyPackageValidationCommand,
  PublicKeyPackageValidationResult,
} from '../../application/ports/device-crypto-gateway'
import {
  parseMlsWorkerRequest,
  parseMlsWorkerResult,
  type MlsWorkerRequest,
  type MlsWorkerResult,
} from './mls-worker-protocol'

const PROTOCOL_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const ERROR_CODES = new Set<DeviceCryptoErrorCode>([
  'conflict',
  'corrupt-state',
  'invalid-key-package',
  'local-state-lost',
  'invalid-request',
  'not-provisioned',
  'operation-failed',
  'rollback',
  'runtime-import-failed',
  'runtime-init-failed',
  'runtime-invalid-module',
  'runtime-unavailable',
  'storage-unavailable',
  'worker-failed',
  'worker-protocol',
  'worker-timeout',
])

interface WorkerRequestBase {
  version: typeof PROTOCOL_VERSION
  requestId: string
}

export type DeviceCryptoWorkerRequest = MlsWorkerRequest
  | (WorkerRequestBase & {
      type: 'provision'
      command: DeviceCryptoIdentityCommand
    })
  | (WorkerRequestBase & {
      type: 'restore'
      command: DeviceCryptoIdentityCommand
    })
  | (WorkerRequestBase & {
      type: 'validate-key-package'
      command: PublicKeyPackageValidationCommand
    })
  | (WorkerRequestBase & {
      type: 'generate-key-packages'
      command: GenerateDeviceKeyPackagesCommand
    })
  | (WorkerRequestBase & { type: 'checkpoint' })
  | (WorkerRequestBase & { type: 'dispose' })

export type DeviceCryptoWorkerResponse =
  | {
      version: typeof PROTOCOL_VERSION
      requestId: string
      ok: true
      result: DeviceCryptoIdentity | PublicKeyPackageValidationResult
        | GeneratedDeviceKeyPackages | MlsWorkerResult
        | { disposed: true }
    }
  | {
      version: typeof PROTOCOL_VERSION
      requestId: string
      ok: false
      error: { code: DeviceCryptoErrorCode }
    }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function validIdentityCommand(value: unknown): value is DeviceCryptoIdentityCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['deviceId', 'userId'])
    && typeof candidate.userId === 'string'
    && UUID_PATTERN.test(candidate.userId)
    && typeof candidate.deviceId === 'string'
    && UUID_PATTERN.test(candidate.deviceId)
}

function validKeyPackageCommand(value: unknown): value is PublicKeyPackageValidationCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, [
      'credentialIdentity',
      'fingerprint',
      'keyPackage',
      'packageRef',
      'signaturePublicKey',
      'targetDeviceId',
      'targetUserId',
    ])
    && typeof candidate.targetUserId === 'string'
    && UUID_PATTERN.test(candidate.targetUserId)
    && typeof candidate.targetDeviceId === 'string'
    && UUID_PATTERN.test(candidate.targetDeviceId)
    && candidate.credentialIdentity instanceof Uint8Array
    && candidate.credentialIdentity.byteLength === 33
    && candidate.signaturePublicKey instanceof Uint8Array
    && candidate.signaturePublicKey.byteLength === 32
    && typeof candidate.fingerprint === 'string'
    && FINGERPRINT_PATTERN.test(candidate.fingerprint)
    && typeof candidate.packageRef === 'string'
    && FINGERPRINT_PATTERN.test(candidate.packageRef)
    && candidate.keyPackage instanceof Uint8Array
    && candidate.keyPackage.byteLength > 0
    && candidate.keyPackage.byteLength <= 1024 * 1024
}

function validGenerateKeyPackagesCommand(
  value: unknown,
): value is GenerateDeviceKeyPackagesCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['count'])
    && Number.isSafeInteger(candidate.count)
    && Number(candidate.count) >= 1
    && Number(candidate.count) <= 16
}

function parseGeneratedKeyPackages(value: unknown): GeneratedDeviceKeyPackages | null {
  const candidate = record(value)
  if (
    candidate === null
    || !exactKeys(candidate, ['keyPackages', 'revision'])
    || !Array.isArray(candidate.keyPackages)
    || candidate.keyPackages.length < 1
    || candidate.keyPackages.length > 16
    || candidate.keyPackages.some(item => (
      !(item instanceof Uint8Array)
      || item.byteLength === 0
      || item.byteLength > 1024 * 1024
    ))
    || !Number.isSafeInteger(candidate.revision)
    || Number(candidate.revision) <= 0
  ) return null
  return {
    keyPackages: candidate.keyPackages,
    revision: Number(candidate.revision),
  }
}

function parseIdentity(value: unknown): DeviceCryptoIdentity | null {
  const candidate = record(value)
  const identityCommand = candidate === null
    ? null
    : { userId: candidate.userId, deviceId: candidate.deviceId }
  if (
    candidate === null
    || !exactKeys(candidate, [
      'credentialIdentity',
      'deviceId',
      'fingerprint',
      'keyPackage',
      'revision',
      'signaturePublicKey',
      'userId',
    ])
    || !validIdentityCommand(identityCommand)
    || !Number.isSafeInteger(candidate.revision)
    || Number(candidate.revision) <= 0
    || typeof candidate.fingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(candidate.fingerprint)
    || !(candidate.credentialIdentity instanceof Uint8Array)
    || candidate.credentialIdentity.byteLength !== 33
    || !(candidate.signaturePublicKey instanceof Uint8Array)
    || candidate.signaturePublicKey.byteLength !== 32
    || !(candidate.keyPackage instanceof Uint8Array)
    || candidate.keyPackage.byteLength === 0
    || candidate.keyPackage.byteLength > 1024 * 1024
  ) return null
  return {
    userId: identityCommand.userId,
    deviceId: identityCommand.deviceId,
    revision: Number(candidate.revision),
    fingerprint: candidate.fingerprint,
    credentialIdentity: candidate.credentialIdentity,
    signaturePublicKey: candidate.signaturePublicKey,
    keyPackage: candidate.keyPackage,
  }
}

export function parseWorkerRequest(value: unknown): DeviceCryptoWorkerRequest | null {
  const candidate = record(value)
  if (
    candidate === null
    || candidate.version !== PROTOCOL_VERSION
    || !validRequestId(candidate.requestId)
  ) return null

  if (candidate.type === 'checkpoint' || candidate.type === 'dispose') {
    if (!exactKeys(candidate, ['requestId', 'type', 'version'])) return null
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      type: candidate.type,
    }
  }
  if (
    (candidate.type === 'provision' || candidate.type === 'restore')
    && exactKeys(candidate, ['command', 'requestId', 'type', 'version'])
    && validIdentityCommand(candidate.command)
  ) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      type: candidate.type,
      command: candidate.command,
    }
  }
  if (
    candidate.type === 'validate-key-package'
    && exactKeys(candidate, ['command', 'requestId', 'type', 'version'])
    && validKeyPackageCommand(candidate.command)
  ) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      type: candidate.type,
      command: candidate.command,
    }
  }
  if (
    candidate.type === 'generate-key-packages'
    && exactKeys(candidate, ['command', 'requestId', 'type', 'version'])
    && validGenerateKeyPackagesCommand(candidate.command)
  ) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      type: candidate.type,
      command: candidate.command,
    }
  }
  return parseMlsWorkerRequest(value)
}

export function parseWorkerResponse(value: unknown): DeviceCryptoWorkerResponse | null {
  const candidate = record(value)
  if (
    candidate === null
    || candidate.version !== PROTOCOL_VERSION
    || !validRequestId(candidate.requestId)
    || typeof candidate.ok !== 'boolean'
  ) return null

  if (candidate.ok === false) {
    const error = record(candidate.error)
    if (
      !exactKeys(candidate, ['error', 'ok', 'requestId', 'version'])
      || !error
      || !exactKeys(error, ['code'])
      || typeof error.code !== 'string'
      || !ERROR_CODES.has(error.code as DeviceCryptoErrorCode)
    ) {
      return null
    }
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      ok: false,
      error: { code: error.code as DeviceCryptoErrorCode },
    }
  }

  const result = record(candidate.result)
  if (!exactKeys(candidate, ['ok', 'requestId', 'result', 'version'])) return null
  if (result?.disposed === true && exactKeys(result, ['disposed'])) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      ok: true,
      result: { disposed: true },
    }
  }
  if (result?.validated === true && exactKeys(result, ['validated'])) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      ok: true,
      result: { validated: true },
    }
  }
  const generated = parseGeneratedKeyPackages(candidate.result)
  if (generated) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      ok: true,
      result: generated,
    }
  }
  const mlsResult = parseMlsWorkerResult(candidate.result)
  if (mlsResult) {
    return {
      version: PROTOCOL_VERSION,
      requestId: candidate.requestId,
      ok: true,
      result: mlsResult,
    }
  }
  const identity = parseIdentity(candidate.result)
  if (!identity) return null
  return {
    version: PROTOCOL_VERSION,
    requestId: candidate.requestId,
    ok: true,
    result: identity,
  }
}

export function requestEnvelope(
  requestId: string,
  type: 'checkpoint' | 'dispose',
): DeviceCryptoWorkerRequest
export function requestEnvelope(
  requestId: string,
  type: 'provision' | 'restore',
  command: DeviceCryptoIdentityCommand,
): DeviceCryptoWorkerRequest
export function requestEnvelope(
  requestId: string,
  type: 'validate-key-package',
  command: PublicKeyPackageValidationCommand,
): DeviceCryptoWorkerRequest
export function requestEnvelope(
  requestId: string,
  type: 'generate-key-packages',
  command: GenerateDeviceKeyPackagesCommand,
): DeviceCryptoWorkerRequest
export function requestEnvelope(
  requestId: string,
  type: 'checkpoint' | 'dispose' | 'provision' | 'restore' | 'validate-key-package'
    | 'generate-key-packages',
  command?: DeviceCryptoIdentityCommand | PublicKeyPackageValidationCommand
    | GenerateDeviceKeyPackagesCommand,
): DeviceCryptoWorkerRequest {
  if (type === 'provision' || type === 'restore') {
    if (!command || !validIdentityCommand(command)) throw new Error('identity command is required')
    return { version: PROTOCOL_VERSION, requestId, type, command }
  }
  if (type === 'validate-key-package') {
    if (!command || !validKeyPackageCommand(command)) {
      throw new Error('KeyPackage validation command is required')
    }
    return { version: PROTOCOL_VERSION, requestId, type, command }
  }
  if (type === 'generate-key-packages') {
    if (!command || !validGenerateKeyPackagesCommand(command)) {
      throw new Error('KeyPackage generation command is required')
    }
    return { version: PROTOCOL_VERSION, requestId, type, command }
  }
  return { version: PROTOCOL_VERSION, requestId, type }
}

export function successResponse(
  requestId: string,
  result: DeviceCryptoIdentity | PublicKeyPackageValidationResult
    | GeneratedDeviceKeyPackages | MlsWorkerResult
    | { disposed: true },
): DeviceCryptoWorkerResponse {
  return { version: PROTOCOL_VERSION, requestId, ok: true, result }
}

export function errorResponse(
  requestId: string,
  code: DeviceCryptoErrorCode,
): DeviceCryptoWorkerResponse {
  return { version: PROTOCOL_VERSION, requestId, ok: false, error: { code } }
}
