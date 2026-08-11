import type { RealtimeCloseReason, RealtimeFrame } from '../../domain/messaging/realtime'

export interface RealtimeConnection {
  close(): void
}

export interface RealtimeCallbacks {
  onFrame(frame: RealtimeFrame): void
  onOpen(): void
  onClose(reason: RealtimeCloseReason): void
}

export interface RealtimeGateway {
  connect(callbacks: RealtimeCallbacks): RealtimeConnection
}
