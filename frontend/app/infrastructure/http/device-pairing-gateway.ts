import type { DevicePairingGateway } from '../../application/ports/device-pairing-gateway'
import type {
  CreatedDevicePairing,
  DevicePairingPurpose,
  DevicePairingStatus,
  DevicePairingView,
  DeviceHistoryRelayChunk,
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
    trustedDeviceId: nullableStringField(item, 'trusted_device_id'),
    candidateDeviceId: nullableStringField(item, 'candidate_device_id'),
  }
}

function parseHistoryChunk(value: unknown): DeviceHistoryRelayChunk {
  const item = record(value)
  const serverSequence = item.server_sequence
  if (!Number.isSafeInteger(serverSequence) || Number(serverSequence) <= 0) {
    throw new Error('invalid history chunk sequence')
  }
  return {
    chunkId: stringField(item, 'chunk_id'),
    serverSequence: Number(serverSequence),
    senderDeviceId: stringField(item, 'sender_device_id'),
    targetDeviceId: stringField(item, 'target_device_id'),
    conversationId: stringField(item, 'conversation_id'),
    clientChunkId: stringField(item, 'client_chunk_id'),
    ciphertextBase64: stringField(item, 'ciphertext_base64'),
    createdAt: stringField(item, 'created_at'),
    expiresAt: stringField(item, 'expires_at'),
    acknowledgedAt: nullableStringField(item, 'acknowledged_at'),
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

  async scanExistingOffer(pairingId: string, scanToken: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/scan-existing-offer`,
      { method: 'POST', body: { scan_token: scanToken } },
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

  async existingCandidateStatus(pairingId: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/existing-candidate-status`,
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

  async cancelExistingCandidate(pairingId: string): Promise<DevicePairingView> {
    return parseStatus(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/cancel-existing-candidate`,
      { method: 'POST' },
    ))
  }

  async uploadHistoryChunk(
    pairingId: string,
    targetDeviceId: string,
    conversationId: string,
    clientChunkId: string,
    ciphertextBase64: string,
  ): Promise<DeviceHistoryRelayChunk> {
    return parseHistoryChunk(await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/history-chunks`,
      {
        method: 'POST',
        body: {
          target_device_id: targetDeviceId,
          conversation_id: conversationId,
          client_chunk_id: clientChunkId,
          ciphertext_base64: ciphertextBase64,
        },
      },
    ))
  }

  async listHistoryChunks(pairingId: string): Promise<readonly DeviceHistoryRelayChunk[]> {
    const value = await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/history-chunks`,
    )
    if (!Array.isArray(value)) throw new Error('invalid history chunk page')
    return value.map(parseHistoryChunk)
  }

  async listOutboundHistoryChunks(
    pairingId: string,
  ): Promise<readonly DeviceHistoryRelayChunk[]> {
    const value = await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/history-chunks/outbound`,
    )
    if (!Array.isArray(value)) throw new Error('invalid outbound history chunk page')
    return value.map(parseHistoryChunk)
  }

  async acknowledgeHistoryChunk(pairingId: string, chunkId: string): Promise<void> {
    await this.apiClient.request(
      `/api/v1/device-pairings/${pairingId}/history-chunks/${chunkId}/ack`,
      { method: 'POST' },
    )
  }
}
