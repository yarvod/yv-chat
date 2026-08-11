export interface ScheduledTask {
  cancel(): void
}

export interface Scheduler {
  once(delayMs: number, callback: () => void): ScheduledTask
  repeat(intervalMs: number, callback: () => void): ScheduledTask
}
