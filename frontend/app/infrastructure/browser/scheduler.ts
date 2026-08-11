import type { ScheduledTask, Scheduler } from '../../application/ports/scheduler'

class BrowserScheduledTask implements ScheduledTask {
  constructor(private readonly cancelCallback: () => void) {}

  cancel(): void {
    this.cancelCallback()
  }
}

export class BrowserScheduler implements Scheduler {
  once(delayMs: number, callback: () => void): ScheduledTask {
    const timer = window.setTimeout(callback, delayMs)
    return new BrowserScheduledTask(() => window.clearTimeout(timer))
  }

  repeat(intervalMs: number, callback: () => void): ScheduledTask {
    const timer = window.setInterval(callback, intervalMs)
    return new BrowserScheduledTask(() => window.clearInterval(timer))
  }
}
