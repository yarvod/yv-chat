import type { ArchivedMessage, MessageArchive } from '../ports/message-archive'
import type { MessagingGateway } from '../ports/messaging-gateway'
import type { OpaqueMessage } from '../../domain/messaging/models'
import type { ProtocolMessageProtection } from './message-protection'
import { prepareTimelineMessage, type TimelineMessage } from './timeline-message'

const HISTORY_PAGE_SIZE = 100
const MAX_TIMELINE_MESSAGES = 300
const ANCHOR_BEFORE_LIMIT = 50
const ANCHOR_AFTER_LIMIT = 50
const MAX_SEARCH_MESSAGES = 2_000
const MAX_SEARCH_RESULTS = 100
const MAX_RETENTION_DRAIN_PAGES = 1_000

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

  /**
   * Cache every still-retained message while the local MLS group is still on
   * its current epoch.  The forward endpoint is intentional: processing the
   * sender ratchet in authoritative sequence order avoids turning a backwards
   * history pagination request into artificial out-of-order delivery.
   */
  async cacheRetainedBeforeEpochAdvance(conversationId: string): Promise<void> {
    let afterSequence = 0
    for (let pageNumber = 0; pageNumber < MAX_RETENTION_DRAIN_PAGES; pageNumber += 1) {
      const messages = await this.gateway.listMessages(conversationId, afterSequence)
      if (messages.length === 0) return
      const ordered = [...messages].sort((left, right) => left.sequence - right.sequence)
      const nextSequence = ordered.at(-1)?.sequence ?? afterSequence
      if (nextSequence <= afterSequence) {
        throw new TypeError('message retention drain did not advance')
      }
      await this.persist(conversationId, ordered)
      await this.prepare(ordered)
      if (messages.length < HISTORY_PAGE_SIZE) return
      afterSequence = nextSequence
    }
    throw new TypeError('message retention drain exceeded its safety bound')
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

  async loadCachedEndingAtSequence(
    conversationId: string,
    sequence: number,
  ): Promise<ConversationHistoryWindow | null> {
    if (!Number.isSafeInteger(sequence) || sequence <= 0) return null
    const beforeSequence = sequence === Number.MAX_SAFE_INTEGER ? sequence : sequence + 1
    const [cachedBefore, cachedAfter] = await Promise.all([
      this.readBefore(conversationId, beforeSequence, ANCHOR_BEFORE_LIMIT),
      this.readAfter(conversationId, sequence, ANCHOR_AFTER_LIMIT + 1),
    ])
    if (!cachedBefore.some(message => message.sequence === sequence)) return null
    return {
      messages: this.latestWindow(await this.prepare([
        ...cachedBefore,
        ...cachedAfter.slice(0, ANCHOR_AFTER_LIMIT),
      ])),
      hasMore: cachedBefore.length === ANCHOR_BEFORE_LIMIT,
      hasNewer: cachedAfter.length > ANCHOR_AFTER_LIMIT,
    }
  }

  async loadLatest(
    conversationId: string,
    onCached?: HistoryListener,
  ): Promise<ConversationHistoryWindow> {
    const cached = await this.readLatest(conversationId)
    const cachedPrepared = cached.length > 0 ? await this.prepare(cached) : []
    if (cached.length > 0) {
      onCached?.({
        messages: this.latestWindow(cachedPrepared),
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
      messages: this.latestWindow(await this.prepare(page.messages, cachedPrepared)),
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
          await this.prepare(page.messages, current),
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
      const merged = mergeById(messages, await this.prepare(incoming, messages))
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
    onCached?: HistoryListener,
  ): Promise<ConversationHistoryWindow> {
    if (!Number.isSafeInteger(sequence) || sequence <= 0) return this.loadLatest(conversationId)
    const beforeSequence = sequence === Number.MAX_SAFE_INTEGER ? sequence : sequence + 1
    const [cachedBefore, cachedAfter] = await Promise.all([
      this.readBefore(conversationId, beforeSequence, ANCHOR_BEFORE_LIMIT),
      this.readAfter(conversationId, sequence, ANCHOR_AFTER_LIMIT + 1),
    ])
    const cachedOpaque = [
      ...cachedBefore,
      ...cachedAfter.slice(0, ANCHOR_AFTER_LIMIT),
    ]
    const cachedPrepared = cachedBefore.some(message => message.sequence === sequence)
      ? await this.prepare(cachedOpaque)
      : []
    const cachedWindow = cachedPrepared.length > 0
      ? {
          messages: this.latestWindow(cachedPrepared),
          hasMore: cachedBefore.length === ANCHOR_BEFORE_LIMIT,
          hasNewer: cachedAfter.length > ANCHOR_AFTER_LIMIT,
        }
      : null
    if (cachedWindow) onCached?.(cachedWindow)
    try {
      const [page, newer] = await Promise.all([
        this.gateway.listMessageHistory(
          conversationId,
          beforeSequence,
          ANCHOR_BEFORE_LIMIT,
        ),
        this.gateway.listMessages(conversationId, sequence),
      ])
      const opaque = [...page.messages, ...newer.slice(0, ANCHOR_AFTER_LIMIT)]
      await this.persist(conversationId, opaque)
      if (page.messages.some(message => message.sequence === sequence)) {
        return {
          messages: this.latestWindow(await this.prepare(opaque, cachedPrepared)),
          hasMore: page.hasMore,
          hasNewer: newer.length > ANCHOR_AFTER_LIMIT,
        }
      }
    } catch {
      // The encrypted local archive remains a valid device-local fallback.
    }
    if (cachedWindow) return cachedWindow
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
    const [before, newer] = await Promise.all([
      this.gateway.listMessageHistory(
        conversationId,
        target.sequence,
        ANCHOR_BEFORE_LIMIT - 1,
      ),
      this.gateway.listMessages(conversationId, target.sequence),
    ])
    const opaque = [
      ...before.messages,
      target,
      ...newer.slice(0, ANCHOR_AFTER_LIMIT),
    ]
    await this.persist(conversationId, opaque)
    return {
      messages: this.latestWindow(await this.prepare(opaque)),
      hasMore: before.hasMore,
      hasNewer: newer.length > ANCHOR_AFTER_LIMIT,
    }
  }

  async fetchTombstone(conversationId: string, messageId: string): Promise<TimelineMessage> {
    const tombstone = await this.gateway.getMessage(conversationId, messageId)
    await this.persist(conversationId, [tombstone])
    return prepareTimelineMessage(tombstone, this.protection)
  }

  async search(conversationId: string, query: string): Promise<TimelineMessage[]> {
    const normalized = query.trim().toLocaleLowerCase('ru-RU')
    if (!normalized || normalized.length > 100) return []
    const opaque = new Map<string, OpaqueMessage>()
    let beforeSequence: number | undefined
    for (let pageNumber = 0; pageNumber < MAX_SEARCH_MESSAGES / HISTORY_PAGE_SIZE; pageNumber += 1) {
      const page = await this.gateway.listMessageHistory(
        conversationId,
        beforeSequence,
        HISTORY_PAGE_SIZE,
      )
      for (const message of page.messages) opaque.set(message.messageId, message)
      await this.persist(conversationId, page.messages)
      if (!page.hasMore || page.oldestSequence === null) break
      beforeSequence = page.oldestSequence
    }
    const prepared = await this.prepare(
      [...opaque.values()].sort((left, right) => left.sequence - right.sequence),
    )
    return prepared.filter(message => (
      message.contentState === 'available'
      && message.displayBody?.toLocaleLowerCase('ru-RU').includes(normalized)
    )).slice(-MAX_SEARCH_RESULTS)
  }

  async acceptAuthoritativeOutgoing(
    message: OpaqueMessage,
    localPlaintext: string | undefined,
    current: readonly TimelineMessage[],
    hasMore: boolean,
    hasNewer: boolean,
  ): Promise<ConversationHistoryWindow> {
    const archived: ArchivedMessage = {
      ...message,
      ...(localPlaintext ? { localPlaintext } : {}),
    }
    await this.persist(message.conversationId, [archived])
    if (hasNewer) return { messages: [...current], hasMore, hasNewer }
    const merged = mergeById(current, [await prepareTimelineMessage(archived, this.protection)])
    return {
      messages: this.latestWindow(merged),
      hasMore: hasMore || merged.length > MAX_TIMELINE_MESSAGES,
      hasNewer: false,
    }
  }

  async persist(conversationId: string, messages: readonly ArchivedMessage[]): Promise<void> {
    if (!this.archiveAvailable || messages.length === 0) return
    try {
      await this.archive.put(this.ownerUserId, conversationId, messages)
    } catch {
      this.archiveAvailable = false
    }
  }

  private async readLatest(conversationId: string): Promise<ArchivedMessage[]> {
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
    limit: number = HISTORY_PAGE_SIZE,
  ): Promise<ArchivedMessage[]> {
    if (!this.archiveAvailable) return []
    try {
      return await this.archive.loadBefore(
        this.ownerUserId,
        conversationId,
        beforeSequence,
        limit,
      )
    } catch {
      this.archiveAvailable = false
      return []
    }
  }

  private async readAfter(
    conversationId: string,
    afterSequence: number,
    limit: number,
  ): Promise<ArchivedMessage[]> {
    if (!this.archiveAvailable) return []
    try {
      return await this.archive.loadAfter(
        this.ownerUserId,
        conversationId,
        afterSequence,
        limit,
      )
    } catch {
      this.archiveAvailable = false
      return []
    }
  }

  private async prepare(
    messages: readonly ArchivedMessage[],
    reusable: readonly TimelineMessage[] = [],
  ): Promise<TimelineMessage[]> {
    const reusableById = new Map(reusable.map(message => [message.messageId, message]))
    const prepared: TimelineMessage[] = []
    const recoveredForArchive: ArchivedMessage[] = []
    for (const message of messages) {
      const existing = reusableById.get(message.messageId)
      if (
        existing
        && existing.sequence === message.sequence
        && existing.protocolVersion === message.protocolVersion
        && existing.cryptoGenerationId === message.cryptoGenerationId
        && existing.cryptoEpoch === message.cryptoEpoch
        && existing.ciphertextBase64 === message.ciphertextBase64
        && existing.expiresAt === message.expiresAt
        && existing.deletedAt === message.deletedAt
        && existing.deletionReason === message.deletionReason
      ) {
        prepared.push(existing)
        continue
      }
      let recoverable = message
      if (message.ciphertextBase64 !== null && message.localPlaintext === undefined) {
        try {
          const content = await this.protection.unprotectText(message.protocolVersion, {
            conversationId: message.conversationId,
            clientMessageId: message.clientMessageId,
            ciphertextBase64: message.ciphertextBase64,
          })
          recoverable = { ...message, localPlaintext: content.plaintext }
          recoveredForArchive.push(recoverable)
        } catch {
          // Missing/deleted MLS sender keys remain an explicit unavailable gap.
        }
      }
      prepared.push(await prepareTimelineMessage(recoverable, this.protection))
    }
    if (this.archiveAvailable) {
      try {
        for (let offset = 0; offset < recoveredForArchive.length; offset += HISTORY_PAGE_SIZE) {
          const page = recoveredForArchive.slice(offset, offset + HISTORY_PAGE_SIZE)
          if (page.length > 0) {
            await this.archive.put(this.ownerUserId, page[0]!.conversationId, page)
          }
        }
      } catch {
        this.archiveAvailable = false
      }
    }
    return prepared
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
