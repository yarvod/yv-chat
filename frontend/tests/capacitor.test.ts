import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Capacitor native boundary', () => {
  it('uses a local bundle without production remote-navigation escape hatches', () => {
    const config = readFileSync(resolve(process.cwd(), 'capacitor.config.ts'), 'utf8')
    const nuxt = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')

    expect(config).toContain("webDir: '.output/public'")
    expect(config).toContain("hostname: 'app.yvchat.local'")
    expect(config).not.toMatch(/\burl\s*:/)
    expect(config).not.toContain('allowNavigation')
    expect(config).toContain('CapacitorCookies: { enabled: true }')
    expect(config).toContain('CapacitorHttp: { enabled: true }')
    expect(nuxt).toContain("nativeBuild ? [] : ['@vite-pwa/nuxt']")
  })

  it('keeps app storage local, encrypted and non-restorable through Android backup', () => {
    const manifest = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    )
    const media = readFileSync(
      resolve(process.cwd(), 'app/infrastructure/storage/encrypted-media-cache.ts'),
      'utf8',
    )
    const vault = readFileSync(
      resolve(process.cwd(), 'app/infrastructure/storage/indexeddb-crypto-vault.ts'),
      'utf8',
    )

    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:usesCleartextTraffic="false"')
    expect(media).toContain("type StorageBackend = 'opfs' | 'indexeddb'")
    expect(media).toContain("backend: 'indexeddb'")
    expect(vault).toMatch(/generateKey\([\s\S]*false,\s*\['encrypt', 'decrypt'\]/)
  })

  it('declares explicit call/media permissions and bounded native deep links', () => {
    const manifest = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    )
    const plist = readFileSync(resolve(process.cwd(), 'ios/App/App/Info.plist'), 'utf8')

    expect(manifest).toContain('android.permission.CAMERA')
    expect(manifest).toContain('android.permission.RECORD_AUDIO')
    expect(manifest).toContain('android.permission.MODIFY_AUDIO_SETTINGS')
    expect(manifest).toContain('android.permission.WAKE_LOCK')
    expect(manifest).toContain('android:scheme="yvchat" android:host="chat"')
    expect(plist).toContain('<key>NSCameraUsageDescription</key>')
    expect(plist).toContain('<key>NSMicrophoneUsageDescription</key>')
    expect(plist).toContain('<string>yvchat</string>')
  })

  it('keeps native call audio plugins outside auth, crypto and storage boundaries', () => {
    const android = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/java/ru/yoowee/chat/CallAudioPlugin.java'),
      'utf8',
    )
    const ios = readFileSync(resolve(process.cwd(), 'ios/App/App/CallAudioPlugin.swift'), 'utf8')

    for (const source of [android, ios]) {
      expect(source).not.toMatch(/cookie|csrf|indexeddb|opfs|mls|token|message|cipher/iu)
      expect(source).toMatch(/voice|communication/iu)
      expect(source).toMatch(/proximity/iu)
    }
  })
})
