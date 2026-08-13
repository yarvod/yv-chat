import type {
  CreatedDevicePairing,
  DevicePairingView,
} from '../../domain/accounts/device-pairing'

export interface DevicePairingGateway {
  createRequest(candidateProofHash: string, candidateDeviceName: string): Promise<CreatedDevicePairing>
  createOffer(): Promise<CreatedDevicePairing>
  scanRequest(pairingId: string, scanToken: string): Promise<DevicePairingView>
  scanOffer(
    pairingId: string,
    scanToken: string,
    candidateProofHash: string,
    candidateDeviceName: string,
  ): Promise<DevicePairingView>
  candidateStatus(pairingId: string, candidateProof: string): Promise<DevicePairingView>
  trustedStatus(pairingId: string): Promise<DevicePairingView>
  approve(pairingId: string): Promise<DevicePairingView>
  authorize(pairingId: string, candidateProof: string): Promise<void>
  cancelCandidate(pairingId: string, candidateProof: string): Promise<DevicePairingView>
  cancelTrusted(pairingId: string): Promise<DevicePairingView>
}
