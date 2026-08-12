import type { ConversationMember } from '../../domain/messaging/models'

export type MessageTextSegment =
  | { kind: 'text', text: string }
  | { kind: 'mention', text: string, own: boolean }
  | { kind: 'link', text: string, href: string }

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu
const MENTION_PATTERN = /@[\p{L}\p{N}_.-]+/gu
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;:…]$/u
const CLOSING_PAIRS = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
])

function occurrences(value: string, character: string): number {
  return Array.from(value).filter(item => item === character).length
}

function trimLinkPunctuation(value: string): string {
  let trimmed = value
  while (trimmed.length > 0) {
    const last = trimmed.at(-1) ?? ''
    if (SIMPLE_TRAILING_PUNCTUATION.test(last)) {
      trimmed = trimmed.slice(0, -1)
      continue
    }
    const opening = CLOSING_PAIRS.get(last)
    if (opening && occurrences(trimmed, last) > occurrences(trimmed, opening)) {
      trimmed = trimmed.slice(0, -1)
      continue
    }
    break
  }
  return trimmed
}

function safeHref(text: string): string | null {
  try {
    const parsed = new URL(/^www\./iu.test(text) ? `https://${text}` : text)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.length === 0) return null
    return parsed.href
  } catch {
    return null
  }
}

function appendTextSegments(
  output: MessageTextSegment[],
  text: string,
  members: ReadonlyMap<string, ConversationMember>,
  intendedUserIds: ReadonlySet<string>,
  actorUserId: string,
): void {
  if (text.length === 0) return
  let cursor = 0
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) output.push({ kind: 'text', text: text.slice(cursor, index) })
    const member = members.get(match[0].slice(1).toLocaleLowerCase('ru-RU'))
    const intended = member !== undefined && intendedUserIds.has(member.userId)
    output.push(intended
      ? { kind: 'mention', text: match[0], own: member.userId === actorUserId }
      : { kind: 'text', text: match[0] })
    cursor = index + match[0].length
  }
  if (cursor < text.length) output.push({ kind: 'text', text: text.slice(cursor) })
}

export function buildMessageTextSegments(
  body: string,
  conversationMembers: readonly ConversationMember[],
  mentionedUserIds: readonly string[],
  actorUserId: string,
): MessageTextSegment[] {
  const output: MessageTextSegment[] = []
  const members = new Map(conversationMembers.map(member => (
    [member.username.toLocaleLowerCase('ru-RU'), member]
  )))
  const intended = new Set(mentionedUserIds)
  let cursor = 0
  for (const match of body.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0
    const text = trimLinkPunctuation(match[0])
    const href = safeHref(text)
    if (!href || text.length === 0) continue
    appendTextSegments(output, body.slice(cursor, index), members, intended, actorUserId)
    output.push({ kind: 'link', text, href })
    cursor = index + text.length
  }
  appendTextSegments(output, body.slice(cursor), members, intended, actorUserId)
  return output
}
