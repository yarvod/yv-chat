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

Backend package layout следует capabilities и dependency rule:

```text
application/
├── accounts/          # bootstrap, invitation, activation/recovery operations
├── sessions/          # login/authenticate/logout + session policy
├── devices/           # list/rename/revoke/event queries
├── security_events/   # cross-capability retention policy
└── ports/
    ├── identity/      # user/token/device/session/event/UoW protocols
    └── conversations/ # aggregate repository and transaction protocols

infrastructure/persistence/
├── models/            # one ORM model per module
├── repositories/      # one adapter per aggregate + pure mappers
├── identity_uow.py    # transaction assembly only
├── conversation_uow.py
└── database.py        # engine/session factory

bootstrap/providers/
├── settings.py
├── persistence.py
├── adapters.py
├── accounts.py
├── sessions.py
└── devices.py
```

`import-linter` исполняет dependency rule в CI: domain не знает другие слои, application не знает infrastructure/presentation/bootstrap, infrastructure не знает delivery/composition.

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

Единственный composition root читает typed settings, а Dishka явно связывает ports с concrete adapters и управляет lifecycle. `os.getenv()` не разбрасывается по модулям. Runtime dependencies constructor-injected; скрытых mutable globals и service locator через `request.app.state` нет.

Scope contract:

```text
Dishka APP scope
├── AppSettings
├── AsyncEngine / async_sessionmaker
├── IdentityUnitOfWorkFactory
├── Clock / password / credential adapters
└── immutable timing policies

Dishka REQUEST scope
└── typed application use cases

application operation
└── fresh UnitOfWork created by the use case
```

FastAPI handlers получают только нужные им зависимости через `FromDishka`; агрегат «все сервисы приложения» не передаётся. Dishka остаётся bootstrap/presentation detail: domain и application не импортируют DI framework. Request scope не заменяет transaction boundary — каждый use case сам открывает отдельный UoW, поэтому authentication и последующая command в одном HTTP request не делят скрытую транзакцию. HTTP app и bootstrap-admin CLI используют один production graph; отдельной ручной CLI-сборки adapters нет.

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
presentation (Nuxt pages/layouts/components/composables)
                         ↓
application (operations/state coordinators/ports)
                         ↓
domain (account, device, conversation, message models/invariants)

infrastructure (HTTP, browser capabilities, IndexedDB, OPFS, crypto, push)
                         └──────── implements application ports

plugins / composition root → creates app-scoped implementations and injects ports
```

Vue components отвечают за rendering и interaction. Они не реализуют crypto primitives, raw fetch, IndexedDB migrations, OPFS access, sync reconciliation или push protocol.

Рекомендуемая физическая структура развивается по реальным capabilities, а не
по одному giant service-файлу:

```text
app/
├── domain/
│   ├── accounts/
│   ├── devices/
│   └── messaging/
├── application/
│   ├── auth/              # operations + app state
│   ├── accounts/          # admin/profile operations
│   ├── messaging/         # sync/send orchestration
│   └── ports/             # http-agnostic browser/storage/capability contracts
├── infrastructure/
│   ├── http/              # DTO, parsers, same-origin adapters
│   ├── browser/           # device info, theme, haptics, clipboard
│   └── persistence/       # IndexedDB/OPFS adapters when implemented
├── presentation/
│   └── composables/       # Vue/Nuxt bindings to application operations
├── layouts/
├── pages/
├── components/
└── plugins/               # Nuxt app-scoped composition root
```

`domain` не импортирует Vue/Nuxt/browser API. `application` может импортировать
domain и объявляет узкие ports. Infrastructure импортирует contracts/models,
но presentation не создаёт concrete adapters самостоятельно. Nuxt plugin —
единственный composition boundary; state не хранится module-global singleton,
который мог бы пересекать SSR requests.

Проект является browser-first installed PWA с будущими IndexedDB/OPFS и WASM
crypto dependencies, поэтому client rendering задаётся явно. Route middleware
опирается только на app-scoped auth state: logged-out routes не открывают private
screens, admin UI скрывается для обычного пользователя, но backend authorization
всегда остаётся authoritative.

Transport flow разделён явно:

```text
HTTP response (`unknown`)
→ infrastructure runtime parser / transport DTO
→ application result
→ domain model or bounded view state
→ presentation
```

Theme, haptics, clipboard и device detection — browser capabilities, а не
component helpers. Для них допустимы маленькие ports, потому что уже существуют
реальные production/non-browser-test implementations. Theme/haptics preferences
не являются secrets и могут храниться в `localStorage`; auth credentials,
passwords, activation/reset tokens и crypto material там запрещены.

Device label вычисляется автоматически и остаётся только best-effort metadata:
browser family + OS family + device class, bounded до API limit. User-Agent и
Client Hints не дают authorization claims и не являются доказательством модели
устройства. Exact model может быть неизвестна; settings позволяют дать понятное
display name вручную уже после входа.

Semantic haptic intent (`selection`, `success`, `warning`, `error`, `sent`)
отделён от конкретного механизма. Web adapter может использовать
`navigator.vibrate` при поддержке и включённой preference, иначе обязан быть
no-op. Web/PWA не утверждает, что получил прямой доступ к Apple Taptic Engine.

Invite/reset secret разрешён в URL только после `#`: fragment не отправляется
серверу. Activation/reset page извлекает его один раз, немедленно вызывает
`history.replaceState` для очистки address bar и хранит значение только в памяти
до submit/unmount. Query parameters для credentials запрещены.

TypeScript strict. Не использовать необоснованные `any`, `@ts-ignore`, broad casts или non-null assertions. API response остаётся untrusted до parsing/validation на boundary.

Auth credential никогда не хранится в `localStorage`/IndexedDB: browser session находится в `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no-`Domain` cookie.

Реализованный frontend transport состоит из трёх явных boundaries:

```text
Vue app → useAuth state machine → auth service → same-origin API adapter
                                              └→ runtime response parsers
```

API adapter всегда использует относительный `/api/v1/...` URL и `credentials: include`. Для state-changing HTTP вызовов он читает только публичный CSRF cookie `__Host-yv_csrf` и передаёт его в `X-CSRF-Token`; opaque session cookie остаётся недоступной JavaScript. Ошибки HTTP, сети и malformed JSON различаются typed error kind. Runtime parsers допускают в reactive state только явно проверенные account fields. Password очищается из component state до ожидания network response и не попадает в persistent storage или rendered error.

Auth composable моделирует только конечные состояния `booting`, `signed-out`, `submitting`, `authenticated`, `offline`. `401` означает signed-out/revoked credential, network failure даёт retry без ложного logout, а logout очищает client state даже при потере соединения. Следующие conversation/sync services используют тот же transport и собственные typed parsers вместо raw `fetch` в components.

Messaging UI разделён на typed transport parsers/services, `useMessenger` orchestration и небольшие chat components. Authenticated `GET /api/v1/users` проходит через отдельный `ListUserDirectory` use case и `UserRepository.list_active`; наружу выходят только `user_id`, `username`, `display_name`. SQLAlchemy, admin status, activation/password/session fields не пересекают boundary.

Frontend initial catch-up использует race-free порядок:

```text
capture stream cursor baseline
→ fetch directory/conversations/active timeline snapshot
→ poll events strictly after baseline
```

Событие, появившееся до baseline, уже покрывается последующим snapshot; событие после baseline будет применено poll. `reset_required` аналогично фиксирует server cursor до full resource reload. Timeline объединяет messages по stable ID и сортирует только по authoritative server `sequence`.

До crypto ADR доступен только development/MVP synthetic codec protocol v1: UTF-8 payload кодируется base64 для opaque transport compatibility, но это **не шифрование и не E2EE**. Boundary уже имеет `MessageCodec.encode/decode`, UI показывает постоянное предупреждение, persistent plaintext отсутствует. Этот adapter удаляется при `BL-012`–`BL-014`; production secure milestone не может быть объявлен с ним.

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

Versioned account lifecycle transport:

```text
active admin session
  └── /api/v1/admin/users
      ├── list bounded account state
      ├── create invitation → plaintext secret returned once
      ├── reissue → previous unconsumed secrets revoked atomically
      ├── deactivate → all target sessions/devices revoked atomically
      └── password-reset → target sessions/devices revoked + secret returned once

invited user
  └── /api/v1/auth/activate → one-time secret + new password

activated user after admin recovery action
  └── /api/v1/auth/reset-password → separate one-time secret + new password
```

Activation-token persistence различает `used_at` и `revoked_at`; состояния взаимоисключающие. List/update DTO не содержат password hash или activation digest. Reactivation через admin API разрешена только account с уже настроенным password; первоначальное приглашение нельзя обойти выставлением `is_active`.

Password recovery purpose-bound и не переиспользует activation credential. `password_reset_tokens` хранит только SHA-256 digest, TTL и взаимоисключающие `used_at`/`revoked_at`; row lock делает consume single-use при concurrent requests. Admin не задаёт чужой пароль: выдача reset-link немедленно завершает все target sessions/devices, пользователь сам задаёт новый Argon2id password, а blocked account не активируется скрыто. Admin self-reset запрещён этим transport и выполняется через authenticated step-up current-account flow. Typed `password_reset_issued`/`password_reset_completed` events не содержат secret или password.

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

Active-device API выводит только non-revoked/non-expired sessions текущего пользователя, сервером отмечает current session и позволяет rename, revoke одной не-current device-bound session или atomic revoke-all-others. Ownership всегда ограничивается authenticated `user_id`; guessed foreign UUID возвращает тот же not-found outcome. Typed security events (`login`, `logout`, credential replay и device actions) содержат только opaque IDs/timestamps, имеют configurable bounded retention и не принимают free-form payload.

Frontend security center реализует те же операции через отдельный
`AccountSecurityGateway`: infrastructure runtime-validates device/event/profile
DTO, application предоставляет небольшие intent-level use cases, а settings
components отвечают только за формы и подтверждения. Current device помечается
сервером и не получает revoke action. Rename/revoke/revoke-others обновляют
authoritative list после response. IP показывается только как приблизительный
контекст. Event UI принимает закрытый набор typed event names и не ожидает
free-form payload.

Current-account API получает identity исключительно из authenticated principal. `GET/PATCH /api/v1/me` возвращает/изменяет только bounded profile fields. Password change и explicit security reset используют текущий пароль как step-up factor внутри row-locked identity transaction; IP/GeoIP/User-Agent не участвуют. Password change обновляет Argon2id hash и отзывает все остальные sessions/devices, сохраняя current session. Security reset отзывает все sessions/devices, включая current, после чего transport удаляет auth/CSRF cookies. Обе операции создают typed bounded audit events без password/token payload. E2EE identity/key reset в эту account-операцию не входит и проектируется только после protocol ADR.

Password inputs существуют только в локальных refs соответствующей формы:
значения копируются в краткоживущие параметры вызова, UI refs очищаются до
ожидания network response и повторно на unmount. Успешный profile update заменяет
current-account DTO в auth state без reload; успешный security reset очищает
auth state и переводит приложение на login. Это не является E2EE key reset.

PWA замыкает закрытый onboarding без public registration: admin-only panel вызывает отдельные list/invite/reissue/block/reset use cases, а logged-out формы — `ActivateAccount` и `ResetPassword`. Admin list использует server-side bounded search/pagination и batch session summary без N+1. Plaintext activation/reset secret существует в frontend state только в момент ввода или одноразового admin response, находится в URL только после fragment marker, не попадает в HTTP/referrer, localStorage, IndexedDB или logs и удаляется при success/скрытии/unmount/reload. Новый password и confirmation очищаются до ожидания response. Опасные admin actions требуют явного UI confirmation; видимость controls остаётся только UX, серверная `require_active_admin` — authorization boundary.

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

Conversation имеет type `direct|group`, creator и membership lifecycle. Реализованный aggregate не зависит от FastAPI/SQLAlchemy и валидирует timezone-aware timestamps, уникальность members, direct shape и ровно одного active creator-owner группы. Membership не удаляется при выходе: фиксируется `left_at`, чтобы последующие sync/audit операции могли отличить бывшего участника от никогда не состоявшего.

Persistence хранит unordered direct pair в канонических `direct_user_low_id`/`direct_user_high_id`; unique index `uq_conversations_direct_pair` закрывает race двух одновременных create. `conversation_members` имеет составной primary key `(conversation_id, user_id)`, bounded role и `left_at >= joined_at`. Удаление conversation каскадирует membership, а ссылки на users используют `RESTRICT`. Repository возвращает domain aggregate с явно загруженными members; ORM наружу infrastructure не выходит.

Versioned `/api/v1/conversations` transport получает actor только из opaque-session principal. List/get возвращают DTO с безопасными user profile fields и membership metadata; ORM не выходит из infrastructure. Unknown UUID, inactive membership и removed member дают одинаковый not-found outcome. Direct membership immutable. В группе owner управляет member↔admin и любыми non-owner memberships; admin может добавлять и удалять только ordinary members, но не менять роли. Owner не может выйти или быть удалён без отдельного ownership-transfer дизайна. Все writes используют row lock, одну transaction и Origin+CSRF.

List загружает members через SQLAlchemy `selectinload` и все referenced users одним bulk lookup, не выполняя user query на каждую conversation. Client-supplied `user_id`, role, device, conversation или resource ID никогда не считается доказательством доступа.

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

Реализованный foundation пока содержит `id`, conversation/sender user/device, positive `protocol_version`, bounded opaque `ciphertext` и server `created_at`. HTTP принимает ciphertext как strict base64 encoding, декодирует в opaque bytes и не эхоит content в create response. Application повторно проверяет active conversation membership и active owned device текущей session; sender user/device не принимаются как свободные client claims. PostgreSQL ограничивает ciphertext 1 MiB, application policy — 64 KiB и transport version `1`.

Это только non-E2EE transport foundation: version `1` не определяет криптографический протокол, backend ничего не шифрует/дешифрует и secure messaging milestone нельзя считать завершённым до отдельного protocol ADR и client crypto adapter.

Колонки `text`, `plaintext`, `decrypted_body`, `message_key` запрещены.

Message creation idempotent по client-generated UUID в scope sender device. Exact retry возвращает исходные `message_id/sequence`; повтор ключа с иным immutable envelope даёт conflict. Под row lock conversation backend выделяет следующий positive sequence, а unique `(conversation_id, sequence)` страхует invariant в БД. List API выдаёт bounded ascending page `sequence > after_sequence`; client timestamp не участвует. Следующий sync этап добавит атомарный message + global sync event cursor.

PostgreSQL — source of truth для server-side sync state только в retention window. WebSocket — notification channel. После reconnect/sleep/lost events клиент выполняет cursor catch-up:

```text
GET /api/v1/sync?after=<cursor>
→ events, next_cursor, has_more
```

Реализованный durable stream использует независимый monotonic cursor каждого пользователя: `sync_streams(user_id, last_cursor)` и recipient-specific `sync_events(user_id, cursor)`. Atomic PostgreSQL upsert выделяет cursor, сохраняя event order внутри user stream и стабильный user lock order между recipients. Visibility фиксируется при записи события, поэтому удалённый member получает финальный `conversation_updated`, хотя последующий conversation GET уже возвращает not-found.

Message row и все `message_created` recipient events коммитятся одним Messaging UoW; exact retry не создаёт повторных events. Sync payload содержит только stable event/conversation/message IDs и timestamps, без ciphertext/plaintext/key data. Cleanup удаляет expired events, но сохраняет stream high-water mark; `/api/v1/sync` сравнивает `after`, oldest retained cursor и stream cursor и выставляет `reset_required`, когда нужен полный resource resync.

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

Async tests выполняются pytest + pytest-asyncio (`asyncio_mode=auto`) и используют обычные `async def`/`await`; test functions не создают event loop через `asyncio.run()`. Production Dishka graph имеет отдельную executable specification, которая резолвит все зарегистрированные application operations в REQUEST scope.

Operational signals: HTTP 5xx, failed logins, active WebSockets, push failures, cleanup counts, DB/media size и free disk. Тяжёлый observability stack не добавляется без необходимости.

Production images non-root, reproducible и не содержат secrets. GitHub Actions строит/publishes images; слабый VPS выполняет pull, intentional migration, rollout и healthcheck.

Production runtime изолирован explicit Compose project `yv-chat`. На host публикуется только loopback `127.0.0.1:18080` gateway; gateway подключён к отдельной edge network и к internal private network, а PostgreSQL/API/Nuxt не имеют host ports и находятся только в private network. Private subnet project-owned и выдаёт gateway стабильный `172.30.242.10`; backend принимает forwarding chain только от этого exact `/32`. Host ingress добавляет реального peer в `X-Forwarded-For`, internal gateway сохраняет цепочку без добавления Docker bridge hop, а application выбирает первый справа untrusted address. Subnet обязательно проверяется на конфликт при переносе на другой host.

Host Nginx остаётся общим ingress для уже работающих сервисов и проксирует только `chat.yoowee.ru` в этот loopback upstream. HTTP-only ACME vhost устанавливается первым; после loopback smoke и выпуска certificate он атомарно заменяется reviewed HTTPS/redirect/HSTS vhost. Каждый reload предваряется `nginx -t`, соседние server blocks не переписываются. Workflow использует immutable `sha-<commit>` GHCR tags, выполняет migration новым backend image до health-checked rollout и не запускает Docker build на VPS. Runtime `.env` и одноразовая initial-admin credential существуют только на сервере с mode `0600`; deploy artifacts не содержат secrets. Полный runbook: [deployment.md](deployment.md).

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
