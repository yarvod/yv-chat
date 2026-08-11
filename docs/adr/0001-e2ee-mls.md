# ADR-0001: MLS 1.0 для end-to-end encryption

- Статус: **accepted for protocol; implementation release-gated**
- Дата решения: 2026-08-11
- Последняя проверка upstream state: 2026-08-11
- Связанные задачи: `BL-012`, `WP-029`; реализация — `BL-013`, `BL-014`,
  `BL-015`, `BL-022`

## 1. Решение

`yv-chat` использует Messaging Layer Security 1.0 по RFC 9420 как единственный
E2EE group key agreement/message protection protocol и применяет его одинаково к
direct conversations и groups. Direct conversation не получает отдельный
самодельный ratchet.

Базовый набор:

```text
MLS version: 1.0
ciphersuite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
wire serialization: RFC 9420 TLS presentation language
handshake wire format: PrivateMessage whenever protocol permits
one yv-chat Device: one distinct MLS client/leaf
one yv-chat Conversation: one MLS group
```

Выбранный ciphersuite является mandatory-to-implement suite OpenMLS и не создаёт
собственную комбинацию primitives. Crypto primitives, TreeKEM, key schedule,
secret deletion schedule, Proposal/Commit/Welcome processing и transcript validation
делегируются выбранной MLS implementation.

Protocol decision окончательный для v1 secure milestone. Concrete browser provider
не считается production-approved только из-за слова MLS или успешной компиляции в
WASM. Начальный implementation path — pinned OpenMLS core с `js` support,
`openmls_rust_crypto` provider и минимальным in-repository Rust/WASM binding вокруг
intent-level API. Upstream `openmls-wasm` — reference/spike material, не готовая
production dependency: официальный README прямо называет bindings experiment, а
upstream matrix помечает `wasm32-unknown-unknown` как built but unsupported/not tested.

`BL-013/014` не могут объявить secure milestone, пока adapter не прошёл все release
gates из раздела 14. Если OpenMLS browser spike не проходит их без patching crypto
internals, реализация останавливается и ADR пересматривается; plaintext/synthetic
fallback запрещён.

## 2. Источники и основания

Решение опирается на первичные источники:

- [RFC 9420 — MLS Protocol](https://www.rfc-editor.org/rfc/rfc9420.html) задаёт
  стандартизованный asynchronous group key agreement с forward secrecy (FS) и
  post-compromise security (PCS).
- [RFC 9750 — MLS Architecture](https://www.rfc-editor.org/rfc/rfc9750.html)
  определяет Authentication Service, Delivery Service, multi-device model, threat
  boundaries и ограничения, которые сам RFC 9420 не решает за приложение.
- [OpenMLS repository](https://github.com/openmls/openmls) реализует RFC 9420,
  поддерживает выбранный MTI ciphersuite и `js` feature.
- [OpenMLS WebAssembly documentation](https://book.openmls.tech/user_manual/wasm.html)
  требует browser/Node secure randomness и time через JavaScript APIs.
- [OpenMLS Wasm Bindings Experiment](https://github.com/openmls/openmls/tree/main/openmls-wasm)
  честно описывает текущие bindings как minimal experiment/starting point.
- [OpenMLS persistence guidance](https://book.openmls.tech/user_manual/persistence.html)
  требует сохранять sensitive group state через `StorageProvider` и действительно
  удалять obsolete key material для FS.
- [W3C WebCrypto Level 2](https://www.w3.org/TR/webcrypto-2/) и
  [IndexedDB 3.0](https://www.w3.org/TR/IndexedDB/) задают browser primitives для
  origin-scoped non-extractable wrapping key и structured persistence.
- [W3C CSP Level 3](https://www.w3.org/TR/CSP3/) и
  [Trusted Types](https://www.w3.org/TR/trusted-types/) используются как
  defense-in-depth против XSS, но не как защита от уже исполняющегося malicious code.

RFC 9750 опубликован в апреле 2025 и является актуальной architecture companion
спецификацией на дату review. Upstream versions не копируются в этот ADR как вечные:
каждый dependency bump требует повторной проверки release notes/advisories.

## 3. Рассмотренные реализации

| Candidate | Browser path | Плюсы | Блокеры/решение |
|---|---|---|---|
| OpenMLS core | Rust `wasm32` + `js`; собственный узкий binding | MIT; прямой RFC 9420; активный interop/test-vector проект; clean provider/storage traits | WASM target upstream built, но не в supported/tested list; official binding experimental. **Выбран только за release gates.** |
| `awslabs/mls-rs` | WASM build, WebCrypto provider | Apache-2.0/MIT; RFC conformance; configurable storage | README помечает WebCrypto provider experimental и отсутствие полного third-party audit. Не выбран первым. |
| Wire CoreCrypto | published TS/WASM bindings, browser/keystore tests | зрелая production-oriented abstraction и encrypted persistence | GPL-3.0 и Wire-specific integration; проект не имеет принятого compatible license decision. Не добавлять скрыто. |
| Matrix Rust/JS crypto | production WASM crypto state machine | реально эксплуатируется Element/Matrix | Olm/Megolm + Matrix event/server semantics, а не transport-neutral MLS для текущей backend модели. Не выбран. |

Мы не выбираем provider по stars, популярности или одному green demo. Для security
важны exact pinned source, license, supported target, KAT/interop, corrupt-state
behavior, storage deletion, dependency advisory response и review нашего binding.

## 4. Mapping к yv-chat

```text
yv-chat User
  └── one or more Device records
        └── one independent MLS client
              ├── signature key + credential
              ├── one-time KeyPackages
              └── per-conversation MLS group state

yv-chat Conversation
  └── one MLS group
        ├── direct: leaves of all active MLS-capable devices of both users
        └── group: leaves of all active MLS-capable devices of all active members

FastAPI/PostgreSQL
  ├── Authentication Service adapter: public device credential binding
  ├── Delivery Service: KeyPackage, Welcome and opaque MLS record routing
  └── authorization/sync/TTL metadata; no private/group keys or plaintext
```

Application membership остаётся user-level product policy. MLS membership —
device-level cryptographic truth. Изменение считается fully applied только когда:

1. server-side authorized membership/device operation записана;
2. authorized current MLS member создаёт Commit для exact expected device set;
3. Commit получает authoritative outer conversation sequence;
4. clients validate/merge Commit и переходят в один новый epoch;
5. UI показывает pending/error, пока reconciliation не завершён.

Server DB flag сам по себе не доказывает, что removed device потерял future keys.
MLS Commit сам по себе не даёт product authorization: server всё равно проверяет
session, role, conversation и device ownership.

### Conversation bootstrap и cutover

Для новой direct/group conversation initiating device становится первым leaf,
получает atomically consumed KeyPackage для каждого другого active MLS-capable
device expected members, создаёт один Add Commit и отдельные Welcome records. Direct
использует тот же flow с devices двух users; отдельного 1:1 crypto protocol нет.

Если хотя бы один required device не имеет valid compatible KeyPackage, bootstrap
остаётся `pending-crypto` и application send заблокирован. Частичная группа не
выдаётся за готовую. Optional stale/offline device eviction требует отдельной visible
policy, а не silent omission.

`MLS-capable device` здесь означает active device с уже зарегистрированной immutable
crypto identity. Legacy device, которое ни разу не запускало MLS-capable PWA, ещё не
является leaf и не блокирует весь conversation: после первого provisioning оно
попадает в exact expected device set следующего roster Commit. Уже enrolled device
никогда не исключается только из-за offline/stale состояния или отсутствующего
KeyPackage; такой required device оставляет generation blocked до replenishment либо
явного revoke.

При миграции existing synthetic conversation server фиксирует одну cutover sequence
и crypto generation под row lock. После accepted MLS bootstrap records с
`protocol_version=1` остаются только historical insecure rows с явной маркировкой;
они никогда не decrypt/re-encrypt задним числом и не получают E2EE badge. New sends
разрешены только v2. Два concurrent initiator не создают две silently competing MLS
groups: server выбирает одну generation/operation, а clients reject mismatched group
ID/generation.

Incoming Commit сначала staged. Client сопоставляет resulting leaf credential set с
authoritative synchronized user/device membership и expected pending operation.
Unauthorized Add/Remove, unknown device или stale membership отклоняются до merge.
Это необходимо даже при valid MLS signature: cryptographic group member не получает
автоматически product-level owner/admin права.

## 5. Authentication Service и device credentials

MVP Authentication Service связывает MLS BasicCredential identity с canonical bytes:

```text
credential_schema_version = 1
user_id                    = UUID (16 bytes)
device_id                  = UUID (16 bytes)
```

Signature key pair генерируется только на device. Public credential/signature key и
KeyPackages загружаются в authenticated per-device API; private key не покидает
crypto adapter/storage. Server проверяет, что session владеет active `device_id`,
credential identity exact и KeyPackage lifetime/ciphersuite/capabilities допустимы.
Clients проверяют то же binding перед Proposal/Commit merge, а не доверяют display
name из payload.

Implementation status после `WP-045`: browser consumer уже передаёт claimed bytes в
pinned OpenMLS WASM Worker и проверяет signature, MLS version/ciphersuite, canonical
credential, signature key, fingerprint, SHA-256 package ref и trailing bytes.
Authenticated current-device identity автоматически restore/provision/register-ится
с exact server comparison. Это закрывает только identity/KeyPackage gate: group,
Welcome, Commit, epoch storage и MLS application messages ещё не реализованы, поэтому
secure milestone и E2EE claim остаются запрещены.

Это server-backed AS, поэтому E2EE не скрывает malicious credential substitution
самим скомпрометированным AS. Обязательные MVP mitigations:

- immutable per-device fingerprint и first-seen/change security log;
- visible device add/remove events во всех общих conversations;
- OOB safety-number/QR verification для high-assurance contacts/groups;
- никакого silent credential replacement под тем же active device;
- credential reset создаёт новую device identity и заметный security change.

Key transparency является отдельным усилением до claims о защите от malicious AS.
Без неё разрешённая формулировка: content защищён от storage/Delivery Service и
network observers при честной identity binding; malicious AS может попытаться
подставить новый credential, что должно быть заметно, но не cryptographically
невозможно.

## 6. KeyPackage и Welcome lifecycle

- Device генерирует bounded pool one-time KeyPackages с short lifetime и выбранным
  exact version/ciphersuite/capability set.
- Server хранит только public KeyPackage bytes, owner device, creation/expiry и
  single-consumption state. Он не генерирует private init keys.
- Fetch/consume выполняется атомарно; consumed/expired/revoked package не выдаётся
  повторно. Device replenishes pool после sync/login foreground work.
- Stale/invalid/signature-mismatched KeyPackage отклоняется fail closed и создаёт
  bounded security telemetry без raw bytes.
- Welcome хранится в отдельной per-target-device opaque queue, потому что broadcast
  conversation timeline не является адресным enrollment channel.
- Welcome доступен только owning active device, idempotently acknowledged, TTL-bound
  и удаляется после ack/expiry. Он не попадает в push plaintext.
- Joiner принимает Welcome только если expected conversation/device credential set,
  group ID, version/ciphersuite и server enrollment operation совпадают.

Нельзя использовать один KeyPackage как бессрочный «public key пользователя» или
копировать private init/signature keys между devices.

## 7. Message framing и ordering

Existing server `protocol_version=1` остаётся synthetic non-secure codec. Secure MLS
records используют `protocol_version=2`; смешивать v1 и v2 в одной secure
conversation после cutover нельзя.

Для v2 поле server `ciphertext` содержит exact TLS-serialized MLS message. Server не
разбирает MLS wire bytes. Outer row по-прежнему даёт:

```text
conversation_id
client_message_id
sender_user_id / sender_device_id (routing claim, server-authorized)
monotonic server sequence
created_at / expires_at / tombstone state
```

Client устанавливает MLS Additional Authenticated Data по deterministic fixed layout:

```text
ASCII "yv-chat-mls-v2" || 0x00
conversation UUID (16 network-order bytes)
client_message UUID (16 network-order bytes)
```

После decrypt adapter обязан constant-shape разобрать и exact сравнить AAD с outer
routing. Несовпадение — corruption/security error; content не отображается. Это
application binding, не новая cryptographic primitive.

MLS application plaintext — strict versioned UTF-8 JSON DTO внутри PrivateMessage:

```json
{"schema_version":1,"type":"text","body":"..."}
```

JSON не подписывается отдельно и не используется для key derivation. Parser имеет
closed union, limits и отвергает unknown required versions. Attachments и deletion
commands получают новые typed variants, а не unstructured dictionaries. Plaintext
DTO существует только в adapter/application memory.

Proposal/Commit records идут через тот же authoritative sequence stream, чтобы все
clients наблюдали одинаковый epoch order. Welcome остаётся per-device. WebSocket/push
будят sync и никогда не являются единственным delivery path.

## 8. Multi-device enrollment

Каждый новый device:

1. проходит обычную account authentication и создаёт отдельную server Device/session;
2. локально создаёт MLS signature identity и KeyPackages;
3. публикует только public credential/KeyPackages;
4. требует explicit approval существующего active device для добавления во все
   conversations, где пользователь уже состоит;
5. добавляется отдельным leaf через MLS Commit и получает отдельный Welcome;
6. не получает pre-join messages из MLS автоматически.

Если у пользователя нет доступного старого device, account/admin recovery может
создать новый authentication session, но не может восстановить прежние group keys.
Это identity reset: contacts получают visible credential change, новый device видит
только server retention после нового epoch, а более старая история потеряна без
заранее выполненного secure transfer/backup design.

Нельзя «для удобства» экспортировать одну общую MLS state blob всем devices. RFC 9750
предупреждает, что shared client state создаёт synchronization и compromise takeover
риски. `BL-015` проектирует отдельный authenticated encrypted history transfer и не
делает новый device участником прошлых epochs.

## 9. Membership, revocation и PCS

- Add user означает Add всех его current active MLS-capable devices одним reviewed
  membership operation; partial add показывается как incomplete, не success.
- New device пользователя добавляется в каждую conversation отдельным Commit.
- Device revoke и member removal немедленно запрещают server access, затем требуют
  Remove Commit для exact leaf/leaves. Future application send блокируется, пока
  local group не reconcile-ит pending security transition.
- Commit меняет epoch; removed leaves не получают new epoch secrets. Уже полученный
  plaintext/keys уничтожить удалённо нельзя.
- Active clients выполняют periodic/usage-triggered Update Commit для PCS; exact
  cadence определяется `BL-014` и тестируется. Persistently offline clients могут
  ослаблять FS/PCS и после bounded policy удаляются/re-enroll.
- Forked/conflicting Commit не выбирается component/UI вручную. Adapter применяет
  upstream validation/fork policy, останавливает send и запускает authoritative
  resync/recovery. Server не decrypt-ит и не «чинит» group state.

Application roles owner/admin остаются server policy. Для secure delete-for-everyone
clients в `BL-014` должны принимать encrypted authenticated deletion command; внешний
server tombstone — storage/sync hint, а не доказательство автора crypto command.

## 10. Threat model

### Assets

- message/attachment plaintext;
- device signature/private init keys;
- MLS group/epoch/ratchet secrets;
- device-local wrapping key и encrypted archive;
- membership/device identity integrity;
- message authenticity/order and protocol state availability.

### Adversaries и результат

| Adversary | MLS должен защитить | Не защищает / реакция |
|---|---|---|
| Passive network observer | content/authenticated payload при HTTPS+MLS | IP, timing, sizes, domain; padding/privacy network — future |
| Compromised DB/backup/Delivery Service | plaintext/private keys; acceptable message forgery | membership/routing/timing metadata; drop/delay/replay/DoS обнаруживается/переживается sync, но не предотвращается полностью |
| Compromised Authentication Service | ограниченно после OOB verification/observability | может подставить credential/new device без key transparency; visible reset + safety verification required |
| Compromised browser origin/XSS/dependency | ничего после arbitrary same-origin code execution | attacker может вызвать adapter/read plaintext/exfiltrate state; CSP, Trusted Types, no third-party script, immutable build и dependency review обязательны |
| Compromised physical device/profile | другие groups/epochs после revoke+updates | plaintext/current state этого device и cached old keys; revoke, Remove/Update, local lock/OS controls |
| Malicious group member | outsider forgery/read prevention | member видит разрешённый content, может copy/screenshot/replay within RFC limits; app dedup/client IDs mitigate replay |
| Push provider | content/key confidentiality | endpoint and traffic metadata; payload только opaque hint |
| Supply-chain attacker | reproducible pinned build/review reduces risk | compromised signed dependency/build can own client; emergency dependency revoke/update required |

### Explicit non-goals

- anonymity или сокрытие conversation graph от server;
- защита plaintext на already compromised endpoint;
- remote erasure у recipient;
- deniability/non-repudiation claims;
- гарантированный secure erase browser/SSD/backup internals;
- history recovery после потери всех authorized devices;
- защита от total Delivery Service denial of service.

## 11. Browser persistence и plaintext lifecycle

Crypto adapter живёт в dedicated Web Worker/WASM boundary, насколько позволяет
provider. Vue components не импортируют WASM bindings и не получают raw private state.
Worker уменьшает accidental UI exposure, но не является security boundary против
same-origin malicious script.

Storage layers:

```text
non-extractable WebCrypto wrapping CryptoKey → IndexedDB CryptoKey record
wrapped/encrypted OpenMLS StorageProvider values → versioned IndexedDB stores
encrypted local archive/index → separate versioned stores
large encrypted media → OPFS where available
```

`localStorage` запрещён для keys, MLS state, decrypted content и credentials.
Non-extractable key снижает риск raw-at-rest export, но XSS всё ещё может попросить
browser выполнить decrypt. Sensitive buffers очищаются best-effort после operation;
JS garbage collector/browser snapshots не дают доказуемого zeroization.

Storage transaction должна атомарно сохранять resulting group state с processed
outer cursor. Crash между decrypt/merge/persist восстанавливается replay-safe sync,
но adapter никогда не откатывает MLS state молча. Каждый state blob имеет schema,
provider version и monotonic local revision; rollback/corruption переводит
conversation в blocked-recovery UX, а не в v1 plaintext fallback.

OpenMLS deletion schedule должен доходить до real `StorageProvider.delete_*`.
IndexedDB/service-worker upgrades не копируют deleted secrets в legacy stores.
Browser eviction означает потерю local cryptographic identity; это visible device
reset/re-enrollment, не автоматическая regeneration под тем же credential.

## 12. Metadata, logs и telemetry

Server по необходимости видит:

- account/device/conversation membership;
- sender account/device routing identity;
- message/key-package/welcome sizes, timestamps, sequence, TTL;
- IP/session/device metadata согласно session policy;
- delivery/read/online/typing metadata;
- push subscription/routing hints.

Server не получает application plaintext, attachment keys, MLS private keys, group
secrets, decrypted filenames/previews или device-local archive key.

Logs/metrics могут содержать only opaque bounded IDs/counts/error classes. Запрещены:

```text
MLS wire bytes / KeyPackage / Welcome dumps
credential private/signature/init keys
group/epoch/exporter/application secrets
decrypted payloads or attachments
wrapping keys and IndexedDB state blobs
```

Upstream features, эквивалентные OpenMLS `content-debug` и `crypto-debug`, запрещены
в production dependency feature graph. Browser source maps production release не
должны встраивать secret runtime state; обычный source code не является secret.

## 13. Failure и recovery UX

Closed error taxonomy минимум различает:

```text
crypto-not-initialized
identity-missing / identity-changed
unsupported-protocol / unsupported-ciphersuite
invalid-credential / invalid-signature
stale-or-used-key-package / invalid-welcome
epoch-gap / forked-commit / replay
corrupt-or-rolled-back-local-state
storage-unavailable / storage-evicted
member-or-device-revoked
```

Ни одна ошибка не показывает raw crypto details и не декодирует bytes synthetic
codec. UI может retry sync, request missing records, re-enroll device или явно reset
local identity с предупреждением о потере history. Автоматический destructive reset
после generic parse error запрещён.

## 14. Implementation release gates

Secure milestone требует одновременно:

1. Exact OpenMLS/core/provider versions pinned в Rust lockfile; no git-floating deps.
2. License review всех crates/bindings и versioned SBOM/dependency audit в CI.
3. WASM build из repository source в CI; no opaque CDN/runtime-loaded script/WASM.
4. Upstream RFC 9420 known-answer vectors и cross-implementation interop fixture.
5. Browser tests минимум Chromium + Firefox; Safari/iOS manual acceptance либо честно
   documented unsupported gate.
6. Multi-device group create/add/remove/update, offline catch-up, out-of-order,
   duplicate, stale Welcome/KeyPackage and concurrent Commit tests.
7. Corrupt/rollback/evicted IndexedDB fail-closed tests and crash transaction tests.
8. Test that private/group keys, plaintext and raw MLS bytes never cross server API,
   logs, Vue state snapshots or analytics.
9. Production feature-graph check forbids debug crypto/content features.
10. CSP/Trusted Types/no-third-party-script review and self-hosted immutable assets.
11. Independent review of the small Rust↔TypeScript binding and this application
    framing/state machine before security claim.
12. Synthetic protocol v1 send/decode disabled for secure conversations and no silent
    downgrade path.

Until all gates pass, UI must display **«тестовый транспорт, не E2EE»** and release
notes must not call the messenger secure/end-to-end encrypted.

## 15. Consequences

Положительные:

- один standard protocol для 1:1/groups/multi-device;
- FS/PCS и membership epochs не изобретаются project code;
- server remains opaque delivery/sync authority within TTL;
- provider изолирован port/adapter boundary и может быть заменён через новый ADR.

Costs/limitations:

- нужен Rust/WASM toolchain, storage adapter и существенно больше browser tests;
- user-level membership ↔ device leaves требует reconciliation;
- malicious AS остаётся сильной угрозой до key transparency/OOB verification;
- PWA не даёт hardware-backed secure enclave/guaranteed secure deletion;
- history transfer и attachments требуют отдельных протокольно проверяемых slices.

## 16. Обязательные follow-up slices

- `BL-013`: minimal OpenMLS browser spike, intent-level adapter, device identity,
  encrypted/versioned IndexedDB provider, KAT and corruption tests.
- `BL-014`: backend public credential/KeyPackage/Welcome ports, MLS group lifecycle,
  membership/device reconciliation, v2 records and synthetic-v1 removal.
- `BL-015`: explicit authenticated device-to-device archive transfer.
- `BL-022`: encrypted local archive and crash-safe cursor/state transaction.
- security backlog: safety-number UX first, key transparency before strong malicious-AS
  claim, CSP/Trusted Types/supply-chain hardening before production secure milestone.

Изменение protocol, ciphersuite, credential identity, AAD layout, app framing,
storage deletion semantics, device sharing model или recovery требует нового ADR,
migration/compatibility design и security review.
