export interface PageVisibility {
  isVisible(): boolean
  subscribe(onVisible: () => void): () => void
}
