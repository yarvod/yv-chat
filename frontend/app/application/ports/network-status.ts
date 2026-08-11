export interface NetworkStatus {
  isOnline(): boolean
  subscribe(listener: (online: boolean) => void): () => void
}
