import type { RealtimeConnection, RealtimeGateway } from '../ports/realtime-gateway'
import type { ScheduledTask, Scheduler } from '../ports/scheduler'
import type { EphemeralRealtimeFrame } from '../../domain/messaging/realtime'

const FALLBACK_SYNC_INTERVAL_MS = 30_000
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

export class RealtimeSyncService {
  private connection: RealtimeConnection | null = null
  private reconnectTask: ScheduledTask | null = null
  private fallbackTask: ScheduledTask | null = null
  private active = false
  private reconnectAttempt = 0
  private catchUpRunning = false
  private catchUpQueued = false
  private catchUp: (() => Promise<void>) | null = null
  private unauthorized: (() => void) | null = null
  private onEphemeral: ((frame: EphemeralRealtimeFrame) => void) | null = null
  private resetEphemeral: (() => void) | null = null

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly scheduler: Scheduler,
  ) {}

  start(
    catchUp: () => Promise<void>,
    unauthorized: () => void,
    onEphemeral: (frame: EphemeralRealtimeFrame) => void = () => undefined,
    resetEphemeral: () => void = () => undefined,
  ): void {
    if (this.active) return
    this.active = true
    this.catchUp = catchUp
    this.unauthorized = unauthorized
    this.onEphemeral = onEphemeral
    this.resetEphemeral = resetEphemeral
    this.fallbackTask = this.scheduler.repeat(
      FALLBACK_SYNC_INTERVAL_MS,
      () => void this.requestCatchUp(),
    )
    this.connect()
  }

  stop(): void {
    this.active = false
    this.connection?.close()
    this.connection = null
    this.reconnectTask?.cancel()
    this.reconnectTask = null
    this.fallbackTask?.cancel()
    this.fallbackTask = null
    this.catchUp = null
    this.unauthorized = null
    this.onEphemeral = null
    this.resetEphemeral?.()
    this.resetEphemeral = null
    this.catchUpQueued = false
  }

  private connect(): void {
    if (!this.active || this.connection) return
    try {
      this.connection = this.gateway.connect({
        onOpen: () => {
          this.reconnectAttempt = 0
        },
        onFrame: frame => {
          if (frame.type === 'typing' || frame.type === 'presence') {
            this.onEphemeral?.(frame)
          } else if (frame.type !== 'ping') {
            void this.requestCatchUp()
          }
        },
        onClose: reason => {
          this.connection = null
          this.resetEphemeral?.()
          if (!this.active) return
          if (reason.unauthorized) {
            const unauthorized = this.unauthorized
            this.stop()
            unauthorized?.()
            return
          }
          this.scheduleReconnect()
        },
      })
    } catch {
      this.connection = null
      this.scheduleReconnect()
    }
  }

  setTyping(conversationId: string, active: boolean): void {
    this.connection?.setTyping(conversationId, active)
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTask) return
    const index = Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    const delay = RECONNECT_DELAYS_MS[index] ?? 30_000
    this.reconnectAttempt += 1
    this.reconnectTask = this.scheduler.once(delay, () => {
      this.reconnectTask = null
      void this.requestCatchUp()
      this.connect()
    })
  }

  private async requestCatchUp(): Promise<void> {
    if (!this.active || !this.catchUp) return
    if (this.catchUpRunning) {
      this.catchUpQueued = true
      return
    }
    this.catchUpRunning = true
    try {
      do {
        this.catchUpQueued = false
        await this.catchUp()
      } while (this.active && this.catchUpQueued)
    } finally {
      this.catchUpRunning = false
    }
  }
}
