import type { MessageArchive } from '../ports/message-archive'
import type { MessagingGateway } from '../ports/messaging-gateway'
import type { OpaqueMessage } from '../../domain/messaging/models'
import type { ProtocolMessageProtection } from './message-protection'
import { prepareTimelineMessage, type TimelineMessage } from './timeline-message'

const HISTORY_PAGE_SIZE = 100
const MAX_TIMELINE_MESSAGES = 300

export interface ConversationHistoryWindow {
  messages: TimelineMessage[]
  hasMore: boolean
  hasNewer: boolean
}

type HistoryListener = (window: ConversationHistoryWindow) => void

function sortMessages(messages: readonly TimelineMessage[]): TimelineMessage[] {
  return [...messages].sort((left, right) => left.sequence - right.sequence)
}

function mergeById(
  current: readonly TimelineMessage[],
  incoming: readonly TimelineMessage[],
): TimelineMessage[] {
  const known = new Map(current.map(item => [item.messageId, item]))
  for (const item of incoming) known.set(item.messageId, item)
  return sortMessages([...known.values()])
}

export class ConversationHistory {
  private archiveAvailable = true

  constructor(
    private readonly ownerUserId: string,
    private readonly gateway: MessagingGateway,
    private readonly archive: MessageArchive,
    private readonly protection: ProtocolMessageProtection,
  ) {}

  get archiveStatus(): 'ready' | 'unavailable' {
    return this.archiveAvailable ? 'ready' : 'unavailable'
  }

  async loadCachedLatest(conversationId: string): Promise<ConversationHistoryWindow | null> {
    const cached = await this.readLatest(conversationId)
    if (cached.length === 0) return null
    return {
      messages: this.latestWindow(await this.prepare(cached)),
      hasMore: cached.length === HISTORY_PAGE_SIZE,
      hasNewer: false,
    }
  }

  async loadLatest(
    conversationId: string,
    onCached?: HistoryListener,
  ): Promise<ConversationHistoryWindow> {
    const cached = await this.readLatest(conversationId)
    if (cached.length > 0) {
      onCached?.({
        messages: this.latestWindow(await this.prepare(cached)),
        hasMore: cached.length === HISTORY_PAGE_SIZE,
        hasNewer: false,
      })
    }
    const page = await this.gateway.listMessageHistory(
      conversationId,
      undefined,
      HISTORY_PAGE_SIZE,
    )
    await this.persist(conversationId, page.messages)
    return {
      messages: this.latestWindow(await this.prepare(page.messages)),
      hasMore: page.hasMore,
      hasNewer: false,
    }
  }

  async loadBefore(
    conversationId: string,
    beforeSequence: number,
    current: readonly TimelineMessage[],
    alreadyHasNewer: boolean,
    onCachedFallback?: HistoryListener,
  ): Promise<ConversationHistoryWindow> {
    try {
      const page = await this.gateway.listMessageHistory(
        conversationId,
        beforeSequence,
        HISTORY_PAGE_SIZE,
      )
      await this.persist(conversationId, page.messages)
      if (page.messages.length > 0) {
        return this.mergeOlder(
          current,
          await this.prepare(page.messages),
          page.hasMore,
          alreadyHasNewer,
        )
      }
      const cached = await this.readBefore(conversationId, beforeSequence)
      return this.mergeOlder(
        current,
        await this.prepare(cached),
        cached.length === HISTORY_PAGE_SIZE,
        alreadyHasNewer,
      )
    } catch (error) {
      const cached = await this.readBefore(conversationId, beforeSequence)
      if (cached.length > 0) {
        onCachedFallback?.(this.mergeOlder(
          current,
          await this.prepare(cached),
          cached.length === HISTORY_PAGE_SIZE,
          alreadyHasNewer,
        ))
      }
      throw error
    }
  }

  async loadForward(
    conversationId: string,
    current: readonly TimelineMessage[],
    alreadyHasMore: boolean,
  ): Promise<ConversationHistoryWindow> {
    let messages = [...current]
    let hasMore = alreadyHasMore
    let afterSequence = messages.at(-1)?.sequence ?? 0
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const incoming = await this.gateway.listMessages(conversationId, afterSequence)
      await this.persist(conversationId, incoming)
      const merged = mergeById(messages, await this.prepare(incoming))
      hasMore ||= merged.length > MAX_TIMELINE_MESSAGES
      messages = merged.slice(-MAX_TIMELINE_MESSAGES)
      if (incoming.length < HISTORY_PAGE_SIZE) {
        return { messages, hasMore, hasNewer: false }
      }
      afterSequence = incoming.at(-1)?.sequence ?? afterSequence
    }
    return this.loadLatest(conversationId)
  }

  async loadEndingAtSequence(
    conversationId: string,
    sequence: number,
  ): Promise<ConversationHistoryWindow> {
    if (!Number.isSafeInteger(sequence) || sequence <= 0) return this.loadLatest(conversationId)
    const beforeSequence = sequence === Number.MAX_SAFE_INTEGER ? sequence : sequence + 1
    try {
      const page = await this.gateway.listMessageHistory(
        conversationId,
        beforeSequence,
        HISTORY_PAGE_SIZE,
      )
      await this.persist(conversationId, page.messages)
      if (page.messages.some(message => message.sequence === sequence)) {
        return {
          messages: this.latestWindow(await this.prepare(page.messages)),
          hasMore: page.hasMore,
          hasNewer: true,
        }
      }
    } catch {
      // The encrypted local archive remains a valid device-local fallback.
    }
    const cached = await this.readBefore(conversationId, beforeSequence)
    if (cached.some(message => message.sequence === sequence)) {
      return {
        messages: this.latestWindow(await this.prepare(cached)),
        hasMore: cached.length === HISTORY_PAGE_SIZE,
        hasNewer: true,
      }
    }
    const latestCached = await this.readLatest(conversationId)
    if (latestCached.length > 0) {
      return {
        messages: this.latestWindow(await this.prepare(latestCached)),
        hasMore: latestCached.length === HISTORY_PAGE_SIZE,
        hasNewer: false,
      }
    }
    return this.loadLatest(conversationId)
  }

  async loadMessageWindow(
    conversationId: string,
    messageId: string,
  ): Promise<ConversationHistoryWindow> {
    const target = await this.gateway.getMessage(conversationId, messageId)
    const before = await this.gateway.listMessageHistory(
      conversationId,
      target.sequence,
      HISTORY_PAGE_SIZE - 1,
    )
    const opaque = [...before.messages, target]
    await this.persist(conversationId, opaque)
    return {
      messages: this.latestWindow(await this.prepare(opaque)),
      hasMore: before.hasMore,
      hasNewer: true,
    }
  }

  async fetchTombstone(conversationId: string, messageId: string): Promise<TimelineMessage> {
    const tombstone = await this.gateway.getMessage(conversationId, messageId)
    await this.persist(conversationId, [tombstone])
    return prepareTimelineMessage(tombstone, this.protection)
  }

  async acceptAuthoritativeOutgoing(
    message: OpaqueMessage,
    current: readonly TimelineMessage[],
    hasMore: boolean,
    hasNewer: boolean,
  ): Promise<ConversationHistoryWindow> {
    await this.persist(message.conversationId, [message])
    if (hasNewer) return { messages: [...current], hasMore, hasNewer }
    const merged = mergeById(current, [await prepareTimelineMessage(message, this.protection)])
    return {
      messages: this.latestWindow(merged),
      hasMore: hasMore || merged.length > MAX_TIMELINE_MESSAGES,
      hasNewer: false,
    }
  }

  async persist(conversationId: string, messages: readonly OpaqueMessage[]): Promise<void> {
    if (!this.archiveAvailable || messages.length === 0) return
    try {
      await this.archive.put(this.ownerUserId, conversationId, messages)
    } catch {
      this.archiveAvailable = false
    }
  }

  private async readLatest(conversationId: string): Promise<OpaqueMessage[]> {
    if (!this.archiveAvailable) return []
    try {
      return await this.archive.loadLatest(
        this.ownerUserId,
        conversationId,
        HISTORY_PAGE_SIZE,
      )
    } catch {
      this.archiveAvailable = false
      return []
    }
  }

  private async readBefore(
    conversationId: string,
    beforeSequence: number,
  ): Promise<OpaqueMessage[]> {
    if (!this.archiveAvailable) return []
    try {
      return await this.archive.loadBefore(
        this.ownerUserId,
        conversationId,
        beforeSequence,
        HISTORY_PAGE_SIZE,
      )
    } catch {
      this.archiveAvailable = false
      return []
    }
  }

  private prepare(messages: readonly OpaqueMessage[]): Promise<TimelineMessage[]> {
    return Promise.all(
      messages.map(message => prepareTimelineMessage(message, this.protection)),
    )
  }

  private latestWindow(messages: readonly TimelineMessage[]): TimelineMessage[] {
    return sortMessages(messages).slice(-MAX_TIMELINE_MESSAGES)
  }

  private mergeOlder(
    current: readonly TimelineMessage[],
    incoming: readonly TimelineMessage[],
    hasMore: boolean,
    alreadyHasNewer: boolean,
  ): ConversationHistoryWindow {
    const merged = mergeById(current, incoming)
    if (merged.length > MAX_TIMELINE_MESSAGES) {
      return {
        messages: merged.slice(0, MAX_TIMELINE_MESSAGES),
        hasMore,
        hasNewer: true,
      }
    }
    return { messages: merged, hasMore, hasNewer: alreadyHasNewer }
  }
}
