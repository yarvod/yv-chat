# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-034 — Isolated OpenMLS Worker runtime и reproducible browser package

Статус: **completed**
Backlog item: `BL-013` (browser crypto runtime slice)
Цель: собрать pinned Rust/WASM provider в проверяемый same-origin browser package и
дать frontend изолированный Worker runtime, который единолично владеет
`DeviceBootstrap`, WebCrypto key и IndexedDB vault. Application/UI видят только
public device anchors и typed intent results; runtime пока не включается автоматически
до появления server-side immutable device-identity registry.

### Security invariants

1. Generated JS/WASM строятся только из exact Rust/lockfile/wasm-bindgen versions;
   CI повторно генерирует package и проверяет отсутствие drift/private exports.
2. Worker загружает module только из фиксированного same-origin path. URL не приходит
   из message/input; dynamic remote code отсутствует.
3. `DeviceBootstrap`, `CryptoKey`, IV/ciphertext и vault records никогда не выходят
   из Worker. Main thread получает только credential identity, signature public key,
   KeyPackage, fingerprint и revision.
4. Worker protocol — closed discriminated union с request ID, strict runtime parsing,
   bounded public outputs и sanitized error codes без raw exception/private bytes.
5. Initialize сначала загружает vault. `missing` разрешает candidate bootstrap только
   как explicit provisioning operation; `corrupt/partial` fail closed без regeneration.
6. После atomic bootstrap runtime всегда восстанавливает committed record, поэтому
   concurrent tab winner не может расходиться с in-memory identity.
7. Checkpoint использует ровно следующий revision; conflict/rollback не retry/reset
   silently. Runtime освобождает replaced/terminated WASM objects.
8. Auth lifecycle пока не вызывает provisioning: без backend identity comparison
   невозможно безопасно отличить первый запуск от потерянного local state.
9. Synthetic protocol v1 остаётся единственным outgoing path и явно не E2EE.

### План

- [x] Repository-owned reproducible browser package и drift/private-export gates.
- [x] Typed Worker request/response DTOs, exact validators и bounded error mapping.
- [x] Device crypto runtime с explicit provision/restore/checkpoint/dispose lifecycle.
- [x] Dedicated module Worker transport и main-thread client с timeout/disposal.
- [x] Tests для provisioning, reload restore, concurrent winner, corrupt/rollback,
  protocol validation, sanitized failures и resource disposal.
- [x] Frontend/Docker/CI build integration без сборки на production VPS.
- [x] Architecture/backlog/README sync и physical Chromium acceptance.
- [x] Repository quality gates; full CI выполняется перед commit.

### Не входит в этот slice

- automatic provisioning при login;
- backend device identity/KeyPackage registry;
- MLS group lifecycle, message v2 или attachment encryption;
- production E2EE claim;
- recovery после утраты всех device-local keys.

### Definition of Done

- production frontend image содержит reproducibly generated same-origin WASM package;
- Worker/vault lifecycle восстанавливает exact identity и fail closed на corruption;
- main thread не получает private crypto/storage material;
- tests и generated API/drift gates фиксируют boundary;
- текущий insecure transport не меняется и ограничения явно документированы.

### Проверка

- release OpenMLS WASM + WebCrypto + fake IndexedDB: explicit provision, exact reload
  restore, concurrent writer convergence, wrong AAD и modified ciphertext fail closed;
- Worker protocol/client: exact schema, bounded public DTO, sanitized error, correlation,
  timeout и dispose;
- physical Chromium production smoke: Worker → `/crypto/v1` JS/WASM → IndexedDB,
  fingerprint сохраняется после Worker restart, revision `1 → 2`;
- Nuxt build выдаёт hashed Worker chunk, versioned WASM и Workbox precache entries;
- frontend lint/typecheck/Vitest/build и полный `make ci` перед commit.

Автоматический auth lifecycle намеренно не вызывает `provision`: следующий backend
slice должен дать immutable server identity registry, иначе потерю local state нельзя
безопасно отличить от первого запуска.
