export type VideoNoteFacingMode = 'user' | 'environment'

export const VIDEO_NOTE_MAX_DURATION_MS = 60_000
export const VIDEO_NOTE_MAX_BYTES = 8 * 1024 * 1024

export interface RecordedVideoNote {
  body: Blob
  contentType: 'video/mp4' | 'video/webm'
  durationSeconds: number
}

export interface VideoNoteRecordingSession {
  readonly previewStream: MediaStream
  readonly facingMode: VideoNoteFacingMode
  readonly recording: boolean
  start(): void
  switchCamera(): Promise<MediaStream>
  stop(): Promise<RecordedVideoNote>
  cancel(): Promise<void>
}

export interface VideoNoteRecorder {
  isSupported(): boolean
  open(facingMode: VideoNoteFacingMode): Promise<VideoNoteRecordingSession>
}
