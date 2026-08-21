import type { PluginListenerHandle } from '@capacitor/core'
import { describe, expect, it } from 'vitest'

import {
  CapacitorCallAudio,
  type CallAudioPlugin,
} from '../app/infrastructure/capacitor/capacitor-call-audio'

class FakeCallAudioPlugin implements CallAudioPlugin {
  route: 'system' | 'earpiece' | 'speaker' = 'system'
  video = false
  proximity = false
  deactivations = 0
  routeListener: ((state: { selectedRoute: string, earpieceAvailable: boolean }) => void) | null
    = null

  async activate(options: { video: boolean }) {
    this.video = options.video
    return { selectedRoute: this.route, earpieceAvailable: true }
  }

  async setVideo(options: { video: boolean }) {
    this.video = options.video
    return { selectedRoute: this.route, earpieceAvailable: true }
  }

  async setRoute(options: { route: 'system' | 'earpiece' | 'speaker' }) {
    this.route = options.route
    return { selectedRoute: this.route, earpieceAvailable: true }
  }

  async setProximity(options: { enabled: boolean }): Promise<void> {
    this.proximity = options.enabled
  }

  async deactivate(): Promise<void> {
    this.deactivations += 1
  }

  async addListener(
    _eventName: 'routeChanged',
    listener: (state: { selectedRoute?: unknown, earpieceAvailable?: unknown }) => void,
  ): Promise<PluginListenerHandle> {
    this.routeListener = listener
    return { remove: async () => { this.routeListener = null } }
  }
}

describe('CapacitorCallAudio', () => {
  it('maps only platform call controls and never persists route state', async () => {
    localStorage.clear()
    const plugin = new FakeCallAudioPlugin()
    const adapter = new CapacitorCallAudio(plugin)

    expect(await adapter.activate(false)).toEqual({
      selectedRoute: 'system',
      outputs: [
        { deviceId: 'native:earpiece', label: 'Разговорный динамик', kind: 'earpiece' },
        { deviceId: 'native:speaker', label: 'Встроенный динамик', kind: 'speaker' },
      ],
    })
    expect(await adapter.selectRoute('speaker')).toMatchObject({ selectedRoute: 'speaker' })
    await adapter.setProximity(true)
    await adapter.setVideo(true)
    await adapter.deactivate()

    expect(plugin).toMatchObject({ route: 'speaker', proximity: true, video: true })
    expect(plugin.deactivations).toBe(1)
    expect(localStorage.length).toBe(0)
  })

  it('forwards OS route changes and hides an unavailable earpiece', async () => {
    const plugin = new FakeCallAudioPlugin()
    const adapter = new CapacitorCallAudio(plugin)
    const states: object[] = []
    const stop = await adapter.subscribe(state => states.push(state))

    plugin.routeListener?.({ selectedRoute: 'speaker', earpieceAvailable: false })

    expect(states).toEqual([{
      selectedRoute: 'speaker',
      outputs: [{ deviceId: 'native:speaker', label: 'Встроенный динамик', kind: 'speaker' }],
    }])
    await stop()
    expect(plugin.routeListener).toBeNull()
  })
})
