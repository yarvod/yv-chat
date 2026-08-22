import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('mobile application shell', () => {
  it('keeps the loaded chat workspace alive across app-tab navigation', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/pages/chat.vue'), 'utf8')
    const app = readFileSync(resolve(process.cwd(), 'app/app.vue'), 'utf8')

    expect(app).toContain('<NuxtPage />')
    expect(page).toMatch(/definePageMeta\(\{[^}]*layout: 'app'[^}]*middleware: 'auth'[^}]*keepalive: true/)
  })

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
    expect(mobileBlock).toContain('padding-top: env(safe-area-inset-top, 0px)')
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
    expect(css).toMatch(/\.message-timeline \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/)
    expect(css).toMatch(/\.conversation-list \{[^}]*overflow-y: auto;/)
    expect(css).toContain('.product-shell--conversation .mobile-tabs { display: none; }')
  })

  it('suppresses app-shell double-tap zoom without taking custom media gestures', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')

    expect(css).toMatch(/\.app-root \{[^}]*touch-action: manipulation;/)
    expect(css).toMatch(/\.media-viewer__image \{[^}]*touch-action: none;/)
    expect(css).toMatch(/\.media-viewer > video \{[^}]*max-width: 100%;[^}]*max-height: 100%;/)
  })

  it('tracks visual viewport changes so the keyboard cannot displace the PWA shell', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 840px)'))
    const plugin = readFileSync(resolve(process.cwd(), 'app/plugins/visual-viewport.client.ts'), 'utf8')

    expect(plugin).toContain('window.visualViewport')
    expect(plugin).toContain("'--app-viewport-height'")
    expect(plugin).toContain("'--app-viewport-offset-top'")
    expect(plugin).toContain('viewport?.offsetTop')
    expect(plugin).toContain("addEventListener('resize', apply)")
    expect(plugin).toContain("addEventListener('scroll', apply)")
    expect(plugin).toContain("document.addEventListener('focusin', handleFocusIn)")
    expect(plugin).toContain("document.addEventListener('focusout', handleFocusOut)")
    expect(plugin).toContain("root.classList.add('app-keyboard-active')")
    expect(plugin).toContain("root.classList.remove('app-keyboard-active')")
    expect(mobileBlock).toMatch(/\.product-shell \{[^}]*position: fixed;[^}]*top: var\(--app-viewport-offset-top\);/)
  })

  it('owns the iOS top safe area globally and hides bottom tabs during text entry', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 840px)'))

    expect(mobileBlock).toMatch(/\.product-shell \{[^}]*padding-top: env\(safe-area-inset-top, 0px\);/)
    expect(mobileBlock).toContain('html.app-keyboard-active .product-shell { --mobile-tabs-slot-height: 0px; }')
    expect(mobileBlock).toContain('html.app-keyboard-active .mobile-tabs { display: none; }')
    expect(mobileBlock).not.toMatch(/\.sidebar-actions \{[^}]*safe-area-inset-top/)
    expect(mobileBlock).toMatch(/\.conversation-header \{[^}]*padding: 7px 9px;/)
  })

  it('clips only the native auth scrollport to the system safe viewport', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const plugin = readFileSync(resolve(process.cwd(), 'app/plugins/system-bars.client.ts'), 'utf8')

    expect(plugin).toContain("root.classList.add('app-native', `app-native--${platform}`)")
    expect(plugin).toContain("root.classList.remove('app-native', `app-native--${platform}`)")
    expect(css).toMatch(/html\.app-native body \{ overflow: hidden; \}/)
    expect(css).toMatch(/html\.app-native \.auth-layout \{[\s\S]*position: fixed;[\s\S]*inset: env\(safe-area-inset-top, 0px\)[\s\S]*overflow: auto;/)
    expect(css).not.toMatch(/(?:^|\n)\.auth-layout \{[^}]*position: fixed;/)
  })

  it('pairs bottom-tab press feedback with a semantic selection haptic', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const layout = readFileSync(resolve(process.cwd(), 'app/layouts/app.vue'), 'utf8')

    expect(css).toMatch(/\.mobile-tab \{[^}]*transition:[^}]*transform \.1s ease;/)
    expect(css).toMatch(/\.mobile-tab:active \{[^}]*transform: scale\(\.91\);/)
    expect(layout).toContain('@click="performMobileTabSelection(item.to)"')
    expect(layout).toMatch(/function performMobileTabSelection\(to: string\): void \{\s+if \(isNavigationItemActive\(to\)\) return\s+\$frontend\.haptics\.perform\('selection'\)/)
  })

  it('opens a tapped conversation optimistically and keeps hover mouse-only', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const workspace = readFileSync(resolve(process.cwd(), 'app/components/chat/ChatWorkspace.vue'), 'utf8')

    expect(css).toMatch(/\.conversation-row \{[^}]*touch-action: manipulation;/)
    expect(css).toContain('@media (hover: hover) and (pointer: fine) { .conversation-row:hover')
    expect(workspace).toMatch(/selectedConversationId\(route\.query\.conversation\) \|\| openingConversationId\.value/)
    expect(workspace).toMatch(/openingConversationId\.value = conversationId\s+try \{\s+await messenger\.selectConversation/)
    expect(workspace).toMatch(/finally \{\s+openingConversationId\.value = null/)
  })

  it('keeps the PWA rubber-band canvas aligned with the selected page theme', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const config = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')

    expect(css).toMatch(/html, body, #__nuxt, \.app-root \{[^}]*background-color: var\(--bg\);/)
    expect(css).toMatch(/\.product-content \{[^}]*background-color: var\(--bg\);/)
    expect(css).toMatch(/\.page-view \{[^}]*background-color: var\(--bg\);/)
    expect(config).toContain("content: '#f4f2fb', media: '(prefers-color-scheme: light)'")
    expect(config).toContain("content: '#0a0b10', media: '(prefers-color-scheme: dark)'")
  })

  it('keeps video-note capture free of native long-press callouts and its player frameless', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')

    expect(css).toMatch(/\.video-note-capture \{[^}]*touch-action: none;[^}]*user-select: none;[^}]*-webkit-touch-callout: none;/)
    expect(css).toMatch(/\.video-note-button \{[^}]*-webkit-touch-callout: none;[^}]*-webkit-user-drag: none;/)
    expect(css).toMatch(/\.video-note-recorder__progress \{[^}]*conic-gradient\([^}]*mask: radial-gradient/)
    expect(css).toMatch(/\.video-note-recorder__review-actions button \{[^}]*min-width: 116px;/)
    expect(css).toMatch(/\.message-bubble\.message-bubble--video-note \{[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/)
  })

  it('gives coarse-pointer message long-press to the application menu', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const coarseBlock = css.slice(
      css.indexOf('@media (hover: none) and (pointer: coarse)'),
      css.indexOf('@media (max-width: 840px)'),
    )

    expect(coarseBlock).toMatch(/\.message-bubble, \.message-bubble \* \{[^}]*-webkit-user-select: none;[^}]*user-select: none;[^}]*-webkit-touch-callout: none;/)
    expect(coarseBlock).toMatch(/\.message-bubble:not\(\.message-bubble--video-note, \.message-bubble--sticker\) \{[^}]*min-width: 48px;[^}]*min-height: 48px;/)
    expect(coarseBlock).toMatch(/\.message-bubble img, \.message-bubble video \{[^}]*-webkit-user-drag: none;/)
    expect(css.slice(0, css.indexOf('@media (hover: none) and (pointer: coarse)')))
      .not.toMatch(/\.message-bubble \{[^}]*user-select: none;/)
  })

  it('does not let the column timeline shrink long message content to the touch minimum', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')

    expect(css).toMatch(/\.message-bubble \{[^}]*flex-shrink: 0;/)
    expect(css).toMatch(/@media \(hover: none\) and \(pointer: coarse\)[\s\S]*\.message-bubble:not\(\.message-bubble--video-note, \.message-bubble--sticker\) \{[^}]*min-width: 48px;[^}]*min-height: 48px;/)
  })

  it('centers the iOS new-chat plus and keeps delight motion bounded', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')
    const icon = readFileSync(resolve(process.cwd(), 'app/components/ui/AppIcon.vue'), 'utf8')

    expect(css).toMatch(/\.new-chat-button \{[^}]*min-width: 40px;[^}]*min-height: 40px;[^}]*padding: 0;[^}]*-webkit-appearance: none;/)
    expect(css).toMatch(/\.new-chat-button \.app-icon \{[^}]*width: 21px;[^}]*height: 21px;/)
    expect(icon).toContain('M12 4.5v15M4.5 12h15')
    expect(css).toContain('.reaction-tray-enter-active')
    expect(css).toContain('.reaction-burst')
    expect(css).toContain('.message-bubble.message-bubble--sticker')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('overlays transient connection state without reserving a shell row', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/main.css'), 'utf8')

    expect(css).toMatch(/\.product-shell \{[^}]*grid-template-rows: minmax\(0, 1fr\);/)
    expect(css).toMatch(/\.global-connection \{[^}]*position: fixed;/)
    expect(css).not.toContain('--connection-bar-height')
  })
})
