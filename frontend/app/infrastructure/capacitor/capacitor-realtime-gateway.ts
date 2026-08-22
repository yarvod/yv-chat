import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import type {
  OutgoingCallSignal,
  RealtimeCallbacks,
  RealtimeConnection,
  RealtimeGateway,
} from '../../application/ports/realtime-gateway'
import { parseRealtimeFrame } from '../realtime/realtime-parser'

interface NativeRealtimeOpenEvent {
  connectionId: number
}

interface NativeRealtimeMessageEvent extends NativeRealtimeOpenEvent {
  data: string
}

interface NativeRealtimeCloseEvent extends NativeRealtimeOpenEvent {
  code: number
}

export interface NativeRealtimePlugin {
  connect(options: { url: string, origin: string, connectionId: number }): Promise<void>
  send(options: { data: string, connectionId: number }): Promise<void>
  close(options: { connectionId: number }): Promise<void>
  addListener(
    eventName: 'realtimeOpen',
    listener: (event: NativeRealtimeOpenEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'realtimeMessage',
    listener: (event: NativeRealtimeMessageEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'realtimeClose',
    listener: (event: NativeRealtimeCloseEvent) => void,
  ): Promise<PluginListenerHandle>
}

const nativeRealtime = registerPlugin<NativeRealtimePlugin>('NativeRealtime')
const UNAUTHORIZED_CLOSE = 4401

export class CapacitorRealtimeGateway implements RealtimeGateway {
  private nextConnectionId = 0

  constructor(
    private readonly apiOrigin: string,
    private readonly appOrigin: string,
    private readonly plugin: NativeRealtimePlugin = nativeRealtime,
  ) {}

  connect(callbacks: RealtimeCallbacks): RealtimeConnection {
    const url = new URL('/api/v1/realtime', this.apiOrigin)
    url.protocol = 'wss:'
    const connectionId = ++this.nextConnectionId
    let open = false
    let explicitlyClosed = false
    let ended = false
    let handles: PluginListenerHandle[] = []

    const removeListeners = (): void => {
      const current = handles
      handles = []
      for (const handle of current) void handle.remove()
    }
    const send = (data: string): void => {
      if (!open || explicitlyClosed) return
      void this.plugin.send({ data, connectionId }).catch(() => {
        open = false
        void this.plugin.close({ connectionId }).catch(() => undefined)
      })
    }
    const start = async (): Promise<void> => {
      handles = await Promise.all([
        this.plugin.addListener('realtimeOpen', event => {
          if (event.connectionId !== connectionId || explicitlyClosed || ended) return
          open = true
          callbacks.onOpen()
        }),
        this.plugin.addListener('realtimeMessage', event => {
          if (event.connectionId !== connectionId || explicitlyClosed) return
          try {
            const frame = parseRealtimeFrame(JSON.parse(event.data) as unknown)
            if (frame.type === 'ping') {
              send(JSON.stringify({ type: 'pong' }))
              return
            }
            callbacks.onFrame(frame)
          } catch {
            if (ended) return
            ended = true
            open = false
            void this.plugin.close({ connectionId }).catch(() => undefined)
            callbacks.onClose({ unauthorized: false })
            removeListeners()
          }
        }),
        this.plugin.addListener('realtimeClose', event => {
          if (event.connectionId !== connectionId || explicitlyClosed || ended) return
          ended = true
          open = false
          callbacks.onClose({ unauthorized: event.code === UNAUTHORIZED_CLOSE })
          removeListeners()
        }),
      ])
      if (explicitlyClosed) {
        removeListeners()
        return
      }
      try {
        await this.plugin.connect({
          url: url.toString(),
          origin: this.appOrigin,
          connectionId,
        })
      } catch {
        if (ended || explicitlyClosed) return
        ended = true
        callbacks.onClose({ unauthorized: false })
        removeListeners()
      }
    }
    void start()

    return {
      setTyping(conversationId: string, active: boolean): void {
        send(JSON.stringify({ type: 'typing', conversation_id: conversationId, active }))
      },
      sendCall(signal: OutgoingCallSignal): boolean {
        if (!open || explicitlyClosed) return false
        send(JSON.stringify(signal))
        return true
      },
      close: (): void => {
        if (explicitlyClosed) return
        explicitlyClosed = true
        open = false
        removeListeners()
        void this.plugin.close({ connectionId }).catch(() => undefined)
      },
    }
  }
}
