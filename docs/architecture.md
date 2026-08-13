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
│   ├── conversations/     # focused group/member operations
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

### Messenger viewport и interaction model

Authenticated `product-shell` ограничен ровно `100dvh` и не отдаёт высоту длинному
content. Обычные settings/admin pages скроллят `.product-content`, а chat workspace
получает `height: 100%`, `min-height: 0` и `overflow: hidden` на каждом grid boundary.
Внутри messenger скроллятся только `.conversation-list` и `.message-timeline`;
desktop rail/sidebar, conversation header, security state и composer остаются в
своих grid rows. `overscroll-behavior: contain` не передаёт scroll наружу.

Desktop использует split view с bounded sidebar. Mobile использует master/detail:
выбранный conversation хранится как несекретный UUID в query `/chat?conversation=…`.
Первый переход из list создаёт history entry, переключение между разговорами заменяет
его, browser Back возвращает list. На list global bottom tabs занимают отдельный
safe-area-aware viewport slot; внутри conversation они скрываются, поэтому composer
остаётся у visual viewport и при уменьшении высоты software keyboard.

Компонент не вычисляет grouping inline: pure typed `buildTimelineLayout` создаёт day
separators и объединяет соседние сообщения одного sender только в пятиминутном окне.
Scroll coordinator проверяет позицию до DOM update: initial load и собственная отправка
следуют вниз, но входящее сообщение во время чтения истории сохраняет `scrollTop` и
показывает explicit scroll-to-latest action. Composer ограниченно растёт до 128 px;
Enter отправляет, Shift+Enter добавляет строку, IME composition никогда не вызывает
преждевременную отправку.

Message-relative viewport является durable local intent, а не абсолютным `scrollTop`.
Cold reload читает из encrypted IndexedDB bounded окно `49 before + target + 50 after`;
при archive miss тот же window запрашивается у server. Timeline скрыт до первой exact
расстановки и programmatic restore всегда использует instant scroll. Hidden mobile
pane с нулевой высотой не имеет права вычислять или сохранять anchor. Push/deep-link
остаётся pending, пока target row не появился в DOM с небольшим контекстом с обеих
сторон, поэтому sparse latest cache не считается готовым target window.

History size не определяет стоимость initial render: latest/anchored fetch содержит не
более 100 rows, reactive timeline ограничен 300 rows, encrypted archive — 2000 rows.
Pagination расширяет окно по требованию; Vue никогда не монтирует lifetime history
целиком. Уже подготовленные неизменившиеся envelopes переиспользуются, чтобы merge
local/server window не запускал повторную дешифровку тех же ciphertext.

Reusable typed SVG icons, local conversation search, circular avatars, time/unread/
presence metadata и compact grouped bubbles являются presentation деталями. Они не
добавляют network state или crypto logic в Vue components. Physical acceptance для
`WP-041` проверяет desktop `1440×900`, mobile `390×844`, keyboard-sized `390×500`,
long sidebar/timeline и неизменные координаты header/composer после internal scroll.

Group info открывается отдельной responsive panel, а не разрастается внутри
`MessagePanel`: desktop использует bounded side sheet, mobile — `100dvh` surface с
safe-area и собственным scroll. Panel получает intent callbacks rename/add/remove/
leave, а реализации находятся в `application/conversations` и вызывают typed
`MessagingGateway`. После successful mutation `useMessenger` заменяет authoritative
conversation DTO и сохраняет encrypted snapshot; другой device сходится через
durable `conversation_updated` + cursor catch-up.

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

Auth composable моделирует только конечные состояния `booting`, `signed-out`,
`submitting`, `authenticated`, `offline`. `401` означает signed-out/revoked
credential, network failure даёт retry без ложного logout. Явный logout очищает
authenticated client state только после успешного server response; при потере сети
UI остаётся authenticated и честно сообщает, что session/device не были отозваны.
Следующие conversation/sync services используют тот же transport и собственные
typed parsers вместо raw `fetch` в components.

iOS Home Screen Web App является отдельной browser installation: начиная с iOS 17.2
она может получить копию Safari auth cookie при установке, но не Safari IndexedDB.
Поэтому наличие valid session и server crypto identity не доказывает наличие
device-local MLS vault в текущем storage container. При registered identity + missing
vault client fail-closed предлагает password-confirmed re-enrollment: обычный login
создаёт новую device/session и заменяет cookie только текущего Web App container,
не вызывая logout/revoke старой Safari session. Silent regeneration public identity
под прежним `device_id` запрещена. Origin storage запрашивает persistence
best-effort, но correctness не полагается на предоставление этой platform guarantee.

Foreground realtime также отделён от Vue components. `BrowserRealtimeGateway`
создаёт только same-origin `/api/v1/realtime` URL без query credential, строго
разбирает закрытый набор frames и отвечает на application-level ping. Application
`RealtimeSyncService` владеет единственным connection lifecycle, bounded
deterministic reconnect и редким 30-секундным fallback poll. Любой `hello`,
durable hint или reconnect вызывает тот же cursor catch-up; повторные wake-ups
coalesce, но не заменяют `/sync`. `ChatWorkspace` только запускает/останавливает
service вместе со своим lifecycle.

Messaging UI разделён на typed transport parsers/services, application-level
message protection, `useMessenger` orchestration и небольшие chat components.
Authenticated `GET /api/v1/users` проходит через отдельный `ListUserDirectory` use
case и `UserRepository.list_active`; наружу выходят только `user_id`, `username`,
`display_name`. SQLAlchemy, admin status, activation/password/session fields не
пересекают boundary.

Frontend initial catch-up использует race-free порядок:

```text
capture stream cursor baseline
→ fetch directory/conversations/active timeline snapshot
→ poll events strictly after baseline
```

Событие, появившееся до baseline, уже покрывается последующим snapshot; событие после baseline будет применено poll. `reset_required` аналогично фиксирует server cursor до full resource reload. Timeline объединяет messages по stable ID и сортирует только по authoritative server `sequence`.

Frontend message protection boundary асинхронный, чтобы Rust/WASM adapter не менял
application/UI contract. Application policy выбирает outgoing version только по
authoritative conversation type: `direct → 2`, `group → 1`.
`ProtocolMessageProtection` затем выбирает adapter только по точному
`protocol_version`: unknown versions запрещены, duplicate registrations ошибочны,
а недоступный MLS v2 завершается `provider-unavailable`. Silent fallback
v2/unknown/corrupt envelope в v1 отсутствует. Outbox сохраняет уже выбранную version
и exact crypto binding; retry не может сменить protocol.

Текущий временный group protocol v1 кодирует UTF-8 в canonical base64
для совместимости с transport, но это **не шифрование и не E2EE**: backend может
прочитать содержимое group message. Group UI показывает постоянное предупреждение.
Adapter возвращает typed corruption error при
malformed base64/UTF-8. Application готовит отдельный `TimelineMessage`: Vue видит
только `available/deleted/unavailable`, bounded display text и protection metadata,
не импортирует crypto adapter и не декодирует ciphertext. Decrypted content живёт
только в reactive in-memory timeline; transport/domain DTO и persistence остаются
opaque DTO shape. Synthetic adapter остаётся только для groups и historical rows до
`BL-051`; E2EE claim относится исключительно к direct v2 conversations.

## 7. Identity, devices и sessions

`User` и `Device` — разные сущности. Один пользователь имеет несколько browser installations/physical devices. Device-specific state включает session, crypto identity, push subscription и last-seen metadata.

Public registration отсутствует:

```text
initial admin bootstrap
        ↓
admin creates standalone invitation (no pseudo-user)
        ↓
one-time hashed registration secret
        ↓
user chooses unique username/display name + Argon2id password
        ↓
account + device + opaque session are committed atomically
```

Versioned account lifecycle transport:

```text
active admin session
  ├── /api/v1/admin/invitations
      ├── create standalone invitation → plaintext secret returned once
      ├── list safe metadata/status without secret or digest
      └── revoke active invitation immediately
  └── /api/v1/admin/users
      ├── list bounded activated/legacy account state
      ├── reissue → previous unconsumed secrets revoked atomically
      ├── deactivate → all target sessions/devices revoked atomically
      └── password-reset → target sessions/devices revoked + secret returned once

invited user
  ├── /api/v1/auth/register → one-time secret + chosen identity + new password
  │   └── protected session cookies returned without a second login
  └── /api/v1/auth/activate → legacy user-bound invitation compatibility

activated user after admin recovery action
  └── /api/v1/auth/reset-password → separate one-time secret + new password
```

`registration_invitations` существует отдельно от `users`: label/creator/TTL и
взаимоисключающие `used_at`/`revoked_at` управляются администратором, а
`registered_user_id` появляется только при успешном consume. Plaintext secret
возвращается только один раз; persistence и list DTO содержат только digest либо
безопасную metadata соответственно. URL использует fragment, который PWA удаляет из
address bar и держит только в памяти до HTTPS body; token input в DOM отсутствует.
Case-insensitive username uniqueness обеспечивается PostgreSQL и transaction: conflict
не потребляет invitation. Token/state проверяются до Argon2id, поэтому invalid abuse
не запускает дорогой password hash. Exact Nginx location `/api/v1/auth/register`
имеет отдельный per-IP rate limit/малый body limit и не влияет на другие API routes или
virtual hosts; volumetric DDoS всё равно требует upstream filtering.

Legacy activation-token persistence различает `used_at` и `revoked_at`; уже выпущенная
user-bound ссылка может быть принята новым экраном с выбранной пользователем identity
либо прежним `/auth/activate` до compatibility cleanup. List/update DTO не содержат
password hash или activation digest. Reactivation через admin API разрешена только
account с уже настроенным password; первоначальное приглашение нельзя обойти
выставлением `is_active`.

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

Выход с текущего устройства является security operation, а не обычной навигацией:
он требует отдельного confirm step в Settings и backend атомарно отзывает current
session вместе с device identity. Device-scoped IndexedDB records физически не
удаляются скрыто, но новый login создаёт новый backend device ID и не получает старые
MLS private keys. Поэтому старая E2EE-история, доступная только этому device, может
стать недоступной после выхода; другие уже подключённые устройства сохраняют свои
локальные архивы. Возврат истории новому device требует отдельного secure
device-to-device transfer из `BL-015`.

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

Conversation имеет type `direct|group`, creator и membership lifecycle. Реализованный aggregate не зависит от FastAPI/SQLAlchemy и валидирует timezone-aware timestamps, уникальность members, direct shape, bounded/normalized group title, максимум 50 active members и ровно одного active creator-owner группы. Membership не удаляется при выходе: фиксируется `left_at`, чтобы последующие sync/audit операции могли отличить бывшего участника от никогда не состоявшего. Повторное добавление реактивирует ту же запись с новым `joined_at`, ролью `member` и `left_at = null`; active duplicate остаётся конфликтом.

Persistence хранит unordered direct pair в канонических `direct_user_low_id`/`direct_user_high_id`; unique index `uq_conversations_direct_pair` закрывает race двух одновременных create. `conversation_members` имеет составной primary key `(conversation_id, user_id)`, bounded role и `left_at >= joined_at`. Удаление conversation каскадирует membership, а ссылки на users используют `RESTRICT`. Repository возвращает domain aggregate с явно загруженными members; ORM наружу infrastructure не выходит.

Versioned `/api/v1/conversations` transport получает actor только из opaque-session principal. List/get возвращают DTO с безопасными user profile fields и membership metadata; ORM не выходит из infrastructure. Unknown UUID, inactive membership и removed member дают одинаковый not-found outcome. Direct membership/title immutable. В группе owner/admin может переименовать conversation и добавлять active accounts; owner управляет member↔admin и любыми non-owner memberships, admin удаляет только ordinary members и не меняет роли. Owner не может выйти или быть удалён без отдельного ownership-transfer дизайна. Все writes используют row lock, одну transaction и Origin+CSRF; title/add/remove/leave публикуют recipient-specific `conversation_updated`, причём remove/leave включает бывшего участника для удаления доступа через catch-up.

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
ciphertext | null
ciphertext_digest
created_at / expires_at
deletion_reason / deleted_at / tombstone_expires_at
```

Active row содержит bounded opaque `ciphertext`; tombstone содержит ту же immutable
routing/order metadata, но `ciphertext = NULL`. `ciphertext_digest` — SHA-256 только
от opaque ciphertext: он нужен для проверки exact idempotent retry после scrub,
никогда не выходит через HTTP/sync/logs и не является message key. HTTP принимает
ciphertext как strict base64, декодирует в opaque bytes и не эхоит content в create
response. Application повторно проверяет active conversation membership и active
owned device текущей session; sender user/device не принимаются как свободные client
claims. PostgreSQL ограничивает ciphertext 1 MiB, application policy — 64 KiB и
transport version `1`.

Это только non-E2EE transport foundation: version `1` не определяет криптографический протокол, backend ничего не шифрует/дешифрует и secure messaging milestone нельзя считать завершённым до отдельного protocol ADR и client crypto adapter.

Колонки `text`, `plaintext`, `decrypted_body`, `message_key` запрещены.

Message creation idempotent по client-generated UUID в scope sender device. Exact retry возвращает исходные `message_id/sequence` даже после scrub, сравнивая retained digest; повтор ключа с иным immutable envelope даёт conflict. Под row lock conversation backend атомарно увеличивает `conversations.last_message_sequence`, а unique `(conversation_id, sequence)` страхует invariant в БД. Физическое удаление старого tombstone не уменьшает high-water и не разрешает reuse sequence. List API выдаёт bounded ascending page `sequence > after_sequence`; client timestamp не участвует. Message и recipient-specific sync events записываются одной транзакцией.

Delete-for-everyone — отдельный application use case. Sender удаляет собственное
сообщение; active group owner/admin может модерировать чужое. Direct peer и ordinary
group member не могут удалить чужой ciphertext. Conversation блокируется до message,
membership и message/conversation binding проверяются server-side, поэтому foreign
message ID даёт not-found, а не existence oracle. Первая операция атомарно scrubs
ciphertext, записывает manual tombstone и recipient-specific `message_deleted`;
duplicate retry возвращает `advanced=false` без commit/event. Уже просмотренную,
скопированную или экспортированную remote copy система уничтожить не обещает.

PostgreSQL — source of truth для server-side sync state только в retention window. WebSocket — notification channel. После reconnect/sleep/lost events клиент выполняет cursor catch-up:

```text
GET /api/v1/sync?after=<cursor>
→ events, next_cursor, has_more
```

Реализованный durable stream использует независимый monotonic cursor каждого пользователя: `sync_streams(user_id, last_cursor)` и recipient-specific `sync_events(user_id, cursor)`. Atomic PostgreSQL upsert выделяет cursor, сохраняя event order внутри user stream и стабильный user lock order между recipients. Visibility фиксируется при записи события, поэтому удалённый member получает финальный `conversation_updated`, хотя последующий conversation GET уже возвращает not-found.

Message row, sender read cursor и recipient-specific `message_created` +
`read_receipt` events коммитятся одним Messaging UoW; отправка означает, что sender
прочитал timeline до выделенной sequence, поэтому собственное сообщение не становится
ложно unread. Exact retry не создаёт повторных rows/events. Sync payload содержит
только stable event/conversation/message/actor IDs, read/delivery sequences и timestamps, без
ciphertext/plaintext/key data. Cleanup удаляет expired events, но сохраняет stream
high-water mark; `/api/v1/sync` сравнивает `after`, oldest retained cursor и stream
cursor и выставляет `reset_required`, когда нужен полный resource resync.

Shared read state хранится в `conversation_read_states` по ключу
`(user_id, conversation_id)`, то есть принадлежит аккаунту, а не отдельному device.
Отсутствующая row означает cursor `0`; persisted cursor всегда positive, ссылается на
существующую server sequence и может только увеличиваться. `MarkConversationRead`
сериализуется conversation row lock, atomic upsert защищён PK/check/FK и lower/equal
retry является no-op без нового receipt. Batch repository одним set-based query
возвращает `last_read_sequence`, persistent conversation high-water как
`latest_sequence` и count только active ciphertext rows после cursor — без N+1 и без
арифметики `latest - read`, которая сломалась бы после delete/TTL gaps.

Frontend получает read summaries через отдельный typed gateway и application use
cases. `useMessenger` помечает только active conversation, только до последней
фактически загруженной authoritative sequence и только когда page visibility сообщает
foreground. Повторные submits дедуплицируются; потерянный/duplicate WebSocket hint
всегда восстанавливается `/sync` и повторным read-state reload.

Delivery state намеренно отделён от read state. Таблица
`conversation_delivery_states` хранит monotonic cursor по ключу
`(device_id, conversation_id)`: delivery означает, что конкретная active installation
успешно получила bounded message page, но не обещает decrypt, foreground/read или
вечное локальное хранение. `MarkConversationDelivered` берёт user/device только из
opaque-session principal, проверяет active owned device, active membership и наличие
server sequence. Future sequence отклоняется, lower/equal retry является no-op.

Публичный participant summary агрегирует `max(last_delivered_sequence)` по active
devices каждого active member. Поэтому UI трактует его как «доставлено хотя бы на
одно устройство получателя»; revoked devices и покинувшие conversation участники не
считаются. API/sync/realtime не раскрывают device ID или metadata другим участникам —
durable `delivery_receipt` содержит только conversation, actor user и sequence.
Cursor и recipient-specific events коммитятся в одном Messaging UoW, realtime
публикуется best-effort после commit. Send также атомарно двигает delivery cursor
устройства отправителя, не создавая новые rows/events при exact retry.

Frontend использует отдельные DTO/gateway/use cases для delivery, подтверждает
последнюю sequence после успешного merge message page независимо от visibility и
дедуплицирует submit по conversation. `delivery_receipt` лишь будит cursor catch-up и
set-based summary reload; компонент получает готовый aggregate и показывает статус
только у собственных сообщений. Это transport-level receipt, а не часть ещё не
выбранного E2EE protocol.

`/api/v1/realtime` принимает WebSocket только после exact Origin и opaque-cookie
handshake. Handshake может выполнить throttled session touch, но не вращает cookie
credential; heartbeat/pong не касается session state. Уже установленное соединение
пассивно проверяет logical session/user/device и expiry, поэтому последующая HTTP
credential rotation не превращает старый socket credential в ложный replay.
Process-local `InMemoryRealtimeHub` держит bounded queue на connection и удаляет
slow consumer. После durable commit application публикует только `event_id`,
`conversation_id`, optional `message_id` и typed `new_message`,
`conversation_updated`, `message_deleted`, durable `read_receipt` либо
`delivery_receipt`; failure notifier
логируется без content и не меняет committed result. Это сознательно single-process
решение без Redis. Presence идёт отдельным ephemeral path и не становится durable
truth.

Typing использует отдельный ephemeral path поверх того же authenticated WebSocket.
Client frame имеет exact форму `typing(conversation_id, active)` и не может задавать
actor, recipients или expiry. `PublishTyping` повторно проверяет active actor и
membership через Messaging UoW, исключает actor из recipients, назначает server TTL
и публикует hint без commit, DB row или `sync_event`. Transport дедуплицирует слишком
частые одинаковые transitions и ограничивает число active conversation keys на
connection; stop transition не задерживается throttle.

Frontend строго отделяет durable frames от typing: `RealtimeSyncService` запускает
cursor catch-up только для durable hints, а typing передаёт в
`TypingIndicatorService`. Сервис keyed по conversation+actor, заменяет expiry timer
при renew, удаляет state по stop/expiry/socket disconnect, а собственный publisher
renew-ит active draft раз в три секунды и отправляет stop при очистке/switch/unmount.
Vue-компонент сообщает только intent о непустом draft и отображает готовый transient
state; draft content никогда не покидает client UI/message-codec boundary.

Presence также остаётся process-local и ephemeral. Hub атомарно отмечает `0 → 1`
subscription как `became_online`, а удаление последней из нескольких user sessions —
как `became_offline`; закрытый slow consumer перестаёт считаться online и будит
transport cleanup. Authorized snapshot пересекает active conversation members с
`hub.online_user_ids`, поэтому не существует global online-directory endpoint.
Transition отправляется отдельно для каждой общей conversation, без session/device/IP
metadata и без DB/sync write. Если новая session появляется во время offline publish,
transport выполняет post-publish reconciliation и повторяет online, сохраняя верное
итоговое best-effort состояние. После durable `conversation_updated` transport заново
вычисляет authorized snapshot для конкретного получателя: это закрывает race, когда
оба пользователя были online до создания общего conversation, и не превращает
presence в global directory.

Frontend хранит presence keyed по conversation+user в отдельном application service.
Initial snapshot и последующие transitions применяются идемпотентно; socket close
немедленно очищает весь ephemeral state. Presence frame не запускает `/sync`, не
продлевает auth session и используется только для UI-индикатора, не авторизации.
Отдельный typed connection lifecycle
`connecting/connected/reconnecting/stopped` управляет visual connection indicator;
зелёное состояние устанавливается только фактическим WebSocket `onopen`.

Глобальный application-level `ConnectionMonitor` отдельно отражает достижимость
same-origin backend на всех authenticated страницах. Browser `online/offline` events
дают немедленный network signal, но `online` считается только поводом для health
probe, а не доказательством связи с сервером. Initial/periodic probes coalesce,
ошибка запускает bounded backoff, teardown удаляет listeners/timers. UI получает
только typed `checking/connected/updating/reconnecting/offline` state; raw fetch и
browser APIs остаются в infrastructure adapters. Узкая safe-area-aware status row
занимает собственную grid-строку и не перекрывает chat header или mobile controls.

Правильность любой realtime-фичи проверяется при отключённом WebSocket. Duplicate WebSocket/Push/sync delivery применяется идемпотентно.

## 10. E2EE trust boundary

Обязательный invariant для direct conversations:

```text
plaintext exists only on authorized client devices
```

Backend хранит direct ciphertext, public protocol data, IDs/timestamps/membership и
минимальную metadata. Он не хранит direct plaintext, decrypted attachments, message
keys или device private identity keys и не имеет `decrypt_message()` для E2EE
content. Временные group v1 bytes являются осознанным исключением: это server-readable
content, хотя transport DTO/DB column по-прежнему называется `ciphertext`.

Protocol decision принят в [ADR-0001](adr/0001-e2ee-mls.md): MLS 1.0 по RFC
9420, один independent MLS client на device и один MLS group на conversation,
включая direct. Выбранный ciphersuite — mandatory-to-implement
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`; TreeKEM, HPKE, signatures,
ratchets и key schedule не реализуются project code. ADR фиксирует AS/DS threat
model, metadata leakage, KeyPackage/Welcome lifecycle, v2 framing, multi-device,
recovery и provider release gates.

Локальный partial-loss recovery и отсутствие permanent primary device уточнены в
[ADR-0002](adr/0002-local-mls-checkpoint-recovery.md).

OpenMLS core + minimal Rust/WASM adapter развёрнут для direct v2 после browser
persistence/corruption, CSP/build и production-like acceptance. KAT/interop,
Safari/storage-denial и independent binding review остаются hardening gates. Group
MLS lifecycle реализован, но operational policy `WP-050` временно не использует его
для новых group messages до `BL-051`. Synthetic v1 явно insecure и не имеет права
становиться fallback для direct.

Первый provider proof находится в `crypto/openmls-provider`. Это отдельный pinned
Rust workspace: Rust `1.91.0`, OpenMLS `0.8.1`, `openmls_rust_crypto 0.5.1` и exact
lockfile. Crate создаёт BasicCredential identity фиксированной длины
`schema_version(1 byte) || user UUID(16) || device UUID(16)`, отдельную Ed25519
signature key и one-time KeyPackage только для принятого AES-128-GCM ciphersuite.
Он заново валидирует TLS bytes через OpenMLS и выдаёт наружу только public identity,
signature key, KeyPackage и SHA-256 public fingerprint. Provider/signature/init
private state удерживается opaque object без serialization/getter/debug API.

Provider подключён к `ProtocolMessageProtection` как exact adapter v2 и получает
E2EE badge только для ready direct conversation. Release WASM и generated TypeScript
glue собираются из exact lockfile; CI отдельно проверяет, что public binding содержит
только sealed state API и не экспортирует private snapshot entrypoints. Physical
Safari и storage-denial/update acceptance остаются отдельными gates.

Внутри Rust crate существует private unsealed snapshot prerequisite. Формат имеет
fixed magic, format/provider versions, monotonic non-zero revision, canonical
identity/public KeyPackage anchors и bounded deterministic sorted storage records.
Restore exact-сверяет ожидаемые user/device UUID, повторно валидирует public
KeyPackage и находит Ed25519 signer только в restored OpenMLS storage. Private
one-time KeyPackage bundle обязателен до claim/join, но OpenMLS намеренно удаляет
его после принятия Welcome; его отсутствие после этого не делает сохранённые group
state и ratchets повреждёнными. Unsupported/truncated/trailing/duplicate/oversized
или inconsistent state переводится в typed fail-closed error.

Native conversation core создаёт deterministic `GroupId` из 16 bytes conversation
UUID, фиксирует exact ciphersuite и `PURE_CIPHERTEXT_WIRE_FORMAT_POLICY`, принимает
только TLS-валидированные one-time KeyPackages, выдаёт opaque Commit/Welcome/ratchet
tree и присоединяет recipient через staged Welcome с повторной сверкой group/suite.
Application AAD имеет точный формат
`"yv-chat-mls-v2" || 0x00 || conversation UUID || client-message UUID`; mismatch,
не-application record, trailing/corrupt wire data и replay закрываются без plaintext
наружу. Native Alice/Bob tests доказывают round-trip и продолжение sender/receiver
ratchets после sealed snapshot restore. Initial create/add/Welcome и
protect/unprotect экспортированы в versioned WASM v3 без private getters; production
transport не переключается до Worker atomic checkpoint и frontend reconciliation.

Unsealed snapshot содержит private MLS material. Он не является public API, не имеет
`wasm_bindgen` export и не может записываться в IndexedDB/файл или логироваться.
WASM `sealState` передаёт snapshot прямо WebCrypto `SubtleCrypto.encrypt`, затем
best-effort очищает временный byte buffer; `restoreSealedState` расшифровывает и
валидирует snapshot внутри Rust/WASM boundary. AES-256-GCM использует новый CSPRNG
96-bit IV и exact AAD
`format-label || canonical-user-UUID || canonical-device-UUID || revision`.
Outer revision обязан совпасть с authenticated inner revision. Wrong key, changed
identity/revision/IV/tag и malformed/bounded envelope дают typed fail-closed error;
fallback или silent identity regeneration отсутствуют.

Browser infrastructure adapter `IndexedDbCryptoVault` владеет versioned базой
`yv-chat-crypto-v1`. Для каждого device она хранит только structured-clone
non-extractable AES-GCM `CryptoKey` и sealed `{schema, user, device, revision,
fingerprint, iv, ciphertext}`. Первичный key+state commit выполняется одной
read-write transaction. Updates требуют ровно `current + 1`, неизменный public
fingerprint и optimistic revision match в transaction; partial key/state, rollback,
conflict и storage failure различаются typed errors и никогда не вызывают reset.
Этот adapter является внутренней зависимостью crypto Worker, а не
application port: намеренно нельзя передавать `CryptoKey`, nonce или ciphertext в
Vue/application DTO. Fake IndexedDB + Node WebCrypto tests фиксируют transaction и
metadata semantics. Physical Chromium и чистый Firefox подтверждены; Safari и
storage-denial scenarios всё ещё release-gated.

Repository хранит текущий generated package под immutable asset path `/crypto/v7/`:
JS glue, TypeScript declaration и WASM производятся exact `Rust 1.91.0` /
`wasm-bindgen 0.2.127`; CI пересобирает их и отклоняет tracked drift и private
snapshot exports. Nuxt production build обязан выпустить отдельный module Worker
chunk, скопировать WASM и включить оба versioned crypto assets и Worker в Workbox
precache. Версия URL меняется вместе с несовместимой binding/schema revision, чтобы
active service worker не смешивал новые JS bindings со старым WASM.
Старые `/crypto/v1/`–`/crypto/v6/` временно остаются только rolling-compatibility
assets для уже открытых Worker, не используются новым runtime и не входят в новый
precache. Import,
binding-shape, WASM init,
Worker crash/protocol/timeout имеют разные bounded error codes без raw exception.

`DeviceCryptoRuntime` существует только внутри dedicated Worker. Он различает
explicit `provision` и `restore`, после конкурентного bootstrap всегда восстанавливает
именно победивший atomic record и освобождает candidate/replaced WASM objects.
`checkpoint` допускает только следующий revision. Closed Worker protocol валидирует
exact поля/UUID/bounds и возвращает main thread только public credential identity,
signature key, KeyPackage, fingerprint и revision; raw exception, `CryptoKey`, IV,
ciphertext и vault record в response schema невозможны. Main-thread client добавляет
request correlation, bounded timeout, sanitized error taxonomy и deterministic
dispose. Composition root предоставляет один lazy authenticated
`DeviceCryptoSession`: layout и messenger делят один Worker/runtime, concurrent
same-device initialize сходятся в один promise и не имеют права предварительно
dispose-ить общий runtime; logout/unmount либо фактическая смена device binding
детерминированно dispose-ят старый scope. Worker не стартует на public
login/activation page.

Runtime v7 также реализует intent-level bounded KeyPackage generation,
read-only public conversation inspection и
create/join/rejoin/update/apply-commit/protect/unprotect. Каждая state-changing операция
считается успешной
только после следующего optimistic vault revision и
atomic sealed-state commit. Commit/Welcome/ciphertext/plaintext копируются наружу
только после durability barrier. Любая ошибка MLS mutation, sealing или IndexedDB
уничтожает потенциально продвинутый in-memory instance и сразу пытается восстановить
последний подтверждённый sealed snapshot. Ошибка конкретной операции возвращается
caller-у, но нерасшифровываемый historical ciphertext не оставляет весь device в
скрытом `not-provisioned`; если durable restore тоже невалиден/недоступен, runtime
остаётся fail-closed. Это предотвращает ratchet/epoch
rollback после частичного сбоя и повторное использование неподтверждённого state.
Main-thread gateway достигает этих операций только через exact Worker envelopes
`mls-inspect`, `mls-bootstrap`, `mls-join`, `mls-rejoin`, `mls-update`,
`mls-apply-commit`, `mls-protect`,
`mls-unprotect`. Каждый command/result
variant имеет закрытый набор полей, canonical UUID, bounded binary sizes и safe
integer epoch/revision. Лишнее поле делает весь envelope invalid; private state не
является допустимым типом. Commit/Welcome/tree/ciphertext/plaintext передаются как
transferable buffers, а malformed response завершает все pending calls fail-closed.

Node 24 integration tests исполняют настоящий release WASM с WebCrypto и fake
IndexedDB, включая reload, concurrent provision и tamper. Отдельный physical Chromium
smoke подтвердил production Worker asset, same-origin module/WASM fetch,
non-extractable key structured clone, exact restore и revision `1 → 2`. Чистый
Firefox smoke под production CSP отдельно подтвердил import, WASM compilation и
OpenMLS bootstrap. Production-like browser acceptance дополнительно подтвердил два
чистых origin/device, initial `GET 404 → PUT 200 → GET 200`, KeyPackage pool,
двусторонний MLS v2 exchange и decrypt из encrypted cache после reload обоих
devices. Production rollout v2 завершён для direct; `WP-050` отключает outgoing MLS
для groups без изменения сохранённых v2 rows. Safari,
storage-denial/update tests и MLS KAT/interop всё ещё обязательны.

Backend registry хранит только public device anchors. `PUT/GET
/api/v1/devices/current/crypto-identity` получает owner исключительно из validated
opaque-session principal. Credential bytes обязаны иметь exact layout
`1 || user UUID || device UUID`; fingerprint сервер пересчитывает как SHA-256 от
protocol label, credential и Ed25519 public key. Client fingerprint не принимается.
Identity immutable: под row lock exact retry идемпотентен, любое изменение public key,
credential или initial KeyPackage даёт typed conflict. Revoked/cross-owner device
отклоняется.

PostgreSQL разделяет `device_crypto_identities` и `device_key_packages`. Первичная
identity и initial package создаются одной transaction и удаляются cascade только
вместе с device. KeyPackage reference — server-derived SHA-256, globally unique;
bytes bounded до 1 MiB. Current device поддерживает inventory через отдельные
`ListDeviceKeyPackageInventory`/`ReplenishDeviceKeyPackages` use cases: batch имеет
1–16 элементов и aggregate limit 4 MiB, а duplicate bytes отклоняются по ref.

`ClaimDeviceKeyPackage` выдаёт package только active claiming device для другого
active target device, если оба пользователя — active members одного conversation.
Use case сначала блокирует claiming device (сериализуя exact retries одного
устройства), затем проверяет idempotency key, membership, target identity и выбирает
один available row через `FOR UPDATE SKIP LOCKED`. Claim metadata атомарно связывает
package с claimant user/device, conversation, request UUID и server time. Composite
owner FK, complete-metadata/self-claim checks, unique `(claiming_device,
claim_request_id)` и partial available index являются database backstop. Exact retry
с той же binding возвращает тот же public result только после повторной проверки
актуальных membership/device/identity; изменение target/conversation для того же
request UUID закрывается conflict. Очередь детерминирована
`created_at, id`, но FIFO конкретных bytes не является внешним контрактом.

HTTP transport разделён на identity registry и KeyPackage inventory/claim routers.
Он принимает canonical base64 и возвращает KeyPackage только вместе с immutable
target identity anchors; session/CSRF/Origin остаются обязательны для mutation.
Frontend имеет собственный typed port, strict response parser и list/replenish/claim
use cases. После identity initialization он держит foreground target восемь
available packages: недостающие пакеты генерируются внутри Rust/OpenMLS, их private
init keys сначала входят в следующий sealed provider revision, а наружу Worker
возвращает только bounded public TLS bytes для upload. HTTP failure не откатывает
provider и может лишь оставить невыданные локальные init keys; следующий inventory
retry создаёт новый уникальный batch без reuse. `claim_request_id` создаётся и
сохраняется caller/outbox, чтобы retry не
создавал новую выдачу. После `WP-045` server-delivered KeyPackage проходит pinned
OpenMLS validation внутри isolated Worker: exact TLS bytes должны иметь valid
signature, MLS 1.0, выбранный ciphersuite и leaf binding с canonical
user/device credential, Ed25519 public key, fingerprint и SHA-256 package ref.
TypeScript не разбирает MLS wire format и получает только bounded success/error.
Pool refresh также single-flight выполняется перед reconciliation новой conversation:
это восполняет packages, которые другие online coordinators израсходовали после
первичного login, не требуя перезапуска PWA.

Conversation MLS coordination использует отдельный Unit of Work и три server-side
типа opaque records: current generation, immutable required-device snapshot и
адресный Welcome. `POST /api/v1/conversations/{id}/crypto/bootstrap` блокирует
conversation/device rows в едином порядке `conversation → actor device → generation /
packages / required rows`, проверяет active membership, снимает все non-revoked
devices активных участников и атомарно claim-ит по одному KeyPackage для каждого
target кроме coordinator. Отсутствие identity/package создаёт `blocked` generation
без частичного secure group и без расходования package. Retry привязан к
`(coordinator_device_id, bootstrap_request_id)`; database uniqueness и conversation
row lock закрывают concurrent duplicate generations. Единый порядок блокировок
обязателен для всех roster mutations: FK-проверка required devices может читать
несколько device rows, поэтому обратный порядок создаёт PostgreSQL deadlock при
одновременном reconciliation разных leaves.

При изменении active device roster backend создаёт следующую generation. Он сохраняет
предыдущие листья без повторного KeyPackage claim и получает новые one-time packages
только для добавленных устройств. Новый device без состояния предыдущей READY
generation не может назначить себя coordinator и claim-ить собственный KeyPackage:
его первый запрос создаёт идемпотентную `blocked/device_roster_changed` generation без
расходования packages и durable `conversation_updated` для всех участников. Первое
доступное прежнее leaf, которое выполняет reconciliation, supersede-ит announcement,
становится фактическим coordinator и claim-ит packages новых leaves от собственного
device identity. Поэтому новый и старый device не обязаны быть online одновременно:
после публикации KeyPackage новый device может забрать сохранённый Welcome позже;
если offline все прежние leaves, ждёт только enrollment нового device.

Pending generation создаёт durable/realtime wake-up для coordinator, а успешный
finalize — для всех active participant users. Delivery остаётся correctness-механизмом
через sync: потерянный WebSocket hint не теряет roster update. Coordination generation
numbers могут содержать blocked announcement между двумя READY состояниями; frontend
применяет следующий Commit по монотонному номеру, но MLS epoch меняется только самим
Commit. Rust/OpenMLS coordinator строит один Commit с remove/add proposals;
существующие листья применяют и проверяют Commit, новые получают Welcome. Removed
leaf не входит в новый required snapshot и реальный WASM тест подтверждает, что он
не расшифровывает future epoch.

Только coordinator текущей pending generation может загрузить bounded opaque
Commit, ratchet tree и точный набор per-device Welcome. Welcome требуется ровно для
строк с claimed KeyPackage; существующие листья не получают фиктивный Welcome.
Ready retry обязан совпасть
побайтно, лишний/пропущенный target отклоняется. `GET .../crypto` возвращает Welcome
только текущему device из required snapshot, а `welcome-ack` идемпотентно отмечает
доставку до expiry. Server не получает signer/init/group/application secrets,
message plaintext или attachment key. Frontend typed gateway и
`ReconcileConversationCrypto` соединяют coordination с Worker. Coordinator перед
finalize шифрованно checkpoint-ит точные Commit/Welcome/tree bytes для crash retry;
target checkpoint-ит join/apply-commit до Welcome ack/ready. Group mutations и
conversation sync invalidates cached reconciliation. Durable `conversation_updated`
запускает reconciliation для изменившегося direct даже когда он не открыт; cold
startup и sync reset bounded последовательно проверяют все direct conversations.
Поэтому любой online previous leaf может автоматически стать coordinator вместо
случайного ожидания, пока peer вручную откроет тот же чат. Stable READY result
кэшируется до такого explicit sync invalidation: protect всегда требует READY,
а unprotect никогда сам не запускает bootstrap/reconciliation. Иначе сама попытка
прочитать retained ciphertext могла бы сначала применить roster Commit и удалить
нужный previous-epoch secret.
Backend exact-current-generation gate остаётся authoritative для stale send.
Outgoing router использует v2, а v1 остаётся только read-only historical adapter.

`coordinator_device_id` — временный author одной membership generation, а не
account-level primary device. Любой сохранившийся active leaf из предыдущей READY
generation может координировать следующий Commit; logout coordinator не передаёт
особый master key и не делает остальные устройства зависимыми от его online status.
После revoke/logout backend публикует roster drift, а следующее подходящее устройство
становится coordinator обычным deterministic election в use case.

Conversation control checkpoint и sealed OpenMLS group хранятся раздельно. Если
control IndexedDB record потерян, но sealed group осталась, runtime v7 read-only
возвращает только её epoch и canonical public device roster. Reconciliation получает
ordered READY generations и восстанавливает `ready` checkpoint исключительно при
единственном exact совпадении conversation + epoch + полного roster, после чего
применяет последующие Commit/Welcome штатно. Inspection не меняет ratchet/revision и
не экспортирует tree/private state. Отсутствующий group, неоднозначное совпадение или
roster mismatch дают typed `local-state-lost`; direct остаётся fail-closed без v1
fallback. Реальная потеря sealed vault требует explicit re-enrollment новой device
identity, а старая история может вернуться только отдельным encrypted device-to-device
transfer flow.

Перед cold-start, sync-reset и durable roster-change reconciliation каждый
direct conversation выполняет retention drain: client читает server envelopes
по возрастанию authoritative sequence, расшифровывает всё, что ещё доступно
его current/past MLS state, и сразу сохраняет content в encrypted device-local vault.
Только после окончания drain разрешён Commit/Welcome advance. Новые OpenMLS
groups и joins дополнительно хранят count-bounded 128 past epochs: это страховка
от delivery/Commit ordering для OpenMLS 0.8, а не unlimited key archive и не замена
30-day server TTL. Legacy groups с нулевым window защищает drain; уже
удалённые в прошлом secrets server восстановить не может.

Каждый v2 message transport содержит `crypto_generation_id` и `crypto_epoch`,
полученные от того же reconciliation/protect operation. Backend под conversation
row lock принимает новый message только для exact current READY generation и если
sender device входит в required roster. Эти поля входят в immutable outbox,
idempotency comparison, HTTP response, domain entity и PostgreSQL row. Поэтому
зашифрованная до membership change очередь не может быть принята после rotation.
Exact retry уже сохранённого envelope возвращает исходный receipt даже после
перехода на следующую generation; новый client message со старой binding получает
conflict. Non-v2 rows обязаны иметь оба поля `NULL`.

`GET .../crypto/updates?after_generation_number=N` авторизует current active device
и возвращает по возрастанию только READY generations, immutable roster которых
содержит этот device. Client применяет каждый Commit последовательно; Welcome после
generation gap означает remove/re-add и вызывает отдельный `rejoin`, а не попытку
перезаписать group неявно. OpenMLS удаляет старую persisted group перед join только
внутри state-changing runtime operation. Invalid Welcome уничтожает mutated runtime,
поэтому durable vault остаётся на последнем подтверждённом snapshot. Welcome ack
resume идемпотентен после crash и выполняется до перехода к следующей generation.

Каждый новый v2 send дополнительно сравнивает current required-device snapshot с
фактическими non-revoked MLS-capable devices всех active conversation members.
Capability означает наличие зарегистрированной immutable crypto identity; legacy
device без identity не является MLS leaf и не блокирует READY roster, если у его
владельца уже есть хотя бы один active capable device. Единая application projection
используется bootstrap и message gate, поэтому после provisioning нового identity
этот device немедленно создаёт roster drift и требует следующую generation. READY
generation со stale capable roster не создаёт окно отправки старому leaf. Explicit
device revoke и logout в одной transaction добавляют durable `conversation_updated`
для каждого active recipient; realtime остаётся только wake-up, cursor stream —
source of truth. Следующий reconciliation создаёт Commit и rotation.

Подготовка history page параллельна, поэтому `DeviceCryptoSession` применяет
single-flight по conversation: concurrent decrypt делят одну reconciliation, а
только результат `ready` кэшируется на срок жизни authenticated runtime. Blocked,
pending и error не кэшируются навсегда. Membership/device sync обязан invalidation-ить
этот cache перед следующим generation check; dispose очищает все entries.

Authenticated app layout автоматически запускает current-device lifecycle:

```text
GET immutable server registration
  ├─ exists → restore exact sealed local identity (никакой regeneration)
  └─ absent → durable local provision → idempotent public registration
                         ↓
exact local/server public comparison
                         ↓
OpenMLS validate initial KeyPackage + server anchors
                         ↓
inventory target 8 → generate/seal unique packages → upload public bytes → ready
```

Если registered server identity существует, но local vault отсутствует/повреждён,
клиент fail closed и показывает unavailable state: password/login не восстанавливает
private signer. Substitution/malformed package/Worker/storage failure не получают
synthetic fallback для secure operations. Private key, wrapping key и sealed state
остаются исключительно client-side. Initial bootstrap/Welcome lifecycle, pool
replenishment, existing-member Commit, ordered catch-up и same-device rejoin
реализованы. Fork/KAT review, browser + PostgreSQL production-like acceptance и
финальный log/security audit остаются release gates.

UI не вызывает concrete crypto adapter: application-facing async operations
`protectText/unprotectText` получают intent DTO с conversation/client-message
binding и возвращают versioned result. Exact-version router fail closed; tombstone
обходит decrypt полностью, а unavailable/corrupt content становится безопасным
per-message placeholder без raw bytes/error. По мере реализации boundary расширяется
на `encryptAttachment/decryptAttachment` и MLS membership operations, сохраняя то же
направление зависимостей.

Для direct plaintext существует в RAM только пока нужен. Group v1 content является
server-readable исключением до `BL-051`. Persistent local archive дополнительно
шифруется device-local storage key. MLS/WebCrypto/IndexedDB находятся за dedicated
adapter/worker boundary; worker и non-extractable wrapping key уменьшают accidental
exposure, но не защищают от arbitrary same-origin XSS. Потеря всех device states не
восстанавливается password reset: это visible identity reset и потеря недоступной
server history.

### 10.1 Current conversation protocol policy

Backend применяет policy после authorization и exact historical idempotency lookup,
но до создания нового message:

```text
new direct message  → protocol_version=2 + current READY generation/epoch/roster
new group message   → protocol_version=1 + no crypto generation/epoch
historical retry    → exact stored envelope may be returned idempotently
history/sync read   → dispatch by protocol_version stored on each row
```

Такой порядок сохраняет безопасный retry старого direct v1 сообщения, но не позволяет
создать новое direct v1. Group v2 отклоняется, а клиент вообще не вызывает для group
bootstrap/Welcome/Commit reconciliation. Уже сохранённые rows никогда не
decrypt/re-encrypt массово: v1 остаётся помеченным non-E2EE, v2 требует локального
MLS state. Потеря локального state не включает fallback.

Direct multi-device topology остаётся MLS group из независимых leaves всех active
devices обоих пользователей. Новое device получает Welcome и читает future epochs;
история до enrollment доступна только через будущий explicit device-to-device
transfer `BL-015`, а не через выдачу keys сервером. Revoked device исключается
следующим Commit и не получает future messages.

## 11. Attachments и media storage

Вложения имеют два разных security flow и не маскируются одним названием.

Текущий group v1 flow:

```text
client validates type/size and computes SHA-256
→ streams original bytes to an authenticated group-only endpoint
→ server verifies membership, limits, digest and quota
→ server stores server-readable bytes under an opaque storage key
→ group v1 message carries up to 10 ordered display metadata/attachment IDs
→ every download rechecks active membership, committed message and expiry
```

Это сознательно **не E2EE**: server видит group message, filename metadata и media
bytes. UI обязан обозначать это, direct MLS v2 endpoint отклоняет такие bytes/IDs,
а server не создаёт plaintext fallback для личного чата.

Будущий direct MLS attachment flow (`BL-017`) имеет другую границу:

```text
client validates type/size
→ creates random file key
→ encrypts locally
→ streams encrypted bytes
→ server stores opaque blob
→ encrypted message carries attachment metadata/key material
```

В обоих flow server-generated `storage_key` — opaque logical key. Client filename
никогда не используется как filesystem path и сейчас хранится только внутри
versioned group message envelope. Application зависит от `MediaStorage`, default
adapter — `LocalMediaStorage(/data/media)`. Upload/download streaming и bounded;
server-side thumbnail/transcoding отсутствуют. Typed `image` и `video` принимаются
только по bounded allowlist browser-safe MIME и могут возвращаться inline с
`nosniff`; generic `file` принимает любое bounded MIME/расширение, но всегда
возвращается как `application/octet-stream` attachment. Это не позволяет HTML, SVG
или другому active content исполняться как документ внутри application origin.
Frontend считает upload SHA-256 инкрементально по `Blob.stream()` через небольшой
audited hash adapter, не материализуя видео целиком вторым `ArrayBuffer` в памяти.

Frontend никогда не навигирует browser/PWA напрямую на protected media URL и не
открывает его через `_blank`: standalone PWA и внешний browser могут иметь разный
cookie context. Download infrastructure gateway выполняет same-origin binary `fetch`
с `credentials: include`. Upload использует same-origin `XMLHttpRequest` только в
этом binary adapter, поскольку стандартный browser `fetch` не предоставляет upload
progress events; `withCredentials`, CSRF header, status/error mapping и strict JSON
receipt остаются теми же. Typed application callback получает только монотонные
bounded `uploadedBytes/totalBytes`, composable агрегирует sequential batch по сумме
байтов, а Vue лишь отображает общий и per-item progress. Application сверяет
conversation/attachment metadata и bounded byte size, а presentation создаёт только
краткоживущий Blob URL. Image/video
URL лениво создаётся около viewport, отзывается при удалении/unmount и открывается во
встроенном fullscreen viewer с keyboard/swipe navigation; видео использует native
browser controls, а unsupported codec получает безопасный download fallback. File
Blob скачивается без выхода из приложения. Composer разделяет media picker с
`accept="image/*,video/*"` и unrestricted file picker: конкретный системный UI
галереи остаётся ответственностью OS/browser.

`WP-073` добавляет `video_note` как presentation metadata поверх того же group v1
`video` attachment, не как новый storage/media kind. Старый клиент игнорирует
необязательные metadata и показывает обычное видео. Browser adapter после user
gesture запрашивает camera/microphone, runtime-negotiates MP4/WebM, записывает
квадратный 480×480 поток с bounded 20 fps / 420 Kbit video / 48 Kbit mono audio и
останавливает все tracks при stop/cancel/error/background/unmount. Client maximum —
60 секунд и 8 MiB; обычный group video сохраняет общий 100 MiB limit. Camera switch
меняет только client capture source; crop/composition выполняется локально там, где
доступен `canvas.captureStream`, с direct MediaRecorder fallback. Server не получает
отдельный camera signal и не делает thumbnail, crop или transcoding. Hold/release,
swipe-left cancel и swipe-up lock являются presentation interaction; authorized
upload, message idempotency, TTL, cleanup и download/cache correctness не меняются.

После `WP-071` group v1 download проходит через отдельный encrypted device cache.
`yv-chat-media-cache-v1` хранит только non-extractable per-user-device AES-256-GCM
key и bounded operational index; bytes пишутся 1 MiB authenticated chunks в opaque
OPFS objects, а browser без OPFS использует отдельный fallback object store той же
media DB. AAD связывает owner user/device, conversation, attachment, kind, MIME,
размер, server expiry и chunk index. Existing message/snapshot/outbox/conversation
crypto/MLS vault databases не мигрируются и вообще не открываются этим adapter.

Persistent LRU ceiling — 2 GiB на user+device; expired entries удаляются независимо
от server cleanup. Это application maximum, а не обещание quota: browser/OS может
дать меньше или evict origin storage. Cache failure является miss и возвращает поток
к authenticated server download. Bounded 128 MiB hot RAM LRU убирает OPFS read при
A → B → A; он очищается при messenger unmount/logout. Local cache не является backup,
не продлевает server TTL и пока обслуживает только явно non-E2EE group v1 media.

`WP-072` добавляет settings operations поверх того же `MediaCache` port: inspect
возвращает только aggregate plaintext byte count, entry count и application ceiling,
а clear принимает exact current `user_id + device_id`. Clear сначала invalidates
decrypted hot LRU generation, затем удаляет только принадлежащие scope media entries,
opaque OPFS/IDB objects и отдельный media key. Message archive, snapshot, outbox,
session/device identity, conversation checkpoints и MLS vault не открываются этой
операцией. In-flight download со старой generation может завершить UI request, но не
имеет права снова положить bytes в persistent/hot cache после clear.

Message text URL presentation выполняется только client-side после decrypt. Typed
segmenter принимает `http://`, `https://` и shorthand `www.`, валидирует URL через
browser `URL`, trim-ит только внешнюю punctuation и выдаёт обычный escaped Vue anchor
с `target="_blank"` и `rel="noopener noreferrer external"`. `javascript:`, `data:`,
`file:` и HTML-looking text остаются inert text. Unfurl/network preview отсутствует:
server и third-party endpoint не узнают ссылку до явного click пользователя.

Authentication может ротировать opaque credential на любом authenticated GET.
Поэтому attachment route обязан перенести каждый `Set-Cookie` из injected auth
response в фактически возвращаемый `StreamingResponse`; иначе database уже примет
новый digest, а browser останется со старым credential и после grace получит replay
revocation.

Committed group media наследует server-side `Message.expires_at` (default 30 days),
uncommitted upload живёт не больше 24 часов. Bounded cleanup блокирует expiry batch
через persistence adapter, терпит already-missing blob и удаляет metadata. Default
limits: 12 MiB image, 100 MiB video, 25 MiB generic file, 5 GiB active media per
uploader и 10 attachment IDs на message; UI отправляет ordered batch до 10 элементов
одним сообщением и повторяет partial failure с теми же client attachment IDs.

Production использует persistent Compose volume, общий для API и cleanup, с
one-shot permission init; он не публикует port и не добавляет container nginx.
Переход на внешний S3 требует реализации `S3MediaStorage`, копирования существующих
opaque keys и проверяемого cutover/rollback. Domain, use cases, HTTP message schema и
таблица metadata при сохранении key-space не меняются; MinIO на том же VPS не нужен.

## 12. Server retention и local-first storage

Server и device выполняют разные роли:

```text
server ciphertext = delivery/sync mailbox within TTL
device encrypted archive = long-term local history after sync
```

Целевая схема IndexedDB хранит conversation index, encrypted local messages, sync
cursor, read state, crypto state, attachment metadata и outbox. Большие encrypted
media blobs предпочтительно хранятся в OPFS/origin-private storage.

Device-local archive не является безусловным backup: site data/PWA может быть удалена. Новый device получает только server retention window; старая история переносится отдельным authenticated encrypted device-to-device flow.

Local text retention может быть longer/forever. Media cache byte-bounded, LRU и имеет explicit pinned policy.

Message retention задаётся typed bootstrap settings. Текущие defaults:

```text
ciphertext TTL        30 days
sync event retention  30 days
tombstone retention   90 days (strictly greater than both values above)
cleanup batch         200 rows
cleanup cadence       5 minutes
```

`expires_at` вычисляется server-side при создании. Отдельный low-memory `cleanup`
process из того же backend image сначала purges bounded expired tombstones, затем
берёт bounded active expiry batch через `FOR UPDATE SKIP LOCKED`, scrubs ciphertext и
атомарно пишет те же recipient-specific `message_deleted` events. Повторный или
concurrent run безопасен; process пишет только structured counts без IDs/content.
Automatic tombstone получает `deleted_at = expires_at`, поэтому retention считается
от server expiry, а не от случайной задержки worker. Cleanup — отдельный process и не
имеет общего in-memory WebSocket hub с API: он не симулирует realtime publish.
Durable sync/reconnect и 30-секундный frontend fallback poll являются correctness
path; WebSocket нужен только для уменьшения latency ручного удаления в API process.

После tombstone retention row удаляется физически, но conversation high-water остаётся.
В течение tombstone window full message resync возвращает deletion marker даже после
истечения ordinary sync events. После этого новый device не получает более старую
server history — она возможна только через будущий secure device-to-device transfer.
Backup retention не должна сохранять TTL-deleted ciphertext бесконечно.

Group attachment cleanup реализован тем же low-memory process: pending blobs имеют
24-hour TTL, committed blobs наследуют message expiry и удаляются bounded/idempotent
через `MediaStorage`. Direct encrypted media и локальный OPFS cache ещё не реализованы.

## 13. PWA, realtime и Web Push

Install surface является частью versioned frontend: HTML явно подключает
`/manifest.webmanifest` (не полагается на implicit module injection), manifest имеет стабильные
`id=/`, `scope=/`, `start_url=/`, отдельные прозрачные `any` и full-bleed opaque
`maskable` PNG 192/512, а Apple получает 152/167/180 touch icons и media-matched
portrait startup images. Канонический знак хранится как SVG без baked platform
shape; deterministic `sharp` script генерирует все raster derivatives. Критическое
содержимое maskable icon находится в центральной W3C safe-zone radius 40%, поэтому
circle/squircle применяет сама ОС. Android-generated splash не использует Apple
startup PNG: Chrome/ОС строят его из manifest `background_color` и install icon.
Поэтому `icon-v3-maskable-*` имеет однотонный full-bleed canvas, пиксельно совпадающий
с `#07111f`, а прозрачный `icon-v3-any-*` остаётся отдельным ресурсом. Install
candidates только 192/512; favicon 32 не участвует в WebAPK. Новое поколение меняет
URL, но Android launcher всё равно может удерживать icon уже установленной PWA до
uninstall/reinstall.
Большие startup PNG не precache-ятся все вместе: браузер выбирает только подходящий
media resource, тогда как app shell, standard icons и crypto WASM остаются в
согласованном Workbox release.

Service Worker использует `autoUpdate`: compatible waiting worker выполняет
`skipWaiting`/`clientsClaim`, после activation controlled page автоматически
перезагружается. Application coordinator проверяет registration при старте, при
возврате visible page в foreground и bounded раз в минуту; concurrent checks
coalesce, transient failure не ломает работающую версию и не создаёт reload loop.
Активация не удаляет IndexedDB, device-local ключ или локальный архив. Миграции
локальной схемы обязаны оставаться совместимыми с установленной версией до
активации нового app shell; очистка site data не является штатным способом
обновления, потому что она уничтожит локальные ключи и архив.

Root `html/body` не является scroll container и использует
`overscroll-behavior: none`: это выключает Chrome pull-to-refresh, но не запрещает
`overflow: auto` у bounded conversation list и timeline. На narrow viewport mobile
tabs используют пару `safe-area-inset-bottom`/`safe-area-max-inset-bottom`: maximum
inset задаёт стабильную высоту и padding, а fixed bottom смещается на разницу dynamic
и maximum inset. Непрозрачный `surface-solid` продолжается под Android gesture pill;
theme-color синхронизируется с выбранной light/dark темой.

Реализованная после `WP-043` PWA startup схема:

```text
encrypted snapshot + cached latest envelopes
              ↓
render local conversation list/timeline
              ↓
sync(persisted cursor) → apply delta → atomically persist a coherent snapshot

no snapshot / corrupt snapshot / reset-required
              ↓
authoritative full bootstrap → persist new snapshot
```

Offline mutation path после `WP-044`:

```text
protect once + allocate client_message_id
              ↓
durable encrypted enqueue (до HTTP)
              ↓
pending → sending → server exact-idempotent POST → sent
              ↓                                      ↓
retryable error + bounded backoff          authoritative local reconcile
              ↓                                      ↓
same immutable envelope                    remove queue entry
```

Permanent 4xx остаётся `failed` до explicit manual retry. Network/408/429/5xx и
malformed acknowledgement считаются retryable; они не создают новый ID/envelope.

Состояние после `WP-042`: backend имеет отдельный authorized latest/exclusive-before
history use case и SQL adapter. Page возвращается ascending, `has_more` вычисляется
bounded чтением `limit + 1`, поэтому TTL gaps не считаются концом истории. Старый
forward `after_sequence` contract сохранён для realtime catch-up.

Browser history orchestration сосредоточена в application service
`ConversationHistory`: он выбирает network/cache fallback, не позволяет stale
локальному cursor перескочить через ещё не загруженную server page и ограничивает
reactive window. Сам archive — отдельный application port; infrastructure разделена
на IndexedDB adapter `yv-chat-messages-v1`, crypto/validation codec и общие typed
transaction primitives. Для каждого account в browser installation создаётся
non-extractable AES-256-GCM key. Каждый transport envelope шифруется с random 96-bit
IV и AAD `schema + owner + conversation + sequence`; scope/sequence mismatch,
изменённый ciphertext и malformed payload fail closed. Adapter сериализует только
явную проекцию `OpaqueMessage`: `TimelineMessage.displayBody` и другой decrypted UI
state не попадают в storage. Archive ограничен 2000 envelopes на conversation.

Клиент сначала пробует encrypted cached latest page, затем reconciles её с server
cursor catch-up. `load older` использует exclusive cursor и сохраняет scroll anchor.
Reactive/DOM window ограничен 300 envelopes; при уходе в более ранний диапазон UI
показывает явный возврат к latest. IndexedDB denial/corruption отключает archive на
текущую сессию и показывает non-blocking warning, не ломая online sync.

Повторное A → B → A внутри живого app instance не перечитывает тот же decrypted
window: messenger держит bounded LRU из 12 последних reactive windows только в RAM и
рисует его до cursor catch-up. Это не persistent plaintext cache и не источник
authoritative ordering. Cold start/saved anchor по-прежнему читается из encrypted
IndexedDB; server reconciliation идёт после local paint, а поздний async result не
может примениться к уже другому active conversation. Viewport anchor захватывается в
момент scroll и flush-ится до смены conversation, поэтому debounce не перепривязывает
позицию к новому chat.

Durable `message_deleted` event не вызывает грубый timeline reset: клиент через
отдельный authorized `GetMessage` use case получает конкретный tombstone, заменяет
loaded item и идемпотентно перезаписывает encrypted archive record, в том числе для
неактивного conversation. Foreign conversation/message binding возвращает 404.

Conversation/directory/read/delivery/sync snapshot находится за отдельным application
port и в отдельной versioned БД `yv-chat-messenger-snapshot-v1`. Запись содержит
только строго валидируемые transport/application DTO, ограничена 1 MiB и шифруется
AES-256-GCM под отдельным per-account non-extractable key с AAD
`schema + owner`. Snapshot не содержит message bodies, session credentials или
private protocol state. Cursor сохраняется только после успешного применения sync
page и только если encrypted message archive доступен: cursor не может обогнать
локально сохранённые envelopes. Повреждение ciphertext/key/schema fail closed и
переводит startup на network bootstrap.

Message outbox находится за отдельным application port в
`yv-chat-message-outbox-v1`. Raw record открывает только owner/sender-device/client
IDs для bounded indexing; immutable envelope и status DTO находятся внутри
AES-256-GCM ciphertext с random 96-bit IV и AAD
`schema + owner + sender_device_id + client_message_id`. Per-account key
non-extractable. Queue ограничена 250 entries на account, codec ограничивает
record/envelope, проверяет scope/state/date/base64 и fail closed при
tamper/schema/key mismatch.
`QueueOutgoingMessage` сначала защищает текст и durable-enqueue-ит exact envelope;
никакого fallback direct POST при storage/quota failure нет, поэтому composer draft
не очищается. `DeliverOutboxMessage` durable-переводит запись в `sending` до HTTP,
проверяет typed receipt на owner/device/conversation/client/protocol binding и только потом
помечает `sent`. Crash до/после server commit оставляет `sending`/`sent`; следующий
startup повторяет тот же request, а backend uniqueness
`(sender_device_id, client_message_id)` возвращает тот же message или 409 при попытке
изменить immutable envelope.

Current `/api/v1/me` возвращает безопасный `device_id` именно authenticated session.
Он нужен только как local storage/idempotency scope, не принимается backend от
клиента при send и не становится authorization factor. Login создаёт новый backend
device, поэтому outbox adapter читает и изменяет только записи текущей пары
`(owner_user_id, sender_device_id)`: stale envelope предыдущего login-device не может
быть повторён под новой uniqueness pair и создать логический duplicate. Старые записи
не удаляются молча; явный lifecycle/cleanup orphaned device queues остаётся hardening
item, а общий account limit не даёт им расти без границ.

Для active conversation receipt преобразуется обратно в authoritative
`OpaqueMessage`, записывается в encrypted history и заменяет optimistic bubble до
удаления outbox entry. Для неактивного conversation server sync event остаётся
correctness path. Startup, успешный WebSocket `onOpen`, durable realtime hints и
30-секундный fallback poll запускают flush. Service Worker Background Sync пока не
включён: он должен появиться только вместе с проверенной cross-release совместимостью
IndexedDB и MLS protocol-state transaction. Параллельные вкладки могут сделать
лишний exact retry, но server duplicate не создаётся; cross-tab lease остаётся
hardening item.

MLS v2 application content имеет отдельный replay-safe local read path. OpenMLS
receive replay protection не ослабляется ради повторного UI render. При первом
protect/unprotect Worker шифрует bounded plaintext тем же non-extractable device
wrapping key и одной IndexedDB transaction записывает одновременно новый sealed
provider revision и keyed `device + conversation + client_message` content record.
Повторный render/reload читает этот encrypted record и не передаёт старый
PrivateMessage в OpenMLS второй раз. Transaction failure откатывает обе записи и
runtime уничтожает потенциально продвинутый in-memory state.

Это ещё не полный local-first: protocol state уже хранится в sealed atomic
IndexedDB crypto vault, но attachment metadata/media/drafts, IndexedDB/OPFS
cross-version upgrade compatibility, Background Sync ownership и secure
device-to-device history transfer остаются в `BL-024`, `BL-025` и `BL-015`.
Workbox по-прежнему кэширует только executable app shell/assets, а user-data БД
принадлежат application adapters и не попадают в Cache Storage Service Worker.

WebSocket обслуживает foreground realtime и передаёт только wake-up hints. Web Push будит background Service Worker. Sync восстанавливает correctness. Current implementation сохраняет редкий HTTP fallback poll, поэтому недоступный WebSocket ухудшает latency, но не correctness.

Push subscription принадлежит device/install, не User целиком. VAPID private key — production secret. Payload содержит только opaque routing hint (`event_id`, `conversation_id`, `message_id`, `sync_required`), никогда plaintext preview. Permanent invalid subscriptions отключаются; push failure не откатывает committed message.

Foreground/background policy и stable event IDs предотвращают двойные notifications/unread increments.

`WP-061` реализует этот boundary через `push_subscriptions`: строка принадлежит exact
`device_id + user_id`, удаляется каскадно при revoke/logout и никогда не возвращает
endpoint или browser keys в status API. Current-device API предоставляет public VAPID
configuration и authenticated `GET/PUT/DELETE /api/v1/push/subscription`; state-changing
operations сохраняют обычные cookie/CSRF проверки. Infrastructure `WebPushNotifier`
получает только typed delivery configuration из composition root, ограничивает четыре
одновременных blocking provider calls через thread adapter и удаляет subscription только
после permanent HTTP `404/410`.

Message use case сначала commit-ит message/sync state, затем best-effort отправляет push
только другим participant users. Service Worker валидирует versioned opaque payload,
подавляет system notification при видимом app window, использует stable event tag для
deduplication и по click фокусирует/открывает exact conversation. Generic title/body не
содержат sender, message или attachment metadata. WebSocket и Push остаются wake-up
каналами; authoritative cursor sync не меняется.

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

Production runtime изолирован explicit Compose project `yv-chat`. Единственный public ingress — уже установленный на VPS системный Nginx: `/api/` и WebSocket он проксирует в loopback-only `127.0.0.1:18081` API, остальные пути — в loopback-only `127.0.0.1:18082` Nuxt. Production Compose не содержит Nginx-контейнера. Контейнерный Nginx остаётся только в локальном integrated `compose.yml`, где нужен разработческий same-origin smoke.

API подключён одновременно к non-internal project-owned ingress network `172.30.243.0/24` (иначе Docker published loopback port не активируется в проверенном runtime) и к internal private network `172.30.242.0/24` с PostgreSQL. Frontend подключён только к ingress network, cleanup и PostgreSQL — только к private. Host proxy приходит в API от фактически проверенного bridge gateway `172.30.243.1`; backend доверяет forwarding chain только от этого exact `/32`, не доверяет произвольному клиентскому `X-Forwarded-For` и выбирает первый справа untrusted address. Оба subnet обязательно проверяются на конфликт при переносе на другой host.

Host Nginx владеет TLS/Certbot, HTTP→HTTPS, security headers и WebSocket upgrade для
двух production origins — `chat.yoowee.ru` и `chat.yoowee.com.de` — в двух exact
HTTPS server blocks с отдельной Certbot lineage на каждый domain; backend strict
Origin allowlist содержит оба имени. Общие security headers, rate limit и
API/WebSocket/frontend proxy rules находятся в одном project-owned Nginx snippet,
поэтому certificate independence не создаёт drift transport policy.
Cookies с `__Host-`, Service Worker, IndexedDB и E2EE device state не разделяются
между origins, поэтому вход через второе имя создаёт отдельную browser session/device,
не копируя local crypto state. Соседние `yoowee.ru`/`s3.yoowee.ru` vhost не
изменяются. Vhost устанавливается из temp file с backup, `nginx -t`, reload и
acceptance обоих upstream; graceful reload проверяется bounded retry, потому что
старые workers короткое время могут обслуживать прежнюю конфигурацию. Workflow
использует immutable `sha-<commit>` GHCR tags, выполняет migration новым backend
image до health-checked rollout и не запускает Docker build на VPS. Runtime `.env`
и одноразовая initial-admin credential существуют только на сервере с mode `0600`;
deploy artifacts не содержат secrets. Полный runbook: [deployment.md](deployment.md).

Rollout пересоздаёт и дожидается healthcheck `postgres/media-init/api/cleanup`, затем
проверяет API через loopback ingress и только после этого обновляет frontend. Это не
позволяет auto-update PWA активировать новый app shell в заранее созданном API `502`
окне. На клиенте transport/408/429/5xx при `/me` являются временной недоступностью;
только `401` доказывает недействительность opaque session и разрешает очистить account.

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
