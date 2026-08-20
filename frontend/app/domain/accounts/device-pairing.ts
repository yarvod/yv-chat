export type DevicePairingPurpose = 'enrollment_request' | 'enrollment_offer'
export type DevicePairingStatus =
  | 'created'
  | 'confirmation_pending'
  | 'approved'
  | 'authorized'
  | 'cancelled'
  | 'expired'

export interface CreatedDevicePairing {
  pairingId: string
  protocolVersion: 1
  purpose: DevicePairingPurpose
  scanToken: string
  expiresAt: string
}

export interface DevicePairingView {
  pairingId: string
  protocolVersion: 1
  purpose: DevicePairingPurpose
  status: DevicePairingStatus
  candidateDeviceName: string | null
  trustedDeviceName: string | null
  accountDisplayName: string | null
  authenticationCode: string | null
  expiresAt: string
  authorizedDeviceId: string | null
  trustedDeviceId: string | null
  candidateDeviceId: string | null
}

export interface DeviceHistoryRelayChunk {
  chunkId: string
  serverSequence: number
  senderDeviceId: string
  targetDeviceId: string
  conversationId: string
  clientChunkId: string
  ciphertextBase64: string
  createdAt: string
  expiresAt: string
  acknowledgedAt: string | null
}

export interface DevicePairingQrPayload {
  type: 'yv-chat-device-pairing'
  origin: string
  version: 1
  purpose: DevicePairingPurpose
  pairingId: string
  scanToken: string
  expiresAt: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function encodePairingQr(created: CreatedDevicePairing, origin: string): string {
  const payload: DevicePairingQrPayload = {
    type: 'yv-chat-device-pairing',
    origin,
    version: 1,
    purpose: created.purpose,
    pairingId: created.pairingId,
    scanToken: created.scanToken,
    expiresAt: created.expiresAt,
  }
  return JSON.stringify(payload)
}

export function decodePairingQr(
  raw: string,
  expectedOrigins: string | readonly string[],
): DevicePairingQrPayload {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('invalid pairing QR')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid pairing QR')
  }
  const item = value as Record<string, unknown>
  const purpose = item.purpose
  const trustedOrigins = typeof expectedOrigins === 'string'
    ? new Set([expectedOrigins])
    : new Set(expectedOrigins)
  if (
    item.type !== 'yv-chat-device-pairing'
    || typeof item.origin !== 'string'
    || !trustedOrigins.has(item.origin)
    || item.version !== 1
    || (purpose !== 'enrollment_request' && purpose !== 'enrollment_offer')
    || typeof item.pairingId !== 'string'
    || !uuidPattern.test(item.pairingId)
    || typeof item.scanToken !== 'string'
    || item.scanToken.length < 32
    || item.scanToken.length > 128
    || typeof item.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(item.expiresAt))
    || Date.parse(item.expiresAt) <= Date.now()
  ) {
    throw new Error('invalid pairing QR')
  }
  return {
    type: 'yv-chat-device-pairing',
    origin: item.origin,
    version: 1,
    purpose,
    pairingId: item.pairingId,
    scanToken: item.scanToken,
    expiresAt: item.expiresAt,
  }
}
