/** Closed structured-clone contract for MLS operations inside the crypto Worker. */

import type {
  BootstrapMlsConversationCommand,
  BootstrapMlsConversationResult,
  ApplyMlsCommitCommand,
  JoinMlsConversationCommand,
  MlsConversationStateResult,
  ProtectMlsMessageCommand,
  ProtectMlsMessageResult,
  UnprotectMlsMessageCommand,
  UnprotectMlsMessageResult,
  UpdateMlsConversationCommand,
  UpdateMlsConversationResult,
} from '../../application/ports/mls-conversation-gateway'

const PROTOCOL_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_WIRE_BYTES = 1024 * 1024
const MAX_APPLICATION_BYTES = 256 * 1024
const MAX_ADD_MEMBERS = 49

interface WorkerRequestBase {
  version: typeof PROTOCOL_VERSION
  requestId: string
}

export type MlsWorkerRequest =
  | (WorkerRequestBase & { type: 'mls-bootstrap', command: BootstrapMlsConversationCommand })
  | (WorkerRequestBase & { type: 'mls-join', command: JoinMlsConversationCommand })
  | (WorkerRequestBase & { type: 'mls-update', command: UpdateMlsConversationCommand })
  | (WorkerRequestBase & { type: 'mls-apply-commit', command: ApplyMlsCommitCommand })
  | (WorkerRequestBase & { type: 'mls-protect', command: ProtectMlsMessageCommand })
  | (WorkerRequestBase & { type: 'mls-unprotect', command: UnprotectMlsMessageCommand })

export type MlsWorkerResult =
  | BootstrapMlsConversationResult
  | MlsConversationStateResult
  | ProtectMlsMessageResult
  | UnprotectMlsMessageResult
  | UpdateMlsConversationResult

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function validBytes(value: unknown, maximum: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= maximum
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function validBootstrapCommand(value: unknown): value is BootstrapMlsConversationCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['conversationId', 'keyPackages'])
    && validUuid(candidate.conversationId)
    && Array.isArray(candidate.keyPackages)
    && candidate.keyPackages.length > 0
    && candidate.keyPackages.length <= MAX_ADD_MEMBERS
    && candidate.keyPackages.every(item => validBytes(item, MAX_WIRE_BYTES))
}

function validJoinCommand(value: unknown): value is JoinMlsConversationCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['conversationId', 'ratchetTree', 'welcome'])
    && validUuid(candidate.conversationId)
    && validBytes(candidate.welcome, MAX_WIRE_BYTES)
    && validBytes(candidate.ratchetTree, MAX_WIRE_BYTES)
}

function validRoster(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= MAX_ADD_MEMBERS + 1
    && value.every(validUuid)
    && new Set(value).size === value.length
}

function validUpdateCommand(value: unknown): value is UpdateMlsConversationCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['conversationId', 'desiredDeviceIds', 'keyPackages'])
    && validUuid(candidate.conversationId)
    && validRoster(candidate.desiredDeviceIds)
    && Array.isArray(candidate.keyPackages)
    && candidate.keyPackages.length <= MAX_ADD_MEMBERS
    && candidate.keyPackages.every(item => validBytes(item, MAX_WIRE_BYTES))
}

function validApplyCommitCommand(value: unknown): value is ApplyMlsCommitCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['commit', 'conversationId', 'desiredDeviceIds'])
    && validUuid(candidate.conversationId)
    && validRoster(candidate.desiredDeviceIds)
    && validBytes(candidate.commit, MAX_WIRE_BYTES)
}

function validProtectCommand(value: unknown): value is ProtectMlsMessageCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['clientMessageId', 'conversationId', 'plaintext'])
    && validUuid(candidate.conversationId)
    && validUuid(candidate.clientMessageId)
    && validBytes(candidate.plaintext, MAX_APPLICATION_BYTES)
}

function validUnprotectCommand(value: unknown): value is UnprotectMlsMessageCommand {
  const candidate = record(value)
  return candidate !== null
    && exactKeys(candidate, ['ciphertext', 'clientMessageId', 'conversationId'])
    && validUuid(candidate.conversationId)
    && validUuid(candidate.clientMessageId)
    && validBytes(candidate.ciphertext, MAX_WIRE_BYTES)
}

export function parseMlsWorkerRequest(value: unknown): MlsWorkerRequest | null {
  const candidate = record(value)
  if (
    candidate === null
    || candidate.version !== PROTOCOL_VERSION
    || !validUuid(candidate.requestId)
    || !exactKeys(candidate, ['command', 'requestId', 'type', 'version'])
  ) return null
  if (candidate.type === 'mls-bootstrap' && validBootstrapCommand(candidate.command)) {
    return { version: PROTOCOL_VERSION, requestId: candidate.requestId, type: candidate.type, command: candidate.command }
  }
  if (candidate.type === 'mls-join' && validJoinCommand(candidate.command)) {
    return { version: PROTOCOL_VERSION, requestId: candidate.requestId, type: candidate.type, command: candidate.command }
  }
  if (candidate.type === 'mls-update' && validUpdateCommand(candidate.command)) {
    return { version: PROTOCOL_VERSION, requestId: candidate.requestId, type: candidate.type, command: candidate.command }
  }
  if (candidate.type === 'mls-apply-commit' && validApplyCommitCommand(candidate.command)) {
    return { version: PROTOCOL_VERSION, requestId: candidate.requestId, type: candidate.type, command: candidate.command }
  }
  if (candidate.type === 'mls-protect' && validProtectCommand(candidate.command)) {
    return { version: PROTOCOL_VERSION, requestId: candidate.requestId, type: candidate.type, command: candidate.command }
  }
  if (candidate.type === 'mls-unprotect' && validUnprotectCommand(candidate.command)) {
    return { version: PROTOCOL_VERSION, requestId: candidate.requestId, type: candidate.type, command: candidate.command }
  }
  return null
}

export function parseMlsWorkerResult(value: unknown): MlsWorkerResult | null {
  const candidate = record(value)
  if (candidate === null || !validRevision(candidate.revision)) return null
  if (
    exactKeys(candidate, ['commit', 'epoch', 'ratchetTree', 'revision', 'welcome'])
    && validEpoch(candidate.epoch)
    && validBytes(candidate.commit, MAX_WIRE_BYTES)
    && validBytes(candidate.welcome, MAX_WIRE_BYTES)
    && validBytes(candidate.ratchetTree, MAX_WIRE_BYTES)
  ) return candidate as unknown as BootstrapMlsConversationResult
  if (
    exactKeys(candidate, ['commit', 'epoch', 'ratchetTree', 'revision', 'welcome'])
    && validEpoch(candidate.epoch)
    && validBytes(candidate.commit, MAX_WIRE_BYTES)
    && candidate.welcome === null
    && validBytes(candidate.ratchetTree, MAX_WIRE_BYTES)
  ) return candidate as unknown as UpdateMlsConversationResult
  if (
    exactKeys(candidate, ['ciphertext', 'epoch', 'revision'])
    && validEpoch(candidate.epoch)
    && validBytes(candidate.ciphertext, MAX_WIRE_BYTES)
  ) return candidate as unknown as ProtectMlsMessageResult
  if (
    exactKeys(candidate, ['epoch', 'revision'])
    && validEpoch(candidate.epoch)
  ) return candidate as unknown as MlsConversationStateResult
  if (
    exactKeys(candidate, ['plaintext', 'revision'])
    && validBytes(candidate.plaintext, MAX_APPLICATION_BYTES)
  ) return candidate as unknown as UnprotectMlsMessageResult
  return null
}

export function mlsRequestEnvelope(
  requestId: string,
  type: MlsWorkerRequest['type'],
  command: BootstrapMlsConversationCommand | JoinMlsConversationCommand
    | UpdateMlsConversationCommand | ApplyMlsCommitCommand
    | ProtectMlsMessageCommand | UnprotectMlsMessageCommand,
): MlsWorkerRequest {
  const candidate = { version: PROTOCOL_VERSION, requestId, type, command }
  const parsed = parseMlsWorkerRequest(candidate)
  if (!parsed) throw new Error('invalid MLS Worker request')
  return parsed
}

export function mlsResultTransferables(result: MlsWorkerResult): ArrayBuffer[] {
  let bytes: Uint8Array[]
  if ('commit' in result) {
    bytes = [result.commit, result.ratchetTree]
    if (result.welcome !== null) bytes.push(result.welcome)
  } else if ('ciphertext' in result) bytes = [result.ciphertext]
  else if ('plaintext' in result) bytes = [result.plaintext]
  else bytes = []
  return bytes
    .map(item => item.buffer)
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
}
