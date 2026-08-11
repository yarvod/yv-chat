import type { DeviceCryptoErrorCode } from '../../application/device-crypto/errors'
import type {
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
} from '../../application/ports/device-crypto-gateway'

const PROTOCOL_VERSION = 1
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const ERROR_CODES = new Set<DeviceCryptoErrorCode>([
  'conflict',
  'corrupt-state',
  'invalid-request',
  'not-provisioned',
  'operation-failed',
  'rollback',
  'runtime-unavailable',
  'storage-unavailable',
])

interface WorkerRequestBase {
  version: typeof PROTOCOL_VERSION
  requestId: string
}

export type DeviceCryptoWorkerRequest =
  | (WorkerRequestBase & {
      type: 'provision'
      command: DeviceCryptoIdentityCommand
    })
  | (WorkerRequestBase & {
      type: 'restore'
      command: DeviceCryptoIdentityCommand
    })
  | (WorkerRequestBase & { type: 'checkpoint' })
  | (WorkerRequestBase & { type: 'dispose' })

export type DeviceCryptoWorkerResponse =
  | {
      version: typeof PROTOCOL_VERSION
      requestId: string
      ok: true
      result: DeviceCryptoIdentity | { disposed: true }
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
  return null
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
  type: DeviceCryptoWorkerRequest['type'],
  command?: DeviceCryptoIdentityCommand,
): DeviceCryptoWorkerRequest {
  if (type === 'provision' || type === 'restore') {
    if (!command) throw new Error('identity command is required')
    return { version: PROTOCOL_VERSION, requestId, type, command }
  }
  return { version: PROTOCOL_VERSION, requestId, type }
}

export function successResponse(
  requestId: string,
  result: DeviceCryptoIdentity | { disposed: true },
): DeviceCryptoWorkerResponse {
  return { version: PROTOCOL_VERSION, requestId, ok: true, result }
}

export function errorResponse(
  requestId: string,
  code: DeviceCryptoErrorCode,
): DeviceCryptoWorkerResponse {
  return { version: PROTOCOL_VERSION, requestId, ok: false, error: { code } }
}
