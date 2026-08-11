import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('mobile application shell', () => {
  it('pins navigation to the visual viewport and reserves its safe-area slot', () => {
    const cssPath = resolve(process.cwd(), 'app/assets/main.css')
    const css = readFileSync(cssPath, 'utf8')
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 840px)'))

    expect(css).toContain('--safe-area-max-inset-bottom: env(safe-area-max-inset-bottom, 36px)')
    expect(mobileBlock).toContain('--mobile-tabs-slot-height: calc(62px + env(safe-area-inset-bottom, 0px))')
    expect(mobileBlock).toContain('padding-bottom: var(--mobile-tabs-slot-height)')
    expect(mobileBlock).toMatch(/\.mobile-tabs \{ position: fixed;[^}]*bottom: calc\(env\(safe-area-inset-bottom, 0px\) - var\(--safe-area-max-inset-bottom\)\);/)
    expect(mobileBlock).toContain('height: var(--mobile-tabs-outer-height)')
    expect(mobileBlock).toContain('background: var(--surface-solid)')
  })

  it('prevents root pull-to-refresh without disabling internal scrollers', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')

    expect(css).toMatch(/html \{[^}]*overscroll-behavior: none;/)
    expect(css).toMatch(/body \{[^}]*overscroll-behavior: none;/)
    expect(css).toMatch(/\.message-timeline \{[^}]*overflow-y: auto;/)
    expect(css).toMatch(/\.conversation-list \{[^}]*overflow-y: auto;/)
  })

  it('bounds chat to the viewport and assigns overflow only to internal lists', () => {
    const cssPath = resolve(process.cwd(), 'app/assets/main.css')
    const css = readFileSync(cssPath, 'utf8')

    expect(css).toMatch(/\.product-shell \{[^}]*height: 100dvh;[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.messenger-shell \{[^}]*height: 100%;[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.message-panel \{[^}]*height: 100%;[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.message-timeline \{[^}]*overflow-y: auto;/)
    expect(css).toMatch(/\.conversation-list \{[^}]*overflow-y: auto;/)
    expect(css).toContain('.product-shell--conversation .mobile-tabs { display: none; }')
  })
})
