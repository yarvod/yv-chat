import { describe, expect, it, vi } from 'vitest'

import { RealtimeSyncService } from '../app/application/messaging/realtime-sync-service'
import type {
  RealtimeCallbacks,
  RealtimeConnection,
  RealtimeGateway,
} from '../app/application/ports/realtime-gateway'
import type { ScheduledTask, Scheduler } from '../app/application/ports/scheduler'
import { ApplicationError } from '../app/application/errors'
import { BrowserRealtimeGateway } from '../app/infrastructure/realtime/browser-realtime-gateway'
import { parseRealtimeFrame } from '../app/infrastructure/realtime/realtime-parser'

class FakeScheduledTask implements ScheduledTask {
  cancelled = false

  constructor(
    readonly delay: number,
    readonly callback: () => void,
  ) {}

  cancel(): void {
    this.cancelled = true
  }

  run(): void {
    if (!this.cancelled) this.callback()
  }
}

class FakeScheduler implements Scheduler {
  onceTasks: FakeScheduledTask[] = []
  repeatTasks: FakeScheduledTask[] = []

  once(delayMs: number, callback: () => void): ScheduledTask {
    const task = new FakeScheduledTask(delayMs, callback)
    this.onceTasks.push(task)
    return task
  }

  repeat(intervalMs: number, callback: () => void): ScheduledTask {
    const task = new FakeScheduledTask(intervalMs, callback)
    this.repeatTasks.push(task)
    return task
  }
}

class FakeRealtimeGateway implements RealtimeGateway {
  callbacks: RealtimeCallbacks[] = []
  close = vi.fn()

  connect(callbacks: RealtimeCallbacks): RealtimeConnection {
    this.callbacks.push(callbacks)
    return { close: this.close, setTyping: vi.fn() }
  }
}

class FakeWebSocket extends EventTarget {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readonly url: string
  sent: string[] = []
  close = vi.fn()
  readyState = FakeWebSocket.OPEN

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  send(value: string): void {
    this.sent.push(value)
  }
}

describe('realtime sync', () => {
  it('strictly parses only bounded routing frames', () => {
    expect(parseRealtimeFrame({ type: 'hello' })).toEqual({ type: 'hello' })
    expect(parseRealtimeFrame({
      type: 'new_message',
      event_id: 'event',
      conversation_id: 'conversation',
      message_id: 'message',
      token_hash: 'must-not-escape',
    })).toEqual({
      type: 'new_message',
      eventId: 'event',
      conversationId: 'conversation',
      messageId: 'message',
      actorUserId: null,
      readSequence: null,
      deliverySequence: null,
    })
    expect(parseRealtimeFrame({
      type: 'presence',
      event_id: 'presence-event',
      conversation_id: 'conversation',
      message_id: null,
      actor_user_id: 'bob',
      online: true,
    })).toEqual({
      type: 'presence',
      eventId: 'presence-event',
      conversationId: 'conversation',
      actorUserId: 'bob',
      online: true,
    })
    expect(parseRealtimeFrame({
      type: 'read_receipt',
      event_id: 'read-event',
      conversation_id: 'conversation',
      message_id: null,
      actor_user_id: 'alice',
      read_sequence: 8,
    })).toEqual({
      type: 'read_receipt',
      eventId: 'read-event',
      conversationId: 'conversation',
      messageId: null,
      actorUserId: 'alice',
      readSequence: 8,
      deliverySequence: null,
    })
    expect(parseRealtimeFrame({
      type: 'delivery_receipt',
      event_id: 'delivery-event',
      conversation_id: 'conversation',
      message_id: null,
      actor_user_id: 'bob',
      read_sequence: null,
      delivery_sequence: 9,
    })).toEqual({
      type: 'delivery_receipt',
      eventId: 'delivery-event',
      conversationId: 'conversation',
      messageId: null,
      actorUserId: 'bob',
      readSequence: null,
      deliverySequence: 9,
    })
    expect(() => parseRealtimeFrame({
      type: 'read_receipt',
      event_id: 'event',
      conversation_id: 'conversation',
      message_id: null,
    })).toThrow(ApplicationError)
    expect(() => parseRealtimeFrame({ type: 'typing', user_id: 'arbitrary' }))
      .toThrow(ApplicationError)
    expect(parseRealtimeFrame({
      type: 'typing',
      event_id: 'typing-event',
      conversation_id: 'conversation',
      message_id: null,
      actor_user_id: 'bob',
      active: true,
      expires_at: '2026-08-11T12:00:05+00:00',
    })).toEqual({
      type: 'typing',
      eventId: 'typing-event',
      conversationId: 'conversation',
      actorUserId: 'bob',
      active: true,
      expiresAt: '2026-08-11T12:00:05+00:00',
    })
  })

  it('keeps one connection, catches up on hints and reconnects with backoff', async () => {
    const gateway = new FakeRealtimeGateway()
    const scheduler = new FakeScheduler()
    const catchUp = vi.fn().mockResolvedValue(undefined)
    const unauthorized = vi.fn()
    const onTyping = vi.fn()
    const resetEphemeral = vi.fn()
    const onConnectionState = vi.fn()
    const service = new RealtimeSyncService(gateway, scheduler)

    service.start(catchUp, unauthorized, onTyping, resetEphemeral, onConnectionState)
    service.start(catchUp, unauthorized)
    expect(gateway.callbacks).toHaveLength(1)
    expect(onConnectionState).toHaveBeenLastCalledWith('connecting')
    expect(scheduler.repeatTasks[0]?.delay).toBe(30_000)
    gateway.callbacks[0]?.onFrame({ type: 'hello' })
    gateway.callbacks[0]?.onOpen()
    expect(onConnectionState).toHaveBeenLastCalledWith('connected')
    await vi.waitFor(() => expect(catchUp).toHaveBeenCalledTimes(1))

    gateway.callbacks[0]?.onClose({ unauthorized: false })
    expect(onConnectionState).toHaveBeenLastCalledWith('reconnecting')
    expect(resetEphemeral).toHaveBeenCalledOnce()
    expect(scheduler.onceTasks[0]?.delay).toBe(1_000)
    scheduler.onceTasks[0]?.run()
    await vi.waitFor(() => expect(gateway.callbacks).toHaveLength(2))
    expect(catchUp).toHaveBeenCalledTimes(2)

    gateway.callbacks[1]?.onFrame({
      type: 'typing',
      eventId: 'typing-event',
      conversationId: 'conversation',
      actorUserId: 'bob',
      active: true,
      expiresAt: '2026-08-11T12:00:05+00:00',
    })
    expect(onTyping).toHaveBeenCalledOnce()
    expect(catchUp).toHaveBeenCalledTimes(2)
    gateway.callbacks[1]?.onFrame({
      type: 'presence',
      eventId: 'presence-event',
      conversationId: 'conversation',
      actorUserId: 'bob',
      online: true,
    })
    expect(onTyping).toHaveBeenCalledTimes(2)
    expect(catchUp).toHaveBeenCalledTimes(2)

    gateway.callbacks[1]?.onClose({ unauthorized: true })
    expect(unauthorized).toHaveBeenCalledOnce()
    expect(onConnectionState).toHaveBeenLastCalledWith('stopped')
    expect(scheduler.repeatTasks[0]?.cancelled).toBe(true)
    expect(scheduler.onceTasks).toHaveLength(1)
  })

  it('builds a same-origin credential-free socket URL and answers ping', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', { location: { href: 'https://chat.example/settings' } })
    const callbacks = {
      onFrame: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
    }
    const connection = new BrowserRealtimeGateway().connect(callbacks)
    const socket = FakeWebSocket.instances.at(-1)
    expect(socket?.url).toBe('wss://chat.example/api/v1/realtime')
    expect(socket?.url).not.toContain('?')
    socket?.dispatchEvent(new MessageEvent('message', { data: '{"type":"ping"}' }))
    expect(socket?.sent).toEqual(['{"type":"pong"}'])
    expect(callbacks.onFrame).not.toHaveBeenCalled()
    connection.setTyping('conversation-id', true)
    expect(socket?.sent.at(-1)).toBe('{"type":"typing","conversation_id":"conversation-id","active":true}')
    vi.unstubAllGlobals()
  })
})
