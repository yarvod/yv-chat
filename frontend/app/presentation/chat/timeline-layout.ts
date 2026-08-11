import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { ConversationType } from '../../domain/messaging/models'

export type TimelineLayoutItem =
  | { kind: 'day', key: string, label: string }
  | {
    kind: 'message'
    key: string
    message: TimelineMessage
    joinedToPrevious: boolean
    showSender: boolean
  }

const GROUP_WINDOW_MS = 5 * 60 * 1000

export function buildTimelineLayout(
  messages: readonly TimelineMessage[],
  conversationType: ConversationType,
  actorUserId: string,
): TimelineLayoutItem[] {
  const items: TimelineLayoutItem[] = []
  let previous: TimelineMessage | null = null
  let previousDay = ''

  for (const message of messages) {
    const createdAt = new Date(message.createdAt)
    const day = localDayKey(createdAt)
    if (day !== previousDay) {
      items.push({
        kind: 'day',
        key: `day-${day}`,
        label: formatDay(createdAt),
      })
    }
    const joinedToPrevious = previous !== null
      && previousDay === day
      && previous.senderUserId === message.senderUserId
      && createdAt.getTime() - new Date(previous.createdAt).getTime() <= GROUP_WINDOW_MS
      && previous.contentState === message.contentState
    items.push({
      kind: 'message',
      key: message.messageId,
      message,
      joinedToPrevious,
      showSender: conversationType === 'group'
        && message.senderUserId !== actorUserId
        && !joinedToPrevious,
    })
    previous = message
    previousDay = day
  }
  return items
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}
