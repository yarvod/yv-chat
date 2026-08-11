# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-032 — Versioned restorable OpenMLS state snapshot core

Статус: **completed**
Backlog item: `BL-013` (encrypted-persistence prerequisite)
Цель: сделать private OpenMLS provider state воспроизводимо snapshot/restore внутри
Rust crate, с version/bounds/identity consistency/fail-closed parsing, не экспортируя
plaintext snapshot через WASM/TypeScript API. Следующий slice будет sealing через
non-extractable WebCrypto key и atomic IndexedDB.

### Security invariants

1. Snapshot содержит private MLS material и поэтому не является public DTO/API.
   Ни один `wasm_bindgen` getter не возвращает snapshot bytes.
2. Формат имеет magic, schema/provider revision, exact lengths/counts и общий size
   limit; trailing/truncated/oversized/duplicate records отвергаются.
3. Map сериализуется deterministic sorted order; HashMap iteration не влияет на
   bytes/test fixtures.
4. Restore создаёт новый provider, затем находит signer только в restored OpenMLS
   storage по expected public key; отсутствие/подмена private signer fail closed.
5. Public identity/signature/KeyPackage/fingerprint после restore должны exact
   совпасть и KeyPackage повторно проходит OpenMLS validation.
6. Snapshot revision монотонный и включён в envelope для будущей rollback policy;
   revision `0` и unsupported schema/provider version запрещены.
7. Plain snapshot не пишется на disk/IndexedDB, не логируется и не попадает в test
   output. В этом slice он существует только как short-lived Rust memory buffer.
8. Corruption checks этого формата не заменяют AEAD authenticity. Production
   persistence запрещён до следующего encrypted sealing/atomic storage slice.
9. Synthetic message protocol/outgoing/deployment не меняются.

### План

- [x] Добавить cohesive internal snapshot module и bounded typed errors.
- [x] Deterministic encode provider storage + public restore anchors.
- [x] Strict parser с overflow/duplicate/trailing/unsupported-version checks.
- [x] Restore provider/signer/credential и повторная KeyPackage validation.
- [x] Tests: exact round-trip, stable re-encode, truncation/trailing/corruption,
  wrong identity/public key, missing signer и bounds.
- [x] Подтвердить отсутствие snapshot export в WASM surface.
- [x] Native Clippy/tests + locked release WASM compilation + full repository CI.
- [x] Architecture/backlog/bugs/workplan sync.

### Не входит в этот slice

- AES-GCM/WebCrypto wrapping key;
- IndexedDB schema/transactions/rollback ledger;
- Worker/glue/browser runtime и service-worker migration;
- backend credential/KeyPackage endpoints;
- MLS groups/messages или E2EE claim.

### Definition of Done

- bootstrap → snapshot → restore сохраняет public identity и usable private signer;
- format deterministic/bounded/versioned и fail closed на negative corpus;
- private snapshot не пересекает JS binding;
- native/WASM/full repository gates зелёные;
- docs явно говорят, что unsealed snapshot ещё нельзя сохранять production client.

### Реализовано

- Cohesive private `snapshot` module кодирует provider storage в deterministic
  sorted binary envelope с format/provider version, non-zero revision и строгими
  per-field/entry/total limits.
- Restore exact-сверяет expected user/device credential, public signature key и
  TLS KeyPackage, восстанавливает memory provider, извлекает signer и private
  KeyPackage bundle из его storage и повторно запускает OpenMLS validation.
- Snapshot methods имеют только crate visibility, не помечены `wasm_bindgen` и не
  доступны TypeScript/application UI. Документация запрещает persisting unsealed
  bytes до authenticated WebCrypto sealing.
- 6 новых tests (11 Rust total) покрывают deterministic round-trip и подпись после
  restore, wrong identity/public key, zero/unsupported revision, missing signer,
  truncation/trailing, duplicate records и oversized field.

### Проверено

- Rust `cargo fmt`, Clippy `--all-targets --locked -- -D warnings`, `11 passed`.
- Locked `wasm32-unknown-unknown --release` compilation passed; production feature
  graph по-прежнему содержит только OpenMLS `js`, без `crypto-debug`,
  `content-debug` или `test-utils`.
- Полный `make ci`: backend Ruff/format/import-linter/mypy, `172 passed, 6 skipped`;
  frontend ESLint/Nuxt typecheck, `37 passed`, production PWA build; Rust 11 tests,
  Clippy/format/release WASM/feature graph; Compose/deploy/docs contracts — passed.
  PostgreSQL-only skips остаются отдельным GitHub release gate и этим Rust-only
  slice не изменяются.
