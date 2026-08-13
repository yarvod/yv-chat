import type { CurrentAccount } from '../../domain/accounts/account'
import {
  decodePairingQr,
  encodePairingQr,
  type CreatedDevicePairing,
  type DevicePairingView,
} from '../../domain/accounts/device-pairing'
import type { AuthGateway } from '../ports/auth-gateway'
import type { DeviceInfoPort } from '../ports/device-info'
import type { DevicePairingGateway } from '../ports/device-pairing-gateway'
import type { DevicePairingSecretStore } from '../ports/device-pairing-secrets'

export interface DisplayedPairing {
  created: CreatedDevicePairing
  qrValue: string
}

export interface AuthorizedDevicePairing {
  account: CurrentAccount
  pairing: DevicePairingView
}

export class DevicePairingService {
  constructor(
    private readonly gateway: DevicePairingGateway,
    private readonly secrets: DevicePairingSecretStore,
    private readonly authGateway: AuthGateway,
    private readonly deviceInfo: DeviceInfoPort,
    private readonly origin: string,
  ) {}

  async createRequest(): Promise<DisplayedPairing> {
    const proof = await this.secrets.create()
    const created = await this.gateway.createRequest(
      proof.digest,
      this.deviceInfo.current().label,
    )
    this.secrets.save(created.pairingId, proof.secret)
    return { created, qrValue: encodePairingQr(created, this.origin) }
  }

  async createOffer(): Promise<DisplayedPairing> {
    const created = await this.gateway.createOffer()
    return { created, qrValue: encodePairingQr(created, this.origin) }
  }

  async scan(raw: string, authenticated: boolean): Promise<DevicePairingView> {
    const qr = decodePairingQr(raw, this.origin)
    if (qr.purpose === 'enrollment_request') {
      if (!authenticated) throw new Error('trusted session required')
      return await this.gateway.scanRequest(qr.pairingId, qr.scanToken)
    }
    if (authenticated) throw new Error('candidate phone must use the login screen')
    const existingProof = this.secrets.load(qr.pairingId)
    const proof = existingProof
      ? { secret: existingProof, digest: await this.secrets.digest(existingProof) }
      : await this.secrets.create()
    this.secrets.save(qr.pairingId, proof.secret)
    return await this.gateway.scanOffer(
      qr.pairingId,
      qr.scanToken,
      proof.digest,
      this.deviceInfo.current().label,
    )
  }

  async candidateStatus(pairingId: string): Promise<DevicePairingView> {
    const proof = this.requireProof(pairingId)
    return await this.gateway.candidateStatus(pairingId, proof)
  }

  trustedStatus(pairingId: string): Promise<DevicePairingView> {
    return this.gateway.trustedStatus(pairingId)
  }

  approve(pairingId: string): Promise<DevicePairingView> {
    return this.gateway.approve(pairingId)
  }

  async authorize(pairingId: string): Promise<AuthorizedDevicePairing> {
    const proof = this.requireProof(pairingId)
    await this.gateway.authorize(pairingId, proof)
    const [account, pairing] = await Promise.all([
      this.authGateway.current(),
      this.gateway.candidateStatus(pairingId, proof),
    ])
    this.secrets.remove(pairingId)
    return { account, pairing }
  }

  async cancelCandidate(pairingId: string): Promise<void> {
    const proof = this.requireProof(pairingId)
    await this.gateway.cancelCandidate(pairingId, proof)
    this.secrets.remove(pairingId)
  }

  async cancelTrusted(pairingId: string): Promise<void> {
    await this.gateway.cancelTrusted(pairingId)
  }

  private requireProof(pairingId: string): string {
    const proof = this.secrets.load(pairingId)
    if (!proof) throw new Error('candidate pairing proof is unavailable')
    return proof
  }
}
