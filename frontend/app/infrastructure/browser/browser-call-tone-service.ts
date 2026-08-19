export interface CallTonePlayer {
  unlock(): void
  startIncoming(): void
  startOutgoing(): void
  stop(): void
  dispose(): void
}

type ToneKind = 'incoming' | 'outgoing'

export class BrowserCallToneService implements CallTonePlayer {
  private context: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private active: ToneKind | null = null

  constructor() {
    document.addEventListener('pointerdown', this.unlock, true)
    document.addEventListener('keydown', this.unlock, true)
  }

  readonly unlock = (): void => {
    const context = this.ensureContext()
    if (!context) return
    void context.resume().then(() => {
      if (this.active) this.playPattern(this.active)
    }).catch(() => undefined)
  }

  startIncoming(): void {
    this.start('incoming', 2_400)
  }

  startOutgoing(): void {
    this.start('outgoing', 3_200)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.active = null
  }

  dispose(): void {
    this.stop()
    document.removeEventListener('pointerdown', this.unlock, true)
    document.removeEventListener('keydown', this.unlock, true)
    void this.context?.close().catch(() => undefined)
    this.context = null
  }

  private start(kind: ToneKind, intervalMilliseconds: number): void {
    this.stop()
    this.active = kind
    this.playPattern(kind)
    this.timer = setInterval(() => this.playPattern(kind), intervalMilliseconds)
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context
    if (typeof AudioContext === 'undefined') return null
    this.context = new AudioContext()
    return this.context
  }

  private playPattern(kind: ToneKind): void {
    const context = this.ensureContext()
    if (!context || context.state !== 'running') return
    if (kind === 'incoming') {
      this.note(context, 659.25, 0, 0.24, 0.12)
      this.note(context, 783.99, 0.3, 0.24, 0.11)
      this.note(context, 987.77, 0.6, 0.34, 0.1)
      return
    }
    this.note(context, 440, 0, 0.9, 0.055)
    this.note(context, 480, 0, 0.9, 0.045)
  }

  private note(
    context: AudioContext,
    frequency: number,
    delaySeconds: number,
    durationSeconds: number,
    volume: number,
  ): void {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + delaySeconds
    const end = start + durationSeconds
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(end + 0.02)
  }
}
