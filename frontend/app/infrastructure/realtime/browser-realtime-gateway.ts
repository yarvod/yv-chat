import type {
  RealtimeCallbacks,
  RealtimeConnection,
  RealtimeGateway,
} from '../../application/ports/realtime-gateway'
import { parseRealtimeFrame } from './realtime-parser'

const UNAUTHORIZED_CLOSE = 4401
const INVALID_PAYLOAD_CLOSE = 4400

export class BrowserRealtimeGateway implements RealtimeGateway {
  connect(callbacks: RealtimeCallbacks): RealtimeConnection {
    const url = new URL('/api/v1/realtime', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    let explicitlyClosed = false
    socket.addEventListener('open', callbacks.onOpen)
    socket.addEventListener('message', event => {
      try {
        const frame = parseRealtimeFrame(JSON.parse(String(event.data)) as unknown)
        if (frame.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
          return
        }
        callbacks.onFrame(frame)
      } catch {
        socket.close(INVALID_PAYLOAD_CLOSE, 'invalid frame')
      }
    })
    socket.addEventListener('close', event => {
      if (!explicitlyClosed) {
        callbacks.onClose({ unauthorized: event.code === UNAUTHORIZED_CLOSE })
      }
    })
    socket.addEventListener('error', () => {
      socket.close()
    })
    return {
      setTyping(conversationId: string, active: boolean): void {
        if (socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({ type: 'typing', conversation_id: conversationId, active }))
      },
      close(): void {
        explicitlyClosed = true
        socket.close(1000, 'page closed')
      },
    }
  }
}
