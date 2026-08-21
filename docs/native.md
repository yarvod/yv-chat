# Native iOS/Android wrapper

Capacitor shell использует тот же Nuxt UI/application layer, но является отдельной
установкой и отдельным cryptographic device. Web/PWA остаются самостоятельными
production-клиентами и не зависят от native SDK.

## Storage and identity boundary

| Данные | Web/PWA | Capacitor installation |
| --- | --- | --- |
| Session | `__Host-yv_session` в browser cookie jar | тот же opaque cookie contract в native cookie jar для HTTPS API origin |
| CSRF | публичная `__Host-yv_csrf`, same-origin fetch | читается по exact HTTPS API URL через Capacitor Cookies и передаётся тем же header |
| Device/MLS state | non-extractable wrapping key + sealed state в origin-scoped IndexedDB | отдельный non-extractable key + sealed state в app WebView IndexedDB |
| Conversation archive/outbox/snapshot | encrypted bounded IndexedDB | отдельный encrypted bounded IndexedDB внутри app sandbox |
| Large media cache | encrypted OPFS, bounded IndexedDB fallback | тот же OPFS capability check; при отсутствии WebView OPFS используется bounded IndexedDB fallback |
| Service Worker/Web Push | включены в web/PWA build | Service Worker не генерируется; native push подключается отдельным transport adapter |

Browser PWA и native app не делят cookie, `device_id`, MLS leaf, archive key или
media cache. Установка native app создаёт отдельную session/device. Связывание и
history import выполняются существующим trusted-device flow; копировать provider
state или wrapping key между origins запрещено.

Удаление приложения, OS clear-data или потеря WebView storage удаляют local device
state. Server session можно отозвать из active-device UI; старые local keys не
считаются backup. Android backup отключён, чтобы OS cloud restore не разделял
ciphertext и origin key lifecycle. Store signing secrets, APNs keys,
`google-services.json`, provisioning profiles и keystores не коммитятся.

## Network and authorization

Production shell всегда грузит локальный generated bundle. `server.url` и
`allowNavigation` отсутствуют: они не используются как remote deployment/update
mechanism.

Native build получает API origin только во время сборки:

```bash
cd frontend
YV_CHAT_NATIVE_API_ORIGIN=https://chat.example npm run build:native
npm run cap:sync
npm run generate:native-assets
```

Web/PWA build оставляет `apiOrigin` пустым и продолжает использовать относительные
`/api/v1` и same-origin `wss`. Native build использует exact HTTPS/WSS API origin,
native cookie/HTTP bridge и WebSocket без bearer/query credential. Backend
`ALLOWED_ORIGINS` должен дополнительно содержать обе точные WebView origin:

```text
capacitor://app.yvchat.local
https://app.yvchat.local
```

Wildcard запрещён. `__Host-` cookie остаются Secure/HttpOnly/SameSite=Strict/no
Domain и принадлежат реальному API host; JS не получает session credential.

## Platform capabilities

- semantic haptic intents используют Capacitor Haptics на native и
  `navigator.vibrate`/no-op в web;
- native status bar следует выбранной light/dark theme;
- native keyboard events используют существующий `app-keyboard-active` layout
  contract, не создавая второй mobile layout;
- `yvchat://chat/<conversation>?message=<message>` принимается только с UUID fields;
- camera/microphone permissions описывают существующие explicit video-note/call
  actions; capture не запускается автоматически;
- Android application backup и cleartext traffic отключены.

Native notification adapter получает свежий APNs/FCM token у OS при каждом launch/
inspection и не кэширует его в localStorage. Backend хранит provider token только у
exact authenticated `device_id`; status API token не возвращает. Notification tap
принимает только versioned UUID routing hints и запускает обычный authenticated sync.
Lock-screen текст всегда generic и не содержит sender/message/attachment/SDP.

### Provider setup

Для iOS включается Push Notifications capability для App ID `ru.yoowee.chat` и
подходящий provisioning profile. Committed `App.entitlements` содержит development
environment; distribution signing/profile должен сформировать production entitlement.
На backend одним комплектом задаются `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_BUNDLE_ID`, base64 полного `.p8` PKCS8 PEM в `APNS_PRIVATE_KEY_B64` и только
для sandbox build — `APNS_USE_SANDBOX=true`.

Для Android файл конкретного Firebase project помещается локально в
`frontend/android/app/google-services.json`; он игнорируется Git. Backend получает
`FCM_PROJECT_ID`, service-account email в `FCM_CLIENT_EMAIL` и base64 полного PKCS8
PEM в `FCM_PRIVATE_KEY_B64`. APNs/FCM keys остаются server-only secrets; в native
bundle попадают только platform-generated installation tokens.

APNs использует token-auth HTTP/2, Android — FCM HTTP v1 OAuth2. Оба transport
имеют bounded timeout, удаляют destination только по explicit permanent-invalid
ответу provider и не откатывают уже committed message/call event. Browser Web Push
сохраняет прежние VAPID endpoint/keys и Service Worker без native зависимости.

CallKit/PushKit VoIP и Android Telecom full-screen incoming-call UI ещё не входят в
этот notification slice: обычный generic incoming-call push уже маршрутизируется,
но полноценный системный call surface выполняется отдельным workplan.

### Call audio runtime

Существующий `RTCPeerConnection`, signaling, TURN и MLS call identity остаются в
WebView/application layer. Локальный `CallAudio` plugin не получает API origin,
cookie/CSRF, user/device/call IDs, SDP, media stream, keys или plaintext. Его полный
contract ограничен `video`, `proximity` и маршрутами `system`/`earpiece`/`speaker`.

На iOS активный звонок использует `AVAudioSession.playAndRecord` с `voiceChat` или
`videoChat`, системными Bluetooth routes и receiver/speaker override. На Android
используются `MODE_IN_COMMUNICATION`, transient voice audio focus и communication
device API; legacy speaker routing остаётся только для поддерживаемых Android 7–11.
Датчик приближения включается только для active audio-only звонка не на громкой
связи и снимается вместе с route override/audio focus во всех terminal paths.

Это улучшает foreground native-call UX, но не означает background/killed-app call:
для системного входящего экрана и background wake-up всё ещё нужны отдельные
PushKit/CallKit и Android Telecom/ConnectionService implementation и store-policy
acceptance. Web/PWA продолжают использовать browser `setSinkId`/output picker и не
вызывают `CallAudio` plugin.

## Local platform prerequisites

- Node/npm versions из `frontend/package.json`;
- Android Studio + Android SDK/JDK version, поддерживаемые текущим Capacitor;
- полный Xcode (не только Command Line Tools) для iOS;
- signing/provisioning на developer machine или CI, вне repository.

После build/sync:

```bash
npm run cap:open:android
npm run cap:open:ios
```

Обязательная physical acceptance: fresh login, reload/session rotation, WebSocket
reconnect, IndexedDB reload, MLS send/decrypt, OPFS fallback, upload/download,
logout, app update preserving data, clear-data recovery, keyboard/safe areas,
haptics, camera/microphone permission denial и call cleanup.

Для native push дополнительно обязательны реальные sandbox/production device tests:
permission allow/deny, token rotation/reinstall, foreground/background/terminated
delivery, tap routing, revoked session, invalid-token cleanup и отсутствие plaintext
в APNs/FCM provider console. Без provider credentials и physical devices эти пункты
не считаются подтверждёнными локальными mocks.

Для call audio обязательны реальные iPhone/Android проверки receiver/speaker,
wired/Bluetooth connect/disconnect, proximity, camera transition, OS interruption,
background/foreground и cleanup после reject/hangup/media error. Android plugin
компилируется локально; для iOS compile/sign требуется полный Xcode, которого нет в
текущем workspace (Swift syntax и Xcode project structure проверяются отдельно).
