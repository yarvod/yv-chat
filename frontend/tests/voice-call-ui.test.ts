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
    audioOutputs: [],
    selectedAudioOutputId: '',
    ...overrides,
  }
}

const actions = () => ({
  accept: vi.fn().mockResolvedValue(undefined),
  reject: vi.fn(),
  hangup: vi.fn(),
  toggleMute: vi.fn(),
  resumeAudio: vi.fn(),
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
        ...actions(),
      },
    })

    expect(wrapper.text()).toContain('Алиса')
    expect(wrapper.text()).toContain('02:05')
    await wrapper.get('[aria-label="Свернуть звонок"]').trigger('click')
    expect(minimize).toHaveBeenCalledOnce()
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
  })
})
