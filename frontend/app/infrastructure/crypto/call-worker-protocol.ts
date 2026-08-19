import type {
  CallBindingCommand,
  CallBindingSignatureResult,
  CallBindingVerificationResult,
  CallVerificationCodeCommand,
  CallVerificationCodeResult,
} from '../../application/ports/call-identity-gateway'

const PROTOCOL_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface BaseRequest {
  version: typeof PROTOCOL_VERSION
  requestId: string
}

export type CallWorkerRequest =
  | (BaseRequest & { type: 'call-sign', command: CallBindingCommand })
  | (BaseRequest & {
      type: 'call-verify'
      command: CallBindingCommand & { signature: Uint8Array }
    })
  | (BaseRequest & { type: 'call-code', command: CallVerificationCodeCommand })

export type CallWorkerResult = CallBindingSignatureResult
  | CallBindingVerificationResult | CallVerificationCodeResult

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function validBinding(value: unknown, signature: boolean): value is CallBindingCommand & {
  signature: Uint8Array
} {
  const item = record(value)
  const keys = [
    'callId', 'calleeDeviceId', 'calleeUserId', 'callerDeviceId', 'callerUserId',
    'conversationId', 'role', 'sdp', ...(signature ? ['signature'] : []),
  ]
  if (
    !item
    || !exactKeys(item, keys)
    || (item.role !== 'offer' && item.role !== 'answer')
    || typeof item.conversationId !== 'string' || !UUID_PATTERN.test(item.conversationId)
    || typeof item.callId !== 'string' || !UUID_PATTERN.test(item.callId)
    || typeof item.callerUserId !== 'string' || !UUID_PATTERN.test(item.callerUserId)
    || typeof item.callerDeviceId !== 'string' || !UUID_PATTERN.test(item.callerDeviceId)
    || typeof item.calleeUserId !== 'string' || !UUID_PATTERN.test(item.calleeUserId)
    || typeof item.sdp !== 'string' || item.sdp.length === 0 || item.sdp.length > 65_536
    || (item.role === 'offer' && item.calleeDeviceId !== null)
    || (item.role === 'answer' && (
      typeof item.calleeDeviceId !== 'string' || !UUID_PATTERN.test(item.calleeDeviceId)
    ))
    || (signature && (
      !(item.signature instanceof Uint8Array) || item.signature.byteLength !== 64
    ))
  ) return false
  return true
}

function validCode(value: unknown): value is CallVerificationCodeCommand {
  const item = record(value)
  if (!item || !exactKeys(item, [
    'answerSdp', 'answerSignature', 'callId', 'calleeDeviceId', 'calleeUserId',
    'callerDeviceId', 'callerUserId', 'conversationId', 'offerSdp', 'offerSignature',
  ])) return false
  return [
    item.conversationId, item.callId, item.callerUserId, item.callerDeviceId,
    item.calleeUserId, item.calleeDeviceId,
  ].every(value => typeof value === 'string' && UUID_PATTERN.test(value))
    && typeof item.offerSdp === 'string' && item.offerSdp.length > 0
    && item.offerSdp.length <= 65_536
    && typeof item.answerSdp === 'string' && item.answerSdp.length > 0
    && item.answerSdp.length <= 65_536
    && item.offerSignature instanceof Uint8Array && item.offerSignature.byteLength === 64
    && item.answerSignature instanceof Uint8Array && item.answerSignature.byteLength === 64
}

export function parseCallWorkerRequest(value: unknown): CallWorkerRequest | null {
  const item = record(value)
  if (
    !item || item.version !== PROTOCOL_VERSION
    || typeof item.requestId !== 'string' || !UUID_PATTERN.test(item.requestId)
    || !exactKeys(item, ['command', 'requestId', 'type', 'version'])
  ) return null
  if (item.type === 'call-sign' && validBinding(item.command, false)) {
    return { version: PROTOCOL_VERSION, requestId: item.requestId, type: item.type, command: item.command }
  }
  if (item.type === 'call-verify' && validBinding(item.command, true)) {
    return { version: PROTOCOL_VERSION, requestId: item.requestId, type: item.type, command: item.command }
  }
  if (item.type === 'call-code' && validCode(item.command)) {
    return { version: PROTOCOL_VERSION, requestId: item.requestId, type: item.type, command: item.command }
  }
  return null
}

export function parseCallWorkerResult(value: unknown): CallWorkerResult | null {
  const item = record(value)
  if (item?.signature instanceof Uint8Array
    && item.signature.byteLength === 64 && exactKeys(item, ['signature'])) {
    return { signature: item.signature }
  }
  if (item?.verified === true && exactKeys(item, ['verified'])) return { verified: true }
  if (typeof item?.code === 'string' && /^\d{4} \d{4} \d{4}$/.test(item.code)
    && exactKeys(item, ['code'])) return { code: item.code }
  return null
}

export function callRequestEnvelope(
  requestId: string,
  type: CallWorkerRequest['type'],
  command: CallBindingCommand | (CallBindingCommand & { signature: Uint8Array })
    | CallVerificationCodeCommand,
): CallWorkerRequest {
  return { version: PROTOCOL_VERSION, requestId, type, command } as CallWorkerRequest
}

export function callResultTransferables(result: CallWorkerResult): Transferable[] {
  return 'signature' in result ? [result.signature.buffer] : []
}
