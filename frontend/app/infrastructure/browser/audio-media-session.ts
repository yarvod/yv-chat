import type {
  AudioMediaControls,
  AudioMediaMetadata,
  AudioMediaPosition,
  AudioMediaSession,
} from '../../application/ports/audio-media-session'

export class BrowserAudioMediaSession implements AudioMediaSession {
  constructor(
    private readonly navigatorRef: Navigator = window.navigator,
    private readonly createMetadata: ((metadata: MediaMetadataInit) => MediaMetadata) | null = (
      'MediaMetadata' in window ? metadata => new MediaMetadata(metadata) : null
    ),
  ) {}

  private session(): MediaSession | null {
    return 'mediaSession' in this.navigatorRef ? this.navigatorRef.mediaSession : null
  }

  setMetadata(metadata: AudioMediaMetadata): void {
    const session = this.session()
    if (!session || !this.createMetadata) return
    session.metadata = this.createMetadata(metadata)
  }

  setPlaybackState(state: 'none' | 'paused' | 'playing'): void {
    const session = this.session()
    if (session) session.playbackState = state
  }

  setPosition(position: AudioMediaPosition): void {
    const session = this.session()
    if (!session || typeof session.setPositionState !== 'function') return
    try {
      session.setPositionState(position)
    } catch {
      // Some browsers expose Media Session but reject position state for blob audio.
    }
  }

  setControls(controls: AudioMediaControls): () => void {
    const session = this.session()
    if (!session) return () => undefined
    const handlers: ReadonlyArray<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', controls.play],
      ['pause', controls.pause],
      ['previoustrack', controls.previous],
      ['nexttrack', controls.next],
      ['seekbackward', details => controls.seekBackward(details.seekOffset ?? 10)],
      ['seekforward', details => controls.seekForward(details.seekOffset ?? 10)],
      ['seekto', details => {
        if (details.seekTime !== undefined) controls.seekTo(details.seekTime)
      }],
    ]
    const installed: MediaSessionAction[] = []
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
        installed.push(action)
      } catch {
        // Capability differs across otherwise Media Session-aware browsers.
      }
    }
    return () => {
      for (const action of installed) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // Ignore partial implementations during cleanup.
        }
      }
    }
  }

  clear(): void {
    const session = this.session()
    if (!session) return
    session.metadata = null
    session.playbackState = 'none'
  }
}
