import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClearDeviceMediaCache } from '../app/application/storage/clear-device-media-cache'
import DeviceStorageCard from '../app/components/settings/DeviceStorageCard.vue'

afterEach(() => vi.unstubAllGlobals())

describe('device storage settings', () => {
  it('invalidates decrypted hot media before persistent device cache deletion', async () => {
    const order: string[] = []
    const hotCache = {
      clearMemory: vi.fn(() => order.push('hot')),
    }
    const cache = {
      load: vi.fn(),
      store: vi.fn(),
      remove: vi.fn(),
      inspect: vi.fn(),
      clear: vi.fn(async () => {
        order.push('persistent')
        return { usedBytes: 0, entryCount: 0, limitBytes: 1024 }
      }),
      close: vi.fn(),
    }

    await new ClearDeviceMediaCache(cache, hotCache).execute('user-1', 'device-1')

    expect(order).toEqual(['hot', 'persistent'])
    expect(hotCache.clearMemory).toHaveBeenCalledWith('user-1', 'device-1')
    expect(cache.clear).toHaveBeenCalledWith('user-1', 'device-1')
  })

  it('shows media usage and requires confirmation before clearing only that device scope', async () => {
    const inspect = vi.fn().mockResolvedValue({
      usedBytes: 12 * 1024 * 1024,
      entryCount: 3,
      limitBytes: 2 * 1024 * 1024 * 1024,
    })
    const clear = vi.fn().mockResolvedValue({
      usedBytes: 0,
      entryCount: 0,
      limitBytes: 2 * 1024 * 1024 * 1024,
    })
    const perform = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        inspectDeviceMediaCache: { execute: inspect },
        clearDeviceMediaCache: { execute: clear },
        haptics: { perform },
      },
    }))
    const wrapper = mount(DeviceStorageCard, {
      props: { ownerUserId: 'user-1', ownerDeviceId: 'device-1' },
    })
    await flushPromises()

    expect(inspect).toHaveBeenCalledWith('user-1', 'device-1')
    expect(wrapper.text()).toContain('12 МиБ')
    expect(wrapper.text()).toContain('из 2 ГиБ')
    expect(wrapper.text()).toContain('3 локальных файла')
    expect(wrapper.text()).toContain('ключи MLS остаются')

    await wrapper.get('button.danger-button').trigger('click')
    expect(clear).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Очистить локальные копии медиа?')
    await wrapper.findAll('button').find(button => button.text() === 'Да, очистить')?.trigger('click')
    await flushPromises()

    expect(clear).toHaveBeenCalledWith('user-1', 'device-1')
    expect(wrapper.text()).toContain('Локальный медиакэш очищен')
    expect(wrapper.text()).toContain('0 локальных файлов')
    expect(perform).toHaveBeenCalledWith('success')
  })
})
