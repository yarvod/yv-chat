import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserDeviceInfo } from '../app/infrastructure/browser/device-info'
import { BrowserHaptics } from '../app/infrastructure/browser/haptics'
import { BrowserLocation } from '../app/infrastructure/browser/browser-location'
import { BrowserStoragePersistence } from '../app/infrastructure/browser/storage-persistence'
import { BrowserThemePreferences } from '../app/infrastructure/browser/theme-preferences'

beforeEach(() => localStorage.clear())

describe('browser capability adapters', () => {
  it('derives a bounded mobile device label from best-effort metadata', () => {
    const navigatorRef = {
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      userAgentData: { mobile: true, platform: 'iOS' },
    } as unknown as Navigator

    expect(new BrowserDeviceInfo(navigatorRef).current()).toEqual({
      label: 'Safari · iOS · Телефон',
      browser: 'Safari',
      operatingSystem: 'iOS',
      deviceClass: 'mobile',
    })
  })

  it('performs semantic vibration only when supported and enabled', () => {
    const vibrate = vi.fn()
    const haptics = new BrowserHaptics({ vibrate } as unknown as Navigator, localStorage)
    haptics.perform('sent')
    expect(vibrate).toHaveBeenCalledWith([10])

    haptics.setEnabled(false)
    haptics.perform('error')
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(() => new BrowserHaptics({} as Navigator, localStorage).perform('success')).not.toThrow()
  })

  it('persists theme preference and resolves system theme', () => {
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList
    const preferences = new BrowserThemePreferences(document, localStorage, media)

    expect(preferences.apply('system')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('yv-chat:theme')).toBe('system')
    expect(preferences.apply('dark')).toBe('dark')
  })

  it('keeps invitation secret in a fragment and consumes it once from the address bar', () => {
    const replaceState = vi.fn()
    const locationRef = {
      origin: 'https://chat.example',
      pathname: '/activate',
      search: '',
      hash: '#token=one-time%20secret',
    } as Location
    const location = new BrowserLocation(locationRef, { replaceState } as unknown as History)

    expect(location.activationUrl('one-time secret')).toBe('https://chat.example/activate#token=one-time+secret')
    expect(location.passwordResetUrl('reset secret')).toBe('https://chat.example/reset-password#token=reset+secret')
    expect(location.consumeFragmentValue('token')).toBe('one-time secret')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/activate')
  })

  it('requests persistent origin storage without treating denial as an error', async () => {
    const granted = {
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => true),
    }
    await expect(new BrowserStoragePersistence(granted).request()).resolves.toBe('persistent')
    expect(granted.persist).toHaveBeenCalledOnce()

    await expect(new BrowserStoragePersistence({
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => false),
    }).request()).resolves.toBe('denied')
    await expect(new BrowserStoragePersistence(undefined).request()).resolves.toBe('unsupported')
  })
})
