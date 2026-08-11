# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-030 — Async crypto boundary и fail-closed protocol dispatch

Статус: **completed**
Backlog item: `BL-013` (foundation slice)
Цель: подготовить frontend к async Rust/WASM crypto, убрать encode/decode из Vue UI
и гарантировать, что MLS v2/unknown/corrupt envelope никогда не декодируется
synthetic v1 adapter как plaintext fallback.

### Invariants

1. Vue components получают только presentation-ready content и protection metadata;
   они не импортируют codec/WebCrypto/WASM/IndexedDB adapters.
2. Application service маршрутизирует строго по `protocol_version`; каждый adapter
   объявляет ровно одну version, duplicates запрещены.
3. Текущий outgoing protocol остаётся explicit v1 synthetic и сохраняет постоянное
   предупреждение. Он не переименовывается в secure.
4. Зарезервированный MLS v2 adapter fail closed как unavailable до реального
   OpenMLS implementation; он не вызывает v1 decoder и не возвращает ciphertext.
5. Unknown version, malformed base64/UTF-8 и unavailable provider дают bounded safe
   placeholder per message, не raw error/bytes и не глобальный crash timeline.
6. Send передаёт выбранный `protocol_version` из application result в gateway;
   infrastructure больше не hard-code-ит `1` скрыто.
7. Decrypted plaintext существует только в reactive in-memory timeline view, не в
   domain opaque DTO, transport parser, logs или persistence.
8. Tombstone никогда не передаётся в decrypt adapter.
9. API/backend/schema/deployment и cryptographic dependencies в этом slice не
   меняются.

### План

- [x] Typed `MessageProtocolAdapter` port, protection commands/results/errors.
- [x] `ProtocolMessageProtection` exact-version router с async API.
- [x] Synthetic v1 adapter и explicit unavailable MLS v2 adapter.
- [x] Protocol-aware gateway send contract без hidden version constant.
- [x] Presentation timeline model + async application decode before Vue render.
- [x] Удалить `MessageCodec` prop/import и direct decode из `MessagePanel.vue`.
- [x] Unit/composable/component tests для happy path, corrupt/unknown/v2 fail closed.
- [x] Architecture/backlog/bugs/workplan sync и full CI.

### Не входит в этот slice

- OpenMLS dependency/Rust toolchain/WASM binary;
- real device key generation или IndexedDB crypto state;
- backend KeyPackage/Welcome/credential endpoints;
- MLS group bootstrap/Commit processing;
- переключение production conversations на protocol v2.

### Definition of Done

- UI не имеет доступа к concrete protocol adapter;
- all crypto operations application-facing и async;
- v2/unknown/corrupt input никогда не проходит synthetic decoder;
- gateway получает explicit version из protection result;
- synthetic warning и per-message unavailable UX проверены Vitest;
- lint/typecheck/tests/build и repository CI зелёные.

### Реализовано

- Application-facing `ProtocolMessageProtection` маршрутизирует async operations
  только в adapter с точной версией; invalid/duplicate registration отклоняется при
  composition.
- Synthetic v1 остаётся явно insecure, reserved MLS v2 возвращает typed
  `provider-unavailable`; unknown version и повреждённые canonical base64/UTF-8
  envelopes не имеют fallback.
- Gateway принимает version из protection result. `TimelineMessage` отделяет opaque
  transport от transient decrypted view и даёт Vue только bounded presentation
  state; tombstones обходят decrypt.
- `MessagePanel` не импортирует codec и не получает ciphertext decoder. Safe
  unavailable UX не показывает raw envelope или внутреннюю ошибку.

### Проверено

- `rtk env UV_CACHE_DIR=/tmp/yv-chat-uv-cache make ci`:
  backend Ruff/format/import-linter/mypy, `172 passed, 6 skipped`; frontend
  ESLint/Nuxt typecheck, `37 passed`, production PWA build; dev/default/prod Compose,
  deploy scripts и documentation contracts.
- Skipped backend tests — PostgreSQL integration/concurrency suite без доступного
  локального container runtime; это остаётся обязательным CI/release gate и данным
  frontend-only slice не изменялось.
