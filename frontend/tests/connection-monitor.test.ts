import { describe, expect, it, vi } from 'vitest'

import {
  ConnectionMonitor,
  type ServerConnectionState,
} from '../app/application/connectivity/connection-monitor'
import type { NetworkStatus } from '../app/application/ports/network-status'
import type { ScheduledTask, Scheduler } from '../app/application/ports/scheduler'
import type { ServerHealthGateway } from '../app/application/ports/server-health-gateway'

class FakeTask implements ScheduledTask {
  cancelled = false
  constructor(readonly delay: number, readonly callback: () => void) {}
  cancel(): void { this.cancelled = true }
  run(): void { if (!this.cancelled) this.callback() }
}

class FakeScheduler implements Scheduler {
  onceTasks: FakeTask[] = []
  repeatTasks: FakeTask[] = []
  once(delayMs: number, callback: () => void): ScheduledTask {
    const task = new FakeTask(delayMs, callback)
    this.onceTasks.push(task)
    return task
  }
  repeat(intervalMs: number, callback: () => void): ScheduledTask {
    const task = new FakeTask(intervalMs, callback)
    this.repeatTasks.push(task)
    return task
  }
}

class FakeNetwork implements NetworkStatus {
  listener: ((online: boolean) => void) | null = null
  unsubscribed = false
  constructor(public online = true) {}
  isOnline(): boolean { return this.online }
  subscribe(listener: (online: boolean) => void): () => void {
    this.listener = listener
    return () => { this.unsubscribed = true }
  }
  set(online: boolean): void {
    this.online = online
    this.listener?.(online)
  }
}

describe('connection monitor', () => {
  it('reports initial health, browser offline, and confirmed recovery', async () => {
    const health: ServerHealthGateway = { probe: vi.fn().mockResolvedValue(undefined) }
    const network = new FakeNetwork()
    const scheduler = new FakeScheduler()
    const states: ServerConnectionState[] = []
    const monitor = new ConnectionMonitor(health, network, scheduler)

    monitor.start(state => states.push(state))
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'))
    expect(scheduler.repeatTasks[0]?.delay).toBe(30_000)

    network.set(false)
    expect(states.at(-1)).toBe('offline')
    network.set(true)
    expect(states.at(-1)).toBe('updating')
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'))

    monitor.stop()
    expect(network.unsubscribed).toBe(true)
    expect(scheduler.repeatTasks[0]?.cancelled).toBe(true)
  })

  it('retries a failed probe with bounded backoff and never probes in parallel', async () => {
    let release: (() => void) | null = null
    const health: ServerHealthGateway = {
      probe: vi.fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
        .mockResolvedValue(undefined),
    }
    const network = new FakeNetwork()
    const scheduler = new FakeScheduler()
    const states: ServerConnectionState[] = []
    const monitor = new ConnectionMonitor(health, network, scheduler)

    monitor.start(state => states.push(state))
    await vi.waitFor(() => expect(states.at(-1)).toBe('reconnecting'))
    expect(scheduler.onceTasks[0]?.delay).toBe(1_000)
    scheduler.onceTasks[0]?.run()
    scheduler.repeatTasks[0]?.run()
    expect(health.probe).toHaveBeenCalledTimes(2)

    release?.()
    await vi.waitFor(() => expect(health.probe).toHaveBeenCalledTimes(3))
    expect(states.at(-1)).toBe('connected')
    monitor.stop()
  })
})
