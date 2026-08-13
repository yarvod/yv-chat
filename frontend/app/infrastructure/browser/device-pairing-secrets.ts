import type {
  DevicePairingSecretStore,
  GeneratedPairingProof,
} from '../../application/ports/device-pairing-secrets'

const keyPrefix = 'yv-chat:pending-device-pairing:v1:'

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

export class BrowserDevicePairingSecretStore implements DevicePairingSecretStore {
  private readonly memory = new Map<string, string>()

  constructor(private readonly storage: Storage = window.sessionStorage) {}

  async create(): Promise<GeneratedPairingProof> {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = base64Url(bytes)
    const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
    bytes.fill(0)
    return { secret, digest }
  }

  async digest(secret: string): Promise<string> {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
  }

  save(pairingId: string, proof: string): void {
    this.memory.set(pairingId, proof)
    try {
      this.storage.setItem(`${keyPrefix}${pairingId}`, proof)
    } catch {
      // Memory keeps the active flow usable when sessionStorage is denied.
    }
  }

  load(pairingId: string): string | null {
    const memory = this.memory.get(pairingId)
    if (memory) return memory
    try {
      const persisted = this.storage.getItem(`${keyPrefix}${pairingId}`)
      if (persisted) this.memory.set(pairingId, persisted)
      return persisted
    } catch {
      return null
    }
  }

  remove(pairingId: string): void {
    this.memory.delete(pairingId)
    try {
      this.storage.removeItem(`${keyPrefix}${pairingId}`)
    } catch {
      // Nothing sensitive is copied to another fallback store.
    }
  }
}
