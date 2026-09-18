import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserExternalLinks } from '../app/infrastructure/browser/external-links'

afterEach(() => vi.unstubAllGlobals())

describe('external link platform boundary', () => {
  it('offers the menu only in Android standalone PWA, never in native or ordinary browser tabs', () => {
    vi.stubGlobal('navigator', { userAgent: 'Android Chrome/140' })
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    expect(new BrowserExternalLinks(false, 'https://chat.test').needsActionMenu()).toBe(true)
    expect(new BrowserExternalLinks(true, 'https://chat.test').needsActionMenu()).toBe(false)
    media.mockReturnValue({ matches: false } as MediaQueryList)
    expect(new BrowserExternalLinks(false, 'https://chat.test').needsActionMenu()).toBe(false)
    media.mockReturnValue({ matches: true } as MediaQueryList)
    vi.stubGlobal('navigator', { userAgent: 'iPhone Safari' })
    expect(new BrowserExternalLinks(false, 'https://chat.test').needsActionMenu()).toBe(false)
    media.mockRestore()
  })

  it('shares only external HTTP(S), preserving query and fragment, and makes no intent URL', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    const links = new BrowserExternalLinks(false, 'https://chat.test')
    const url = 'https://example.com/a?q=1&name=%D0%B4#view'
    await links.share(url)
    expect(share).toHaveBeenCalledWith({ url })
    for (const invalid of ['javascript:alert(1)', 'intent://example.com', 'data:text/html,bad',
      'https://user:secret@example.com', 'https://chat.test/chat', '/chat', 'bad']) {
      expect(links.externalUrl(invalid)).toBeNull()
      await expect(links.share(invalid)).rejects.toThrow()
    }
    expect(share).toHaveBeenCalledTimes(1)
  })
})
