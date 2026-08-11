# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-033 — WebCrypto sealing и atomic IndexedDB crypto vault

Статус: **completed**
Backlog item: `BL-013` (encrypted browser persistence slice)
Цель: разрешить persistent device crypto state только как AES-256-GCM sealed
ciphertext: private OpenMLS snapshot шифруется/расшифровывается внутри Rust/WASM
через non-extractable WebCrypto `CryptoKey`, а IndexedDB adapter атомарно хранит key,
sealed record и monotonic revision без доступа Vue/application к private bytes.

### Security invariants

1. Wrapping key создаётся `AES-GCM 256`, `extractable=false`, usages только
   `encrypt/decrypt`; JWK/raw export отсутствует.
2. Private snapshot не возвращается из WASM. WebCrypto Promise получает его из WASM
   memory, после operation buffer очищается best-effort.
3. Уникальный 96-bit IV генерируется CSPRNG для каждого seal; reuse запрещён.
4. AAD exact связывает format label, canonical user UUID, device UUID и revision.
5. Sealed envelope имеет schema/revision/IV/ciphertext limits; modified IV/AAD/tag,
   wrong device/revision/key fail closed без auto-reset/fallback.
6. IndexedDB содержит один non-extractable key record и один sealed state record на
   device. Key+state bootstrap пишутся одной transaction.
7. Existing identity при missing/corrupt key/state не regenerates silently. Adapter
   возвращает typed `missing/corrupt/rollback/storage-unavailable` state.
8. Revision может только увеличиваться; stale/equal overwrite запрещён, restore
   сравнивает outer record и authenticated inner snapshot revision.
9. Vue и message application services не получают `CryptoKey`, nonce, ciphertext
   или vault internals; этот slice ещё не включает production MLS messaging.
10. Synthetic v1 остаётся outgoing и имеет insecure warning.

### План

- [x] Rust/WASM async seal/restore API на `SubtleCrypto` с bounded errors/AAD.
- [x] Opaque `SealedSnapshot` WASM result: revision, IV, ciphertext, fingerprint.
- [x] Native tests для AAD/envelope validation и locked release WASM compile.
- [x] Typed internal frontend crypto-vault DTO/error taxonomy; это infrastructure
  dependency будущего Worker, не application port, чтобы не утечь `CryptoKey`.
- [x] IndexedDB adapter с versioned schema, non-extractable key generation и atomic
  bootstrap/monotonic update.
- [x] Vitest fake IndexedDB/WebCrypto tests: non-extractable key, round-trip record,
  rollback, partial/missing/corrupt state и isolation by device.
- [x] WASM build/glue packaging contract; private snapshot export static gate.
- [x] Architecture/backlog/bugs/workplan sync и repository quality gates.

### Не входит в этот slice

- backend credential/KeyPackage API;
- MLS group lifecycle и message v2;
- service worker migration across a real deployed old schema;
- Firefox/Safari physical browser acceptance;
- production E2EE claim.

### Definition of Done

- only authenticated ciphertext may leave Rust private-state boundary;
- browser key is non-extractable and state writes are atomic/monotonic;
- wrong key/device/revision/corruption fail closed without identity replacement;
- native/WASM/frontend/full repository checks pass;
- limitations and remaining release gates are explicit.

### Проверка

- `cargo fmt --check`;
- native и `wasm32-unknown-unknown` `cargo clippy ... -D warnings`;
- `cargo test --locked`: 13 passed;
- release WASM + pinned `wasm-bindgen 0.2.127`, generated `.d.ts` API gate;
- frontend lint/typecheck и Vitest: 42 passed;
- полный `make ci` выполняется перед commit.

Physical browser WASM execution не заявляется проверенным в этом slice: Worker
integration и Chromium/Firefox/Safari seal/restore/tamper acceptance остаются явным
следующим release gate. Поэтому текущий message protocol по-прежнему synthetic v1 и
не E2EE.
