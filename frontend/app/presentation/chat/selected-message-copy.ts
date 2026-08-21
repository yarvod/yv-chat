import type { TimelineMessage } from '../../application/messaging/timeline-message'
import type { Conversation, MessageAttachment } from '../../domain/messaging/models'

function attachmentLabel(attachment: MessageAttachment): string {
  if (attachment.presentation === 'video_note') return '[Видеосообщение]'
  if (attachment.presentation === 'sticker') return '[Стикер]'
  if (attachment.kind === 'image') return '[Фото]'
  if (attachment.kind === 'video') return '[Видео]'
  return `[Файл: ${attachment.name}]`
}

function messageBody(message: TimelineMessage): string {
  const parts: string[] = []
  const text = message.displayBody?.trim()
  if (text) parts.push(text)
  if (message.call) parts.push('[Звонок]')
  parts.push(...(message.displayAttachments ?? []).map(attachmentLabel))
  return parts.join('\n')
}

function localTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const fields = new Map(new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]))
  return `${fields.get('day')}.${fields.get('month')}.${fields.get('year')} ${fields.get('hour')}:${fields.get('minute')}`
}

function senderDisplayName(message: TimelineMessage, conversation: Conversation): string {
  return conversation.members.find(member => member.userId === message.senderUserId)?.displayName
    ?? 'Участник'
}

export function selectedMessageCopyText(
  messages: readonly TimelineMessage[],
  conversation: Conversation,
): string {
  return [...messages]
    .filter(message => message.contentState === 'available')
    .sort((left, right) => left.sequence - right.sequence)
    .map(message => {
      const body = messageBody(message)
      const timestamp = localTimestamp(message.createdAt)
      if (!body || !timestamp) return null
      return `${senderDisplayName(message, conversation)}, [${timestamp}]\n${body}`
    })
    .filter((block): block is string => block !== null)
    .join('\n\n')
}
