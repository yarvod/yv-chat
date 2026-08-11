import type { PageVisibility } from '../../application/ports/page-visibility'

export class BrowserPageVisibility implements PageVisibility {
  isVisible(): boolean {
    return document.visibilityState === 'visible'
  }

  subscribe(onVisible: () => void): () => void {
    const listener = (): void => {
      if (this.isVisible()) onVisible()
    }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  }
}
