import { describe, expect, it, vi } from 'vitest'

import { TypingIndicatorService } from '../app/application/messaging/typing-indicator-service'
import type { Clock } from '../app/application/ports/clock'
import type { ScheduledTask, Scheduler } from '../app/application/ports/scheduler'
import type { TypingTransport } from '../app/application/ports/typing-transport'

class Task implements ScheduledTask {
  cancelled = false
  constructor(readonly callback: () => void) {}
  cancel(): void { this.cancelled = true }
  run(): void { if (!this.cancelled) this.callback() }
}

class TestScheduler implements Scheduler {
  onceTasks: Task[] = []
  repeatTasks: Task[] = []
  once(_delayMs: number, callback: () => void): ScheduledTask {
    const task = new Task(callback)
    this.onceTasks.push(task)
    return task
  }
  repeat(_intervalMs: number, callback: () => void): ScheduledTask {
    const task = new Task(callback)
    this.repeatTasks.push(task)
    return task
  }
}

describe('typing indicator application service', () => {
  it('replaces expiry, stops locally and never duplicates indicator rows', () => {
    const transport: TypingTransport = { setTyping: vi.fn() }
    const scheduler = new TestScheduler()
    const clock: Clock = { nowMilliseconds: () => Date.parse('2026-08-11T12:00:00Z') }
    const service = new TypingIndicatorService(transport, scheduler, clock)
    const snapshots: string[][] = []
    service.subscribe(items => snapshots.push(items.map(item => item.actorUserId)))

    service.apply({
      type: 'typing', eventId: '1', conversationId: 'conversation', actorUserId: 'bob',
      active: true, expiresAt: '2026-08-11T12:00:05Z',
    })
    service.apply({
      type: 'typing', eventId: '2', conversationId: 'conversation', actorUserId: 'bob',
      active: true, expiresAt: '2026-08-11T12:00:06Z',
    })
    expect(snapshots.at(-1)).toEqual(['bob'])
    expect(scheduler.onceTasks[0]?.cancelled).toBe(true)
    scheduler.onceTasks[1]?.run()
    expect(snapshots.at(-1)).toEqual([])

    service.setLocal('conversation', true)
    service.setLocal('conversation', true)
    scheduler.repeatTasks[0]?.run()
    service.setLocal('conversation', false)
    expect(transport.setTyping).toHaveBeenNthCalledWith(1, 'conversation', true)
    expect(transport.setTyping).toHaveBeenNthCalledWith(2, 'conversation', true)
    expect(transport.setTyping).toHaveBeenNthCalledWith(3, 'conversation', false)
  })

  it('drops already expired and explicit stop frames', () => {
    const scheduler = new TestScheduler()
    const service = new TypingIndicatorService(
      { setTyping: vi.fn() },
      scheduler,
      { nowMilliseconds: () => Date.parse('2026-08-11T12:00:10Z') },
    )
    const snapshots: number[] = []
    service.subscribe(items => snapshots.push(items.length))
    service.apply({
      type: 'typing', eventId: 'old', conversationId: 'conversation', actorUserId: 'bob',
      active: true, expiresAt: '2026-08-11T12:00:05Z',
    })
    service.apply({
      type: 'typing', eventId: 'stop', conversationId: 'conversation', actorUserId: 'bob',
      active: false, expiresAt: '2026-08-11T12:00:10Z',
    })
    expect(snapshots.at(-1)).toBe(0)
    expect(scheduler.onceTasks).toHaveLength(0)
  })
})
