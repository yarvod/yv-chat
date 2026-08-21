import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Capacitor native boundary', () => {
  it('uses a local bundle without production remote-navigation escape hatches', () => {
    const config = readFileSync(resolve(process.cwd(), 'capacitor.config.ts'), 'utf8')
    const nuxt = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')

    expect(config).toContain("webDir: '.output/public'")
    expect(config).toContain("hostname: 'app.yvchat.local'")
    expect(config).toContain("appId: 'de.com.yoowee.chat'")
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
      resolve(process.cwd(), 'android/app/src/main/java/de/com/yoowee/chat/CallAudioPlugin.java'),
      'utf8',
    )
    const ios = readFileSync(resolve(process.cwd(), 'ios/App/App/CallAudioPlugin.swift'), 'utf8')

    for (const source of [android, ios]) {
      expect(source).not.toMatch(/cookie|csrf|indexeddb|opfs|mls|token|message|cipher/iu)
      expect(source).toMatch(/voice|communication/iu)
      expect(source).toMatch(/proximity/iu)
    }
  })

  it('keeps release identity and versions aligned across Android and iOS', () => {
    const android = readFileSync(resolve(process.cwd(), 'android/app/build.gradle'), 'utf8')
    const ios = readFileSync(resolve(process.cwd(), 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
    const version = readFileSync(resolve(process.cwd(), 'native-version.properties'), 'utf8')

    expect(android).toContain('applicationId "de.com.yoowee.chat"')
    expect(android).toContain('namespace = "de.com.yoowee.chat"')
    expect(ios).toContain('PRODUCT_BUNDLE_IDENTIFIER = de.com.yoowee.chat;')
    expect(version).toMatch(/^VERSION_CODE=[1-9][0-9]*$/m)
    expect(version).toMatch(/^VERSION_NAME=[0-9]+\.[0-9]+\.[0-9]+$/m)
    const versionCode = version.match(/^VERSION_CODE=([1-9][0-9]*)$/m)?.[1]
    const versionName = version.match(/^VERSION_NAME=([0-9]+\.[0-9]+\.[0-9]+)$/m)?.[1]
    expect(ios.match(/CURRENT_PROJECT_VERSION = ([^;]+);/g)).toEqual([
      `CURRENT_PROJECT_VERSION = ${versionCode};`,
      `CURRENT_PROJECT_VERSION = ${versionCode};`,
    ])
    expect(ios.match(/MARKETING_VERSION = ([^;]+);/g)).toEqual([
      `MARKETING_VERSION = ${versionName};`,
      `MARKETING_VERSION = ${versionName};`,
    ])
    expect(android).toContain("System.getenv('ANDROID_KEYSTORE_PATH')")
    expect(android).toContain('if (releaseTaskRequested && !releaseSigningComplete)')
  })

  it('publishes only verified signed APKs from matching main tags', () => {
    const workflow = readFileSync(
      resolve(process.cwd(), '../.github/workflows/android-release.yml'),
      'utf8',
    )

    expect(workflow).toContain('- "v*.*.*"')
    expect(workflow).toContain('git merge-base --is-ancestor "$release_commit" origin/main')
    expect(workflow).toContain('(( version_code > previous_code ))')
    expect(workflow).toContain('ANDROID_KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_B64 }}')
    expect(workflow).toContain('./gradlew --no-daemon assembleRelease')
    expect(workflow).toContain('apksigner" verify --verbose --print-certs')
    expect(workflow).toContain("name='de.com.yoowee.chat'")
    expect(workflow).toContain('gh release create "$GITHUB_REF_NAME"')
    expect(workflow).not.toMatch(/yv-chat-release\.jks["']?\s*:\s*[A-Za-z0-9+/=]{20}/)
  })

  it('prepares versioned releases locally before any explicit push', () => {
    const releaseScript = readFileSync(
      resolve(process.cwd(), '../scripts/release-android.sh'),
      'utf8',
    )
    const versionUpdater = readFileSync(
      resolve(process.cwd(), '../scripts/update-native-version.mjs'),
      'utf8',
    )

    expect(releaseScript).toContain('working tree must be clean before release')
    expect(releaseScript).toContain('version $requested_version must be greater than latest release')
    expect(releaseScript).toContain('node scripts/update-native-version.mjs --set')
    expect(releaseScript).toContain('git commit -m "chore(release): v$requested_version"')
    expect(releaseScript).toContain('git tag -a "$tag"')
    expect(releaseScript).toContain('git push --atomic origin main "refs/tags/$tag"')
    expect(releaseScript).toContain('if [[ "$publish" == true ]]')
    expect(releaseScript).toContain('gh secret list --json name')
    expect(releaseScript).not.toContain('gh secret get')
    expect(versionUpdater).toContain('Xcode MARKETING_VERSION must contain')
    expect(versionUpdater).toContain('Xcode CURRENT_PROJECT_VERSION must contain')
  })
})
