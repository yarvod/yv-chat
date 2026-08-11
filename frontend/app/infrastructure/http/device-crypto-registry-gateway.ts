import { ApplicationError } from '../../application/errors'
import type {
  DeviceCryptoRegistryGateway,
  RegisteredDeviceCryptoIdentity,
} from '../../application/ports/device-crypto-registry-gateway'
import type { DeviceCryptoIdentity } from '../../application/ports/device-crypto-gateway'
import type { ApiClient } from './api-client'
import { decodeCanonicalBase64, encodeBase64 } from './public-crypto-codec'
import {
  integerField,
  record,
  stringField,
} from './runtime-parsers'

const PATH = '/api/v1/devices/current/crypto-identity'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX_256_PATTERN = /^[0-9a-f]{64}$/

function parseRegistration(value: unknown): RegisteredDeviceCryptoIdentity {
  const item = record(value)
  const userId = stringField(item, 'user_id')
  const deviceId = stringField(item, 'device_id')
  const protocolVersion = integerField(item, 'protocol_version')
  const fingerprint = stringField(item, 'fingerprint')
  const initialKeyPackageRef = stringField(item, 'initial_key_package_ref')
  const createdAt = stringField(item, 'created_at')
  if (
    !UUID_PATTERN.test(userId)
    || !UUID_PATTERN.test(deviceId)
    || protocolVersion !== 2
    || !HEX_256_PATTERN.test(fingerprint)
    || !HEX_256_PATTERN.test(initialKeyPackageRef)
    || Number.isNaN(Date.parse(createdAt))
  ) throw new ApplicationError(null, 'invalid-response', 'invalid server response')
  return {
    userId,
    deviceId,
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
    initialKeyPackageRef,
    createdAt,
  }
}

export class HttpDeviceCryptoRegistryGateway implements DeviceCryptoRegistryGateway {
  constructor(private readonly api: ApiClient) {}

  async getCurrent(): Promise<RegisteredDeviceCryptoIdentity | null> {
    try {
      return parseRegistration(await this.api.request(PATH))
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 404) return null
      throw error
    }
  }

  async register(identity: DeviceCryptoIdentity): Promise<RegisteredDeviceCryptoIdentity> {
    return parseRegistration(await this.api.request(PATH, {
      method: 'PUT',
      body: {
        credential_identity_base64: encodeBase64(identity.credentialIdentity),
        signature_public_key_base64: encodeBase64(identity.signaturePublicKey),
        key_package_base64: encodeBase64(identity.keyPackage),
      },
    }))
  }
}
