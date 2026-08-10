# Architecture

Этот документ описывает целевую архитектуру `yv-chat`, действующие границы ответственности и правила её изменения. Он восстановлен из исходной полной спецификации `README.md` (`b8350e7`) и согласован с обязательными инструкциями `AGENTS.md`.

`AGENTS.md` остаётся нормативным источником для coding agents и security-инвариантов. Этот документ объясняет устройство системы и причины решений. Текущая реализация планируется через `workplan.md`, будущие результаты — через `backlog.md`.

## 1. Назначение и ограничения

`yv-chat` — закрытый self-hosted мессенджер примерно для 10–15 доверенных пользователей.

Приоритеты:

1. correctness;
2. security;
3. maintainability;
4. simplicity;
5. низкое потребление ресурсов небольшого VPS.

Система должна поддержать:

- Nuxt PWA для desktop/mobile browser;
- закрытое admin-controlled создание пользователей;
- несколько устройств на пользователя;
- text/images/video/files как E2EE ciphertext;
- realtime delivery, offline sync и локальную историю;
- server TTL для сообщений/медиа;
- Web Push;
- production deployment через Docker Compose + Nginx;
- позже — WebRTC calls с coturn fallback.

Проект намеренно не рассчитан на гипотетический большой scale. Kafka, RabbitMQ, Redis, Celery, Kubernetes, MinIO, Elasticsearch, service mesh, отдельный API gateway и microservices запрещены без доказанной текущей потребности и отдельного архитектурного решения.

## 2. System context

```text
┌──────────────────────────────────────┐
│ Nuxt PWA                             │
│ Vue / TypeScript                     │
│ UI → services → API/crypto/storage   │
│ IndexedDB + OPFS + Service Worker    │
└──────────────────┬───────────────────┘
                   │ HTTPS / WSS
                   ▼
┌──────────────────────────────────────┐
│ Nginx                               │
│ TLS, reverse proxy, upload limits,  │
│ security headers, trusted forwarding│
└──────────────────┬───────────────────┘
                   ▼
┌──────────────────────────────────────┐
│ Single FastAPI application          │
│ REST, auth, sync, WS, push dispatch │
└──────────────┬───────────────┬───────┘
               │               │
               ▼               ▼
┌──────────────────────┐  ┌─────────────────────┐
│ PostgreSQL           │  │ LocalMediaStorage   │
│ server sync truth    │  │ /data/media         │
│ within retention     │  │ encrypted blobs only│
└──────────────────────┘  └─────────────────────┘
               ▲               ▲
               └──── cleanup ──┘
```

Future calls:

```text
FastAPI/WebSocket signaling
             │
             ▼
WebRTC peer ←────────→ WebRTC peer
             └─ TURN/coturn fallback
```

FastAPI никогда не проксирует call media как обычный HTTP/WebSocket payload.

## 3. Deployment model

MVP production topology:

```text
nginx
api
postgres
cleanup
```

Позже допускается `coturn`. Снаружи публикуются только HTTPS/WSS и необходимые TURN ports. PostgreSQL не публикуется в интернет.

Первичное media storage — локальный volume `/data/media`. MinIO на том же VPS не создаёт независимый failure domain и не используется. Внешний S3-compatible storage добавляется только при реальной потребности: несколько backend hosts, недостаток диска, durable media, отдельный failure domain или lifecycle/replication.

Целевой VPS мал: ориентир 2 GB RAM и 30–40 GB диска. Любая новая инфраструктура оценивается по idle RAM, disk overhead и operational complexity.

## 4. Backend dependency direction

```text
presentation ─────→ application ─────→ domain
                         ▲
                         │ implements ports
infrastructure ──────────┘

bootstrap/composition root wires all layers
```

### Domain

Содержит entities, value objects, invariants и domain errors.

Domain не зависит от FastAPI, Pydantic transport DTO, SQLAlchemy, PostgreSQL, HTTP, WebSocket, Docker, filesystem/S3 SDK или конкретного crypto provider. Время, идентификаторы и state transitions передаются явно. Загруженная из БД entity проходит те же инварианты, что новая.

### Application

Содержит один use case на одну операцию, typed Command/Query/Result, ports и orchestration.

Application может зависеть от domain, но не от concrete infrastructure. Transaction boundary соответствует application operation. Authorization и business policy выполняются здесь или в domain, а не в route/repository.

Порты узкие и выражают потребности use case: `Clock`, password/session credential services, repositories, `MediaStorage`, push provider. Generic CRUD escape hatch не используется.

### Infrastructure

Содержит SQLAlchemy repositories/UoW, PostgreSQL adapters, password hashing, filesystem/S3 adapters, push sender и другие внешние реализации.

ORM models не выходят наружу. Repository маппит ORM ↔ domain/application DTO. Infrastructure не переносит business authorization в SQL helper только ради удобства.

### Presentation

FastAPI route:

1. валидирует untrusted transport input;
2. получает authenticated principal;
3. создаёт Command/Query;
4. вызывает один use case;
5. переводит typed result/error в HTTP/WS response.

Route не выполняет SQL, TTL calculation, membership business rules, crypto operations или push dispatch.

### Bootstrap

Единственный composition root читает typed settings, создаёт engine/adapters/use cases и управляет lifecycle process resources. `os.getenv()` не разбрасывается по модулям. Runtime dependencies constructor-injected; скрытых mutable globals нет.

## 5. Code design contract

- transport DTO, application DTO, domain entity и ORM model — разные понятия;
- explicit types вместо unstructured dictionaries;
- typed application/domain errors вместо stringly `Exception`;
- async только для настоящего async I/O, blocking password hashing вынесен из event loop;
- timezone-aware UTC и `Clock` для expiry/TTL/cleanup;
- repository не делает скрытый commit;
- методы чтения не имеют неожиданных writes/notifications;
- нет junk-drawer `utils.py`/`helpers.py`;
- абстракция создаётся для существующей boundary/двух consumers, не «на будущее»;
- happy path use case читается сверху вниз;
- tests проверяют публичное поведение и security invariants.

Schema change всегда включает domain/application impact, ORM mapping, repository behavior, новую Alembic migration и tests. Уже применённые production migrations не переписываются.

## 6. Frontend architecture

```text
pages / components
        ↓
composables / stores
        ↓
client application services
   ┌────┼──────────┬─────────┐
   ▼    ▼          ▼         ▼
 API  Crypto    IndexedDB   OPFS/Push
```

Vue components отвечают за rendering и interaction. Они не реализуют crypto primitives, raw fetch, IndexedDB migrations, OPFS access, sync reconciliation или push protocol.

TypeScript strict. Не использовать необоснованные `any`, `@ts-ignore`, broad casts или non-null assertions. API response остаётся untrusted до parsing/validation на boundary.

Auth credential никогда не хранится в `localStorage`/IndexedDB: browser session находится в `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no-`Domain` cookie.

## 7. Identity, devices и sessions

`User` и `Device` — разные сущности. Один пользователь имеет несколько browser installations/physical devices. Device-specific state включает session, crypto identity, push subscription и last-seen metadata.

Public registration отсутствует:

```text
initial admin bootstrap
        ↓
admin creates invitation
        ↓
one-time hashed activation secret
        ↓
user sets Argon2id password
```

Browser auth использует opaque random credential + server-side state, потому что продукту нужны instant revoke, active-device list и logout-all-others. JWT не добавляется без реальной distributed/resource-server причины.

Сервер хранит только SHA-256 lookup digest 256-bit session credential. Session связана с user + device и имеет:

- idle expiry;
- immutable absolute expiry;
- revocation;
- throttled `last_seen_at`/idle touch;
- atomic credential rotation;
- short previous-token grace для concurrent requests;
- revoke при replay предыдущего credential после grace.

IP, GeoIP, User-Agent, Client Hints, OS/browser version и device model — только approximate/risk metadata. Их изменение само по себе не отзывает session и не даёт authorization. Client IP берётся только из socket peer/trusted reverse-proxy chain.

Cookie-authenticated writes требуют exact allowed `Origin` и CSRF protection. Credential не принимается из URL, body, `Authorization`, `localStorage` или WebSocket query string.

## 8. Conversation и authorization model

Целевые core entities:

```text
User ──< Device ──< Session
  │
  └──< ConversationMember >── Conversation
                                  │
                                  └──< Message ──< Attachment
                                           ├──< Receipt
                                           └──< SyncEvent/Tombstone
```

Conversation имеет type `direct|group`, creator и membership lifecycle. Все reads/writes проверяют membership server-side. Client-supplied `user_id`, role, device, conversation или resource ID никогда не считается доказательством доступа.

Database constraints защищают concurrency invariants: normalized unique usernames, idempotency keys, stable sequences, ownership pairs и uniqueness там, где одной application-проверки недостаточно.

## 9. Messaging, ordering и sync

Серверный message envelope versioned и не зависит от UI plaintext schema:

```text
id
conversation_id
sender_user_id / sender_device_id
protocol_version
sequence
ciphertext
created_at / expires_at / deleted_at
```

Колонки `text`, `plaintext`, `decrypted_body`, `message_key` запрещены.

Message creation idempotent по client-generated request/message ID. Authoritative ordering выдаёт серверный sequence/cursor, не client timestamp. Message + sync event записываются атомарно.

PostgreSQL — source of truth для server-side sync state только в retention window. WebSocket — notification channel. После reconnect/sleep/lost events клиент выполняет cursor catch-up:

```text
GET /api/v1/sync?after=<cursor>
→ events, next_cursor, has_more
```

Правильность любой realtime-фичи проверяется при отключённом WebSocket. Duplicate WebSocket/Push/sync delivery применяется идемпотентно.

## 10. E2EE trust boundary

Обязательный invariant:

```text
plaintext exists only on authorized client devices
```

Backend хранит ciphertext, public protocol data, IDs/timestamps/membership и минимальную metadata. Он не хранит plaintext, decrypted attachments, message keys или device private identity keys и не имеет `decrypt_message()` для пользовательского content.

Crypto protocol не изобретается. До реализации создаётся ADR/threat model с выбранным зрелым protocol/implementation, device enrollment, direct/group establishment, membership removal, recovery, rotation, metadata leakage, persistence и version upgrades. Предпочтительное исследование — MLS/OpenMLS + WASM, но выбор принимается только после review.

UI вызывает intent-level crypto adapter. Plaintext существует в RAM только пока нужен. Persistent local archive дополнительно шифруется device-local storage key.

## 11. Attachments и media storage

Attachment flow:

```text
client validates type/size
→ creates random file key
→ encrypts locally
→ streams encrypted bytes
→ server stores opaque blob
→ encrypted message carries attachment metadata/key material
```

Server-generated `storage_key` — opaque logical key. Client filename никогда не используется как filesystem path. Application зависит от `MediaStorage`, default adapter — `LocalMediaStorage(/data/media)`. Upload/download streaming и bounded; server-side thumbnail/transcoding отсутствуют, потому что нарушили бы E2EE и resource budget.

## 12. Server retention и local-first storage

Server и device выполняют разные роли:

```text
server ciphertext = delivery/sync mailbox within TTL
device encrypted archive = long-term local history after sync
```

IndexedDB хранит conversation index, encrypted local messages, sync cursor, read state, crypto state, attachment metadata и outbox. Большие encrypted media blobs предпочтительно хранятся в OPFS/origin-private storage.

Device-local archive не является безусловным backup: site data/PWA может быть удалена. Новый device получает только server retention window; старая история переносится отдельным authenticated encrypted device-to-device flow.

Local text retention может быть longer/forever. Media cache byte-bounded, LRU и имеет explicit pinned policy.

Server TTL cleanup идемпотентно удаляет expired encrypted files/metadata/ciphertext и терпит missing files. `Delete for everyone` создаёт tombstone с достаточной catch-up retention. Backup retention не должна сохранять TTL-deleted content бесконечно.

## 13. PWA, realtime и Web Push

PWA startup local-first:

```text
read IndexedDB → render immediately
              ↘ sync delta in parallel → apply → persist
```

Outbox имеет `pending/sending/sent/failed`, persistent idempotency key и reconcile после reconnect. Service Worker/IndexedDB migrations versioned и совместимы при update.

WebSocket обслуживает foreground realtime. Web Push будит background Service Worker. Sync восстанавливает correctness.

Push subscription принадлежит device/install, не User целиком. VAPID private key — production secret. Payload содержит только opaque routing hint (`event_id`, `conversation_id`, `message_id`, `sync_required`), никогда plaintext preview. Permanent invalid subscriptions отключаются; push failure не откатывает committed message.

Foreground/background policy и stable event IDs предотвращают двойные notifications/unread increments.

## 14. Calls

Calls появляются только после стабильных messaging, sync и E2EE.

- FastAPI/WebSocket: signaling state;
- WebRTC: audio/video media plane;
- STUN/TURN/coturn: connectivity fallback;
- Push: только wake-up hint;
- SDP/media keys не попадают в notification preview;
- PWA platform limitations документируются до обещаний native-like incoming calls.

## 15. Security и trust boundaries

Никогда не логировать passwords, activation/session credentials, Authorization headers, private keys, plaintext messages или decrypted attachments. Structured logs используют opaque IDs, sizes и event types.

Любой внешний input валидируется. API не возвращает ORM, SQL/internal paths/stack traces/secrets. Admin authorization и resource ownership проверяются application/server logic.

Production ingress: HTTPS only, HTTP redirect, reviewed CSP, secure cookies, upload limits, `X-Content-Type-Options`, `Referrer-Policy`; HSTS включается только после подтверждённого TLS/domain setup.

При disk pressure запрещаются новые большие uploads; unexpired permanent data не удаляется молча.

## 16. Transactions и side effects

Transaction boundary совпадает с use case. Пример send:

```text
check membership
assign sequence
persist message
persist sync event
commit
then best-effort WebSocket/Push
```

Push/realtime failure не откатывает durable state. Если позже потребуется более надёжная dispatch semantics, outbox добавляется по доказанной необходимости, а не заранее.

## 17. Configuration, quality и operations

Backend dependency/environment manager — только `uv`; source of truth: `backend/pyproject.toml` + `backend/uv.lock`. Lockfile не редактируется вручную. Docker/CI используют frozen lock.

Минимальные проверки:

```text
backend: Ruff check/format, mypy, pytest, PostgreSQL migrations/integration
frontend: ESLint, TypeScript/Nuxt typecheck, Vitest, production build
repository: Docker Compose config
```

Operational signals: HTTP 5xx, failed logins, active WebSockets, push failures, cleanup counts, DB/media size и free disk. Тяжёлый observability stack не добавляется без необходимости.

Production images non-root, reproducible и не содержат secrets. GitHub Actions строит/publishes images; слабый VPS выполняет pull, intentional migration, rollout и healthcheck.

## 18. Documentation-driven workflow

Каждая фича проходит один и тот же lifecycle:

```text
docs/backlog.md
      ↓ выбрать один item
docs/workplan.md
      ↓ detailed scope, invariants, steps, exclusions, checks
implementation + tests + migrations
      ↓ найденные дефекты
docs/bugs.md
      ↓ full verification
focused git commit
      ↓
следующий backlog item
```

Правила:

- `workplan.md` содержит ровно одну текущую фичу;
- backlog остаётся полным: выполненный item переносится в `Completed`, а не удаляется;
- bugs — только воспроизводимые дефекты, не feature ideas;
- architecture обновляется при изменении boundaries/trust model/deployment/data ownership;
- README остаётся короткой точкой входа и ссылается на эти документы;
- один завершённый workplan — один сфокусированный commit;
- перед commit: diff/secret review, relevant checks, migration verification и intentional-files check;
- shell-команды выполняются через `rtk`; Python workflow — только через `uv`.

## 19. Изменение архитектуры

Обычная реализация выбирает самый простой вариант, совместимый с этим документом и существующими patterns.

Отдельный ADR/design review обязателен, если меняются:

- E2EE protocol/key establishment/device identity/recovery;
- opaque-session model или browser credential transport;
- server/local retention semantics и tombstones;
- authoritative ordering/sync cursor;
- media storage class (local → external S3);
- single-backend deployment topology;
- trust reverse proxy/CORS/Origin/CSRF boundary;
- backup guarantees или public API compatibility.

Архитектурное изменение должно описать concrete requirement, alternatives, security/data-migration impact, resource cost, rollout/rollback и tests. «Может пригодиться», «так принято enterprise» или «для будущего scale» не являются достаточной причиной.

## 20. Definition of Done

Фича завершена, когда:

- happy path и важные failure/security paths реализованы;
- dependency direction и authorization сохранены;
- sensitive data не появляется в DB/API/logs;
- schema change имеет новую migration и PostgreSQL verification;
- realtime correctness сохраняется после reconnect/retry;
- docs/config/OpenAPI обновлены;
- relevant backend/frontend/Compose checks зелёные;
- `workplan.md`, `backlog.md`, `bugs.md` синхронизированы;
- изменения зафиксированы отдельным commit;
- непроверенное явно указано, а не предполагается.
