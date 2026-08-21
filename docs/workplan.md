# Текущий workplan

## WP-120 — Подписанные Android releases

Статус: **completed locally; GitHub secret upload и first tag pending explicit owner approval**
Backlog: `BL-081`

Цель: зафиксировать окончательную native identity `de.com.yoowee.chat`, ввести
монотонную версию и воспроизводимо публиковать подписанный APK в GitHub Releases так,
чтобы последующие APK обновляли существующую установку без удаления app data.

### Scope

- единый Capacitor/Android/iOS application identifier `de.com.yoowee.chat`;
- tracked `versionCode`/`versionName` source of truth и tag/version validation;
- guarded local release command с clean-main gate, iOS/Android version sync,
  checks, local commit/tag preparation и explicit atomic `--push`;
- release-only Android signing config из environment/GitHub Secrets;
- tag-triggered native production build, Capacitor sync, signed APK verification,
  SHA-256 checksum и GitHub Release upload;
- один self-managed long-lived release keystore вне repository, public certificate
  export и local macOS Keychain password storage;
- static/unit checks для identity, version и fail-closed signing workflow;
- native runbook для version bump, Firebase registration, restore и key rotation ban.

### Security и compatibility invariants

- keystore/private key/password/google-services credentials не коммитятся и не
  печатаются в logs;
- release build fail-closed не выполняется без полного signing secret set;
- один и тот же `applicationId` + certificate сохраняются для всего lifetime app;
- каждый public release имеет строго возрастающий positive `versionCode`;
- remote refs не меняются без explicit `--push`; atomic main+tag push одновременно
  запускает production deploy и Android release workflow;
- GitHub tag обязан совпадать с tracked `versionName` и указывать на commit из main;
- APK update сохраняет Android app sandbox; debug-signed APK не считается upgradeable
  production installation;
- web/PWA build, cookie/session, IndexedDB schema, API origin и server deployment не
  меняются из-за package identifier.

### Exclusions

- публикация в Google Play и Play App Signing enrollment;
- iOS distribution certificate/provisioning/App Store release;
- in-app automatic updater/downloader;
- Android Developer Console identity verification и Firebase project creation,
  требующие действий владельца во внешних консолях.

### Definition of Done

- все committed native identity points и Java package paths используют
  `de.com.yoowee.chat`;
- Android release build читает tracked version и подписывается только injected key;
- workflow создаёт проверенный universal APK + checksum по `vX.Y.Z` tag;
- release command отклоняет dirty/non-main/outdated tree, stale SemVer/versionCode и
  отсутствие signing secret names до любого explicit push;
- keystore создан вне repo, public certificate/fingerprint экспортированы, password
  сохранён в Keychain; GitHub signing secrets добавлены либо внешний auth blocker явно
  зафиксирован;
- frontend web/PWA/native tests, lint/typecheck/build, Android debug/release compile и
  static iOS checks проходят;
- documentation объясняет первый release, update preservation, backup и lost-key risk.

### Проверка

- `frontend`: `64` Vitest files / `383` tests passed, ESLint, Nuxt typecheck и
  production/PWA build passed (`generateSW`, `67` precache entries);
- release unit/integration test прошёл initial prepared `v1.0.0`, затем
  `1.0.0 (1) -> 1.1.0 (2)`, exact Android/iOS sync, commit/tag creation и rejection
  версии ниже latest tag;
- native updater `--check` и `bash -n scripts/release-android.sh` passed;
- Android debug и injected-keystore release builds passed на JDK 21; package
  `de.com.yoowee.chat`, version `1.0.0 (1)` и signing certificate verified через
  `aapt`/`apksigner`; release без signing environment fail-closed;
- native production build/sync/assets, iOS plist lint, Swift syntax и Xcode static
  structure checks passed; web/PWA contracts не изменены;
- keystore/password остались вне repository и logs; GitHub Actions Secrets намеренно
  не загружены без отдельного разрешения владельца, optional Firebase
  `google-services.json` ещё не предоставлен;
- pending external acceptance: encrypted offline keystore backup, first atomic
  `main + v1.0.0` push, green GitHub Release workflow и physical signed-APK update
  preserving app data.
