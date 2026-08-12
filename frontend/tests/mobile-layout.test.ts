import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('mobile application shell', () => {
  it('positions restored history instantly before revealing the timeline', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    expect(css).not.toMatch(/\.message-timeline \{[^}]*scroll-behavior:\s*smooth/)
    expect(css).toMatch(/\.message-timeline--restoring \{[^}]*visibility:\s*hidden/)
    expect(css).toMatch(/\.message-timeline--restoring \{[^}]*scroll-behavior:\s*auto/)
  })

  it('pins navigation to the visual viewport and reserves its safe-area slot', () => {
    const cssPath = resolve(process.cwd(), 'app/assets/main.css')
    const css = readFileSync(cssPath, 'utf8')
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 840px)'))

    expect(mobileBlock).toContain('--mobile-tabs-slot-height: calc(62px + env(safe-area-inset-bottom, 0px))')
    expect(mobileBlock).toContain('padding-bottom: var(--mobile-tabs-slot-height)')
    expect(mobileBlock).toMatch(/\.mobile-tabs \{ position: absolute;[^}]*bottom: 0;/)
    expect(mobileBlock).toContain('height: var(--mobile-tabs-outer-height)')
    expect(mobileBlock).toContain('padding: 7px 12px env(safe-area-inset-bottom, 0px)')
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

    expect(css).toMatch(/\.product-shell \{[^}]*height: var\(--app-viewport-height\);[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.messenger-shell \{[^}]*height: 100%;[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.message-panel \{[^}]*height: 100%;[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.message-timeline \{[^}]*overflow-y: auto;/)
    expect(css).toMatch(/\.conversation-list \{[^}]*overflow-y: auto;/)
    expect(css).toContain('.product-shell--conversation .mobile-tabs { display: none; }')
  })

  it('tracks visual viewport size and offset so the keyboard cannot displace the PWA shell', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 840px)'))
    const plugin = readFileSync(resolve(process.cwd(), 'app/plugins/visual-viewport.client.ts'), 'utf8')

    expect(plugin).toContain('window.visualViewport')
    expect(plugin).toContain("'--app-viewport-height'")
    expect(plugin).toContain("'--app-viewport-offset-top'")
    expect(plugin).toContain('viewport?.offsetTop')
    expect(plugin).toContain("addEventListener('resize', apply)")
    expect(plugin).toContain("addEventListener('scroll', apply)")
    expect(mobileBlock).toMatch(/\.product-shell \{[^}]*position: fixed;[^}]*top: var\(--app-viewport-offset-top\);/)
  })

  it('keeps the conversation-list action below the iOS top safe area', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 840px)'))

    expect(mobileBlock).toMatch(/\.sidebar-actions \{[^}]*min-height: calc\(62px \+ env\(safe-area-inset-top, 0px\)\);/)
    expect(mobileBlock).toMatch(/\.sidebar-actions \{[^}]*padding-top: calc\(10px \+ env\(safe-area-inset-top, 0px\)\);/)
  })

  it('overlays transient connection state without reserving a shell row', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')

    expect(css).toMatch(/\.product-shell \{[^}]*grid-template-rows: minmax\(0, 1fr\);/)
    expect(css).toMatch(/\.global-connection \{[^}]*position: fixed;/)
    expect(css).not.toContain('--connection-bar-height')
  })
})
