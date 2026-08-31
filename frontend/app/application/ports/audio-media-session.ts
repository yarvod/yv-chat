export interface AudioMediaMetadata {
  title: string
  artist: string
  album: string
}

export interface AudioMediaPosition {
  duration: number
  playbackRate: number
  position: number
}

export interface AudioMediaControls {
  play: () => void
  pause: () => void
  previous: () => void
  next: () => void
  seekBackward: (seconds: number) => void
  seekForward: (seconds: number) => void
  seekTo: (seconds: number) => void
}

export interface AudioMediaSession {
  setMetadata(metadata: AudioMediaMetadata): void
  setPlaybackState(state: 'none' | 'paused' | 'playing'): void
  setPosition(position: AudioMediaPosition): void
  setControls(controls: AudioMediaControls): () => void
  clear(): void
}
