import type { ClipboardPort } from '../../application/ports/clipboard'

export class BrowserClipboard implements ClipboardPort {
  async writeText(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(value)
  }
}
