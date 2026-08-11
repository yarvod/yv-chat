import type { Clock } from '../ports/clock'
import type { ScheduledTask, Scheduler } from '../ports/scheduler'
import type { TypingTransport } from '../ports/typing-transport'
import type { TypingRealtimeFrame } from '../../domain/messaging/realtime'

const RENEW_INTERVAL_MS = 3_000

export interface TypingIndicator {
  conversationId: string
  actorUserId: string
  expiresAt: string
}

export class TypingIndicatorService {
  private readonly indicators = new Map<string, TypingIndicator>()
  private readonly expiryTasks = new Map<string, ScheduledTask>()
  private listeners = new Set<(indicators: readonly TypingIndicator[]) => void>()
  private localConversationId: string | null = null
  private renewTask: ScheduledTask | null = null

  constructor(
    private readonly transport: TypingTransport,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
  ) {}

  subscribe(listener: (indicators: readonly TypingIndicator[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  apply(frame: TypingRealtimeFrame): void {
    const key = `${frame.conversationId}:${frame.actorUserId}`
    this.expiryTasks.get(key)?.cancel()
    this.expiryTasks.delete(key)
    const expiresAt = Date.parse(frame.expiresAt)
    if (!frame.active || expiresAt <= this.clock.nowMilliseconds()) {
      this.indicators.delete(key)
      this.emit()
      return
    }
    this.indicators.set(key, {
      conversationId: frame.conversationId,
      actorUserId: frame.actorUserId,
      expiresAt: frame.expiresAt,
    })
    this.expiryTasks.set(key, this.scheduler.once(
      expiresAt - this.clock.nowMilliseconds(),
      () => {
        const current = this.indicators.get(key)
        if (current?.expiresAt !== frame.expiresAt) return
        this.indicators.delete(key)
        this.expiryTasks.delete(key)
        this.emit()
      },
    ))
    this.emit()
  }

  setLocal(conversationId: string, active: boolean): void {
    if (active && this.localConversationId === conversationId) return
    if (this.localConversationId !== null) {
      this.transport.setTyping(this.localConversationId, false)
      this.renewTask?.cancel()
      this.renewTask = null
      this.localConversationId = null
    }
    if (!active) return
    this.localConversationId = conversationId
    this.transport.setTyping(conversationId, true)
    this.renewTask = this.scheduler.repeat(RENEW_INTERVAL_MS, () => {
      if (this.localConversationId === conversationId) {
        this.transport.setTyping(conversationId, true)
      }
    })
  }

  clear(): void {
    if (this.localConversationId !== null) {
      this.transport.setTyping(this.localConversationId, false)
    }
    this.localConversationId = null
    this.renewTask?.cancel()
    this.renewTask = null
    this.clearRemote()
  }

  clearRemote(): void {
    for (const task of this.expiryTasks.values()) task.cancel()
    this.expiryTasks.clear()
    this.indicators.clear()
    this.emit()
  }

  private snapshot(): TypingIndicator[] {
    return [...this.indicators.values()]
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
