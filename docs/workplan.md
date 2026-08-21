# Текущий workplan

## WP-118 — Native call audio runtime

Статус: **completed locally; physical audio and full Xcode acceptance pending**
Backlog: `BL-079`

Цель: дать существующим WebRTC-аудио/видеозвонкам корректную нативную аудиосессию,
выбор разговорного/громкого маршрута и датчик приближения на Capacitor iOS/Android,
не меняя signaling, MLS identity, cookie auth и web/PWA runtime.

### Scope

- узкий frontend port для platform-owned call audio без доступа к auth/storage/crypto;
- web adapter с текущими `setSinkId`/browser picker semantics без native side effects;
- iOS `AVAudioSession` в `playAndRecord` + `voiceChat`/`videoChat`, receiver/speaker
  routing, route-change events и proximity monitoring;
- Android `MODE_IN_COMMUNICATION`, communication-device routing, audio focus,
  route-change events и bounded proximity wake lock;
- активация только после разрешённого microphone capture и гарантированный cleanup
  при hangup/error/dispose;
- native speaker/receiver controls через существующий call UI;
- unit/static/native build regression tests и platform runbook.

### Security и compatibility invariants

- plugin получает только `video`, `active` и requested audio route; cookie, CSRF token,
  push token, MLS/device keys, SDP, call identity и plaintext не передаются;
- WebRTC media остаётся в стандартном WebView peer connection и не проходит через
  FastAPI или новый native persistence;
- native runtime не читает и не записывает IndexedDB, OPFS, cookies или media cache;
- web/PWA не импортируют platform implementation в runtime и сохраняют service worker,
  Web Push, same-origin HTTP/WebSocket и browser audio-output behavior;
- release audio focus/session, route override и proximity state выполняется
  идемпотентно во всех terminal paths.

### Exclusions

- PushKit VoIP token/provider и CallKit incoming-call system UI;
- Android Telecom/ConnectionService и full-screen incoming-call activity;
- гарантированный background WebRTC при suspended/killed app;
- изменение WebRTC signaling, TURN, MLS или call-history protocol.

### Definition of Done

- iOS/Android shells содержат локальный Capacitor plugin; Android проходит compile,
  iOS source/project проходит доступные static checks, а full Xcode compile остаётся
  явным rollout gate при отсутствии полного Xcode в workspace;
- на native service exposes receiver/speaker routes и синхронизирует platform route
  changes с текущим call overlay;
- voice/video mode, proximity и cleanup следуют lifecycle звонка;
- browser tests подтверждают неизменный `setSinkId` path и отсутствие native calls;
- frontend unit/lint/typecheck/PWA build и native generate/sync/build зелёные;
- physical audio-route/proximity acceptance явно остаётся rollout gate до проверки на
  real iPhone/Android hardware.

### Проверка

- frontend: `376 passed`, ESLint и Nuxt typecheck зелёные;
- web/PWA production build зелёный, Service Worker сохранил `generateSW` и 67-entry
  precache;
- native static generate с exact HTTPS API origin и Capacitor sync iOS/Android
  зелёные;
- Android `assembleDebug` и повторный `compileDebugJavaWithJavac` зелёные на JDK из
  Android Studio + SDK 36;
- Swift source проходит `swiftc -parse`, Xcode project — `plutil -lint`;
- full iOS build/sign не запускался: установлен только Command Line Tools, не полный
  Xcode. Physical receiver/speaker/Bluetooth/proximity/interruption acceptance также
  не запускался и остаётся обязательным rollout gate.
