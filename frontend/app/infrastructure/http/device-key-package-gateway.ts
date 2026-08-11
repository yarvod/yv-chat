import { ApplicationError } from '../../application/errors'
import type {
  ClaimedDeviceKeyPackage,
  ClaimDeviceKeyPackageInput,
  DeviceKeyPackageGateway,
  DeviceKeyPackageInventory,
  ReplenishedDeviceKeyPackages,
} from '../../application/ports/device-key-package-gateway'
import type { ApiClient } from './api-client'
import { decodeCanonicalBase64, encodeBase64 } from './public-crypto-codec'
import { integerField, record, stringField } from './runtime-parsers'

const INVENTORY_PATH = '/api/v1/devices/current/key-packages'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX_256_PATTERN = /^[0-9a-f]{64}$/
const MAX_KEY_PACKAGE_BYTES = 1_048_576

function validatedUuid(item: Record<string, unknown>, name: string): string {
  const value = stringField(item, name)
  if (!UUID_PATTERN.test(value)) throw invalidResponse()
  return value
}

function parseInventory(value: unknown): DeviceKeyPackageInventory {
  const item = record(value)
  return {
    deviceId: validatedUuid(item, 'device_id'),
    availableCount: integerField(item, 'available_count'),
  }
}

function parseReplenished(value: unknown): ReplenishedDeviceKeyPackages {
  return {
    ...parseInventory(value),
    addedCount: integerField(record(value), 'added_count'),
  }
}

function parseClaimed(value: unknown): ClaimedDeviceKeyPackage {
  const item = record(value)
  const protocolVersion = integerField(item, 'protocol_version')
  const fingerprint = stringField(item, 'fingerprint')
  const packageRef = stringField(item, 'package_ref')
  const claimedAt = stringField(item, 'claimed_at')
  const keyPackage = decodeCanonicalBase64(stringField(item, 'key_package_base64'))
  if (
    protocolVersion !== 2
    || !HEX_256_PATTERN.test(fingerprint)
    || !HEX_256_PATTERN.test(packageRef)
    || Number.isNaN(Date.parse(claimedAt))
    || keyPackage.byteLength > MAX_KEY_PACKAGE_BYTES
  ) throw invalidResponse()
  return {
    conversationId: validatedUuid(item, 'conversation_id'),
    claimRequestId: validatedUuid(item, 'claim_request_id'),
    targetDeviceId: validatedUuid(item, 'target_device_id'),
    targetUserId: validatedUuid(item, 'target_user_id'),
    protocolVersion: 2,
    credentialIdentity: decodeCanonicalBase64(
      stringField(item, 'credential_identity_base64'),
      33,
    ),
    signaturePublicKey: decodeCanonicalBase64(
      stringField(item, 'signature_public_key_base64'),
      32,
    ),
    fingerprint,
    packageRef,
    keyPackage,
    claimedAt,
  }
}

export class HttpDeviceKeyPackageGateway implements DeviceKeyPackageGateway {
  constructor(private readonly api: ApiClient) {}

  async listInventory(): Promise<DeviceKeyPackageInventory> {
    return parseInventory(await this.api.request(INVENTORY_PATH))
  }

  async replenish(
    keyPackages: readonly Uint8Array[],
  ): Promise<ReplenishedDeviceKeyPackages> {
    return parseReplenished(await this.api.request(INVENTORY_PATH, {
      method: 'POST',
      body: { key_packages_base64: keyPackages.map(encodeBase64) },
    }))
  }

  async claim(input: ClaimDeviceKeyPackageInput): Promise<ClaimedDeviceKeyPackage> {
    return parseClaimed(await this.api.request(
      `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/key-package-claims`,
      {
        method: 'POST',
        body: {
          target_device_id: input.targetDeviceId,
          claim_request_id: input.claimRequestId,
        },
      },
    ))
  }
}

function invalidResponse(): ApplicationError {
  return new ApplicationError(null, 'invalid-response', 'invalid server response')
}
