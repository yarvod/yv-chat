export type HapticIntent = 'selection' | 'success' | 'warning' | 'error' | 'sent'

export interface HapticsPort {
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
  perform(intent: HapticIntent): void
}
