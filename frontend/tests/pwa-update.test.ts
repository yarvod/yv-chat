import { describe, expect, it, vi } from 'vitest'

import { PwaUpdateCoordinator } from '../app/application/pwa/pwa-update-coordinator'
import type { PageVisibility } from '../app/application/ports/page-visibility'
import type { PwaUpdateGateway } from '../app/application/ports/pwa-update-gateway'
import type { ScheduledTask, Scheduler } from '../app/application/ports/scheduler'

class FakeTask implements ScheduledTask {
  cancelled = false
  constructor(readonly delay: number, readonly callback: () => void) {}
  cancel(): void { this.cancelled = true }
  run(): void { if (!this.cancelled) this.callback() }
}

class FakeScheduler implements Scheduler {
  repeatTasks: FakeTask[] = []
  once(): ScheduledTask { throw new Error('not used') }
  repeat(intervalMs: number, callback: () => void): ScheduledTask {
    const task = new FakeTask(intervalMs, callback)
    this.repeatTasks.push(task)
    return task
  }
}

class FakeVisibility implements PageVisibility {
  listener: (() => void) | null = null
  unsubscribed = false
  visible = true
  isVisible(): boolean { return this.visible }
  subscribe(listener: () => void): () => void {
    this.listener = listener
    return () => { this.unsubscribed = true }
  }
}

describe('PWA update coordinator', () => {
  it('checks on start, foreground, and bounded interval, then cleans up', async () => {
    const gateway: PwaUpdateGateway = { check: vi.fn().mockResolvedValue(undefined) }
    const visibility = new FakeVisibility()
    const scheduler = new FakeScheduler()
    const coordinator = new PwaUpdateCoordinator(gateway, visibility, scheduler)

    coordinator.start()
    await vi.waitFor(() => expect(gateway.check).toHaveBeenCalledTimes(1))
    expect(scheduler.repeatTasks[0]?.delay).toBe(60_000)
    visibility.listener?.()
    await vi.waitFor(() => expect(gateway.check).toHaveBeenCalledTimes(2))
    scheduler.repeatTasks[0]?.run()
    await vi.waitFor(() => expect(gateway.check).toHaveBeenCalledTimes(3))

    coordinator.stop()
    expect(visibility.unsubscribed).toBe(true)
    expect(scheduler.repeatTasks[0]?.cancelled).toBe(true)
  })

  it('coalesces concurrent checks and treats update failures as non-blocking', async () => {
    let release: (() => void) | null = null
    const gateway: PwaUpdateGateway = {
      check: vi.fn()
        .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
        .mockRejectedValueOnce(new Error('offline')),
    }
    const visibility = new FakeVisibility()
    const scheduler = new FakeScheduler()
    const coordinator = new PwaUpdateCoordinator(gateway, visibility, scheduler)

    coordinator.start()
    visibility.listener?.()
    scheduler.repeatTasks[0]?.run()
    expect(gateway.check).toHaveBeenCalledTimes(1)
    release?.()
    await vi.waitFor(() => expect(gateway.check).toHaveBeenCalledTimes(2))
    coordinator.stop()
  })
})
