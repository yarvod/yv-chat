import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

import type { HapticIntent, HapticsPort } from '../../application/ports/haptics'

const STORAGE_KEY = 'yv-chat:haptics'

export interface CapacitorHapticDriver {
  impact(style: ImpactStyle): Promise<void>
  notification(type: NotificationType): Promise<void>
}

const driver: CapacitorHapticDriver = {
  impact: style => Haptics.impact({ style }),
  notification: type => Haptics.notification({ type }),
}

export class CapacitorHaptics implements HapticsPort {
  constructor(
    private readonly storage: Storage = localStorage,
    private readonly native: CapacitorHapticDriver = driver,
  ) {}

  isEnabled(): boolean {
    return this.storage.getItem(STORAGE_KEY) !== 'off'
  }

  setEnabled(enabled: boolean): void {
    this.storage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  }

  perform(intent: HapticIntent): void {
    if (!this.isEnabled()) return
    const feedback = intent === 'success'
      ? this.native.notification(NotificationType.Success)
      : intent === 'warning'
        ? this.native.notification(NotificationType.Warning)
        : intent === 'error'
          ? this.native.notification(NotificationType.Error)
          : this.native.impact(ImpactStyle.Light)
    void feedback.catch(() => undefined)
  }
}
