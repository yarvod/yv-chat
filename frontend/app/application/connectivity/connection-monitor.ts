import type { NetworkStatus } from '../ports/network-status'
import type { ScheduledTask, Scheduler } from '../ports/scheduler'
import type { ServerHealthGateway } from '../ports/server-health-gateway'

const HEALTH_POLL_INTERVAL_MS = 30_000
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

export type ServerConnectionState =
  | 'checking'
  | 'connected'
  | 'updating'
  | 'reconnecting'
  | 'offline'

export class ConnectionMonitor {
  private active = false
  private probing = false
  private queued = false
  private retryAttempt = 0
  private retryTask: ScheduledTask | null = null
  private pollTask: ScheduledTask | null = null
  private unsubscribeNetwork: (() => void) | null = null
  private listener: ((state: ServerConnectionState) => void) | null = null
  private state: ServerConnectionState = 'checking'

  constructor(
    private readonly health: ServerHealthGateway,
    private readonly network: NetworkStatus,
    private readonly scheduler: Scheduler,
  ) {}

  start(listener: (state: ServerConnectionState) => void): void {
    if (this.active) return
    this.active = true
    this.listener = listener
    this.unsubscribeNetwork = this.network.subscribe(online => this.networkChanged(online))
    this.pollTask = this.scheduler.repeat(HEALTH_POLL_INTERVAL_MS, () => {
      if (this.network.isOnline()) void this.requestProbe(false)
    })
    if (!this.network.isOnline()) {
      this.transition('offline')
      return
    }
    this.transition('checking')
    void this.requestProbe(false)
  }

  stop(): void {
    this.active = false
    this.retryTask?.cancel()
    this.retryTask = null
    this.pollTask?.cancel()
    this.pollTask = null
    this.unsubscribeNetwork?.()
    this.unsubscribeNetwork = null
    this.listener = null
    this.queued = false
  }

  private networkChanged(online: boolean): void {
    if (!this.active) return
    this.retryTask?.cancel()
    this.retryTask = null
    if (!online) {
      this.retryAttempt = 0
      this.transition('offline')
      return
    }
    this.transition('updating')
    void this.requestProbe(true)
  }

  private async requestProbe(showUpdating: boolean): Promise<void> {
    if (!this.active || !this.network.isOnline()) return
    if (this.probing) {
      this.queued = true
      return
    }
    this.probing = true
    if (showUpdating && this.state !== 'checking') this.transition('updating')
    try {
      do {
        this.queued = false
        try {
          await this.health.probe()
          this.retryAttempt = 0
          this.retryTask?.cancel()
          this.retryTask = null
          this.transition('connected')
        } catch {
          if (!this.network.isOnline()) this.transition('offline')
          else {
            this.transition('reconnecting')
            this.scheduleRetry()
          }
        }
      } while (this.active && this.queued && this.network.isOnline())
    } finally {
      this.probing = false
    }
  }

  private scheduleRetry(): void {
    if (!this.active || this.retryTask || !this.network.isOnline()) return
    const index = Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)
    const delay = RETRY_DELAYS_MS[index] ?? 30_000
    this.retryAttempt += 1
    this.retryTask = this.scheduler.once(delay, () => {
      this.retryTask = null
      void this.requestProbe(false)
    })
  }

  private transition(state: ServerConnectionState): void {
    this.state = state
    this.listener?.(state)
  }
}
