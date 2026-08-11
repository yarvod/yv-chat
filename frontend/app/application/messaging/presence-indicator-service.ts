import type { PresenceRealtimeFrame } from '../../domain/messaging/realtime'

export interface PresenceIndicator {
  conversationId: string
  userId: string
}

export class PresenceIndicatorService {
  private readonly indicators = new Map<string, PresenceIndicator>()
  private listeners = new Set<(indicators: readonly PresenceIndicator[]) => void>()

  subscribe(listener: (indicators: readonly PresenceIndicator[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  apply(frame: PresenceRealtimeFrame): void {
    const key = `${frame.conversationId}:${frame.actorUserId}`
    if (frame.online) {
      this.indicators.set(key, {
        conversationId: frame.conversationId,
        userId: frame.actorUserId,
      })
    } else {
      this.indicators.delete(key)
    }
    this.emit()
  }

  clear(): void {
    this.indicators.clear()
    this.emit()
  }

  private snapshot(): PresenceIndicator[] {
    return [...this.indicators.values()]
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
