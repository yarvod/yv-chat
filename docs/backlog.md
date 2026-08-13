# Backlog

Полный упорядоченный backlog продукта, восстановленный из исходной большой спецификации `README.md` (`b8350e7`) и уточнённый действующими правилами `AGENTS.md` и [architecture.md](architecture.md).

В работу одновременно берётся одна фича. Для неё создаётся подробный `docs/workplan.md`; после реализации, проверок и отдельного коммита пункт переносится в `Completed`. Архитектурные правила не считаются задачами и не дублируются здесь без конкретного проверяемого результата.

## Приоритет исполнения после ревизии 2026-08-12

Порядок ниже является единственной активной очередью. Категории дальше по документу
сохраняют полные требования, но не задают порядок реализации.

### Release gate — сначала закрыть уже реализованное

1. Завершить и развернуть текущий `WP-069`: existing MLS leaves должны автоматически
   reconciled-ить inactive direct roster; rollout также включает готовые `WP-067/068`.
2. Production-проверить `BUG-063`: serial history decrypt должен сохранить MLS
   ratchet и позволить reply после reload.
3. Исправить `BUG-059`: cache-first startup обязан reconciled-ить directory после
   активации нового пользователя. Это bounded correctness fix, а не новая platform-фича.

### P0 — безопасность истории и сохранность production-данных

1. `BL-064` — retention-aligned multi-epoch offline recovery. Без него корректный
   ciphertext в пределах server TTL может стать нечитаемым после нескольких MLS
   rotations, поэтому это следующий большой security/correctness slice.
2. `BL-031` — encrypted offsite backup + проверяемый restore. Local browser archive
   не заменяет backup account, membership и server sync state.
3. `BL-019` — global quota, low-disk admission и storage visibility. Group media уже
   доступно production, поэтому disk-full защита нужна до дальнейшего роста media UX.

### P1 — настоящее local-first приложение и безопасные вложения

1. `BL-025` — IndexedDB/Service Worker compatibility gate и cross-release tests;
   schema/update safety должна появиться до новых persistent stores.
2. `BL-024` — remaining persisted drafts/attachment metadata, pinning и retention
controls. Encrypted OPFS cache, byte-bounded eviction и safe device clear уже готовы.
3. `BL-017` вместе с оставшейся attachment-частью `BL-013` — direct MLS attachment
   encryption/upload/download без server plaintext или file keys.
4. `BL-043` — оставшийся offline draft, cancel/retry и polished
   attachment UX поверх уже готовых secure storage boundaries.
5. `BL-015` — QR linking, trusted-device MLS enrollment и двусторонний
   device-to-device history transfer после `BL-064`/`BL-025`.
6. `BL-051` — возврат group MLS только после multi-epoch и multi-device acceptance.

### P2 — assurance, product controls и эксплуатация

1. Оставшийся cross-browser/tamper/interop audit `BL-013` и configurable retention
   policy `BL-018`.
2. `BL-032` observability/runbooks, затем `BL-033` release E2E/security checklist.
3. Остатки `BL-028` notification controls и `BL-041` accessibility/visual gate.

### P3 — после стабильного messaging/E2EE

`BL-034` → `BL-035` → `BL-036`: signaling, audio, затем video calls. Эти задачи не
должны вытеснять recovery, backup, local storage или attachment security.

## Frontend application и administration

### BL-041 — Visual system, accessibility и PWA polish

Статус: **remaining accessibility/visual gate**. Реализованные shell, responsive
timeline, mobile viewport, install assets и update UX перенесены в `Completed` как
`BL-041A`; здесь перечислено только незавершённое.

Результат: ключевые desktop/mobile состояния проходят воспроизводимый accessibility
и visual-regression gate, а не только ручной happy-path smoke.

- attachment/emoji-ready composer slots после secure attachment boundary;
- полный focus-visible, keyboard navigation, ARIA/live regions и contrast audit;
- skeleton/empty/error/offline states без layout shift;
- user-facing install/update education; schema compatibility принадлежит `BL-025`;
- repository-owned visual regression screenshots для short/long timeline,
  empty/loading/error, keyboard-sized mobile viewport и основных desktop states.

## Messaging foundation

В этом разделе нет незавершённого foundation: conversations, ordered/idempotent
messages, cursor sync, receipts/presence/typing и authenticated WebSocket перенесены
в `Completed`. Новые correctness-задачи появляются отдельными bounded slices.

## E2EE и multi-device history

### BL-064 — Retention-aligned multi-epoch offline recovery

Статус: **next P0 feature after current release gate**. `WP-063` уже deployed;
`BUG-063` закрыл обнаруженную parallel-ratchet prerequisite локально и требует
production verification до начала этого slice.

Результат: уже авторизованный MLS device с сохранённым sealed local state после
долгого offline периода последовательно догоняет все пропущенные generations и
расшифровывает каждый ещё хранящийся на server ciphertext, который был отправлен,
пока device входил в соответствующий epoch/roster.

- зафиксировать единый retention contract для ciphertext, sync events, READY
  Commit/Welcome и необходимых client epoch secrets;
- восстанавливать историю epoch-by-epoch: получить ordered Commit/message ranges,
  расшифровать и сохранить сообщения старого epoch до необратимого продвижения;
- выбрать и обосновать bounded OpenMLS past-epoch policy; не включать unlimited
  `max_past_epochs` и не хранить key material на server;
- сохранять crash-safe checkpoint после каждого применённого epoch и продолжать
  idempotently после reload, sleep, network loss или duplicate delivery;
- устройство, добавленное позже, revoked/removed leaf и устройство без прежнего
  sealed state не получают pre-membership history или чужие epoch secrets;
- если server retention gap уже наступил, показывать точную неполноту истории и
  предлагать отдельный authenticated device-to-device transfer, а не silent loss;
- regression matrix: несколько сообщений и rotations за offline период, более 100
  generations, out-of-order/duplicate Commit, reload между epochs, expiry boundary,
  removal/re-add и отсутствие downgrade или plaintext/key logging.

### BL-013 — Frontend crypto adapter и device identity

Статус: **remaining attachment boundary и assurance**. Text protection, sealed vault,
Worker runtime, device identity и KeyPackage lifecycle перенесены в `Completed` как
`BL-013A`.

Результат: оставшийся crypto surface получает attachment API и независимые
cross-browser/security assurance gates.

- `encryptAttachment/decryptAttachment` и MLS-bound encrypted metadata contract
  реализуются вместе с `BL-017` без вывода file keys в Vue;
- seal/restore/tamper/storage-denial acceptance в Firefox и Safari;
- migration/update lifecycle покрывается совместно с `BL-025`;
- memory/plaintext lifecycle audit и log-redaction gate полного Worker flow;
- known-answer/interop vectors реального MLS provider и pinned dependency review.

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

### BL-015 — Secure QR device linking, MLS enrollment и двусторонняя history sync

Статус: **detailed design queued after `BL-064` and `BL-025`**. Реализовывать
итерациями с отдельным security/ADR review до изменения MLS membership semantics;
это не UI-задача «нарисовать QR». `BL-064` сначала закрепляет multi-epoch recovery,
а `BL-025` — совместимость persistent browser storage между PWA releases.

Результат: пользователь связывает компьютер и телефон без камеры на компьютере,
подтверждает новое crypto-device уже доверенным устройством, автоматически получает
доступ к будущим сообщениям во всех MLS direct и двусторонне объединяет доступную
локальную историю. Компьютер всегда **показывает** QR, телефон всегда **сканирует**;
после pairing устройства равноправны, permanent primary phone/device не появляется.
Открытие конкретного чата, одновременный online собеседника, logout/login и ручной
crypto reset не являются частью нормального flow.

#### Два обязательных пользовательских flow

**A. Доверенный телефон подключает или восстанавливает компьютер.**

1. Новый компьютер на login page выбирает `Войти с помощью телефона` и показывает
   `enrollment_request` QR. Уже авторизованный компьютер с отсутствующей/повреждённой
   локальной crypto identity показывает тот же тип request через
   `Настройки → Устройства → Восстановить E2EE`, без обязательного logout.
2. Уже доверенная телефонная PWA открывает
   `Настройки → Устройства → Сканировать QR`, сканирует request и показывает origin,
   candidate device name/type, время и короткий authentication code.
3. Пользователь явно подтверждает компьютер на телефоне; компьютер одновременно
   показывает тот же короткий code и ожидаемый approving device. Несовпадение
   останавливает pairing.
4. Компьютер доказывает владение ephemeral private key из pairing request, получает
   собственную opaque HttpOnly session без передачи пароля и регистрирует **новую**
   independent device crypto identity/KeyPackages. Телефон не передаёт свой signer,
   session credential или device-local storage key.
5. Доверенное устройство авторизует новый device, запускает enrollment во все
   доступные direct и затем двустороннюю archive sync. Если компьютер уже был
   HTTP-авторизован, pairing восстанавливает только trust/crypto/history boundary;
   потерянная immutable identity не перезаписывается: создаётся replacement device,
   а прежняя отзывается только после crash-safe cutover.

Для этого flow основным scanner является камера **внутри уже авторизованной PWA**:
только этот install владеет нужной session, device identity и MLS state. Сканирование
обычной камерой iOS может открыть URL в Safari, который является отдельным storage /
crypto-device; web landing не получает право одобрить компьютер и предлагает открыть
телефонную PWA либо ввести там bounded one-time code.

**B. Доверенный компьютер подключает новый телефон.**

1. Компьютер открывает `Настройки → Устройства → Подключить телефон` и показывает
   `enrollment_offer` QR плюс короткий ручной code и TTL.
2. Телефон сканирует QR из pre-auth экрана установленной PWA. Обычная камера может
   открыть onboarding URL, но пользователь явно выбирает, является ли Safari
   самостоятельным device или pairing должен продолжиться в установленной PWA;
   нельзя молча зарегистрировать Safari вместо Home Screen PWA.
3. Телефон генерирует собственную identity и ephemeral proof, после чего оба экрана
   показывают account/device details и одинаковый authentication code. Подтверждение
   требуется на доверенном компьютере до выдачи телефонной session и crypto trust.
4. Компьютер авторизует телефон, enroll-ит его в доступные direct и начинает
   двустороннюю archive sync. Камера компьютеру не требуется ни на одном шаге.

Оба flow используют одну versioned pairing state machine, но разные начальные роли:
`enrollment_request` означает «QR показывает candidate computer», а
`enrollment_offer` — «QR показывает trusted computer». После взаимной аутентификации
роль scanner/display не определяет направление history transfer.

#### Pairing и account-level device trust

- Candidate device генерирует локально ephemeral key pair; QR содержит только
  HTTPS origin, version, purpose/role, opaque one-time pairing ID, ephemeral public
  key/fingerprint, expiry и anti-replay binding. Password, cookie/session bearer,
  archive key, MLS signer, sealed provider, plaintext и постоянный private key в QR
  или URL не попадают.
- Pairing имеет короткий configurable TTL, одноразовое использование, explicit
  cancel и durable состояния вроде `created → scanned → confirmation_pending →
  approved → authorized → crypto_enrolling → history_syncing → ready`, а также
  `expired/cancelled/revoked/failed`. Все переходы idempotent и monotonic.
- До `approved` ни сканирование QR, ни знание manual code не создают session/device.
  Approval привязан к exact account, candidate ephemeral proof, approving active
  device, requested role и normalized origin. Cross-account approval запрещён.
- У каждого связанного device остаётся собственная immutable device identity.
  Доверенное устройство подписывает bounded authorization нового device; server
  хранит проверяемый versioned linked-device roster/public attestations, но не может
  незаметно добавить device без обнаружимого изменения trust state. Exact account
  trust model, verification code/key-transparency semantics и credential format
  фиксируются отдельным ADR до реализации, без самодельных crypto primitives.
- Settings показывают все linked/pending devices, кто и когда одобрил pairing,
  последний activity и состояние `auth / crypto enrollment / history sync`. Можно
  отозвать candidate во время pairing и любое linked device после него. Revocation
  прекращает transfer, отзывает server session и исключает leaf из будущих epochs.
- Если доступного trusted device/recovery secret нет, password login может создать
  обычную account session, но сам по себе не раскрывает прежнюю E2EE-историю и не
  считается скрытым подтверждением новой identity. Нужен explicit secure-identity
  reset с изменением verification state либо отдельный recovery design.
- Endpoints остаются `/api/v1`, state-changing операции требуют обычные
  cookie/CSRF/strict-Origin проверки, rate limits и authorization. Pairing IDs,
  codes и ephemeral material не логируются целиком.

#### MLS enrollment без остановки существующих устройств

- Связанный account device и активный MLS leaf — разные состояния. Новый login /
  pending crypto-device **не должен немедленно менять roster каждого direct и
  переводить все текущие conversations в `blocked/device_roster_changed`**.
- Новая identity сначала публикует bounded validated KeyPackages как pending. Для
  каждого conversation enrollment становится видимым в authoritative roster только
  атомарно вместе с валидным Commit/Welcome и готовностью новой generation. Пока
  конкретный direct ещё не enroll-нут, прежняя READY generation продолжает принимать
  сообщения от прежних leaves; новый device честно показывает per-chat progress и
  не делает insecure fallback.
- Доверенное approving device в фоне, независимо от active route/chat, проходит все
  direct, где оно владеет подходящим sealed MLS state, создаёт standard Commit и
  адресный Welcome. Собеседник может быть offline: server хранит opaque Commit,
  Welcome и sync events до catch-up/ACK; открывать чат на его device не требуется.
- Enrollment crash-safe и resumable на уровне conversation: completed direct не
  повторяет membership change, failed direct не откатывает уже completed, а один
  повреждённый/утраченный local group не блокирует все остальные. UI показывает
  точные `pending/ready/needs another trusted leaf/recovery required` состояния.
- Отдельный ADR/security spike сравнивает два стандартизованных продолжения для
  direct, где approving device не владеет current group: сохранённый Commit/Welcome
  от другого previous leaf и MLS 1.0 External Commit по актуальному signed GroupInfo.
  External Commit не включается только ради UX до проверки OpenMLS support,
  application-level authorization, resync/remove attack surface, ordering и
  compatibility. Переход на Signal-style pairwise sessions также возможен только
  отдельной versioned protocol migration, не внутри QR PR.
- Global crypto sync worker живёт вне chat component и запускается после auth/crypto
  bootstrap, cold start, reconnect, visibility resume, push/sync hint и cursor reset.
  WebSocket остаётся необязательным wake-up; correctness обеспечивают PostgreSQL и
  cursor catch-up. Ни authorizer, ни candidate не обязаны оставаться online
  одновременно после сохранённого pairing/enrollment checkpoint.
- Старые ciphertext и epochs не перешифровываются. Новый leaf читает сообщения только
  после своего membership epoch; доступная прежняя история приходит через отдельный
  authenticated archive transfer. Historical v1/v2 rows не переписываются.

#### Двусторонняя local-history sync

- После crypto enrollment оба устройства обмениваются authenticated bounded
  manifests: conversation IDs, server message ID/sequence ranges, protocol/epoch
  metadata, tombstones, attachment availability и archive schema/capabilities.
- Transfer строит union: scanner может передавать данные display-у и получать
  отсутствующие данные обратно в той же pairing session. Уже частично заполненные
  телефон и компьютер синхронизируют mutually missing ranges, а не выбирают один
  authoritative archive и не затирают второй.
- Historical message content, которое source уже может расшифровать, передаётся
  chunks внутри mutually authenticated E2EE channel и на target заново шифруется его
  независимым device-local storage key. Общий private MLS signer, sealed current/past
  group state, session credential и storage key между устройствами не копируются.
- Server-retained ciphertext догружается обычным sync; данные за retention window
  могут дополняться device archive. Если ни server, ни одно paired device больше не
  имеют запись, UI показывает gap, а не создаёт вымышленную полноту истории.
- Conflict resolution основан на authenticated server message IDs/sequences,
  immutable envelope metadata и tombstones. Duplicate chunks/imports идемпотентны;
  incompatible payload, signature/authentication failure или contradictory immutable
  record останавливает затронутый range fail-closed без удаления исправного архива.
- Transfer chunked, byte/time bounded, backpressured, cancellable и resumable.
  Checkpoint содержит manifest version, range/chunk IDs, hashes и ACK, но не plaintext.
  Relay на VPS при необходимости хранит только TTL-bounded opaque ciphertext; прямое
  одновременное соединение не является условием корректности.
- Локальные attachments передаются только если source действительно хранит их
  encrypted/plaintext-resolvable representation и действуют quota/size policies;
  missing/expired media обозначается отдельно. Read/archive/preferences sync не
  может отменить более новый authenticated tombstone.

#### Устойчивость к restart, deploy и PWA update

- Pairing/enrollment/relay metadata, idempotency bindings, TTL, Commit/Welcome,
  durable events и ACK хранятся в PostgreSQL либо другом явно утверждённом durable
  adapter, а не только в process memory. Backend restart теряет лишь WebSocket и
  ephemeral caches.
- Ephemeral/private device keys, sealed MLS state, encrypted archive и local progress
  остаются в persistent storage конкретного browser install. Service Worker update,
  frontend bundle activation и IndexedDB migration не меняют `device_id`, не стирают
  keys и не создают новую identity; это обеспечивается `BL-025` compatibility gate.
- После API/container restart клиенты reconnect-ятся, делают cursor catch-up и
  продолжают exact durable state. Retry каждого mutation/chunk безопасен; restart в
  любой точке не требует повторного password login, QR scan или открытия чата.
- Protocol/capability version согласуется до pairing. Backend migrations additive;
  feature включается флагом после compatible frontend rollout. Старые клиенты,
  которые не знают QR flow, продолжают существующий MLS v2 messaging и не получают
  неизвестный linked device в roster до безопасного enrollment cutover.
- Safari tab и установленная iOS/macOS PWA считаются разными device/storage
  containers, пока реальная platform-проверка не докажет обратное. Никакой deploy не
  пытается автоматически объединить или переиспользовать их private state.

#### Реализационные slices и acceptance gate

1. ADR/threat model: trust root/attestation, two-role handshake, External Commit
   decision, durable state machine, browser/PWA handoff и downgrade compatibility.
2. Pairing transport + UI: computer display, phone in-app scanner, passwordless
   session bootstrap, manual-code fallback, device list/revoke; без history transfer.
3. Pending-device model и atomic background MLS enrollment без глобального direct
   outage; per-conversation status/retry и no-active-chat dependency.
4. Bidirectional manifests/chunk transfer для text/tombstones, затем bounded media и
   secondary app state. Каждый slice имеет отдельный rollout flag и rollback plan,
   который не отзывает уже здоровые devices и не удаляет archive.
5. Production-like acceptance минимум на Safari tab, installed iOS PWA, installed
   macOS PWA, Android PWA и desktop Chrome/Firefox; camera всегда только на телефоне.

Обязательная тестовая матрица:

- flow A: unauthenticated computer и отдельно authenticated-but-crypto-lost computer;
- flow B: trusted computer → new phone; in-app scanner, default iOS camera landing,
  manual code и явное различение Safari/Home Screen PWA;
- телефон→компьютер, компьютер→телефон и mutually missing archive ranges в одной
  session; duplicate/out-of-order/resume, partial/corrupt chunk и quota exhaustion;
- offline собеседник, inactive direct и сотни conversations: новое устройство пишет
  после enrollment без входа/открытия чата собеседником;
- approving device sleep/offline после approval, candidate sleep, network loss,
  missed/duplicated WebSocket and Push, cursor reset и retention gap;
- API/frontend/PostgreSQL-safe rolling restart до scan, после scan, после approval,
  во время session issuance, MLS Commit/finalize/Welcome ACK и каждого history chunk;
- PWA deploy/service-worker activation и IndexedDB migration на каждом durable state;
  после reload сохраняются device identity, progress, возможность decrypt и send;
- expired/replayed/screenshot QR, guessed/manual code, wrong account/origin/device,
  concurrent scanners, two simultaneous candidates, MITM/substitution, stale
  approving device, revoke во время enrollment/transfer и revoked-session retry;
- server не получает/log-ирует message plaintext, archive/storage/MLS private keys,
  passwords или session credentials; новый/removed device не читает epochs, в которых
  не состоял, кроме явно переданной владельцем authenticated local-history копии.

Definition of Done: оба QR-flow проходят реальную device matrix; ни один flow не
требует камеры компьютера, online собеседника или открытия конкретного direct;
существующие chats продолжают отправку во время pending enrollment; доступная история
объединяется в обе стороны без silent loss; restart/deploy на каждой checkpoint-точке
автоматически продолжается либо безопасно завершается без потери уже существующих
keys/messages; security review, ADR, runbook и rollback проверены до production flag.

## Attachments, retention и storage

### BL-017 — Encrypted attachment upload/download

Статус: **P1 after `BL-025`/`BL-024`**. Старый `WP-051` design/WIP должен быть
revalidated against current direct-only MLS v2 policy и не считается выполнением.

Результат: клиент шифрует file до upload и расшифровывает только локально.

- client type/size validation, random file key и encrypted metadata в message payload;
- versioned `/api/v1/attachments` upload/download;
- authorization через conversation membership;
- configurable limits для image/file/video/voice;
- server не делает preview/transcoding и не получает keys/plaintext.

### BL-043 — Telegram-like photo/file experience поверх encrypted attachments

Статус: **desktop paste/drop completed in `WP-065`/`c8d55f6`**. Здесь остаются только
durable/direct-media slices после `BL-017` и `BL-024`; production group
picker/batch/gallery/video/download уже перенесён в `Completed`.

Результат: secure attachment boundary получает цельный offline-capable composer и
polished desktop/mobile interaction без server-side preview/transcoding.

- [x] desktop drag/drop и clipboard paste с теми же type/size/count checks, что picker;
- caption и locally generated encrypted preview/thumbnail для direct MLS attachment;
- upload cancel/retry и offline-safe draft/outbox lifecycle поверх persistent staging;
- явные download/cache/pin/expired states без обещания доступности удалённого original;
- mobile camera/photo-library/file chooser и desktop keyboard/accessibility tests;
- UI не получает file key/private crypto state и не маркирует group v1 media как E2EE.

### BL-018 — Server TTL cleanup и tombstone retention

Статус: **remaining configurable policy only**. Message/media cleanup, tombstones,
bounded concurrency и missing-file tolerance уже production-ready через `WP-028`/
`WP-056` и сохранены в `Completed` (`BL-010`, `BL-016`).

Результат: администратор выбирает retention policy без нарушения уже проверенной
cleanup/tombstone семантики.

- configurable retention по типам, включая forever policy;
- migration/config validation для существующих conversations/messages;
- media expiry наследует effective message policy, pending upload остаётся bounded;
- policy-boundary tests для forever/type override и tombstone window;
- документация backup compatibility и redacted operational summary.

### BL-019 — Quotas, disk pressure и upload backpressure

Статус: **частично выполнено**: per-file limits, per-uploader active-media quota,
streaming writes и bounded cleanup уже есть; global disk admission/visibility нет.

Результат: небольшой VPS не заполняется неконтролируемо.

- global media quota и reserved-free-space threshold поверх существующих limits;
- media usage, PostgreSQL size и free-disk metrics/alerts;
- admin-only storage dashboard: media/DB usage, filesystem capacity/free/reserved,
  configured quotas и low-disk admission state без раскрытия чужих filename/content;
- запрет новых больших uploads при low disk вместо удаления unexpired data;
- bounded cleanup batches и resource-budget tests;
- документированный ориентир диска/резерва.

## Local-first PWA

### BL-024 — OPFS media cache и local retention controls

Статус: **group v1 encrypted cache active in `WP-071`; usage visibility and safe
device clear active in `WP-072`; remaining drafts/pinning/retention controls stay
queued after `BL-025` compatibility gate**. Этот slice использует новую
изолированную media DB/OPFS schema и не мигрирует существующие persistent stores.

Результат: переписка, meaningful UI state и уже загруженные media переживают reload и
bounded offline-период, не превращая origin storage в безлимитный или plaintext archive.

- [x] OPFS/origin-private adapter с отдельным IndexedDB fallback; group v1 bytes шифруются
  device-local key at rest, direct media cache хранит только client-encrypted bytes;
- [x] versioned authenticated metadata связывает local blob с owner/device,
  conversation/attachment ID, type, size и server expiry; digest binding для новых
  message envelopes остаётся;
- encrypted per-conversation composer draft; выбранные media/file draft bytes
  копируются в bounded staging store, поэтому reload не теряет подготовленную отправку;
- [x] byte-bounded LRU cache с default device budget 2 GiB; configurable UI и
  explicit pinned-media policy остаются;
- local text retention: forever/1 year/90 days без изменения server TTL;
- [x] offline open для cached group media и честный missing-original UX после
  server/local eviction;
- `navigator.storage.persist()` только после объяснимого user gesture; quota pressure
  отображается без обещания backup или невозможности browser eviction;
- [x] user-facing media storage screen показывает exact adapter usage/entry count и
  2 GiB application ceiling; origin-wide `navigator.storage.estimate()` breakdown
  для app shell/archive/drafts остаётся;
- [x] clear-evictable-media-cache не удаляет session, device identity, MLS state или
  encrypted message archive без отдельного explicit destructive action;
- eviction/reload/quota-denial/corrupt-record tests и отсутствие plaintext/media keys
  в IndexedDB metadata, logs или UI state inspectors.

### BL-025 — PWA lifecycle и update safety

Статус: **частично выполнено**: install surface, Workbox app shell и automatic update
готовы; persistent-schema compatibility и background ownership остаются.

Результат: приложение устанавливается, работает с offline shell и безопасно обновляется.

- compatibility gate и explicit migrations для всех IndexedDB/OPFS schemas до
  активации нового Service Worker;
- upgrade tests со старой установленной version, сохранёнными crypto state, archive,
  snapshot и outbox без silent reset;
- определить owner фоновой отправки: Service Worker Background Sync включается только
  с проверенной cross-release MLS transaction compatibility;
- cross-tab lease для outbox/crypto mutations; параллельные вкладки уже не создают
  server duplicate, но не должны выполнять лишнюю state-changing crypto operation;
- storage-denial/update-failure UX с safe rollback на прежний executable shell.

## Web Push

### BL-028 — Notification UX, preferences и deduplication

Статус: **remaining controls after deployed `WP-061` MVP**. Device-bound subscription,
generic background notification, focus/navigation и invalid-subscription cleanup
перенесены в `Completed` вместе с `BL-026`/`BL-027`.

Результат: foreground/background уведомления не дублируют unread state.

- authenticated installed Android/iOS real-device permission/delivery/click acceptance;
- per-device global enable/status и bounded recovery после browser permission change;
- per-conversation mute до времени без plaintext preview;
- app badge derived idempotently from authoritative unread state;
- звук/vibration только там, где platform реально поддерживает управление;
- stable event/message ID dedup tests для WebSocket + Push + sync на нескольких devices.

## Production и operations

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

### BL-076 — Independent TLS certificates for production origins

Статус: **in progress** (`WP-076`).

- отдельные Certbot lineages для `.ru` и `.com.de` исключают общий renewal failure;
- два exact HTTPS server используют общий project-owned proxy/security snippet;
- scoped install, rollback и acceptance не затрагивают соседние Nginx services.

### BL-075 — Dual production origins

Статус: **completed and production verified** (`WP-075`, `dda65a4`, workflow
`31702700102`).

- общий chat-vhost и SAN TLS certificate для `chat.yoowee.ru` и
  `chat.yoowee.com.de`;
- exact backend Origin allowlist без wildcard;
- отдельные origin-scoped browser sessions, PWA storage и E2EE devices;
- scoped Nginx/Certbot rollout без изменения соседних VPS services.

### BL-074 — Standalone managed registration invitations

Статус: **completed and production verified** (`WP-074`, `50d0b6d`, workflow
`31701582705`).

- standalone invitation lifecycle без inactive pseudo-user;
- admin list/revoke, transient link/QR и self-chosen unique username;
- atomic registration + device-bound session, abuse-resistant public endpoint;
- legacy activation compatibility только для уже выпущенных ссылок.

### BL-073 — Telegram-style compact group video notes

Статус: **implemented, full-CI verified and production deployed** (`WP-073`,
`dc14858`); physical Android/iOS acceptance подтвердила permission/capture flow,
safe-area fixes и gesture/presentation polish.

- hold/release отправляет, swipe-left отменяет, swipe-up фиксирует запись;
- locked mode поддерживает cancel/send и best-effort front/back camera switch;
- browser-negotiated MP4/WebM ограничен 480×480, 20 fps, low bitrate, 60 секундами
  и 8 MiB без server-side crop/transcoding;
- optional `video_note` presentation metadata даёт старому client обычный video
  fallback без backend schema/media-kind migration;
- круглый player переиспользует authenticated group download, TTL и encrypted
  device media cache; direct MLS composer остаётся закрыт до `BL-017`.

### BL-071 — Encrypted 2 GiB device media cache

Статус: **implemented, full-CI and real-browser verified** (`WP-071`, `14a0868`).

- отдельная `yv-chat-media-cache-v1` и opaque OPFS directory не мигрируют message,
  snapshot, outbox или MLS stores;
- AES-256-GCM chunks используют отдельный non-extractable per-user-device key;
- persistent 2 GiB LRU, expiry eviction, 128 MiB hot LRU и concurrent coalescing;
- real browser reload показал cached PNG после удаления server media bytes, затем
  direct MLS v2 message успешно расшифровался вторым устройством.

### BL-070 — Telegram-like chat interactions

Статус: **implemented and locally verified** (`WP-070`).

- message activity атомарно поднимает свежие диалоги вверх;
- bounded client-side search не передаёт query/plaintext server-у;
- reply target и mention IDs живут внутри protected versioned content;
- reactions авторизованы, idempotent, агрегированы и синхронизируются durable event;
- photo viewer поддерживает swipe/keyboard, pinch/double-click/wheel zoom и pan;
- поддерживаемое video играет inline/fullscreen, codec failure остаётся download fallback;
- лимиты media сохранены как конфигурируемая защита небольшого VPS.

### BL-069 — Automatic MLS roster reconciliation

Статус: **implemented and full-CI verified locally** (`WP-069`).

- cold startup и sync reset reconciles все direct conversations;
- durable `conversation_updated` запускает reconcile изменившегося inactive direct;
- previous leaf создаёт Commit без входа peer и без ручного открытия того же чата;
- READY cache инвалидируется sync-событием, а не каждым message envelope;
- server exact current generation/epoch gate сохраняет fail-closed stale-send защиту.

### BL-068 — Instant anchored chat open and reload

Статус: **implemented and real-browser verified locally** (`WP-068`).

- encrypted IndexedDB и server history читают bounded окно `49 before + target + 50 after`;
- cached latest больше не рисуется перед saved mid-history anchor;
- hidden mobile pane не перезаписывает anchor, а deep-link ждёт target DOM;
- programmatic restore выполняется без smooth animation и до показа timeline;
- browser test с 1000 сообщениями восстановил `#512..#517` после reload с delta `6 px`,
  а deep-link `#500` загрузил contiguous `451..550` при 100 DOM rows.
- release OpenMLS/WASM integration расшифровывает 100 последовательных v2 envelopes,
  после runtime reload читает anchored rows `40..90` из encrypted content cache без
  повторного движения receiver ratchet и сохраняет возможность отправить reply.

### BL-067 — Safe iOS PWA crypto re-enrollment

Статус: **implemented and full-CI verified; production iPhone acceptance pending**
(`WP-067`).

- Home Screen PWA с copied Safari cookie и отсутствующим local MLS vault предлагает
  отдельный password-confirmed enrollment вместо logout;
- новый login выдаёт отдельные device/session и cookie текущему PWA container, не
  отзывая здоровую Safari session;
- обычный device crypto watcher provision-ит identity/KeyPackages для нового ID;
- password очищается до network await, silent identity replacement не появился;
- origin storage persistence запрашивается best-effort без очистки IndexedDB.

### BL-066 — Instant cached conversation return

Статус: **implemented and real-browser verified locally** (`WP-066`, `21ec11f`).

- bounded LRU держит reactive windows 12 недавно открытых conversations только в RAM;
- A → B → A рисует hot window до network catch-up без пустого timeline;
- cold saved anchor рисуется из encrypted IndexedDB до server reconciliation;
- scroll anchor захватывается до debounce и flush-ится до смены conversation;
- late async results не перерисовывают новый active chat, tombstones обновляют cache;
- isolated two-origin browser acceptance: 45 сообщений за 47 ms, тот же anchor
  sequence `16` восстановлен за 625 ms без последующего drift или console errors.

### BL-044 — Per-conversation viewport restoration

Статус: **completed** (`WP-064`, `d1eb746`, physical Pixel acceptance documented).

- warm/cold push deep link targets exact authorized conversation/message;
- encrypted message-relative anchor stores sequence, offset and latest intent;
- throttled restore survives local/network pagination, prepend and viewport changes;
- incoming messages do not pull a history reader to bottom;
- visual viewport keeps composer reachable through keyboard resize;
- mobile/system-bar contract is tested; physical Pixel confirmed that the lower
  Android navigation surface remains Chrome/WebAPK-owned and cannot be recolored by
  standard manifest/meta/CSS APIs. Exact native control would require a TWA/APK wrapper,
  which remains outside PWA scope rather than an open viewport bug.

### BL-013A — Frontend text crypto, device identity и sealed runtime

Статус: **completed** (`WP-030`–`WP-035`, `WP-040`, `WP-045`, `WP-047`).

- async exact-version `protectText/unprotectText` без downgrade;
- pinned OpenMLS native/WASM provider и canonical device identity/KeyPackage proof;
- bounded private snapshot/restore без JS export;
- AES-256-GCM sealed state с non-extractable key и device/revision-bound AAD;
- atomic versioned IndexedDB vault и isolated Worker runtime;
- authenticated immutable identity registry и exact consumer KeyPackage validation;
- bounded one-time KeyPackage pool/claim/replenishment with concurrency constraints;
- corruption/version/no-fallback tests и отсутствие crypto primitives в Vue.

### BL-041A — Visual/PWA foundation

Статус: **completed and production-verified** (`WP-041`, `WP-043`, `WP-053`,
`WP-055`, `WP-059`, `WP-060`).

- semantic visual/motion tokens and reduced-motion fallback;
- desktop split view, mobile master/detail, fixed header/composer и bounded timeline;
- compact chat rows, grouped bubbles, day separators, receipts, typing/presence и
  scroll-to-latest behavior;
- multiline composer, visual viewport/keyboard positioning, safe areas и gesture bar;
- explicit manifest, Apple assets, versioned transparent `any`/solid `maskable` icons,
  reproducible SVG→PNG pipeline и Pixel splash/safe-zone regressions;
- automatic update activation/reload, transient/offline connection overlay;
- byte-accurate accessible group media upload progress.

### BL-063 — MLS-capable send roster consistency

Статус: **completed and deployed** (`WP-063`, production run `31591911253`).

Bootstrap и v2 message gate используют одну projection активных MLS-capable devices.
Legacy device без identity не блокирует READY direct conversation при наличии capable
leaf у каждого участника; новая identity требует rotation, а stale generation/epoch,
revoked sender и participant без capable device остаются fail-closed. Exact topology
закреплена unit и PostgreSQL regressions.

### BL-062 — Deploy-safe session и self-healing MLS runtime

Статус: **completed** (`WP-062`).

Existing browser devices переживают API/frontend recreation без password login,
нового device ID или generation storm. Только authoritative `401` очищает session,
transient API failure retry-ится, failed MLS mutation восстанавливает sealed checkpoint,
а deploy публикует frontend только после healthy API. Production-like два устройства
успешно отправляют после hard API restart.

### BL-054 — Self-healing local MLS checkpoint и явный device recovery

Статус: **completed** (`WP-054`, `01ef0ac`, production run `31549397629`).

- read-only inspection локального epoch/device roster через Rust/Worker port;
- exact recovery server checkpoint только при epoch+roster match;
- ordered catch-up последующих Commit/Welcome;
- fail-closed диагностика полной потери device-local MLS state;
- coordinator выбирается на generation без permanent primary device.

### BL-050 — Conversation-scoped direct/group protocol policy

Статус: **completed** (`WP-050`, `45709c3`, production run `31541538389`).

- direct принимает только MLS v2 с exact generation/epoch/roster binding;
- group временно принимает только явно non-E2EE v1 без client fallback;
- historical v1/v2 rows immutable и читаются своей exact version;
- historical exact retry идемпотентен, но не разрешает новый direct v1;
- multi-account/device/reload/revoke scenarios проверены.

### BL-038 — Native-feeling PWA shell и frontend Clean Architecture

Статус: **completed** (`WP-020`, `c9c7bcf`).

- routes `/login`, `/activate`, `/chat`, `/settings`, `/admin/users` и guards;
- desktop navigation rail + mobile bottom navigation с safe-area/touch targets;
- light/dark/system tokens, persisted non-secret preference и reduced-motion fallback;
- haptics port, bounded device label и safe URL-fragment invite consumption;
- app-scoped state без SSR singleton, runtime DTO parsers и без raw browser/API calls
  в components;
- Vitest, lint/typecheck/build и desktop browser smoke.

Physical mobile visual acceptance остаётся общим gate `BL-041`/`BL-033`, а не
незавершённой частью shell architecture.

### BL-039 — Admin account lifecycle и password recovery

Статус: **completed** (`WP-021`).

- bounded admin user list/search и deactivate/reactivate safety invariants;
- admin reset атомарно revokes target sessions/devices;
- purpose-bound hashed one-time reset secret с TTL/single-use/concurrency policy;
- fragment-only reset/invitation URL, пользователь сам задаёт Argon2id password;
- audit без secrets и negative authorization/CSRF/guessing tests;
- Alembic, repositories/use cases, Dishka wiring и pytest.

### BL-040 — User settings, devices и security center

Статус: **completed** (`WP-022`).

- profile и user-editable device display name;
- current/other sessions с bounded browser/OS/IP metadata;
- revoke one/all others, password change и security reset;
- theme/haptics/motion/notification/privacy preferences;
- credential hashes/private material не выводятся, metadata не является auth factor.

### BL-042 — Управление группой и составом участников

Статус: **completed** (`WP-046`, `8fb3720`).

- rename, add/remove/re-add и максимум 50 active members;
- role-aware responsive UI без ложного ownership transfer;
- atomic `conversation_updated`, local snapshot update и multi-device catch-up;
- negative authorization/concurrency/persistence/frontend tests;
- явная MLS Commit/Welcome boundary без фиктивной rotation.

### BL-009 — Receipts, unread state, typing и presence

Статус: **completed** (`WP-024`–`WP-027`).

- shared per-user read cursor, durable read/delivery receipts и server unread count;
- foreground-only mark-read до загруженной authoritative sequence;
- ephemeral server-expiring typing и best-effort multi-device WebSocket presence;
- reconnect deduplication и automated tests.

Physical multi-device release acceptance агрегируется в `BL-033` и не держит
реализованный foundation в активном backlog.

### BL-011 — Authenticated WebSocket notifications

Статус: **completed** (`WP-023`–`WP-026`).

- same-origin cookie handshake, active-session и exact Origin validation;
- explicit `hello`, `new_message`, `message_deleted`, `typing`, `presence`,
  `read_receipt`, `delivery_receipt` и `conversation_updated` frames;
- small routing hints; durable sync остаётся correctness path;
- heartbeat не продлевает auth session, periodic revalidation закрывает revoked/
  expired session без отдельного client-trusted revocation event;
- single-process registry без Redis и cursor catch-up после reconnect.

### BL-014 — E2EE conversations, membership changes и rotation

Статус: **completed crypto foundation** (`WP-047`, `91a6765`–`881f648`).

- sealed OpenMLS group state, multi-device fan-out и membership Commit;
- exact READY generation/epoch/sender-leaf binding;
- ordered Commit/Welcome catch-up и same-device remove/re-add;
- device revoke/logout routing, active roster send gate и rotation;
- checking/pending/blocked/ready UX без v2→v1 downgrade;
- two-origin/device exchange, reload decrypt, PostgreSQL integration и production rollout.

Group outgoing MLS сейчас выключен explicit policy; его возврат отслеживает `BL-051`.

### BL-016 — MediaStorage port и LocalMediaStorage

Статус: **completed** (`WP-056`, `5135a50`, production run `31551963185`).

- opaque generated storage keys и logical key в БД без client path;
- streaming save/open/delete/exists без unbounded RAM;
- traversal, missing-file, partial-write и ownership tests;
- default `/data/media`; S3 adapter не добавлен без external-storage requirement.

### BL-043A — Group photo/file/video experience

Статус: **completed and deployed** (`WP-056`–`WP-060`).

- intentional media/file pickers, arbitrary generic files и ordered batch до 10;
- adaptive photo gallery, in-app fullscreen swipe/keyboard viewer и inline video;
- credentialed Blob download без navigation из standalone PWA;
- byte-accurate aggregate/per-item upload progress;
- safe unsupported-codec download и unavailable/expired states;
- streaming server storage, opaque keys, membership authorization и cleanup.

Этот group v1 flow остаётся server-readable и никогда не маркируется E2EE. Direct
crypto, durable cache/draft и оставшийся interaction polish отслеживают `BL-017`,
`BL-024` и активный `BL-043`.

### BL-022 — IndexedDB encrypted local archive

Статус: **completed core** (`WP-042`, `WP-043`, `WP-033`/`WP-034`).

- encrypted snapshot для directory/conversations/read-delivery state/sync cursor;
- bounded encrypted latest/before message archive, 2,000 records per conversation;
- bounded timeline DOM/RAM и load-older без пропусков;
- non-extractable AES-256-GCM keys и plaintext только в rendering/processing RAM;
- cache-first paint, затем catch-up с persisted cursor;
- sealed versioned crypto provider state в отдельном atomic IndexedDB vault;
- non-blocking storage-unavailable/corrupt handling и automated reload tests.

Attachment metadata/media/drafts теперь принадлежат `BL-024`, а cross-release schema
compatibility — `BL-025`; они не делают завершённый text archive «частичным».

### BL-023 — Offline outbox и conflict recovery

Статус: **completed** (`WP-044`).

- bounded 250-entry encrypted queue с device-scoped idempotency key;
- `pending/sending/sent/failed`, backoff, manual retry и foreground/reconnect flush;
- authoritative receipt reconciliation и sync correctness для inactive conversations;
- crash-between-send-and-ack и duplicate retry tests;
- quota fail-closed UX без потери current composer input;
- stale previous-login device entries не переотправляются под новым device scope.

Background Sync и cross-tab ownership являются update/runtime hardening в `BL-025`.

### BL-026 — Push subscriptions и VAPID

Статус: **completed and deployed** (`WP-061`).

- permission после user gesture с installed iOS/iPadOS constraints;
- device-bound subscription CRUD;
- public VAPID config, private secret вне Git/image/logs;
- endpoint/key redaction и invalid subscription recovery.

### BL-027 — Privacy-safe push dispatcher

Статус: **completed and deployed** (`WP-061`).

- opaque version/event/conversation/message IDs или `sync_required` only;
- никакого plaintext preview, media keys или sensitive signaling;
- commit до best-effort bounded dispatch;
- permanent `404/410` cleanup; push failure не откатывает message;
- generic background notification, foreground suppression и scoped click navigation.

### BL-029 — Production Nginx, TLS и security headers

Статус: **completed** (`WP-019`, production workflow `31452613018`).

- HTTP→HTTPS, certificate automation и verified HSTS;
- WebSocket upgrade/timeouts, upload limits и exact trusted proxy chain;
- CSP, `X-Content-Type-Options`, `Referrer-Policy` и minimal backend disclosure;
- system Nginx routes loopback-only API/frontend; PostgreSQL не опубликован;
- migration-before-rollout, immutable GHCR images и соседние services сохранены.

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
