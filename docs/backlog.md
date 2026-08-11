# Backlog

Полный упорядоченный backlog продукта, восстановленный из исходной большой спецификации `README.md` (`b8350e7`) и уточнённый действующими правилами `AGENTS.md` и [architecture.md](architecture.md).

В работу одновременно берётся одна фича. Для неё создаётся подробный `docs/workplan.md`; после реализации, проверок и отдельного коммита пункт переносится в `Completed`. Архитектурные правила не считаются задачами и не дублируются здесь без конкретного проверяемого результата.

## In progress

Активная фича отсутствует: `BL-003D` завершена, следующей будет выбрана `BL-004`.

## Next — identity и account management

### BL-003E — Current account API и security reset

Результат: клиент получает `/api/v1/me`, меняет безопасные account preferences и может выполнить явный security reset.

- current-user DTO без ORM/secret fields;
- password change с проверкой текущего пароля и отзывом остальных sessions;
- явный security reset/revoke-all policy;
- step-up authentication для чувствительных действий без использования IP/GeoIP как фактора;
- security events и tests для revoked/expired/current session cases.

## Messaging foundation

### BL-004 — Conversation domain и persistence

Результат: существуют direct/group conversations с явным membership lifecycle.

- `Conversation`, `ConversationMember`, type/role/joined/left invariants;
- direct conversation uniqueness и group creator/role rules;
- SQLAlchemy mappings, indexes, constraints и Alembic migration;
- repositories/UoW без generic CRUD и без ORM leakage;
- PostgreSQL concurrency tests для membership/duplicate direct conversation.

### BL-005 — Conversation API и authorization

Результат: пользователь создаёт и получает только доступные ему conversations.

- create/list/get direct и group conversation use cases;
- add/remove/leave member и role-change policy;
- `/api/v1/conversations` transport DTO;
- server-side membership check на каждой операции;
- negative tests: non-member read, privilege escalation, guessed conversation ID, removed member.

### BL-006 — Versioned opaque message envelope

Результат: backend принимает и сохраняет только versioned ciphertext envelope, не связанный с UI plaintext schema.

- message identity, conversation/sender device, protocol version, ciphertext bytes, server timestamps;
- запрет plaintext/message-key columns и logging;
- временный synthetic ciphertext transport явно помечен non-E2EE и имеет removal path;
- sender-device ownership и membership authorization;
- message/attachment envelope DTO versioning и size bounds.

### BL-007 — Idempotent message creation и ordering

Результат: retry не создаёт дубли, а concurrent messages получают стабильный server order.

- client-generated request/message ID с database uniqueness;
- monotonically increasing conversation sequence или эквивалентный устойчивый cursor;
- атомарная запись message + sync event в одной transaction;
- pagination со стабильным order/tie-breaking;
- PostgreSQL tests для concurrent send, duplicate retry и transaction rollback.

### BL-008 — Cursor sync и offline catch-up

Результат: состояние полностью восстанавливается после сна, reconnect и пропущенных realtime events.

- `GET /api/v1/sync?after=<cursor>` с `next_cursor`/`has_more`;
- bounded pagination и retention-aware gaps;
- conversation/message/membership/deletion events;
- client apply semantics и idempotent event handling;
- главный test: WebSocket выключен → события созданы → sync восстанавливает всё без дублей.

### BL-009 — Receipts, unread state, typing и presence

Результат: read state согласуется между устройствами, а ephemeral indicators не становятся durable truth.

- delivered/read receipt model и per-user/per-conversation cursors;
- unread counters, согласованные на нескольких devices;
- typing events с expiry без долговременной истории;
- best-effort online presence из active WebSockets с heartbeat timeout;
- deduplication и tests после reconnect.

### BL-010 — Delete-for-everyone и tombstones

Результат: удаление доходит до offline devices в пределах документированной политики.

- authorized deletion use case и `message_deleted` sync event;
- tombstone retention дольше обычного event catch-up window;
- применение tombstone к локальному archive;
- отсутствие ложного обещания уничтожить уже просмотренные/screenshotted copies;
- retry/idempotency/expired-content tests.

### BL-011 — Authenticated WebSocket notifications

Результат: WebSocket ускоряет доставку, но не заменяет sync.

- same-origin cookie handshake, active-session и exact Origin validation;
- explicit `hello`, `new_message`, `message_deleted`, `typing`, `presence`, `read_receipt`, `conversation_updated`, `device_revoked` events;
- small routing hints вместо дублирования state/ciphertext;
- heartbeat не продлевает auth session бесконечно;
- single-process in-memory connection registry без преждевременного Redis;
- reconnect всегда запускает cursor catch-up.

## E2EE и multi-device history

### BL-012 — E2EE protocol ADR и security review

Результат: до crypto-кода утверждён проверяемый зрелый протокол, приоритетно исследован MLS/OpenMLS + WASM.

- device identity и trust model;
- second-device enrollment, direct/group establishment;
- membership removal, key rotation, recovery и compromise behavior;
- metadata, видимые серверу, protocol framing/version upgrades;
- browser/WASM persistence, test vectors и threat model;
- отдельное review: никакой самодельной комбинации primitives.

### BL-013 — Frontend crypto adapter и device identity

Результат: UI работает с intent-level crypto API, private material не выходит из изолированного слоя.

- `encryptMessage/decryptMessage/encryptAttachment/decryptAttachment` boundary;
- создание/хранение device identity и protocol state;
- safe IndexedDB persistence, memory/plaintext lifecycle и log redaction;
- known-answer/test-vector, corruption и version-mismatch tests;
- отсутствие crypto primitives в Vue components.

### BL-014 — E2EE conversations, membership changes и rotation

Результат: direct/group сообщения шифруются выбранным протоколом на каждом авторизованном устройстве.

- create/join group crypto state;
- multi-device fan-out и membership change commits;
- removal/revocation и key rotation;
- protocol-version compatibility/error UX;
- удаление synthetic shortcuts до объявления secure milestone готовым.

### BL-015 — Secure device-to-device history transfer

Результат: новый device получает историю старше server retention только от уже авторизованного устройства.

- pairing QR/transfer request и explicit confirmation;
- authenticated encrypted transfer session;
- bounded/resumable archive transfer без загрузки бессрочной истории на VPS;
- re-encryption под device-local storage key нового устройства;
- cancellation/replay/wrong-device/partial-transfer tests.

## Attachments, retention и storage

### BL-016 — MediaStorage port и LocalMediaStorage

Результат: backend потоково хранит opaque encrypted bytes в `/data/media` за application port.

- generated opaque storage keys и prefix layout;
- в БД только logical key, никогда absolute path/client filename;
- streaming save/open/delete/exists без unbounded RAM;
- traversal, missing-file, partial-write и ownership tests;
- S3 adapter не добавляется до реальной внешней storage requirement.

### BL-017 — Encrypted attachment upload/download

Результат: клиент шифрует file до upload и расшифровывает только локально.

- client type/size validation, random file key и encrypted metadata в message payload;
- versioned `/api/v1/attachments` upload/download;
- authorization через conversation membership;
- configurable limits для image/file/video/voice;
- server не делает preview/transcoding и не получает keys/plaintext.

### BL-018 — Server TTL cleanup и tombstone retention

Результат: expired ciphertext/media удаляются идемпотентно и безопасно повторяются.

- configurable retention по типам, включая forever policy;
- cleanup expired file → metadata/message state с tolerance к missing files;
- отдельная tombstone retention;
- metrics/log summary без content;
- crash/retry/concurrent cleanup tests.

### BL-019 — Quotas, disk pressure и upload backpressure

Результат: небольшой VPS не заполняется неконтролируемо.

- per-file/per-user/global quotas;
- media usage, PostgreSQL size и free-disk metrics/alerts;
- запрет новых больших uploads при low disk вместо удаления unexpired data;
- bounded cleanup batches и resource-budget tests;
- документированный ориентир диска/резерва.

## Local-first PWA

### BL-020 — Frontend API/service foundation и auth UI

Результат: PWA имеет typed service layer и полноценные login/current-session/logout screens.

- network access за одним API adapter, runtime parsing untrusted responses;
- session bootstrap без чтения HttpOnly credential;
- CSRF token handling и generic login errors;
- loading/offline/revoked-session states;
- strict TypeScript без `any`/`@ts-ignore` shortcuts.

### BL-021 — Conversations и messaging UI

Результат: usable direct/group chat поверх application services, не смешивающий UI, crypto и persistence.

- conversation list, message timeline, composer, reply/attachment states;
- pagination и stable sequence rendering;
- unread/read indicators, typing/presence как best effort;
- accessibility, mobile layout и reconnect states;
- component tests критичных interactions.

### BL-022 — IndexedDB encrypted local archive

Результат: startup сначала показывает локальную историю, затем применяет sync delta.

- versioned stores для conversation index, encrypted messages, cursor, receipts, protocol state и attachment metadata;
- device-local non-extractable storage key где поддерживается;
- plaintext только в RAM на время rendering/processing;
- versioned IndexedDB migrations и service-worker compatibility tests;
- понятный UX при очищенном/недоступном browser storage.

### BL-023 — Offline outbox и conflict recovery

Результат: offline send проходит состояния `pending/sending/sent/failed` и безопасно повторяется.

- persistent queue с client idempotency keys;
- reconnect/backoff/manual retry;
- reconcile с authoritative sync response;
- crash-between-send-and-ack и duplicate retry tests;
- bounded queue/storage pressure behavior.

### BL-024 — OPFS media cache и local retention controls

Результат: большие encrypted blobs хранятся отдельно, ограниченно и очищаемо.

- OPFS/origin-private adapter с fallback;
- byte-bounded LRU cache, pinned-media policy;
- local text retention: forever/1 year/90 days;
- missing-original UX после server/local eviction;
- запрос persistent storage и отображение quota pressure без обещания backup.

### BL-025 — PWA lifecycle и update safety

Результат: приложение устанавливается, работает с offline shell и безопасно обновляется.

- manifest/icons/installability;
- service-worker offline shell и background-safe reconnect;
- update notification/activation flow;
- compatibility gate с IndexedDB schema;
- tests обновления старой установленной версии.

## Web Push

### BL-026 — Push subscriptions и VAPID

Результат: каждая browser installation управляет собственной subscription.

- permission только после user gesture, включая installed iOS/iPadOS PWA constraints;
- device-bound subscription table/CRUD;
- VAPID public config и private secret вне Git/image/logs;
- endpoint/key material redaction;
- changed/expired subscription recovery.

### BL-027 — Privacy-safe push dispatcher

Результат: push будит клиент opaque routing hint, а message correctness остаётся у sync.

- payload только version/event/conversation/message IDs или `sync_required`;
- никакого plaintext preview, SDP, media keys или sensitive signaling;
- commit message до best-effort bounded dispatch;
- permanent invalid/gone subscription disable/delete;
- push failure не откатывает message.

### BL-028 — Notification UX, preferences и deduplication

Результат: foreground/background уведомления не дублируют unread state.

- foreground active conversation: без system notification;
- background: service worker generic notification и click/focus/navigation/sync;
- global enabled, conversation mute, privacy mode;
- stable event/message ID dedup WebSocket + Push + sync;
- multi-device read state, app badge и invalid-subscription tests.

## Production и operations

### BL-029 — Production Nginx, TLS и security headers

Результат: наружу опубликованы только HTTPS/WSS через проверенный ingress.

- HTTP→HTTPS, certificate automation и HSTS только после проверки TLS;
- WebSocket upgrade/timeouts и trusted proxy chain;
- upload limits согласованы с application limits;
- CSP, `X-Content-Type-Options`, `Referrer-Policy` и минимальное раскрытие backend;
- PostgreSQL не опубликован наружу.

### BL-030 — Production images, GHCR и deployment workflow

Результат: GitHub Actions строит reproducible images и выполняет контролируемый deploy.

- frozen `uv.lock`/npm lock builds, non-root minimal images;
- backend/frontend image build и push в GHCR;
- protected branch/environment, runtime secrets и intentional Alembic step;
- healthcheck, compatibility-aware rollout и rollback plan;
- без тяжёлой сборки на VPS 1–2 GB RAM.

### BL-031 — Backup/restore и retention-compatible policy

Результат: потеря VPS не уничтожает durable account/membership state, а TTL не превращается в вечный архив.

- encrypted offsite PostgreSQL backups и bounded retention;
- explicit решение: ephemeral media не backup либо внешний durable storage;
- restore runbook и регулярный restore test;
- migration/version compatibility;
- документированная связь backup retention с message/media TTL.

### BL-032 — Observability и operational runbooks

Результат: состояние малого VPS видно без тяжёлого observability stack.

- structured redacted logs;
- HTTP 5xx/failed login/WebSocket/push/cleanup counters;
- DB/media/disk size и free-space alerts;
- Docker healthchecks и cleanup summaries;
- incident/runbook для disk full, DB restore, failed migration и credential compromise.

### BL-033 — Release E2E и security checklist

Результат: перед реальным использованием подтверждён полный critical path и production checklist.

- Admin создаёт Alice/Bob → activation/login/devices;
- conversation → encrypted message → realtime → offline catch-up без дублей;
- attachment encryption/access/TTL cleanup;
- revoke device, expired session, Origin/CSRF и non-member negative paths;
- Push wake-up без plaintext;
- backup/restore, migration и reconnect validation;
- проверка отсутствия secrets/plaintext в DB/logs/API schemas.

## Later — calls

### BL-034 — Call signaling и state machine

Результат: FastAPI/WebSocket передаёт только versioned signaling state после стабильного messaging/E2EE.

- `call_offer`, `call_answer`, `ice_candidate`, `call_rejected`, `call_ended`;
- authenticated conversation participants и timeout/reconnect/failure state;
- push `incoming_call` только как wake-up hint без SDP/keys preview;
- server не переносит media plane.

### BL-035 — WebRTC audio и coturn

Результат: audio идёт peer-to-peer с TURN fallback.

- browser capability/permission UX;
- STUN/TURN configuration и coturn production secrets/ports;
- NAT/failure/reconnect tests;
- ресурсные метрики и отсутствие FastAPI media proxy.

### BL-036 — Video calls и platform evaluation

Результат: video добавляется после стабильного audio; ограничения PWA документированы.

- camera switching, mute, bandwidth/failure UX;
- TURN load/storage-free architecture;
- mobile background/incoming-call limitations;
- решение о native wrapper только при подтверждённой необходимости.

## Completed

### BL-003D — Admin user management и activation HTTP API

Versioned admin list/invite/update/reissue API, public activation credential endpoint без registration, explicit used/revoked token lifecycle, atomic target-session revoke, Dishka wiring, bounded errors и negative authorization/Origin/CSRF/PostgreSQL concurrency tests.

### BL-ARCH-001 — Clean Architecture modularization

Application разложен по account/session/device capabilities, identity ports и SQLAlchemy adapters разделены по aggregate responsibility, Dishka composition root состоит из шести небольших providers и используется HTTP/CLI, import-linter фиксирует dependency rule, production graph проверяется тестом, async suite переведён на pytest-asyncio без ручного `asyncio.run()`.

### BL-003C — Active device/session management

Dishka composition root с явными APP/REQUEST scopes, user-scoped device/session use cases, list/current marker, rename, revoke одной и всех остальных sessions, bounded typed security events, versioned FastAPI endpoints, Origin/CSRF/ownership tests и PostgreSQL concurrency verification.

### BL-003B — Session HTTP transport

Versioned FastAPI login/session/logout, `Secure`/`HttpOnly`/`SameSite=Strict` `__Host-` cookie, exact Origin + double-submit CSRF, explicit CORS, safe client IP/trusted-proxy boundary и composition root.

### BL-003 — Opaque session core

Device-bound login/logout, 256-bit credentials with SHA-256 lookup hashes, idle/absolute expiry, throttled touch, atomic row-locked rotation, previous-token grace, replay revocation и PostgreSQL concurrency tests.

### BL-002 — User repositories и admin-controlled activation

Repository ports/adapters, one-time bootstrap первого администратора, admin-only invitation, одноразовый hashed activation secret, Argon2id password activation и concurrency/uniqueness tests.

### BL-001 — Persistence foundation

SQLAlchemy async + asyncpg, Alembic, отдельные domain/ORM модели `User`/`Device`, typed database settings, первая migration и PostgreSQL upgrade/downgrade verification.

### BL-000 — Repository bootstrap

FastAPI healthcheck, Nuxt PWA shell, lint/typecheck/tests/build, `uv`/npm lockfiles, Compose, Nginx local config, Makefile и GitHub Actions CI.
