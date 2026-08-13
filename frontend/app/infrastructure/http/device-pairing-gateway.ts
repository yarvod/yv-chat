import type { DevicePairingGateway } from '../../application/ports/device-pairing-gateway'
import type {
  CreatedDevicePairing,
  DevicePairingPurpose,
  DevicePairingStatus,
  DevicePairingView,
} from '../../domain/accounts/device-pairing'
import type { ApiClient } from './api-client'
import {
  nullableStringField,
  record,
  stringField,
} from './runtime-parsers'

const purposes = new Set<DevicePairingPurpose>(['enrollment_request', 'enrollment_offer'])
const statuses = new Set<DevicePairingStatus>([
  'created',
  'confirmation_pending',
  'approved',
  'authorized',
  'cancelled',
  'expired',
])

function purposeField(item: Record<string, unknown>): DevicePairingPurpose {
  const purpose = stringField(item, 'purpose') as DevicePairingPurpose
  if (!purposes.has(purpose)) throw new Error('invalid pairing purpose')
  return purpose
}

function parseCreated(value: unknown): CreatedDevicePairing {
  const item = record(value)
  if (item.protocol_version !== 1) throw new Error('invalid pairing version')
  return {
    pairingId: stringField(item, 'pairing_id'),
    protocolVersion: 1,
    purpose: purposeField(item),
    scanToken: stringField(item, 'scan_token'),
    expiresAt: stringField(item, 'expires_at'),
  }
}

function parseStatus(value: unknown): DevicePairingView {
  const item = record(value)
  if (item.protocol_version !== 1) throw new Error('invalid pairing version')
  const status = stringField(item, 'status') as DevicePairingStatus
  if (!statuses.has(status)) throw new Error('invalid pairing status')
  return {
    pairingId: stringField(item, 'pairing_id'),
    protocolVersion: 1,
    purpose: purposeField(item),
    status,
    candidateDeviceName: nullableStringField(item, 'candidate_device_name'),
    trustedDeviceName: nullableStringField(item, 'trusted_device_name'),
    accountDisplayName: nullableStringField(item, 'account_display_name'),
    authenticationCode: nullableStringField(item, 'authentication_code'),
    expiresAt: stringField(item, 'expires_at'),
    authorizedDeviceId: nullableStringField(item, 'authorized_device_id'),
  }
}

export class HttpDevicePairingGateway implements DevicePairingGateway {
  constructor(private readonly apiClient: ApiClient) {}

  async createRequest(
    candidateProofHash: string,
    candidateDeviceName: string,
  ): Promise<CreatedDevicePairing> {
    return parseCreated(await this.apiClient.request('/api/v1/device-pairings/requests', {
      method: 'POST',
      body: {
        candidate_proof_hash: candidateProofHash,
        candidate_device_name: candidateDeviceName,
      },
    }))
  }

  async createOffer(): Promise<CreatedDevicePairing> {
    return parseCreated(await this.apiClient.request('/api/v1/device-pairings/offers', {
      method: 'POST',
    }))
  }

  async scanRequest(pairingId: string, scanToken: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/scan-request`,
      { method: 'POST', body: { scan_token: scanToken } },
    ))
  }

  async scanOffer(
    pairingId: string,
    scanToken: string,
    candidateProofHash: string,
    candidateDeviceName: string,
  ): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/scan-offer`,
      {
        method: 'POST',
        body: {
          scan_token: scanToken,
          candidate_proof_hash: candidateProofHash,
          candidate_device_name: candidateDeviceName,
        },
      },
    ))
  }

  async candidateStatus(pairingId: string, candidateProof: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/candidate-status`,
      { method: 'POST', body: { candidate_proof: candidateProof } },
    ))
  }

  async trustedStatus(pairingId: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/trusted-status`,
    ))
  }

  async approve(pairingId: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/approve`,
      { method: 'POST' },
    ))
  }

  async authorize(pairingId: string, candidateProof: string): Promise<void> {
    await this.apiClient.request(`/api/v1/device-pairings/${pairingId}/authorize`, {
      method: 'POST',
      body: { candidate_proof: candidateProof },
    })
  }

  async cancelCandidate(
    pairingId: string,
    candidateProof: string,
  ): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/cancel-candidate`,
      { method: 'POST', body: { candidate_proof: candidateProof } },
    ))
  }

  async cancelTrusted(pairingId: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/cancel-trusted`,
      { method: 'POST' },
    ))
  }
}
