# Текущий workplan

## WP-084 — Single-flight and cancellable device history synchronization

Статус: **completed locally; production rollout pending** (`BUG-078`, `BL-015`, ADR-0003/ADR-0004)

Цель: для одной неупорядоченной пары account devices может существовать только
одна активная QR history synchronization. Повторный QR безопасно заменяет прежнюю
попытку, обе стороны исполняют transfer без параллельных локальных jobs, а отмена
с любого устройства останавливает общий server relay и вторую сторону.

### Production reproduction

- до обновления создать несколько QR pairing между теми же телефоном и компьютером;
- открыть новую PWA: durable local queue восстанавливает все `pairingId` одновременно;
- Settings показывает три-четыре одинаковых progress cards, каждая параллельно
  запускает MLS enrollment/history requests;
- PostgreSQL получает взаимные device/session locks и отвечает
  `DeadlockDetectedError`; client скрывает 500 под бесконечным `retrying`;
- остановить отдельную задачу или весь transfer с одного устройства невозможно.

### Scope

- server хранит общий `history_sync_cancelled_at` у authorized pairing и разрешает
  отмену exact trusted/authorized actor с любой стороны;
- при authorizing новой existing-device pairing прежний active relay той же
  неупорядоченной пары атомарно supersede-ится;
- database partial unique invariant запрещает две active authorized history sync
  для одного user/device pair даже при конкурентных approvals;
- migration помечает прежние production duplicates отменёнными, оставляя latest;
- client durable store дедуплицирует старые jobs по owner/current/target и сохраняет
  только newest pairing;
- client выполняет history jobs последовательно, не запускает несколько MLS/history
  pipelines одного local device одновременно и прекращает retries после terminal
  `404/409/410`;
- Settings показывает одну card на target, точную retry/cancelled причину и кнопку
  `Остановить`; cancel intent переживает reload/network failure до server ACK;
- peer замечает server cancellation на следующем relay poll и также прекращает job.

### Security invariants

- cancel доступен только exact active session/device одной из двух bound сторон;
- unordered pair uniqueness scoped к exact user; cross-account/device guesses не
  раскрывают существование pairing;
- отмена не отзывает device/session и не удаляет уже импортированную encrypted local
  history, а только прекращает конкретный bounded relay;
- server по-прежнему не видит plaintext, completion marker или archive keys;
- supersede/cancel idempotent; stale client не может оживить отменённый relay.

### Verification

- frontend unit: три legacy jobs одного target сворачиваются в newest; resume имеет
  `maxConcurrency === 1`; cancellation останавливает active retry, сохраняется при
  network failure и удаляется после server ACK;
- component: у progress card есть доступная кнопка остановки и cancelled state;
- backend application/HTTP: обе bound стороны могут cancel, third device получает
  404, relay после cancel получает 410;
- PostgreSQL integration: concurrent/repeated existing-device approvals оставляют
  ровно одну active unordered pair; migration upgrade сохраняет latest;
- isolated Compose/browser: несколько старых attempts → reload → одна card; новый QR
  replaces её; cancel на телефоне останавливает компьютер; API restart не оживляет;
- frontend lint/typecheck/tests/build, backend Ruff/format/mypy/pytest и `make ci`.

### Exclusions

- изменение MLS message protocol или передача private keys;
- перенос media/attachments;
- глобальная server task queue: coordination остаётся в PostgreSQL pairing state.

### Definition of Done

- одна пара устройств не может породить несколько одновременно исполняемых sync;
- production deadlock reproduction закрыт client serialization и DB invariant;
- пользователь может остановить sync на любом устройстве и видит остановку второго;
- stale durable jobs автоматически очищаются без ручного localStorage/перелогина;
- полный CI и realistic local acceptance green до rollout.

### Verification result

- frontend: 54 test files / 295 tests passed; legacy duplicate restore,
  `maxConcurrency === 1`, persisted cancel retry and Settings action covered;
- backend: PostgreSQL concurrent approval, including simultaneous QR offers with
  reversed trusted/candidate roles, leaves one active unordered pair without a
  deadlock; both bound sides cancel idempotently, third device receives 404 and
  relay receives 410;
- migration: fresh `base → head` and explicit four-duplicate `0026 → 0027` upgrade
  passed; four authorized audit rows remain and exactly one stays active;
- full `make ci` passed: Ruff/format/import contracts/mypy, backend pytest, Rust/WASM,
  frontend lint/typecheck/tests/build and Compose/deployment validation;
- isolated Compose stack built and started on `localhost:8081`; authenticated
  Settings layout was checked in the local browser. The exact multi-device race is
  exercised deterministically by client and PostgreSQL integration tests before
  production rollout.
