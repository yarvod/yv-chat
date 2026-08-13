import type {
  CreatedDevicePairing,
  DevicePairingView,
  DeviceHistoryRelayChunk,
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
  scanExistingOffer(pairingId: string, scanToken: string): Promise<DevicePairingView>
  candidateStatus(pairingId: string, candidateProof: string): Promise<DevicePairingView>
  trustedStatus(pairingId: string): Promise<DevicePairingView>
  existingCandidateStatus(pairingId: string): Promise<DevicePairingView>
  approve(pairingId: string): Promise<DevicePairingView>
  authorize(pairingId: string, candidateProof: string): Promise<void>
  cancelCandidate(pairingId: string, candidateProof: string): Promise<DevicePairingView>
  cancelTrusted(pairingId: string): Promise<DevicePairingView>
  cancelExistingCandidate(pairingId: string): Promise<DevicePairingView>
  cancelHistorySync(pairingId: string): Promise<void>
  uploadHistoryChunk(
    pairingId: string,
    targetDeviceId: string,
    conversationId: string,
    clientChunkId: string,
    ciphertextBase64: string,
  ): Promise<DeviceHistoryRelayChunk>
  listHistoryChunks(pairingId: string): Promise<readonly DeviceHistoryRelayChunk[]>
  listOutboundHistoryChunks(pairingId: string): Promise<readonly DeviceHistoryRelayChunk[]>
  acknowledgeHistoryChunk(pairingId: string, chunkId: string): Promise<void>
}
