import type { Clock } from '../../application/ports/clock'

export class BrowserClock implements Clock {
  nowMilliseconds(): number {
    return Date.now()
  }
}
