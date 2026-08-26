import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DevicePairingService } from '../app/application/accounts/device-pairing'
import type { AuthGateway } from '../app/application/ports/auth-gateway'
import type { DeviceInfoPort } from '../app/application/ports/device-info'
import type { DevicePairingGateway } from '../app/application/ports/device-pairing-gateway'
import type { DevicePairingSecretStore } from '../app/application/ports/device-pairing-secrets'
import type { CurrentAccount } from '../app/domain/accounts/account'
import { parseTrustedDevicePairingOrigins } from '../app/infrastructure/browser/device-pairing-origins'
import {
  decodePairingQr,
  encodePairingQr,
  type CreatedDevicePairing,
  type DevicePairingView,
} from '../app/domain/accounts/device-pairing'

const origin = 'https://chat.example'
const aliasOrigin = 'https://chat-alias.example'
const androidOrigin = 'https://app.yvchat.local'
const iosOrigin = 'capacitor://app.yvchat.local'
const future = '2099-08-13T10:10:00Z'
const pairingId = '7f0551de-b774-4a47-9f1f-7bead64062fe'
const scanToken = 'scan-token-with-at-least-thirty-two-random-bytes'
const proof = 'candidate-proof-with-at-least-thirty-two-random-bytes'
const digest = 'a'.repeat(64)

function created(purpose: CreatedDevicePairing['purpose']): CreatedDevicePairing {
  return { pairingId, protocolVersion: 1, purpose, scanToken, expiresAt: future }
}

function view(purpose: CreatedDevicePairing['purpose'], status = 'confirmation_pending'): DevicePairingView {
  return {
    pairingId,
    protocolVersion: 1,
    purpose,
    status: status as DevicePairingView['status'],
    candidateDeviceName: 'New PWA',
    trustedDeviceName: 'Trusted phone',
    accountDisplayName: 'Alice',
    authenticationCode: '123456',
    expiresAt: future,
    authorizedDeviceId: null,
    trustedDeviceId: 'trusted-device',
    candidateDeviceId: null,
  }
}

class FakeSecrets implements DevicePairingSecretStore {
  readonly values = new Map<string, string>()

  async create() {
    return { secret: proof, digest }
  }

  async digest(value: string): Promise<string> {
    expect(value).toBe(proof)
    return digest
  }

  save(id: string, value: string): void {
    this.values.set(id, value)
  }

  load(id: string): string | null {
    return this.values.get(id) ?? null
  }

  remove(id: string): void {
    this.values.delete(id)
  }
}

class FakeGateway implements DevicePairingGateway {
  scannedRequest: [string, string] | null = null
  scannedOffer: [string, string, string, string] | null = null
  scannedExistingOffer: [string, string] | null = null
  authorized: [string, string] | null = null

  async createRequest(candidateProofHash: string, candidateDeviceName: string) {
    expect(candidateProofHash).toBe(digest)
    expect(candidateDeviceName).toBe('Safari · iOS · Телефон')
    return created('enrollment_request')
  }

  async createOffer() {
    return created('enrollment_offer')
  }

  async scanRequest(id: string, token: string) {
    this.scannedRequest = [id, token]
    return view('enrollment_request')
  }

  async scanOffer(id: string, token: string, candidateProofHash: string, name: string) {
    this.scannedOffer = [id, token, candidateProofHash, name]
    return view('enrollment_offer')
  }

  async scanExistingOffer(id: string, token: string) {
    this.scannedExistingOffer = [id, token]
    return { ...view('enrollment_offer'), candidateDeviceId: 'existing-device' }
  }

  async candidateStatus() { return view('enrollment_request') }
  async trustedStatus() { return view('enrollment_offer') }
  async existingCandidateStatus() { return view('enrollment_offer') }
  async approve() { return view('enrollment_offer', 'approved') }
  async cancelCandidate() { return view('enrollment_request', 'cancelled') }
  async cancelTrusted() { return view('enrollment_offer', 'cancelled') }
  async cancelExistingCandidate() { return view('enrollment_offer', 'cancelled') }
  async uploadHistoryChunk() { throw new Error('not used') }
  async listHistoryChunks() { return [] }
  async listOutboundHistoryChunks() { return [] }
  async acknowledgeHistoryChunk() { return undefined }

  async authorize(id: string, candidateProof: string): Promise<void> {
    this.authorized = [id, candidateProof]
  }
}

const account: CurrentAccount = {
  userId: 'user',
  deviceId: 'device',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  createdAt: future,
  updatedAt: future,
}

const defaultAuthGateway: AuthGateway = {
  current: async () => account,
  login: async () => account,
  logout: async () => undefined,
}

function service(
  gateway = new FakeGateway(),
  secrets = new FakeSecrets(),
  authGateway: AuthGateway = defaultAuthGateway,
  trustedQrOrigins: readonly string[] = [origin],
) {
  const deviceInfo: DeviceInfoPort = {
    current: () => ({
      label: 'Safari · iOS · Телефон',
      browser: 'Safari',
      operatingSystem: 'iOS',
      deviceClass: 'mobile',
    }),
  }
  return {
    pairing: new DevicePairingService(
      gateway,
      secrets,
      authGateway,
      deviceInfo,
      origin,
      trustedQrOrigins,
    ),
    gateway,
    secrets,
  }
}

describe('device pairing', () => {
  it('derives an exact fail-closed QR origin allowlist from deployment config', () => {
    expect(parseTrustedDevicePairingOrigins(
      JSON.stringify([origin, aliasOrigin]),
      origin,
    )).toEqual([origin, aliasOrigin])
    expect(parseTrustedDevicePairingOrigins([origin, `${aliasOrigin}/path`], origin)).toEqual([
      origin,
    ])
    expect(parseTrustedDevicePairingOrigins(JSON.stringify([aliasOrigin]), origin)).toEqual([
      origin,
    ])
    expect(parseTrustedDevicePairingOrigins('{broken', origin)).toEqual([origin])
    expect(parseTrustedDevicePairingOrigins(
      JSON.stringify([origin, androidOrigin, iosOrigin]),
      iosOrigin,
    )).toEqual([origin, androidOrigin, iosOrigin])
    expect(parseTrustedDevicePairingOrigins(
      [iosOrigin, `${iosOrigin}/path`],
      iosOrigin,
    )).toEqual([iosOrigin])

    const config = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8')
    const localCompose = readFileSync(resolve(process.cwd(), '../compose.yml'), 'utf8')
    const compose = readFileSync(resolve(process.cwd(), '../compose.prod.yml'), 'utf8')
    expect(config).toContain('defaultDevicePairingOrigins')
    expect(config).toContain('https://chat.yoowee.ru')
    expect(config).toContain('https://chat.yoowee.com.de')
    expect(dockerfile).toContain('https://chat.yoowee.ru')
    expect(dockerfile).toContain('https://chat.yoowee.com.de')
    expect(localCompose).toContain('NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS:')
    expect(localCompose).toContain('args:')
    expect(localCompose).toContain("NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS: '${ALLOWED_ORIGINS")
    expect(compose).toContain("NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS: '${ALLOWED_ORIGINS")
    expect(compose).toContain(androidOrigin)
    expect(compose).toContain(iosOrigin)
  })

  it('keeps candidate proof out of the QR and rejects another origin', async () => {
    const { pairing, secrets } = service()
    const displayed = await pairing.createRequest()

    expect(displayed.qrValue).not.toContain(proof)
    expect(displayed.qrValue).not.toContain(digest)
    expect(secrets.load(pairingId)).toBe(proof)
    expect(decodePairingQr(displayed.qrValue, origin).purpose).toBe('enrollment_request')
    expect(() => decodePairingQr(displayed.qrValue, 'https://evil.example')).toThrow()
  })

  it('routes all three phone-scans-computer cases across trusted origins', async () => {
    const { pairing, gateway, secrets } = service(
      new FakeGateway(),
      new FakeSecrets(),
      defaultAuthGateway,
      [origin, aliasOrigin],
    )
    const requestQr = encodePairingQr(created('enrollment_request'), aliasOrigin)
    await expect(pairing.scan(requestQr, false)).rejects.toThrow('trusted session')
    await pairing.scan(requestQr, true)
    expect(gateway.scannedRequest).toEqual([pairingId, scanToken])

    const offerQr = encodePairingQr(created('enrollment_offer'), aliasOrigin)
    await pairing.scan(offerQr, false)
    expect(gateway.scannedOffer).toEqual([
      pairingId,
      scanToken,
      digest,
      'Safari · iOS · Телефон',
    ])
    expect(secrets.load(pairingId)).toBe(proof)

    const existing = await pairing.scan(offerQr, true)
    expect(gateway.scannedExistingOffer).toEqual([pairingId, scanToken])
    expect(existing.candidateDeviceId).toBe('existing-device')

    const untrustedQr = encodePairingQr(created('enrollment_request'), 'https://evil.example')
    await expect(pairing.scan(untrustedQr, true)).rejects.toThrow('invalid pairing QR')
  })

  it('clears candidate proof only after cookie exchange and current-account load', async () => {
    const gateway = new FakeGateway()
    const secrets = new FakeSecrets()
    secrets.save(pairingId, proof)
    let failCurrent = true
    const authGateway: AuthGateway = {
      current: async () => {
        if (failCurrent) throw new Error('network')
        return account
      },
      login: async () => account,
      logout: async () => undefined,
    }
    const { pairing } = service(gateway, secrets, authGateway)

    await expect(pairing.authorize(pairingId)).rejects.toThrow('network')
    expect(secrets.load(pairingId)).toBe(proof)
    failCurrent = false
    expect(await pairing.authorize(pairingId)).toEqual({
      account,
      pairing: view('enrollment_request'),
    })
    expect(gateway.authorized).toEqual([pairingId, proof])
    expect(secrets.load(pairingId)).toBeNull()
  })
})
