import { beforeEach, describe, expect, it } from 'vitest'

import { BrowserThemePreferences } from '../app/infrastructure/browser/theme-preferences'

describe('browser theme integration', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta id="yv-theme-color" name="theme-color" content="#000000">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f2fb">
    `
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })

  it('keeps the Android system-bar color aligned with the selected app theme', () => {
    const media = {
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList
    const preferences = new BrowserThemePreferences(document, localStorage, media)

    expect(preferences.apply('light')).toBe('light')
    expect(Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
      meta => meta.getAttribute('content'),
    )).toEqual(['#f4f2fb', '#f4f2fb', '#f4f2fb'])
    expect(preferences.apply('dark')).toBe('dark')
    expect(Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
      meta => meta.getAttribute('content'),
    )).toEqual(['#0a0b10', '#0a0b10', '#0a0b10'])
  })
})
