# Backlog

Полный упорядоченный backlog продукта, восстановленный из исходной большой спецификации `README.md` (`b8350e7`) и уточнённый действующими правилами `AGENTS.md` и [architecture.md](architecture.md).

В работу одновременно берётся одна фича. Для неё создаётся подробный `docs/workplan.md`; после реализации, проверок и отдельного коммита пункт переносится в `Completed`. Архитектурные правила не считаются задачами и не дублируются здесь без конкретного проверяемого результата.

## Frontend application и administration

### BL-038 — Native-feeling PWA shell и frontend Clean Architecture

Статус: **completed** (`WP-020`, commit `c9c7bcf`).

Результат: frontend имеет явные `domain/application/infrastructure/presentation`
boundaries, Nuxt pages/layouts вместо монолитного `app.vue` и responsive shell,
который ощущается как цельное desktop/mobile приложение.

- routes `/login`, `/activate`, `/chat`, `/settings`, `/admin/users` и guards;
- desktop navigation rail + mobile bottom navigation с safe-area/touch targets;
- light/dark/system design tokens, persisted non-secret preference;
- restrained motion и обязательный `prefers-reduced-motion` fallback;
- semantic haptics port с Vibration capability/no-op adapter;
- автоматический bounded device label вместо login input;
- URL-fragment invite consumption без попадания secret в HTTP/referrer;
- app-scoped auth/application state без SSR cross-request singleton;
- runtime DTO parsers и отсутствие raw HTTP/browser APIs в components;
- mobile/desktop visual QA, Vitest, lint/typecheck/build.

Implementation и desktop browser smoke завершены; physical 390px screenshot не
был сфальсифицирован при заблокированном test Mac и остаётся acceptance-пунктом
`BL-041`/`BL-033`, не блокирующим независимые backend vertical slices.

### BL-039 — Admin account lifecycle и password recovery

Статус: **completed** (`WP-021`).

Результат: администратор управляет пользователями через отдельную страницу, но
не получает и не задаёт чужой постоянный пароль.

- bounded paginated user list/search с role/state/session summary;
- deactivate/block и explicit reactivate с self/admin safety invariants;
- admin-triggered password reset: все target sessions/devices revoked atomically;
- отдельный purpose-bound one-time reset token хранится только hashed, имеет TTL,
  single-use/revocation/concurrency constraints и не смешивается с activation;
- reset URL использует fragment/transient client memory; пользователь сам задаёт
  новый Argon2id password, admin его не видит;
- one-time invitation URL вместо неудобного raw code, explicit copy/hide/expiry;
- audit events без token/password и negative authorization/CSRF/guessing tests;
- Alembic migration, repository/use cases, split Dishka providers и pytest.

### BL-040 — User settings, devices и security center

Статус: **completed** (`WP-022`).

Результат: settings page управляет профилем, темой, haptics и безопасностью
текущего аккаунта через существующие и новые typed use cases.

- profile/display name и user-editable device display name;
- current/other active devices с browser/OS/device class/IP/approximate metadata;
- revoke one, revoke all others, change password и security reset;
- theme/haptics/motion/notification/privacy preferences;
- session/token hashes и raw subscription/crypto material никогда не выводятся;
- best-effort device metadata не используется как authorization factor.

### BL-041 — Visual system, accessibility и PWA polish

Статус: **in progress; `WP-059` production-verified** (`WP-041` завершил core messenger viewport/interaction и
первую install surface; `WP-043` добавил Pixel edge-to-edge/pull-to-refresh contract
и maskable v2 assets; `WP-053` добавил branded shell, connection status и automatic
update lifecycle; `WP-055` убирает stable connection bar из viewport и оставляет
только transient/offline overlay; `WP-059` исправляет Pixel adaptive icon/generated
splash и invalidates install-time v2 cache; полный accessibility/visual-regression
gate остаётся).

`WP-059` (`59495f0`, deploy `31577182322`) восстановил explicit manifest discovery,
выпустил versioned `v3` transparent `any`/opaque solid `maskable` assets, зафиксировал
Android safe-zone/background pixel regressions и убрал причину белого fallback-круга,
вложенного квадрата и серого Pixel generated splash.

Результат: приложение имеет единый визуальный язык, install/update UX и
доступность, а messenger shell по плотности и поведению привычен пользователю
Telegram/WhatsApp без копирования их бренда.

- [x] semantic color/spacing/typography/elevation/motion tokens;
- [x] stable `100dvh`/visual-viewport shell без page-level скачков при длинном content,
  mobile browser chrome, safe areas и открытии software keyboard;
- [x] desktop split view: фиксированная conversation list/sidebar и отдельный timeline;
- [x] mobile master/detail navigation с естественным back flow и без горизонтального overflow;
- [x] закреплённые conversation header и composer; скроллится только timeline, новые
  сообщения не выдёргивают пользователя с прочитанной позиции;
- [x] компактные chat rows, avatars, timestamps, unread/presence indicators и
  touch-friendly contextual actions;
- [x] readable grouped bubbles, day separators, delivery state, typing и
  scroll-to-latest control;
- [x] composer с multiline auto-grow в заданных пределах,
  Enter/Shift+Enter policy и mobile keyboard-safe positioning;
- [ ] attachment/emoji-ready composer slots после encrypted attachments boundary;
- [ ] полный focus-visible, keyboard navigation, ARIA/live regions и contrast audit;
- [ ] skeleton/empty/error/offline states без layout shift;
- [x] PWA standard/maskable/touch icons, portrait Apple splash, theme colors и
  standalone safe areas;
- [x] Android gesture-area surface и запрет root pull-to-refresh при сохранении
  независимого scrolling timeline/list;
- [x] отдельная прозрачная `any` icon и full-bleed opaque `maskable` icon без baked
  square/squircle, с versioned manifest URLs и воспроизводимым SVG→PNG pipeline;
- [x] automatic foreground/periodic update detection, activation и reload;
- [ ] migration-compatible service worker lifecycle и user-facing install education;
- [ ] repository-owned visual regression screenshots для short/long timeline, empty/loading/error,
  mobile keyboard-sized viewport и основных desktop/mobile состояний.

## Messaging foundation

### BL-042 — Управление группой и составом участников

Статус: **completed** (`WP-046`, commit `8fb3720`).

Результат: owner/admin управляет названием и активным составом группы через
responsive group-info UI, а backend остаётся единственной границей авторизации.

- rename title отдельным use case и versioned endpoint;
- add/remove/re-add участника с single-membership lifecycle;
- максимум 50 активных участников вместе с owner;
- role-aware UI без обещания передачи ownership;
- atomic `conversation_updated` для старых и новых recipients;
- immediate local encrypted snapshot update и multi-device catch-up;
- negative authorization, concurrency, persistence и frontend interaction tests;
- явная интеграционная граница для MLS Commit/Welcome без фиктивной key rotation.

### BL-009 — Receipts, unread state, typing и presence

Статус: **implementation complete; verification pending** (`WP-024` завершил shared read cursor/unread slice;
`WP-025` завершил ephemeral typing; `WP-026` завершил best-effort presence;
`WP-027` завершил delivered-per-device).

Результат: read state согласуется между устройствами, а ephemeral indicators не становятся durable truth.

- [x] shared per-user/per-conversation read cursor и durable `read_receipt`;
- [x] server-derived unread counters, согласованные на нескольких devices;
- [x] foreground-only mark-read до реально загруженной server sequence;
- [x] delivered cursor/receipt на уровне device (`WP-027`);
- [x] typing events с server expiry без долговременной истории (`WP-025`);
- [x] best-effort multi-device online presence из active WebSockets (`WP-026`);
- [x] deduplication и tests после reconnect.

### BL-011 — Authenticated WebSocket notifications

Статус: **in progress** (`WP-023` foundation + `WP-024` durable read receipt;
`WP-025` завершил typing; `WP-026` завершил presence; device-revoked hints остаются).

Результат: WebSocket ускоряет доставку, но не заменяет sync.

- same-origin cookie handshake, active-session и exact Origin validation;
- explicit `hello`, `new_message`, `message_deleted`, `typing`, `presence`, `read_receipt`, `conversation_updated`, `device_revoked` events;
- small routing hints вместо дублирования state/ciphertext;
- heartbeat не продлевает auth session бесконечно;
- single-process in-memory connection registry без преждевременного Redis;
- reconnect всегда запускает cursor catch-up.

## E2EE и multi-device history

### BL-054 — Self-healing local MLS checkpoint и явный device recovery

Статус: **completed** (`WP-054`, commit `01ef0ac`, production run `31549397629`).

Результат: существующая device identity не требует logout/login после deploy/reload,
если sealed OpenMLS group сохранилась, но отдельный conversation checkpoint потерян.

- read-only public inspection локального epoch/device roster через Rust/Worker port;
- точное восстановление server-generation checkpoint только при epoch+roster match;
- ordered catch-up последующих Commit/Welcome после восстановления;
- отдельная fail-closed диагностика полной потери device-local MLS state;
- permanent primary device не вводится: coordinator выбирается на generation;
- последующий explicit re-enrollment и encrypted history transfer остаются отдельными
  security slices для случая реального удаления crypto vault.

### BL-050 — Conversation-scoped direct/group protocol policy

Статус: **completed** (`WP-050`, commit `45709c3`, production run `31541538389`).

Результат: direct conversations остаются fail-closed OpenMLS v2 E2EE, а group
conversations временно используют synthetic v1 без E2EE с постоянной честной
маркировкой. Выбор протокола является server-enforced policy по conversation type,
а не client fallback. История остаётся immutable и читается по версии каждой записи.

- direct: только v2 + exact generation/epoch/roster binding;
- group: только v1, без MLS bootstrap/Commit/Welcome;
- historical v1/v2 rows не переписываются и не меняют security label;
- exact historical retry идемпотентен, но не открывает создание нового direct v1;
- реальные multi-account/device/reload/revoke browser scenarios;
- отдельный backlog item возвращает group MLS после стабилизации multi-device flow.

### BL-013 — Frontend crypto adapter и device identity

Статус: **in progress** (`WP-030` завершил async fail-closed boundary; `WP-031`
завершил pinned OpenMLS provider/device-bootstrap proof; `WP-032` — private
snapshot/restore, `WP-033` — WebCrypto sealing и atomic IndexedDB vault, `WP-034` —
versioned package и isolated Worker runtime; `WP-040` — server one-time delivery;
`WP-045` — consumer validation и authenticated identity lifecycle).

Результат: UI работает с intent-level crypto API, private material не выходит из изолированного слоя.

- [x] async `protectText/unprotectText` exact-version boundary без downgrade;
- [ ] `encryptAttachment/decryptAttachment` и MLS membership boundary;
- [x] pinned OpenMLS native/WASM provider и canonical memory-only device identity/
  KeyPackage proof (`WP-031`);
- [x] deterministic versioned/bounded private provider snapshot+restore core без JS
  export (`WP-032`);
- [x] AES-256-GCM sealed persistent state с non-extractable WebCrypto key,
  device/revision-bound AAD и без JS export private snapshot (`WP-033`);
- [x] versioned IndexedDB vault с atomic key+state bootstrap, monotonic optimistic
  update и fail-closed partial/corrupt state (`WP-033`);
- [x] подключить vault к repository-owned versioned WASM Worker runtime без передачи
  `CryptoKey`/sealed internals в application/UI (`WP-034`);
- [x] Chromium physical Worker/WASM/WebCrypto/IndexedDB provision → reload restore →
  checkpoint smoke (`WP-034`);
- [x] immutable current-device public identity registry, server-derived fingerprint и
  отдельно сохранённый initial KeyPackage без выдачи bytes (`WP-035`);
- [ ] проверить seal/restore/tamper в Firefox и Safari, а также storage denial и
  migration/update lifecycle;
- [x] atomic one-time KeyPackage inventory/replenishment/authorized claim с exact
  retry и PostgreSQL concurrency constraints (`WP-040`);
- [x] consumer-side OpenMLS KeyPackage validation связывает canonical user/device,
  credential, signature key, fingerprint, package ref и exact bytes;
- [x] restore/provision/register подключены к authenticated lifecycle только после
  exact local/server comparison; registered identity никогда тихо не заменяется;
- [x] bounded KeyPackage pool generation/replenishment из того же sealed provider
  state и automatic foreground inventory policy (`WP-047`, target 8);
- [ ] memory/plaintext lifecycle audit и log-redaction gate для полного Worker flow;
- [ ] known-answer/interop test vectors реального MLS provider;
- [x] corruption/version-mismatch/no-fallback tests для protocol dispatch;
- [x] отсутствие crypto primitives и ciphertext decoding в Vue components.

### BL-014 — E2EE conversations, membership changes и rotation

Статус: **completed crypto foundation** (`WP-047`, commits `91a6765`–`881f648`);
group outgoing MLS временно отключается type-level policy `WP-050`.

Результат: OpenMLS lifecycle реализован для direct/group и остаётся production
foundation; текущая product policy использует его только для direct conversations.

- [x] create/join group crypto state и sealed crash-safe checkpoint;
- [x] initial multi-device fan-out и add/remove membership Commit в native/WASM;
- [x] exact message binding к current READY generation/epoch и sender leaf;
- [x] ordered catch-up нескольких пропущенных Commit/Welcome generations;
- [x] same-device remove/re-add rejoin без epoch rollback;
- [x] durable explicit device revoke/logout routing, exact active roster send gate
  и последующий key rotation; admin-wide reset/deactivation использует тот же send
  gate, а унификация proactive notification остаётся hardening;
- [x] protocol-version compatibility/error UX с per-conversation
  checking/pending/blocked/ready состояниями;
- [x] synthetic v1 удалён из новых sends и оставлен только read-only для явно
  помеченной исторической записи; downgrade v2→v1 отсутствует;
- [x] production-like two-origin/device exchange + reload decrypt, PostgreSQL
  migrations/integration suite, полный CI и immutable production rollout.

### BL-051 — Возврат group MLS после multi-device stabilization

Статус: **planned after protocol/media stabilization**.

Результат: groups снова переходят с явно non-E2EE v1 на OpenMLS v2 только после
устранения generation divergence и прохождения реальной browser/device matrix.

- новая cutover sequence без переписывания historical v1 rows;
- add/remove/re-add, revoke/relogin и несколько devices на каждого участника;
- offline generation catch-up и exhausted KeyPackage recovery;
- Chrome/Firefox/Safari + Android installed-PWA acceptance;
- отсутствие silent fallback: blocked MLS означает blocked send;
- отдельный security review и production rollout gate.

### BL-015 — Secure device-to-device history transfer

Результат: новый device получает историю старше server retention только от уже авторизованного устройства.

- pairing QR/transfer request и explicit confirmation;
- authenticated encrypted transfer session;
- bounded/resumable archive transfer без загрузки бессрочной истории на VPS;
- re-encryption под device-local storage key нового устройства;
- cancellation/replay/wrong-device/partial-transfer tests.

## Attachments, retention и storage

### BL-016 — MediaStorage port и LocalMediaStorage

Статус: **completed** (`WP-056`, `5135a50`, production run `31551963185`).

Результат: backend потоково хранит bytes под opaque key в `/data/media` за application
port. В текущем group v1 slice bytes server-readable; будущий direct flow передаст в
тот же port уже client-encrypted ciphertext.

- generated opaque storage keys и prefix layout;
- в БД только logical key, никогда absolute path/client filename;
- streaming save/open/delete/exists без unbounded RAM;
- traversal, missing-file, partial-write и ownership tests;
- S3 adapter не добавляется до реальной внешней storage requirement.

### BL-017 — Encrypted attachment upload/download

Статус: **queued** (`WP-051` WIP сохранён и продолжится после срочных `WP-052`/`WP-053`).

Результат: клиент шифрует file до upload и расшифровывает только локально.

- client type/size validation, random file key и encrypted metadata в message payload;
- versioned `/api/v1/attachments` upload/download;
- authorization через conversation membership;
- configurable limits для image/file/video/voice;
- server не делает preview/transcoding и не получает keys/plaintext.

### BL-043 — Telegram-like photo/file experience поверх encrypted attachments

Статус: **частично выполнено; следующий slice queued** (`WP-056` развернул group-first
single-file flow; `WP-057`, `09177e7`, production run `31556674459` добавил
session-safe download и ordered batch до 10 файлов с in-app gallery; `WP-058`,
`0bc2424`, production run `31575085192` добавил intentional media/file picker,
произвольные типы файлов и inline/fullscreen video; direct E2EE media, offline draft,
drag/drop и расширенный cache остаются queued).

Результат: пользователь удобно отправляет изображения и произвольные файлы. В
текущем group v1 slice backend видит исходные bytes и bounded metadata; direct MLS
slice позже передаст только encrypted bytes.

File key и encrypted metadata direct conversation будут доставляться только внутри
MLS v2 application message. Group v1 сейчас загружает исходные bytes без file key:
такой flow явно не является E2EE и не получает secure badge до отдельной crypto-фичи.

- attachment button, picker и drag/drop/paste там, где это поддерживает platform;
- одно сообщение содержит caption и bounded ordered набор файлов; несколько фото
  отображаются адаптивной gallery, открываются в полноэкранном viewer и листаются
  swipe/keyboard без отдельных искусственных сообщений;
- image preview/thumbnail генерируется локально до encryption, файл показывает
  локально расшифрованные имя/type/size и отдельное понятное действие download;
- upload progress, cancel/retry и offline-safe draft/outbox lifecycle;
- bubble/gallery UX с tap-to-view/download и понятным unavailable/expired state;
- client-side authenticated encryption metadata интегрирована с выбранным MLS
  message protection, без server-side plaintext thumbnail/transcoding;
- streaming/chunked upload/download, quotas, opaque storage keys и membership auth;
- encrypted bounded OPFS/IndexedDB cache и explicit eviction policy;
- mobile camera/photo-library/file chooser, desktop keyboard/accessibility tests.

### BL-018 — Server TTL cleanup и tombstone retention

Статус: **частично выполнено** (`WP-028` завершил message ciphertext TTL,
tombstones, bounded PostgreSQL cleanup и monotonic sequence; `WP-056` добавил
24-hour pending и 30-day committed group media cleanup; per-type/forever policy
остаётся).

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
- admin-only storage dashboard: media/DB usage, filesystem capacity/free/reserved,
  configured quotas и low-disk admission state без раскрытия чужих filename/content;
- запрет новых больших uploads при low disk вместо удаления unexpired data;
- bounded cleanup batches и resource-budget tests;
- документированный ориентир диска/резерва.

## Local-first PWA

### BL-022 — IndexedDB encrypted local archive

Статус: **частично выполнено** (`WP-042` завершил bounded latest/before history и
encrypted message archive; `WP-043` добавил encrypted conversation/directory/
receipt/sync snapshot и cache-first startup. Protocol state, attachment metadata,
upgrade migration gate и offline outbox остаются).

Результат: startup сначала показывает локальную историю, затем применяет sync delta.

- [x] отдельный versioned encrypted snapshot store для conversation index,
  directory, sync cursor и read/delivery receipts;
- [ ] versioned stores для protocol state и attachment metadata;
- [x] отдельный versioned encrypted-message store с bounded per-conversation retention;
- [x] bounded latest/before pagination и load-older без пропусков для conversation с
  более чем 100 уже существующими сообщениями;
- [x] bounded timeline window, чтобы DOM и reactive RAM не росли без лимита;
- [x] device-local non-extractable AES-256-GCM storage key;
- [x] plaintext только в RAM на время rendering/processing; archive adapter явно
  проецирует `TimelineMessage` обратно в transport DTO до encryption;
- [ ] IndexedDB upgrade migrations и cross-release service-worker compatibility tests;
- [x] понятный non-blocking UX при недоступном browser storage;
- [x] encrypted conversation snapshot рендерится до сети и затем выполняет catch-up
  с persisted cursor без повторного full list bootstrap;
- [ ] полноценная offline работа без API остаётся зависимой от `BL-023` outbox и
  будущих локальных mutation/reconciliation правил.

### BL-023 — Offline outbox и conflict recovery

Статус: **completed** (`WP-044`).

Результат: offline send проходит состояния `pending/sending/sent/failed` и безопасно повторяется.

- [x] bounded per-account persistent queue с immutable client idempotency key и
  active-device scope, совпадающим с backend uniqueness;
- [x] AES-256-GCM encrypted records и non-extractable device-local key без raw
  plaintext/session/private protocol state;
- [x] explicit `pending/sending/sent/failed`, bounded backoff и manual retry;
- [x] flush на foreground startup, WebSocket reconnect и fallback catch-up;
- [x] reconcile typed authoritative send receipt с active timeline/archive, а
  durable sync остаётся correctness path для неактивных conversations;
- [x] crash-between-send-and-ack и duplicate exact-envelope retry tests;
- [x] 250-entry account limit, storage/quota fail-closed UX и сохранение composer
  draft, если durable enqueue не состоялся;
- [x] stale entry предыдущего login-device не переотправляется под новым
  `sender_device_id`; current device приходит только из authenticated `/me`;
- [ ] Service Worker Background Sync не включён: браузерные ограничения и update/
  protocol-state compatibility должны быть решены вместе с `BL-025`/MLS state;
- [ ] cross-tab lease является дальнейшим hardening: параллельные вкладки уже не
  создают server duplicates благодаря exact backend idempotency, но могут выполнять
  лишний одинаковый request.

### BL-024 — OPFS media cache и local retention controls

Результат: большие encrypted blobs хранятся отдельно, ограниченно и очищаемо.

- OPFS/origin-private adapter с fallback;
- byte-bounded LRU cache, pinned-media policy;
- local text retention: forever/1 year/90 days;
- missing-original UX после server/local eviction;
- запрос persistent storage и отображение quota pressure без обещания backup.
- user-facing device storage screen через `navigator.storage.estimate()`: usage/quota,
  разбиение app cache/archive/media где adapter может посчитать его безопасно,
  clear-evictable-cache без удаления identity/protocol keys по умолчанию.

### BL-044 — Per-conversation viewport restoration

Результат: каждый чат открывается на последней осмысленной позиции этого device,
а не всегда внизу и не на случайном DOM offset.

- encrypted local anchor хранит conversation ID, nearest server sequence/message ID
  и относительное смещение, а не хрупкий абсолютный `scrollTop`;
- anchor обновляется throttled, восстанавливается после cache/network pagination и
  корректно переживает prepend старой истории, font/image layout и viewport resize;
- unread/new-message policy не перетирает сохранённую позицию; явная кнопка «вниз»
  возвращает к latest и обновляет anchor;
- bounded cleanup для удалённых/покинутых conversations и mobile/desktop tests.

### BL-025 — PWA lifecycle и update safety

Результат: приложение устанавливается, работает с offline shell и безопасно обновляется.

- [x] manifest, versioned transparent `any`/opaque `maskable` icons и Apple touch assets;
- [x] Android edge-to-edge gesture surface и root pull-to-refresh suppression;
- service-worker offline shell и background-safe reconnect;
- [x] automatic foreground/periodic update check и auto-activation/reload (`WP-053`);
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
- настройки являются per-device и включают system notification permission/status,
  звук/vibration где platform это реально поддерживает, mute до времени и app badge;
- stable event/message ID dedup WebSocket + Push + sync;
- multi-device read state, app badge и invalid-subscription tests.

## Production и operations

### BL-029 — Production Nginx, TLS и security headers

Статус: **completed** (`WP-019`, production workflow `31452613018`).

Результат: наружу опубликованы только HTTPS/WSS через проверенный ingress.

- HTTP→HTTPS, certificate automation и HSTS только после проверки TLS;
- WebSocket upgrade/timeouts и trusted proxy chain;
- upload limits согласованы с application limits;
- CSP, `X-Content-Type-Options`, `Referrer-Policy` и минимальное раскрытие backend;
- PostgreSQL не опубликован наружу.

Production `chat.yoowee.ru` работает через отдельный vhost единственного системного
Nginx: `/api/`/WebSocket направляются в loopback-only API `127.0.0.1:18081`, `/` —
в loopback-only Nuxt `127.0.0.1:18082`. Let’s Encrypt certificate, HTTP→HTTPS,
HSTS/CSP, exact trusted proxy boundary, migration-before-rollout и immutable GHCR
images проверены; production Nginx container удалён, все соседние `infra-*`
containers сохранили состояние (`WP-038`).

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

### BL-FIX-054 — Branded shell, safe logout и automatic PWA lifecycle

Канонический фирменный знак заменил текстовую `Y`; desktop shell оставляет один
logo в navigation rail и не дублирует account footer. Current-device logout перенесён
в Settings, требует blocking confirm и не маскирует network failure под успешный
выход. Typed connection monitor показывает checking/connected/reconnecting/offline,
а PWA проверяет и применяет Service Worker update при старте, foreground и bounded
периодически. Full CI, desktop/mobile browser acceptance и production rollout
`12dac1a` подтверждены.

### BL-FIX-053 — Existing-account second-device MLS enrollment

Новый device без previous READY state создаёт idempotent roster-change announcement
без self-claim KeyPackage; первое доступное прежнее leaf становится фактическим
coordinator, durable/realtime events будят участников, а READY finalize доставляет
Welcome новому device без требования одновременного online. Единый lock order
`conversation → device → generation/packages/required` устраняет воспроизведённый
PostgreSQL deadlock. Full CI и production rollout `f69a191` подтверждены; API/frontend
healthy, свежие production-логи без `422/500`.

### BL-FIX-039 — Mobile shell and multi-client realtime correctness

Fixed bottom navigation reserves a safe-area-aware viewport slot, realtime indicator
reflects actual WebSocket lifecycle, conversation updates refresh authorized presence,
and multi-device disconnect preserves online state while another subscription exists.
TLS runbook also distinguishes origin health from client VPN fake-IP failures.

### BL-012 — E2EE protocol ADR и security review

[ADR-0001](adr/0001-e2ee-mls.md) принимает MLS 1.0/RFC 9420 для direct и group,
отдельный MLS client на каждый device и MTI X25519/AES-128-GCM/SHA-256/Ed25519
ciphersuite. Threat model разделяет client, recipient, Authentication Service,
Delivery Service, storage, XSS и supply-chain adversaries; честно фиксирует metadata
leakage и malicious-AS limitation. Описаны KeyPackage/Welcome, v1→v2 cutover/AAD,
multi-device enrollment, membership/epoch reconciliation, recovery/persistence и
fail-closed UX. OpenMLS core выбран только как gated Rust/WASM implementation path:
его experimental bindings не считаются production-ready без pinned build,
KAT/interop, browser/corruption, license/dependency и independent binding review.

### BL-010 — Delete-for-everyone и message tombstones

Sender и group owner/admin могут авторизованно удалить opaque message; direct peer,
ordinary group member, outsider и foreign conversation/message binding закрыты
negative tests. Первая операция scrubs ciphertext и атомарно создаёт durable
recipient-specific `message_deleted`, duplicate retry — no-op. Automatic 30-day TTL
использует тот же tombstone contract, 90-day tombstone window переживает ordinary
sync retention, а отдельный conversation high-water не переиспользует sequence после
physical purge. Frontend strict parser, use case/composable и confirm UI применяют
manual/expired tombstones без decode `null` и без обещания remote erasure уже
просмотренных копий. Production Compose/deploy включает изолированный low-memory
cleanup process.

### BL-030 — Production images, GHCR и deployment workflow

Immutable `sha-<commit>` backend/frontend images строятся и публикуются в GHCR только GitHub Actions; VPS выполняет scoped pull, PostgreSQL wait, intentional Alembic migration и health-checked rollout. Production Compose имеет project-owned ingress/internal networks, отдельные loopback binds `127.0.0.1:18081`/`:18082`, не содержит Nginx service, использует pinned PostgreSQL image, non-root app images, resource limits и project-scoped volumes. Remote script требует server-only `.env` mode `0600`, использует temporary Docker auth, проверяет оба direct upstream и пытается вернуть previous image tag при failed healthcheck. Runbook фиксирует GitHub environment, secrets, first-run и rollback.

### BL-037 — Admin invitations и activation UI

Logged-out PWA имеет отдельную activation форму для one-time secret и нового password; credentials очищаются до/после network operation и не сохраняются. Admin-only transient panel runtime-validates bounded account list, создаёт invitation и показывает plaintext secret только до явного скрытия/закрытия/reload. Публичная регистрация не появилась, backend role/Origin/CSRF остаются authoritative.

### BL-021 — Conversations и messaging UI

Authenticated PWA показывает active-user directory, direct/group conversation list, server-sequence timeline и idempotent composer. Runtime parsers отделяют untrusted transport DTO, services инкапсулируют API, `useMessenger` координирует snapshot/cursor polling/reset, а небольшие Vue-компоненты отвечают только за interaction/rendering. Initial sync фиксирует baseline cursor до resource snapshot, исключая lost-event race. Temporary protocol v1 codec изолирован, явно помечен non-E2EE и не сохраняет локальный plaintext; secure milestone остаётся `BL-012`–`BL-014`.

### BL-020 — Frontend API/service foundation и auth UI

Typed same-origin API adapter централизует `credentials: include`, CSRF для state-changing requests, HTTP/network/invalid-response errors и runtime parsing untrusted JSON. Auth service и `useAuth` state machine реализуют session bootstrap, login/logout, revoked/offline/retry states; Vue shell не видит session credential, очищает password сразу после submit и разделяет transport/application/UI concerns. Critical-path Vitest, lint, typecheck, production build и clean Docker/HTTP smoke проходят.

### BL-008 — Cursor sync и offline catch-up

Per-user cursor streams и recipient event rows, atomic message+events, conversation/membership emission включая removed member, bounded `/api/v1/sync`, high-water/oldest-retained gap detection и idempotent retention cleanup. HTTP test восстанавливает conversation/message routing без WebSocket; PostgreSQL concurrency подтверждает cursor/event uniqueness.

### BL-007 — Idempotent message creation и ordering

Device-scoped client UUID, exact retry reuse, conflicting retry 409, conversation row-lock sequence allocation, database unique constraints и bounded ascending list-after API. PostgreSQL concurrency test подтверждает разные последовательные значения для одновременных sends; Alembic `0009` backfill сохраняет upgrade существующих rows.

### BL-006 — Versioned opaque message envelope

Отдельный Message domain/application/persistence vertical slice хранит только bounded opaque bytes, version и server/sender metadata. Messaging UoW проверяет active membership и owned active device; strict base64 HTTP не принимает sender claims и не эхоит content. Alembic `0008`, metadata/OpenAPI forbidden-field, HTTP и PostgreSQL tests фиксируют отсутствие plaintext/key contract. Это явно non-E2EE foundation.

### BL-005 — Conversation API и authorization

Отдельные create/list/get/add/remove/leave/change-role use cases, safe member DTO с bulk user lookup, отдельный Dishka provider и versioned FastAPI router. Active membership скрывает guessed/removed conversations одинаковым 404; owner/admin hierarchy, direct immutability, CSRF и PostgreSQL persistence покрыты pytest.

### BL-003E — Current account API и security reset

Safe current-account DTO/profile update, step-up password change с Argon2id update и revoke-others, explicit revoke-all security reset, CSRF/Origin/cookie cleanup, typed bounded audit events, Dishka wiring и unit/HTTP/PostgreSQL tests.

### BL-004 — Conversation domain и persistence

Direct/group aggregate и membership lifecycle реализованы отдельно от transport: domain invariants, узкие repository/UoW ports, SQLAlchemy adapters, Dishka binding и Alembic `0006`. Unordered direct pair защищена unique index под реальной PostgreSQL concurrency; schema не содержит message plaintext/key columns.

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
