# Текущий workplan

## WP-117 — Native APNs/FCM notifications

Статус: **completed locally; physical provider acceptance pending**
Backlog: `BL-079`

Цель: подключить нативные push-уведомления для Capacitor iOS/Android как отдельные
device-bound transports, сохранив существующий Web Push и неизменный web/PWA runtime.

### Scope

- явный provider-aware subscription contract: `web`, `apns`, `fcm`;
- additive Alembic migration существующих Web Push строк без потери endpoint/keys;
- Capacitor adapter для permission, token registration/rotation, unregister и
  безопасной навигации по opaque routing hints;
- APNs HTTP/2 token-auth и FCM HTTP v1 provider adapters с bounded timeout;
- generic lock-screen copy без имени отправителя, plaintext сообщения, SDP или key
  material;
- удаление permanently invalid provider tokens и отсутствие rollback уже
  committed message/call event;
- platform capability/config runbook без committed signing/provider secrets;
- regression tests для web compatibility, native token lifecycle, API validation,
  persistence и provider payloads.

### Security и architecture invariants

- push token принадлежит exact authenticated device/session; guessed device/user id
  клиент не передаёт;
- `HttpOnly` session cookie и double-submit CSRF остаются единственной HTTP auth
  границей; push token не становится bearer credential;
- payload содержит только version/event/conversation/message-or-call IDs и
  `sync_required`; приложение после открытия выполняет обычный authenticated sync;
- APNs/FCM credentials читаются только как backend secrets и не входят в frontend
  bundle, image или repository;
- native token не кэшируется в localStorage; актуальный token запрашивается у OS на
  launch/inspection и идемпотентно upsert-ится;
- браузерный Service Worker, VAPID subscription и web UI не зависят от Capacitor.

### Exclusions

- CallKit/PushKit VoIP pushes и Android Telecom full-screen incoming-call UI;
- store signing/provisioning и создание Apple/Firebase projects/credentials;
- plaintext notification previews;
- изменение WebRTC signaling/media или MLS protocol.

### Definition of Done

- pre-existing `push_subscriptions` мигрируют в provider `web` без изменения
  endpoint/key material;
- API принимает только provider-specific valid shapes и не раскрывает tokens;
- native adapter регистрирует текущий APNs/FCM token после permission и обрабатывает
  validated notification taps; web adapter остаётся прежним;
- server отправляет privacy-safe APNs/FCM/Web Push payload и удаляет только явно
  permanently invalid destinations;
- frontend/backend checks и fresh migration head зелёные; physical delivery явно
  остаётся rollout gate до появления real provider credentials/devices.

### Проверка

- frontend: `372 passed`, ESLint, Nuxt typecheck, production web/PWA build зелёные;
- native static generate и Capacitor sync для iOS/Android зелёные, Service Worker
  остаётся только в web build;
- backend: Ruff check/format, strict mypy и `292 passed, 12 skipped` зелёные;
- fresh PostgreSQL успешно прошёл `alembic upgrade head` до `0029_native_push`;
- отдельный PostgreSQL upgrade `0028 -> 0029` сохранил существующие endpoint/p256dh/
  auth byte-for-byte и добавил `provider=web`, `native_token=NULL`;
- dev/production Compose config зелёный, provider secrets остаются optional atomic
  groups и не попали в repository;
- physical APNs/FCM delivery не запускался: в workspace нет Apple/Firebase provider
  credentials, provisioning и physical devices. Это обязательный rollout gate, а
  не подтверждённый результат mocks.
