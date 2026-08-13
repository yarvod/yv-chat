# Текущий workplan

## WP-082 — Unified QR pairing and existing-device history union

Статус: **completed locally; production rollout pending** (`BL-015`, `BUG-076`,
ADR-0003/ADR-0004)

Цель: один `enrollment_offer` QR на авторизованном компьютере должен безопасно
поддерживать два сценария без ручного выбора режима. Неавторизованная телефонная PWA
подключается как новое independent device, а уже авторизованная PWA того же account
привязывает две существующие device/session boundaries и запускает двустороннее
объединение доступной encrypted local history. Открытие чата и online собеседника не
требуются.

### Scope

- backend определяет режим только по authenticated principal сканера, а не по
  client-supplied account/device IDs;
- `enrollment_offer` сохраняет exact existing candidate session/device binding либо
  новый candidate proof, но никогда оба варианта одновременно;
- same-device и cross-account scan fail closed, revoked/expired session не участвует;
- компьютер остаётся trusted approver и явно подтверждает отображаемое устройство;
- для existing-device pairing approval сразу авторизует уже существующий exact device,
  не создаёт новую Session/Device и не меняет его crypto identity;
- scanner и display независимо восстанавливают один durable history-sync job и
  выполняют union в обе стороны через существующий opaque MLS relay;
- существующий anonymous `offer → authorize new phone` и
  `request → trusted phone approves new computer` сохраняют обратную совместимость;
- Settings на телефоне автоматически объясняет выбранный режим и ожидает approval
  компьютера; Settings на компьютере использует один QR для подключения или sync;
- доступная canonical text/tombstone history дополняет обе стороны; records не
  затираются отсутствием на peer, gaps остаются явными.

### Security invariants

- raw session credential, candidate proof, archive/storage key, MLS signer/state и
  plaintext не попадают в QR, PostgreSQL, logs или HTTP DTO;
- exact candidate session/device подтверждается серверной cookie-authentication,
  strict Origin/CSRF и row-locked monotonic transition;
- pairing status/history relay доступны только exact active trusted/candidate
  sessions одного account;
- retry scan/approve/status idempotent; иной scanner после первого bind получает
  conflict без раскрытия account/device state;
- backend restart сохраняет pairing, authorization, relay chunks и ACK; PWA restart
  восстанавливает local history job без повторного QR;
- existing-device sync не копирует private crypto state и не выполняет скрытый MLS
  roster change.

### Verification

- domain/application tests: existing offer scan/approval, exact retry, same-device,
  cross-account, revoked session, competing scanner и new-device regression;
- HTTP tests: CSRF/origin, exact candidate status/cancel, anonymous offer path и
  отсутствие создания Session/Device для existing sync;
- PostgreSQL integration + fresh migration to `0026`, persistence across engine
  restart и authorization of existing device;
- frontend tests: authenticated offer auto-routing, anonymous offer regression,
  scanner waiting state, both peers queue same resumable job и mutually missing union;
- lint/typecheck/build, full backend pytest and Compose config before rollout.

### Exclusions

- перенос direct attachments/media, preferences/read receipts и данных, отсутствующих
  на server и обоих devices;
- объединение Safari tab и installed PWA без явного pairing;
- копирование MLS epoch/provider state либо создание общего archive key;
- default-camera universal-link handoff и ручной six-digit fallback UI — отдельный
  compatibility slice уже описан в `BL-015`.

### Definition of Done

- залогиненный телефон сканирует QR залогиненного компьютера, компьютер подтверждает,
  после чего обе стороны автоматически дополняют доступные histories друг друга;
- тот же QR по-прежнему подключает неавторизованный новый телефон;
- same-device/cross-account/revoked actors не могут создать pairing или читать relay;
- restart/retry не создаёт duplicate identity/job/chunk и не требует открытия чата;
- migration, документация, security tests и production checks green.

### Verification result

- backend Ruff/format/import-lint/mypy и 265 pytest tests green;
- frontend ESLint/typecheck, 289 Vitest tests и production Nuxt/PWA build green;
- full `make ci`, включая Rust fmt/clippy, 23 native crypto tests и WASM build, green;
- anonymous new-device offer regression и authenticated existing-device
  auto-routing/approval/status/CSRF/cross-account/same-device tests green;
- bidirectional archive test покрывает mutually missing sent records и отдельно
  сценарий, где computer завершил первый poll до запуска phone, а затем догнал
  обратную половину через recurring durable job;
- fresh PostgreSQL 17 upgrade `0001 → 0026` и integration flow с последовательным
  пересозданием четырёх backend engines сохраняют pairing/relay и не создают лишние
  Device/Session; временный test container после проверки удалён;
- `docker compose -f compose.dev.yml config` green; physical iOS/macOS PWA acceptance
  остаётся production rollout check, а не доказательством из unit/integration tests.
