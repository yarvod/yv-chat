import type { PageVisibility } from '../ports/page-visibility'
import type { PwaUpdateGateway } from '../ports/pwa-update-gateway'
import type { ScheduledTask, Scheduler } from '../ports/scheduler'

const UPDATE_CHECK_INTERVAL_MS = 60_000

export class PwaUpdateCoordinator {
  private active = false
  private checking = false
  private queued = false
  private periodicTask: ScheduledTask | null = null
  private unsubscribeVisibility: (() => void) | null = null

  constructor(
    private readonly gateway: PwaUpdateGateway,
    private readonly visibility: PageVisibility,
    private readonly scheduler: Scheduler,
  ) {}

  start(): void {
    if (this.active) return
    this.active = true
    this.unsubscribeVisibility = this.visibility.subscribe(() => void this.requestCheck())
    this.periodicTask = this.scheduler.repeat(
      UPDATE_CHECK_INTERVAL_MS,
      () => void this.requestCheck(),
    )
    void this.requestCheck()
  }

  stop(): void {
    this.active = false
    this.periodicTask?.cancel()
    this.periodicTask = null
    this.unsubscribeVisibility?.()
    this.unsubscribeVisibility = null
    this.queued = false
  }

  private async requestCheck(): Promise<void> {
    if (!this.active || !this.visibility.isVisible()) return
    if (this.checking) {
      this.queued = true
      return
    }
    this.checking = true
    try {
      do {
        this.queued = false
        try {
          await this.gateway.check()
        } catch {
          // A transient update check must never break the running application.
        }
      } while (this.active && this.queued && this.visibility.isVisible())
    } finally {
      this.checking = false
    }
  }
}
