import type { ExternalLinks } from '../../application/ports/external-links'

export class BrowserExternalLinks implements ExternalLinks {
  constructor(private readonly native: boolean, private readonly origin: string) {}

  needsActionMenu(): boolean {
    return !this.native && /Android/u.test(navigator.userAgent)
      && (window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches)
  }

  externalUrl(href: string): string | null {
    try {
      const url = new URL(href)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin === this.origin
        || url.username || url.password) return null
      return url.href
    } catch {
      return null
    }
  }

  canShare(): boolean {
    return typeof navigator.share === 'function'
  }

  async share(url: string): Promise<void> {
    const validated = this.externalUrl(url)
    if (!validated || !this.canShare()) throw new Error('link sharing unavailable')
    await navigator.share({ url: validated })
  }
}
