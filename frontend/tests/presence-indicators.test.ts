import { describe, expect, it } from 'vitest'

import { PresenceIndicatorService } from '../app/application/messaging/presence-indicator-service'

describe('presence indicator application service', () => {
  it('applies idempotent transitions and clears untrusted state on disconnect', () => {
    const service = new PresenceIndicatorService()
    const snapshots: string[][] = []
    service.subscribe(items => snapshots.push(items.map(item => item.userId)))
    const online = {
      type: 'presence' as const,
      eventId: 'event-1',
      conversationId: 'conversation',
      actorUserId: 'bob',
      online: true,
    }

    service.apply(online)
    service.apply({ ...online, eventId: 'event-2' })
    expect(snapshots.at(-1)).toEqual(['bob'])
    service.apply({ ...online, eventId: 'event-3', online: false })
    expect(snapshots.at(-1)).toEqual([])
    service.apply(online)
    service.clear()
    expect(snapshots.at(-1)).toEqual([])
  })
})
