import type { NetworkStatus } from '../../application/ports/network-status'

export class BrowserNetworkStatus implements NetworkStatus {
  isOnline(): boolean {
    return navigator.onLine
  }

  subscribe(listener: (online: boolean) => void): () => void {
    const online = (): void => listener(true)
    const offline = (): void => listener(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }
}
