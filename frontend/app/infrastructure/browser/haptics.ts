import type { HapticIntent, HapticsPort } from '../../application/ports/haptics'

const STORAGE_KEY = 'yv-chat:haptics'
const PATTERNS: Readonly<Record<HapticIntent, readonly number[]>> = {
  selection: [8],
  success: [12, 35, 18],
  warning: [22, 45, 22],
  error: [35, 35, 35],
  sent: [10],
}

export class BrowserHaptics implements HapticsPort {
  constructor(
    private readonly navigatorRef: Navigator = navigator,
    private readonly storage: Storage = localStorage,
  ) {}

  isEnabled(): boolean {
    return this.storage.getItem(STORAGE_KEY) !== 'off'
  }

  setEnabled(enabled: boolean): void {
    this.storage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  }

  perform(intent: HapticIntent): void {
    if (!this.isEnabled() || typeof this.navigatorRef.vibrate !== 'function') return
    this.navigatorRef.vibrate([...PATTERNS[intent]])
  }
}
