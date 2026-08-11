# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-031 — Pinned OpenMLS provider и device bootstrap proof

Статус: **completed**
Backlog item: `BL-013` (provider/device-bootstrap slice)
Цель: добавить минимальный repository-owned Rust core, который с pinned stable
OpenMLS создаёт canonical MLS device identity и one-time KeyPackage, компилируется
native и в `wasm32-unknown-unknown`, но ещё не подключается к production messages и
не объявляется production-ready E2EE.

### Проверенный upstream baseline

- OpenMLS stable `0.8.1`, release tag `openmls-v0.8.1`, commit
  `47dbedecad0c1fd8eb5368d582250ebfcc1e1ce6`;
- `openmls_rust_crypto = 0.5.1`, `openmls_traits = 0.5.0`,
  `openmls_basic_credential = 0.5.0`;
- prerelease `0.9.0-rc.2` намеренно не выбран;
- ciphersuite только
  `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`;
- `crypto-debug`, `content-debug`, test-utils и upstream experimental binding не
  входят в production dependency features.

### Security invariants

1. BasicCredential identity — fixed schema bytes: version `1` + canonical user UUID
   + canonical device UUID; display name/username не участвуют.
2. Private signature/init keys никогда не возвращаются через Rust public DTO,
   JavaScript binding, logs или test snapshots.
3. Public bootstrap result содержит только bounded credential identity, signature
   public key, TLS-serialized KeyPackage и non-secret fingerprint.
4. KeyPackage использует ровно MLS 1.0 и выбранный MTI ciphersuite; другой suite или
   malformed UUID отклоняется.
5. Каждый bootstrap создаёт новый independent device keypair/KeyPackage; private
   material не копируется между devices.
6. Provider state в этом proof остаётся memory-only и поэтому не используется
   production frontend. Persistence/worker binding — следующий отдельный slice.
7. Все dependencies exact-pinned в Cargo manifest+lock; no floating git dependency.
8. Native tests и `wasm32-unknown-unknown` compile обязательны. Browser/WASM runtime,
   encrypted IndexedDB и server upload остаются release gates, не симулируются.
9. Synthetic protocol v1 остаётся outgoing и с постоянным insecure warning.

### План

- [x] Добавить scoped Rust workspace/crate и pinned `rust-toolchain.toml`.
- [x] Реализовать typed identity encoder без unstructured JSON/string identity.
- [x] Реализовать OpenMLS provider bootstrap и safe public result/error taxonomy.
- [x] TLS-serialize и validate generated KeyPackage; вычислить public fingerprint.
- [x] Native tests: deterministic identity layout, distinct devices, exact suite,
  valid signature/KeyPackage, malformed UUID/identity rejection.
- [x] Minimal WASM export без private-state serialization и raw internal errors.
- [x] Проверить native lint/test, release WASM compilation и forbidden feature graph.
- [x] Добавить CI/Makefile gates без увеличения production VPS runtime footprint.
- [x] Architecture/backlog/bugs/workplan sync и full repository CI.

### Не входит в этот slice

- encrypted IndexedDB `StorageProvider` и Web Worker lifecycle;
- загрузка public credentials/KeyPackages на backend;
- MLS group create/add/remove/Commit/Welcome;
- application message encrypt/decrypt и переключение outgoing protocol на v2;
- claim, что текущий messenger уже E2EE.

### Definition of Done

- repository воспроизводимо строит и тестирует exact OpenMLS core;
- public API не может экспортировать private/provider state;
- canonical device credential и KeyPackage проверены OpenMLS validation;
- forbidden debug feature gate и dependency pins проверяются CI;
- `wasm32-unknown-unknown` release compile зелёный;
- docs честно отделяют provider proof от secure messenger milestone.

### Реализовано

- Добавлены exact-pinned Rust workspace/lock/toolchain и repository-owned
  `yv-chat-openmls-provider`; upstream experimental binding не импортирован.
- `DeviceBootstrap` владеет memory provider, Ed25519 signer и private KeyPackage
  bundle как opaque non-serializable value. Наружу доступны только public credential
  bytes, signature public key, validated TLS KeyPackage и bounded fingerprint.
- Canonical BasicCredential layout фиксирует schema/user/device binding. KeyPackage
  создаётся только с MLS 1.0 MTI AES-128-GCM suite и повторно разбирается/проверяется
  OpenMLS; trailing/corrupt bytes fail closed.
- `wasm_bindgen` surface возвращает те же public values и bounded typed error text;
  provider/private key getters отсутствуют. Runtime остаётся memory-only и не
  подключён к outgoing message path.
- Makefile и отдельный CI job проверяют format, Clippy `-D warnings`, native tests,
  locked release WASM compilation и отсутствие sensitive OpenMLS debug features.

### Проверено

- `rtk env CARGO_HOME=/tmp/yv-chat-cargo RUSTUP_HOME=/tmp/yv-chat-rustup make
  crypto-check CARGO=/tmp/yv-chat-cargo/bin/cargo`: 5 Rust tests, Clippy/format,
  release `wasm32-unknown-unknown`, forbidden feature graph — passed; WASM artifact
  `1.1M` до wasm-bindgen glue/size optimization следующего slice.
- `rtk env CARGO_HOME=/tmp/yv-chat-cargo RUSTUP_HOME=/tmp/yv-chat-rustup
  UV_CACHE_DIR=/tmp/yv-chat-uv-cache make ci CARGO=/tmp/yv-chat-cargo/bin/cargo`:
  backend Ruff/format/import-linter/mypy, `172 passed, 6 skipped`; frontend
  ESLint/Nuxt typecheck, `37 passed`, production PWA build; crypto gates,
  dev/default/prod Compose, deploy scripts и documentation contracts.
- Шесть backend PostgreSQL integration/concurrency tests локально skipped из-за
  недоступного container runtime; новый crypto slice базы данных не меняет, а эти
  тесты остаются обязательным GitHub CI/release gate.
