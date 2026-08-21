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

APNs/FCM delivery, CallKit и Android Telecom не считаются реализованными самим
наличием shell. Они требуют отдельных provider credentials, server dispatcher,
permission/failure tests и physical-device acceptance.

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
