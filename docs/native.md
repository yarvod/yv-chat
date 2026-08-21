# Native iOS/Android wrapper

Capacitor shell использует тот же Nuxt UI/application layer, но является отдельной
установкой и отдельным cryptographic device. Web/PWA остаются самостоятельными
production-клиентами и не зависят от native SDK.

Окончательный Android application ID и iOS Bundle ID: `de.com.yoowee.chat`. Это
не API host: production native bundle по-прежнему обращается к configured exact
HTTPS origin, а идентификатор остаётся неизменным весь lifetime установленного app.

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

## Identity, signing and releases

Tracked source версии: `frontend/native-version.properties`:

```text
VERSION_CODE=1
VERSION_NAME=1.0.0
```

`VERSION_CODE` — строго возрастающее positive integer, которое Android использует
для upgrade/downgrade policy. `VERSION_NAME` — пользовательская SemVer и должна exact
совпадать с release tag `vX.Y.Z`. Уже опубликованный versionCode никогда не
переиспользуется. Ручное редактирование версий не требуется: release command
синхронизирует Android source of truth с iOS `MARKETING_VERSION`/
`CURRENT_PROJECT_VERSION`.

Подготовить commit и annotated tag только локально:

```bash
./scripts/release-android.sh 1.1.0
```

Скрипт требует clean `main`, обновляет remote refs без push, проверяет новую strict
SemVer относительно всех `vX.Y.Z` tags, автоматически увеличивает `VERSION_CODE`,
синхронизирует обе iOS build configurations и запускает frontend tests, lint,
typecheck и web/PWA production build. Если version уже подготовлена в tracked-файле,
но ещё не имеет tag (включая первый `1.0.0`), лишний version commit не создаётся.

Полная публикация выполняется только явным флагом:

```bash
./scripts/release-android.sh 1.1.0 --push
```

До изменения version этот режим дополнительно проверяет GitHub authentication и
наличие четырёх signing secret names без чтения их значений. После зелёных checks он
одной atomic операцией отправляет `main` и tag. Push `main` запускает production
deployment, push tag запускает signed APK GitHub Release. Без `--push` никакие remote
refs и production не меняются; напечатанную команду публикации можно выполнить позже.

Self-managed release keystore существует только вне repository:

```text
/Users/yarvod/workspace/vpn/.yv-chat-secrets/android/yv-chat-release.jks
alias: yv-chat-release
macOS Keychain service: de.com.yoowee.chat.android-signing
```

Рядом лежат только shareable public certificate/fingerprint и local README. Пароль
сгенерирован случайно и хранится в macOS Keychain. GitHub Secret не является backup:
нужны минимум две отдельные encrypted offline copies исходного `.jks` и доступный
password-manager/Keychain recovery plan. Потеря private app signing key означает
невозможность обновлять уже установленные GitHub APK. Private key, password и raw
base64 никогда не печатаются в CI logs и не коммитятся.

Repository GitHub Actions secrets:

```text
ANDROID_KEYSTORE_B64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
ANDROID_GOOGLE_SERVICES_JSON_B64
```

Workflow `.github/workflows/android-release.yml` запускается только по tag `vX.Y.Z`,
проверяет совпадение tag с tracked version, строгое возрастание SemVer/versionCode
относительно предыдущего release и принадлежность commit ветке `main`,
собирает local native bundle для `https://chat.yoowee.ru`, подписывает release APK,
проверяет signature/package/version через Android build tools и публикует APK вместе
с SHA-256 checksum в GitHub Release. Signing files существуют на runner только во
временном каталоге и удаляются в `always()` step.

Android сохраняет app sandbox/IndexedDB/cookie jar при установке нового APK поверх
старого только если application ID и signing certificate совпадают, а versionCode
возрос. Debug APK использует другой certificate: первый production release требует
однократного удаления ранее установленной debug-сборки, поэтому debug APK нельзя
раздавать пользователям как predecessor. После первого signed release переустановка
не нужна; обычный Package Installer предлагает «Обновить» и сохраняет local data.

Идентификатор должен быть зарегистрирован как exact Android app
`de.com.yoowee.chat` в Firebase перед включением FCM и как package name + public
certificate в Android Developer Console/Play Console. Firebase/API/provider keys не
являются signing key и управляются независимо.

### Provider setup

Для iOS включается Push Notifications capability для App ID `de.com.yoowee.chat` и
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

Production Android зарегистрирован в Firebase project `yoowee-chat-prod` как exact
package `de.com.yoowee.chat`; public signing-certificate SHA-256 также зарегистрирован.
`google-services.json` передаётся release workflow через GitHub Secret, а dedicated
service account имеет только FCM send role. Его JSON key хранится вне repository и
на production преобразуется в три server-only `FCM_*` значения; raw JSON/PEM и OAuth
token не должны попадать в logs, shell arguments или client bundle.

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
