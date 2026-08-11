# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-029 — E2EE protocol ADR и threat model

Статус: **completed**
Backlog item: `BL-012`
Цель: до любого production crypto-кода зафиксировать зрелый стандарт, trust
boundaries, multi-device lifecycle и проверяемые release gates, не выдавая
экспериментальный browser binding или synthetic codec за защищённый messenger.

### Security questions, на которые slice обязан ответить

1. Какой стандартизованный protocol защищает direct и group conversations и какие
   FS/PCS/authentication свойства он действительно даёт?
2. Что является MLS user, client/device, group, Authentication Service и Delivery
   Service в текущей архитектуре yv-chat?
3. Какие metadata остаются видимыми server/host Nginx/push provider и чего E2EE не
   скрывает?
4. Как устройство создаёт и хранит identity/signature/group secrets; какие browser
   compromise и storage-eviction риски остаются?
5. Как добавляются второе устройство и новые conversation members, как удаление
   device/member меняет epoch и когда выполняется self-update для PCS?
6. Что происходит при потере одного/all devices, server compromise, credential
   substitution, stale KeyPackage, dropped/reordered/forked Commit и rollback local DB?
7. Как versioned application framing, MLS message types, Welcome/key-package queues
   соотносятся с существующими opaque message sequence/sync/TTL endpoints?
8. Какой browser/WASM implementation реально допустим, какие candidates отвергнуты
   или требуют spike, license/security review и interop/known-answer tests?
9. Какие claims запрещено показывать в UI/release notes до завершения `BL-013/014`?

### Invariants

1. Выбирается IETF protocol; primitives, ratchet, KDF, HPKE, signature и group key
   schedule не реализуются вручную.
2. Каждый physical/browser device — отдельный cryptographic client. User/account и
   device identity не объединяются.
3. Server хранит только public credentials/key packages, opaque MLS records,
   per-device Welcome records и routing metadata; client private keys/group state
   никогда не отправляются server-side.
4. Existing HTTPS, opaque session, server authorization, sequence/sync/idempotency и
   TTL остаются обязательны: E2EE не заменяет access control или transport security.
5. Membership/device removal считается завершённым cryptographically только после
   принятого MLS Commit/new epoch, а не после одной server DB mutation.
6. Новый device не получает pre-join history от MLS. История переносится только
   отдельным будущим authenticated device-to-device flow.
7. Password/admin reset не восстанавливает E2EE keys. Потеря всех devices означает
   identity reset и потерю недоступной server history, что UI сообщает явно.
8. Browser code/XSS/compromised device, malicious recipients/screenshots и traffic
   metadata не объявляются решёнными E2EE.
9. Provider должен fail closed на corruption, unknown version/credential, invalid
   signature/Commit/Welcome и rollback; plaintext fallback запрещён.
10. Debug features/logs не могут выводить content или crypto material; production
    build обязан запрещать upstream `content-debug`/`crypto-debug` аналоги.

### План

- [x] Сверить RFC 9420/9750 и official implementation/storage/WASM documentation.
- [x] Составить decision matrix OpenMLS, mls-rs, Wire CoreCrypto и Matrix crypto.
- [x] Принять protocol/ciphersuite/application framing и явно отделить provider gate.
- [x] Описать assets, adversaries, guarantees, non-goals и metadata leakage.
- [x] Спроектировать device credential/KeyPackage/Welcome/group epoch lifecycle.
- [x] Спроектировать membership/revocation/recovery/version migration/failure UX.
- [x] Зафиксировать browser persistence, key deletion, rollback и supply-chain gates.
- [x] Обновить architecture/backlog; bugs не найдено; добавить repository docs checks.
- [x] Проверить links/format/diff/secrets, commit и push отдельным slice.

### Не входит в этот slice

- добавление crypto dependency или генерация реальных keys;
- изменение production wire protocol/database schema;
- объявление текущего synthetic protocol v1 защищённым;
- реализация IndexedDB crypto store, KeyPackage API, MLS Commit или history transfer;
- самостоятельный security audit upstream implementation.

### Definition of Done

- accepted ADR содержит одно однозначное protocol decision и честный provider status;
- threat model перечисляет server/AS/DS/client/recipient/supply-chain threats;
- multi-device/membership/recovery flows имеют state transitions и failure policy;
- mapping к existing backend/frontend boundaries не требует server plaintext;
- security/release gates проверяемы и попадают в backlog следующих slices;
- все источники — primary RFC/official project documentation с датой review.

### Verification record

- primary-source review: RFC 9420, RFC 9750, OpenMLS book/repository/WASM/persistence,
  mls-rs, Wire CoreCrypto, Matrix crypto и W3C WebCrypto/IndexedDB/CSP/Trusted Types;
- `make docs-check`: passed; один current WP, accepted/release-gated ADR и RFC links
  проверяются repository command;
- full `make ci`: backend Ruff/import contracts/mypy/pytest (`172 passed, 6 skipped`),
  frontend ESLint/typecheck/Vitest (`34 passed`)/production build, Compose/deploy и
  docs checks passed;
- `git diff --check` и added-content secret scan: passed перед commit;
- code/runtime/dependencies/schema намеренно не менялись в этом design gate.
