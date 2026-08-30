import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import VoiceCallMiniBar from '../app/components/chat/VoiceCallMiniBar.vue'
import VoiceCallOverlay from '../app/components/chat/VoiceCallOverlay.vue'
import type { VoiceCallState } from '../app/domain/calls/voice-call'

function callState(overrides: Partial<VoiceCallState> = {}): VoiceCallState {
  return {
    phase: 'active',
    conversationId: 'conversation-1',
    callId: 'call-1',
    muted: false,
    startedAt: Date.now() - 125_000,
    notice: null,
    audioOutputSupported: false,
    audioOutputPickerSupported: false,
    audioOutputs: [],
    selectedAudioOutputId: '',
    identityVerified: true,
    verificationCode: '1234 5678 9012',
    cameraSupported: true,
    cameraEnabled: false,
    cameraBusy: false,
    cameraFacingMode: 'user',
    screenShareSupported: false,
    screenSharing: false,
    remoteVideoEnabled: false,
    ...overrides,
  }
}

const actions = () => ({
  accept: vi.fn().mockResolvedValue(undefined),
  reject: vi.fn(),
  hangup: vi.fn(),
  toggleMute: vi.fn(),
  toggleCamera: vi.fn().mockResolvedValue(undefined),
  toggleScreenShare: vi.fn().mockResolvedValue(undefined),
  resumeAudio: vi.fn(),
})

const videoActions = () => ({
  switchCamera: vi.fn().mockResolvedValue(undefined),
  attachVideoElements: vi.fn(),
})

afterEach(() => {
  vi.useRealTimers()
})

describe('voice call presentation', () => {
  it('minimizes an ongoing full-screen call without touching call actions', async () => {
    const minimize = vi.fn()
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState(),
        peerName: 'Алиса',
        minimize,
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...videoActions(),
        ...actions(),
      },
    })

    expect(wrapper.text()).toContain('Алиса')
    expect(wrapper.text()).toContain('02:05')
    await wrapper.get('[aria-label="Свернуть звонок"]').trigger('click')
    expect(minimize).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('shows and selects the real full-screen audio routes', async () => {
    const selectAudioOutput = vi.fn().mockResolvedValue(undefined)
    const requestAudioOutput = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState({
          audioOutputSupported: true,
          audioOutputPickerSupported: true,
          selectedAudioOutputId: 'speaker',
          audioOutputs: [
            { deviceId: 'speaker', label: 'Speakerphone', kind: 'speaker' },
            { deviceId: 'receiver', label: 'Receiver', kind: 'earpiece' },
            { deviceId: 'buds', label: 'Bluetooth Buds', kind: 'bluetooth' },
          ],
        }),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput,
        requestAudioOutput,
        ...videoActions(),
        ...actions(),
      },
    })

    expect(wrapper.text()).not.toContain('Куда выводить звук')
    await wrapper.get('[aria-label="Выбрать аудиовыход"]').trigger('click')
    expect(wrapper.text()).toContain('Куда выводить звук')
    expect(wrapper.text()).toContain('Громкая связь')
    expect(wrapper.text()).toContain('Телефон')
    expect(wrapper.text()).toContain('Bluetooth')
    expect(wrapper.get('[aria-pressed="true"]').text()).toContain('Громкая связь')

    const routes = wrapper.findAll('.voice-call__route')
    await routes.find(route => route.text().includes('Телефон'))?.trigger('click')
    await wrapper.get('[aria-label="Выбрать аудиовыход"]').trigger('click')
    await wrapper.findAll('.voice-call__route')
      .find(route => route.text().includes('Выбрать устройство'))?.trigger('click')

    expect(selectAudioOutput).toHaveBeenCalledWith('receiver')
    expect(requestAudioOutput).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('explains system routing when the browser cannot select an output', async () => {
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState(),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...videoActions(),
        ...actions(),
      },
    })

    await wrapper.get('[aria-label="Выбрать аудиовыход"]').trigger('click')
    expect(wrapper.text()).toContain('маршрут выбирается в системном меню звука')
    expect(wrapper.text()).toContain('громкая связь')
    wrapper.unmount()
  })

  it('keeps timer and essential controls in the compact header', async () => {
    const expand = vi.fn()
    const handlers = actions()
    const wrapper = mount(VoiceCallMiniBar, {
      props: {
        state: callState({ muted: true }),
        peerName: 'Борис',
        expand,
        ...handlers,
      },
    })

    expect(wrapper.get('.voice-call-mini__copy').text()).toContain('Борис')
    expect(wrapper.get('.voice-call-mini__copy').text()).toContain('02:05')
    expect(wrapper.get('[aria-label="Включить микрофон"]').exists()).toBe(true)

    await wrapper.get('[aria-label="Развернуть звонок с Борис"]').trigger('click')
    await wrapper.get('[aria-label="Включить микрофон"]').trigger('click')
    await wrapper.get('[aria-label="Завершить звонок"]').trigger('click')

    expect(expand).toHaveBeenCalledOnce()
    expect(handlers.toggleMute).toHaveBeenCalledOnce()
    expect(handlers.hangup).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('shows remote video, mirrored local preview and camera controls', async () => {
    const handlers = actions()
    const video = videoActions()
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState({ cameraEnabled: true, remoteVideoEnabled: true }),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...video,
        ...handlers,
      },
    })

    expect(wrapper.get('.voice-call__remote-video').attributes('muted')).toBeDefined()
    expect(wrapper.get('.voice-call__local-video').classes())
      .toContain('voice-call__local-video--mirrored')
    await wrapper.get('[aria-label="Выключить камеру"]').trigger('click')
    await wrapper.get('[aria-label="Переключить камеру"]').trigger('click')
    expect(handlers.toggleCamera).toHaveBeenCalledOnce()
    expect(video.switchCamera).toHaveBeenCalledOnce()
    wrapper.unmount()
    expect(video.attachVideoElements).toHaveBeenLastCalledWith(null, null)
  })

  it('suppresses call video while sharing to prevent recursive capture', async () => {
    const handlers = actions()
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState({
          screenShareSupported: true,
          screenSharing: true,
          remoteVideoEnabled: true,
        }),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...videoActions(),
        ...handlers,
      },
    })

    expect(wrapper.text()).toContain('Вы показываете экран')
    expect(wrapper.text()).toContain('Видео собеседника скрыто')
    expect(wrapper.find('.voice-call__local-video').exists()).toBe(false)
    expect(wrapper.get('.voice-call__remote-video').classes())
      .toContain('voice-call__remote-video--suppressed')
    expect(wrapper.get('.voice-call__remote-video').attributes('aria-hidden')).toBe('true')
    await wrapper.get('[aria-label="Остановить демонстрацию экрана"]').trigger('click')
    expect(handlers.toggleScreenShare).toHaveBeenCalledOnce()
    await wrapper.setProps({
      state: callState({ screenShareSupported: true, remoteVideoEnabled: true }),
    })
    expect(wrapper.find('.voice-call__video-placeholder').exists()).toBe(false)
    expect(wrapper.get('.voice-call__remote-video').classes())
      .not.toContain('voice-call__remote-video--suppressed')
    expect(wrapper.get('.voice-call__remote-video').attributes('aria-hidden')).toBe('false')
    wrapper.unmount()
  })

  it('disables screen sharing when the system capture picker is unavailable', () => {
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState({ screenShareSupported: false }),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...videoActions(),
        ...actions(),
      },
    })

    expect(wrapper.get('[aria-label="Показать экран"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('contains strongly mismatched portrait video and covers matching landscape video', async () => {
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState({ remoteVideoEnabled: true }),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...videoActions(),
        ...actions(),
      },
    })
    const remote = wrapper.get('.voice-call__remote-video')
    Object.defineProperties(remote.element, {
      videoWidth: { configurable: true, value: 720 },
      videoHeight: { configurable: true, value: 1_280 },
      clientWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 720 },
    })

    await remote.trigger('resize')
    expect(remote.classes()).toContain('voice-call__remote-video--contained')

    Object.defineProperties(remote.element, {
      videoWidth: { configurable: true, value: 1_280 },
      videoHeight: { configurable: true, value: 720 },
    })
    await remote.trigger('resize')
    expect(remote.classes()).not.toContain('voice-call__remote-video--contained')
    wrapper.unmount()
  })

  it('always mounts the full-screen remote video sink before camera media arrives', async () => {
    const video = videoActions()
    const wrapper = mount(VoiceCallOverlay, {
      props: {
        state: callState({ cameraEnabled: false, remoteVideoEnabled: false }),
        peerName: 'Алиса',
        minimize: vi.fn(),
        dismiss: vi.fn(),
        selectAudioOutput: vi.fn().mockResolvedValue(undefined),
        requestAudioOutput: vi.fn().mockResolvedValue(undefined),
        ...video,
        ...actions(),
      },
    })

    expect(wrapper.get('.voice-call__stage').exists()).toBe(true)
    expect(wrapper.get('.voice-call__remote-video').exists()).toBe(true)
    expect(wrapper.get('.voice-call__video-placeholder').exists()).toBe(true)
    await wrapper.vm.$nextTick()
    expect(video.attachVideoElements).toHaveBeenCalledWith(null, expect.any(HTMLVideoElement))
    wrapper.unmount()
  })

  it('offers accept and reject when an incoming call is compact', async () => {
    const handlers = actions()
    const wrapper = mount(VoiceCallMiniBar, {
      props: {
        state: callState({ phase: 'incoming', startedAt: null, notice: null }),
        peerName: 'Вера',
        expand: vi.fn(),
        ...handlers,
      },
    })

    expect(wrapper.text()).toContain('Входящий звонок')
    expect(wrapper.find('[aria-label="Выключить микрофон"]').exists()).toBe(false)
    await wrapper.get('[aria-label="Ответить на звонок"]').trigger('click')
    await wrapper.get('[aria-label="Отклонить звонок"]').trigger('click')
    expect(handlers.accept).toHaveBeenCalledOnce()
    expect(handlers.reject).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('resets compact mode for a new or terminal call state', () => {
    const workspace = readFileSync(
      resolve(process.cwd(), 'app/components/chat/ChatWorkspace.vue'),
      'utf8',
    )

    expect(workspace).toContain("{ 'messenger-shell--call-minimized': callMinimized }")
    expect(workspace).toContain('callState.phase !== \'idle\' && callMinimized')
    expect(workspace).toContain('callState.phase !== \'idle\' && !callMinimized')
    expect(workspace).toMatch(/\(\) => callState\.value\.callId,[\s\S]*callMinimized\.value = false/)
    expect(workspace).toMatch(/phase === 'idle' \|\| phase === 'ended' \|\| phase === 'error'/)
    expect(workspace.indexOf('<VoiceCallOverlay')).toBeLessThan(
      workspace.indexOf('<div v-else class="workspace-main">'),
    )
  })
})
