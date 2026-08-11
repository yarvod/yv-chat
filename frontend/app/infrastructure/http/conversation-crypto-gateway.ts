import { ApplicationError } from '../../application/errors'
import type {
  ConversationCryptoBlockReason,
  ConversationCryptoGateway,
  ConversationCryptoGeneration,
  ConversationCryptoStatus,
  ConversationCryptoWelcome,
  FinalizeConversationCryptoCommand,
  RequiredConversationCryptoDevice,
} from '../../application/ports/conversation-crypto-gateway'
import type { ApiClient } from './api-client'
import { decodeCanonicalBase64, encodeBase64 } from './public-crypto-codec'
import {
  arrayField,
  booleanField,
  integerField,
  nullableStringField,
  record,
  stringField,
} from './runtime-parsers'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX_256_PATTERN = /^[0-9a-f]{64}$/
const MAX_MLS_BYTES = 1_048_576

function invalidResponse(): never {
  throw new ApplicationError(null, 'invalid-response', 'invalid server response')
}

function uuid(value: string): string {
  if (!UUID_PATTERN.test(value)) invalidResponse()
  return value
}

function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) invalidResponse()
  return value
}

function nullableTimestamp(value: string | null): string | null {
  return value === null ? null : timestamp(value)
}

function nullableBytes(value: string | null, expectedBytes?: number): Uint8Array | null {
  if (value === null) return null
  const decoded = decodeCanonicalBase64(value, expectedBytes)
  if (decoded.byteLength > MAX_MLS_BYTES) invalidResponse()
  return decoded
}

function parseRequiredDevice(value: unknown): RequiredConversationCryptoDevice {
  const item = record(value)
  const fingerprint = nullableStringField(item, 'fingerprint')
  const keyPackageRef = nullableStringField(item, 'key_package_ref')
  if (
    (fingerprint !== null && !HEX_256_PATTERN.test(fingerprint))
    || (keyPackageRef !== null && !HEX_256_PATTERN.test(keyPackageRef))
  ) invalidResponse()
  return {
    userId: uuid(stringField(item, 'user_id')),
    deviceId: uuid(stringField(item, 'device_id')),
    isCoordinator: booleanField(item, 'is_coordinator'),
    fingerprint,
    credentialIdentity: nullableBytes(
      nullableStringField(item, 'credential_identity_base64'),
      33,
    ),
    signaturePublicKey: nullableBytes(
      nullableStringField(item, 'signature_public_key_base64'),
      32,
    ),
    keyPackageRef,
    keyPackage: nullableBytes(nullableStringField(item, 'key_package_base64')),
  }
}

function parseWelcome(value: unknown): ConversationCryptoWelcome {
  const item = record(value)
  return {
    targetDeviceId: uuid(stringField(item, 'target_device_id')),
    welcome: nullableBytes(stringField(item, 'welcome_base64')) ?? invalidResponse(),
    createdAt: timestamp(stringField(item, 'created_at')),
    expiresAt: timestamp(stringField(item, 'expires_at')),
    acknowledgedAt: nullableTimestamp(nullableStringField(item, 'acknowledged_at')),
  }
}

function parseStatus(value: string): ConversationCryptoStatus {
  if (value !== 'blocked' && value !== 'pending' && value !== 'ready') invalidResponse()
  return value
}

function parseBlockReason(value: string | null): ConversationCryptoBlockReason | null {
  if (value !== null && value !== 'missing_identity' && value !== 'missing_key_package') {
    invalidResponse()
  }
  return value
}

export function parseConversationCryptoGeneration(value: unknown): ConversationCryptoGeneration {
  const item = record(value)
  const protocolVersion = integerField(item, 'protocol_version')
  if (protocolVersion !== 2) invalidResponse()
  const epochValue = item.epoch
  if (epochValue !== null && (!Number.isSafeInteger(epochValue) || Number(epochValue) <= 0)) {
    invalidResponse()
  }
  const welcomeValue = item.welcome
  if (welcomeValue !== null && (typeof welcomeValue !== 'object' || Array.isArray(welcomeValue))) {
    invalidResponse()
  }
  const requiredDevices = arrayField(item, 'required_devices').map(parseRequiredDevice)
  if (requiredDevices.length === 0 || requiredDevices.length > 200) invalidResponse()
  const coordinatorDeviceId = uuid(stringField(item, 'coordinator_device_id'))
  if (requiredDevices.filter(device => device.isCoordinator).length !== 1) invalidResponse()
  if (!requiredDevices.some(device => (
    device.isCoordinator && device.deviceId === coordinatorDeviceId
  ))) invalidResponse()
  return {
    generationId: uuid(stringField(item, 'generation_id')),
    conversationId: uuid(stringField(item, 'conversation_id')),
    generationNumber: integerField(item, 'generation_number'),
    protocolVersion: 2,
    status: parseStatus(stringField(item, 'status')),
    blockReason: parseBlockReason(nullableStringField(item, 'block_reason')),
    coordinatorDeviceId,
    epoch: epochValue === null ? null : Number(epochValue),
    commit: nullableBytes(nullableStringField(item, 'commit_base64')),
    ratchetTree: nullableBytes(nullableStringField(item, 'ratchet_tree_base64')),
    createdAt: timestamp(stringField(item, 'created_at')),
    updatedAt: timestamp(stringField(item, 'updated_at')),
    readyAt: nullableTimestamp(nullableStringField(item, 'ready_at')),
    requiredDevices,
    welcome: welcomeValue === null ? null : parseWelcome(welcomeValue),
  }
}

function path(conversationId: string): string {
  return `/api/v1/conversations/${uuid(conversationId)}/crypto`
}

export class HttpConversationCryptoGateway implements ConversationCryptoGateway {
  constructor(private readonly api: ApiClient) {}

  async getCurrent(conversationId: string): Promise<ConversationCryptoGeneration | null> {
    try {
      return parseConversationCryptoGeneration(await this.api.request(path(conversationId)))
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 404) return null
      throw error
    }
  }

  async begin(
    conversationId: string,
    bootstrapRequestId: string,
  ): Promise<ConversationCryptoGeneration> {
    return parseConversationCryptoGeneration(await this.api.request(
      `${path(conversationId)}/bootstrap`,
      { method: 'POST', body: { bootstrap_request_id: uuid(bootstrapRequestId) } },
    ))
  }

  async finalize(command: FinalizeConversationCryptoCommand): Promise<ConversationCryptoGeneration> {
    return parseConversationCryptoGeneration(await this.api.request(
      `${path(command.conversationId)}/generations/${uuid(command.generationId)}`,
      {
        method: 'PUT',
        body: {
          epoch: command.epoch,
          commit_base64: encodeBase64(command.commit),
          ratchet_tree_base64: encodeBase64(command.ratchetTree),
          welcomes: command.welcomes.map(item => ({
            target_device_id: uuid(item.targetDeviceId),
            welcome_base64: encodeBase64(item.welcome),
          })),
        },
      },
    ))
  }

  async acknowledgeWelcome(conversationId: string, generationId: string): Promise<void> {
    await this.api.request(
      `${path(conversationId)}/generations/${uuid(generationId)}/welcome-ack`,
      { method: 'POST' },
    )
  }
}
