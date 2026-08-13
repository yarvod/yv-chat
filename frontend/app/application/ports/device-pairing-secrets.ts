export interface GeneratedPairingProof {
  secret: string
  digest: string
}

export interface DevicePairingSecretStore {
  create(): Promise<GeneratedPairingProof>
  digest(secret: string): Promise<string>
  save(pairingId: string, proof: string): void
  load(pairingId: string): string | null
  remove(pairingId: string): void
}
