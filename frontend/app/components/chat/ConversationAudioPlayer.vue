<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { ConversationAudioTrack } from '../../application/messaging/conversation-audio'
import type { AudioMediaSession } from '../../application/ports/audio-media-session'
import type { MessageAttachment } from '../../domain/messaging/models'
import AppIcon from '../ui/AppIcon.vue'

interface AudioPlayRequest {
  trackId: string
  nonce: number
}

const props = defineProps<{
  conversationId: string
  conversationTitle: string
  tracks: readonly ConversationAudioTrack[]
  request: AudioPlayRequest | null
  loadAttachment: (
    conversationId: string,
    attachment: MessageAttachment,
    expiresAt: string,
  ) => Promise<Blob>
  mediaSession: AudioMediaSession
}>()
const emit = defineEmits<{ close: [] }>()

type RepeatMode = 'off' | 'all' | 'one'

const audio = ref<HTMLAudioElement | null>(null)
const activeTrackId = ref<string | null>(null)
const phase = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const playing = ref(false)
const expanded = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const repeatMode = ref<RepeatMode>('off')
const playbackRate = ref(1)
const notice = ref<string | null>(null)
let sourceUrl: string | null = null
let loadRevision = 0
let touchStartY: number | null = null

const activeTrackIndex = computed(() => props.tracks.findIndex(track => (
  track.trackId === activeTrackId.value
)))
const activeTrack = computed(() => activeTrackIndex.value < 0
  ? null
  : props.tracks[activeTrackIndex.value] ?? null)
const progress = computed(() => duration.value > 0
  ? Math.max(0, Math.min(100, currentTime.value / duration.value * 100))
  : 0)
const repeatLabel = computed(() => {
  if (repeatMode.value === 'one') return 'Повторять текущую композицию'
  if (repeatMode.value === 'all') return 'Повторять весь плейлист'
  return 'Повтор выключен'
})

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const whole = Math.floor(value)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function revokeSource(): void {
  if (!sourceUrl) return
  URL.revokeObjectURL(sourceUrl)
  sourceUrl = null
}

function clearMediaSession(): void {
  props.mediaSession.clear()
}

function stopPlayback(): void {
  loadRevision += 1
  const element = audio.value
  if (element) {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }
  revokeSource()
  activeTrackId.value = null
  phase.value = 'idle'
  playing.value = false
  currentTime.value = 0
  duration.value = 0
  notice.value = null
  clearMediaSession()
}

function closePlayer(): void {
  expanded.value = false
  stopPlayback()
  emit('close')
}

function updateMediaSessionMetadata(track: ConversationAudioTrack): void {
  props.mediaSession.setMetadata({
    title: track.title,
    artist: track.senderName,
    album: props.conversationTitle,
  })
}

function updateMediaSessionPosition(): void {
  if (duration.value <= 0) return
  props.mediaSession.setPosition({
    duration: duration.value,
    playbackRate: playbackRate.value,
    position: Math.min(currentTime.value, duration.value),
  })
}

async function playCurrent(): Promise<void> {
  if (!audio.value || !activeTrack.value || phase.value === 'loading') return
  try {
    await audio.value.play()
    notice.value = null
  } catch {
    notice.value = 'Браузер приостановил звук. Нажмите воспроизведение ещё раз.'
  }
}

async function loadTrack(trackId: string, autoplay = true): Promise<void> {
  const track = props.tracks.find(item => item.trackId === trackId)
  const element = audio.value
  if (!track || !element) return
  const revision = ++loadRevision
  element.pause()
  element.removeAttribute('src')
  element.load()
  revokeSource()
  activeTrackId.value = trackId
  phase.value = 'loading'
  playing.value = false
  currentTime.value = 0
  duration.value = 0
  notice.value = null
  updateMediaSessionMetadata(track)
  try {
    const blob = await props.loadAttachment(
      props.conversationId,
      track.attachment,
      track.expiresAt,
    )
    if (revision !== loadRevision) return
    sourceUrl = URL.createObjectURL(blob)
    element.src = sourceUrl
    element.playbackRate = playbackRate.value
    element.load()
    phase.value = 'ready'
    if (autoplay) await playCurrent()
  } catch {
    if (revision !== loadRevision) return
    phase.value = 'error'
    notice.value = 'Аудио недоступно или срок хранения истёк.'
  }
}

async function handleRequest(request: AudioPlayRequest): Promise<void> {
  await nextTick()
  if (request.trackId !== activeTrackId.value || phase.value === 'error') {
    await loadTrack(request.trackId)
    return
  }
  if (playing.value) audio.value?.pause()
  else await playCurrent()
}

async function togglePlayback(): Promise<void> {
  if (!activeTrack.value) return
  if (phase.value === 'error') {
    await loadTrack(activeTrack.value.trackId)
    return
  }
  if (playing.value) audio.value?.pause()
  else await playCurrent()
}

async function moveTrack(direction: -1 | 1): Promise<void> {
  if (props.tracks.length === 0) return
  const current = Math.max(0, activeTrackIndex.value)
  const next = (current + direction + props.tracks.length) % props.tracks.length
  const track = props.tracks[next]
  if (track) await loadTrack(track.trackId)
}

async function finishTrack(): Promise<void> {
  if (repeatMode.value === 'one' && audio.value) {
    audio.value.currentTime = 0
    await playCurrent()
    return
  }
  if (activeTrackIndex.value < props.tracks.length - 1) {
    await moveTrack(1)
    return
  }
  if (repeatMode.value === 'all') {
    const first = props.tracks[0]
    if (first) await loadTrack(first.trackId)
    return
  }
  playing.value = false
  currentTime.value = duration.value
}

function seek(event: Event): void {
  const element = audio.value
  if (!element) return
  const target = event.currentTarget as HTMLInputElement
  const value = Number(target.value)
  if (!Number.isFinite(value)) return
  element.currentTime = Math.max(0, Math.min(value, duration.value))
  currentTime.value = element.currentTime
  updateMediaSessionPosition()
}

function seekBy(seconds: number): void {
  const element = audio.value
  if (!element || duration.value <= 0) return
  element.currentTime = Math.max(0, Math.min(element.currentTime + seconds, duration.value))
  currentTime.value = element.currentTime
  updateMediaSessionPosition()
}

function cycleRepeat(): void {
  repeatMode.value = repeatMode.value === 'off'
    ? 'all'
    : repeatMode.value === 'all' ? 'one' : 'off'
}

function cyclePlaybackRate(): void {
  playbackRate.value = playbackRate.value === 1
    ? 1.25
    : playbackRate.value === 1.25 ? 1.5 : playbackRate.value === 1.5 ? 2 : 1
  if (audio.value) audio.value.playbackRate = playbackRate.value
  updateMediaSessionPosition()
}

function updateDuration(event: Event): void {
  const element = event.currentTarget as HTMLAudioElement
  duration.value = Number.isFinite(element.duration) ? Math.max(0, element.duration) : 0
  updateMediaSessionPosition()
}

function updateTime(event: Event): void {
  currentTime.value = Math.max(0, (event.currentTarget as HTMLAudioElement).currentTime)
  updateMediaSessionPosition()
}

function setPlaying(value: boolean): void {
  playing.value = value
  props.mediaSession.setPlaybackState(value ? 'playing' : 'paused')
}

function markPlaybackError(): void {
  if (!sourceUrl) return
  phase.value = 'error'
  playing.value = false
  notice.value = 'Этот аудиоформат не поддерживается устройством.'
}

function openFullscreen(): void {
  expanded.value = true
}

function minimize(): void {
  expanded.value = false
}

function handleFullscreenKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') minimize()
  if (event.key === ' ' && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault()
    void togglePlayback()
  }
}

function rememberTouch(event: TouchEvent): void {
  touchStartY = event.changedTouches[0]?.clientY ?? null
}

function finishTouch(event: TouchEvent): void {
  const end = event.changedTouches[0]?.clientY
  if (touchStartY !== null && end !== undefined && end - touchStartY > 72) minimize()
  touchStartY = null
}

function seekTo(seconds: number): void {
  if (!audio.value) return
  audio.value.currentTime = Math.max(0, Math.min(seconds, duration.value))
}

watch(
  () => props.request,
  request => { if (request) void handleRequest(request) },
  { immediate: true },
)

watch(
  () => props.tracks,
  tracks => {
    if (activeTrackId.value && !tracks.some(track => track.trackId === activeTrackId.value)) {
      closePlayer()
    }
  },
)

watch(expanded, value => {
  if (value) window.addEventListener('keydown', handleFullscreenKeydown)
  else window.removeEventListener('keydown', handleFullscreenKeydown)
})

let removeMediaSessionControls: (() => void) | null = null

onMounted(() => {
  removeMediaSessionControls = props.mediaSession.setControls({
    play: () => { void playCurrent() },
    pause: () => audio.value?.pause(),
    previous: () => { void moveTrack(-1) },
    next: () => { void moveTrack(1) },
    seekBackward: seconds => seekBy(-seconds),
    seekForward: seekBy,
    seekTo,
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleFullscreenKeydown)
  removeMediaSessionControls?.()
  stopPlayback()
})
</script>

<template>
  <section v-show="!expanded && activeTrack" class="conversation-audio-player" aria-label="Музыкальный плеер">
    <audio
      ref="audio"
      preload="metadata"
      @loadedmetadata="updateDuration"
      @durationchange="updateDuration"
      @timeupdate="updateTime"
      @play="setPlaying(true)"
      @pause="setPlaying(false)"
      @ended="finishTrack"
      @error="markPlaybackError"
    />
    <button
      class="conversation-audio-player__play"
      type="button"
      :aria-label="playing ? 'Пауза' : 'Воспроизвести'"
      :disabled="phase === 'loading'"
      @click="togglePlayback"
    >
      <span v-if="phase === 'loading'" class="loading-orbit" aria-hidden="true" />
      <AppIcon v-else :name="playing ? 'pause' : 'play'" />
    </button>
    <button class="conversation-audio-player__copy" type="button" @click="openFullscreen">
      <strong>{{ activeTrack?.title }}</strong>
      <small>
        {{ activeTrack?.senderName }} · {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
      </small>
    </button>
    <div class="conversation-audio-player__quick-controls">
      <button type="button" aria-label="Предыдущая композиция" @click="moveTrack(-1)">
        <AppIcon name="previous" />
      </button>
      <button type="button" aria-label="Следующая композиция" @click="moveTrack(1)">
        <AppIcon name="next" />
      </button>
      <button type="button" aria-label="Открыть плеер на весь экран" @click="openFullscreen">
        <AppIcon name="expand" />
      </button>
      <button type="button" aria-label="Закрыть плеер" @click="closePlayer">
        <AppIcon name="close" />
      </button>
    </div>
    <span class="conversation-audio-player__progress" :style="{ width: `${progress}%` }" />
  </section>

  <Teleport to="body">
    <Transition name="audio-player-fullscreen">
      <section
        v-if="expanded && activeTrack"
        class="audio-player-fullscreen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-player-title"
        @touchstart.passive="rememberTouch"
        @touchend.passive="finishTouch"
      >
        <header class="audio-player-fullscreen__header">
          <button type="button" aria-label="Свернуть плеер" @click="minimize">
            <AppIcon name="collapse" />
          </button>
          <span>
            <strong id="audio-player-title">Музыка в чате</strong>
            <small>{{ conversationTitle }} · {{ tracks.length }} комп.</small>
          </span>
          <button type="button" aria-label="Закрыть плеер" @click="closePlayer">
            <AppIcon name="close" />
          </button>
        </header>

        <main class="audio-player-fullscreen__main">
          <div class="audio-player-art" aria-hidden="true">
            <span><AppIcon name="music" /></span>
            <i />
          </div>
          <div class="audio-player-fullscreen__track-copy">
            <h2>{{ activeTrack.title }}</h2>
            <p>{{ activeTrack.senderName }}</p>
          </div>
          <p v-if="notice" class="audio-player-fullscreen__notice" role="status">{{ notice }}</p>
          <div class="audio-player-fullscreen__seek">
            <input
              type="range"
              min="0"
              :max="Math.max(0, duration)"
              step="0.1"
              :value="Math.min(currentTime, duration)"
              aria-label="Позиция воспроизведения"
              @input="seek"
            >
            <span><time>{{ formatTime(currentTime) }}</time><time>-{{ formatTime(Math.max(0, duration - currentTime)) }}</time></span>
          </div>
          <div class="audio-player-fullscreen__controls">
            <button
              class="audio-player-fullscreen__secondary"
              type="button"
              :class="{ active: repeatMode !== 'off' }"
              :aria-label="repeatLabel"
              @click="cycleRepeat"
            >
              <AppIcon name="repeat" />
              <b v-if="repeatMode === 'one'">1</b>
            </button>
            <button type="button" aria-label="Предыдущая композиция" @click="moveTrack(-1)">
              <AppIcon name="previous" />
            </button>
            <button
              class="audio-player-fullscreen__play"
              type="button"
              :aria-label="playing ? 'Пауза' : 'Воспроизвести'"
              :disabled="phase === 'loading'"
              @click="togglePlayback"
            >
              <span v-if="phase === 'loading'" class="loading-orbit" aria-hidden="true" />
              <AppIcon v-else :name="playing ? 'pause' : 'play'" />
            </button>
            <button type="button" aria-label="Следующая композиция" @click="moveTrack(1)">
              <AppIcon name="next" />
            </button>
            <button
              class="audio-player-fullscreen__rate"
              type="button"
              aria-label="Изменить скорость воспроизведения"
              @click="cyclePlaybackRate"
            >{{ playbackRate }}×</button>
          </div>
        </main>

        <aside class="audio-player-queue" aria-label="Плейлист этого чата">
          <header>
            <span><AppIcon name="list" /></span>
            <strong>Плейлист этого чата</strong>
          </header>
          <button
            v-for="(track, index) in tracks"
            :key="track.trackId"
            type="button"
            :class="{ active: track.trackId === activeTrackId }"
            :aria-current="track.trackId === activeTrackId ? 'true' : undefined"
            @click="loadTrack(track.trackId)"
          >
            <span class="audio-player-queue__index">
              <AppIcon v-if="track.trackId === activeTrackId && playing" name="speaker" />
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span>
              <strong>{{ track.title }}</strong>
              <small>{{ track.senderName }}</small>
            </span>
          </button>
        </aside>
      </section>
    </Transition>
  </Teleport>
</template>
