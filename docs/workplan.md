# Текущий workplan

## WP-083 — Observable and completion-safe QR history synchronization

Статус: **completed locally; production rollout pending** (`BUG-077`, `BL-015`,
ADR-0003/ADR-0004)

Цель: QR pairing не должен объявлять существующие устройства синхронизированными
сразу после server authorization. Trusted device сначала доводит target MLS leaf до
READY во всех direct chats, затем обе стороны выполняют возобновляемый encrypted
history union и подтверждают завершение взаимными relay markers/ACK. Пользователь на
обоих устройствах видит точную стадию и может уйти из Settings без остановки работы.

### Scope

- existing-device и new-device trusted flows используют один durable background job;
- job сохраняет, требуется ли trusted-side MLS enrollment, и возобновляется после
  reload/PWA restart без повторного QR;
- history protocol передаёт отдельный encrypted completion marker для каждого direct;
- `complete` возможен только когда локальные markers подтверждены peer и markers peer
  получены/применены для всех direct conversations;
- UI различает `preparing_crypto`, `transferring`, `waiting_peer`, `retrying`,
  `complete`; показывает числа chats/records/gaps и явное разрешение уйти из Settings;
- authorized QR workspace закрывается и больше не зависает с текстом
  «завершаем вход»;
- импорт локального plaintext archive уведомляет открытый chat, чтобы недоступные
  bubbles обновились без logout/relogin;
- server restart и PWA navigation не сбрасывают pairing/job/progress semantics.

### Security invariants

- completion marker и canonical history остаются MLS PrivateMessages; server видит
  только bounded opaque relay metadata/ciphertext;
- imported record проходит прежнюю strict binding/schema validation до archive write;
- trusted device не объявляет target готовым только по успешному reconcile: server
  roster обязан содержать exact target device;
- timeout/error не превращается в success; UI показывает retry/waiting state;
- никакие MLS private keys, archive keys, session credentials или plaintext не
  попадают в HTTP DTO/logs/QR.

### Verification

- unit: asymmetric start, mutually missing history, encrypted completion markers,
  ACK-gated completion, resume with persisted peer markers;
- component: existing trusted flow invokes MLS enrollment, authorized workspace
  closes, progress remains observable after component remount;
- messenger: imported active-conversation records refresh visible timeline;
- backend: bounded extra completion marker per direction/conversation;
- isolated local Compose: pair existing devices, restart API between scan/approve,
  navigate away/back, finish both peers, verify no duplicate Device/Session;
- frontend lint/typecheck/tests/build, backend lint/mypy/pytest and full `make ci`.

### Exclusions

- attachments/media transfer;
- history absent from server and both paired local archives;
- merging Safari storage into installed PWA without explicit pairing;
- redesign of MLS itself.

### Definition of Done

- both devices show an honest stage and terminal success/failure instead of a frozen
  confirmation pill;
- user can leave Settings while global background job continues;
- records readable on computer become readable on phone after verified union and the
  open timeline refreshes;
- restart/reload resumes without new QR and cannot produce a false `complete`;
- local realistic acceptance and full CI are green before production rollout.

### Verification result

- backend Ruff/format/import-lint/mypy и 266 pytest tests green;
- frontend ESLint/typecheck, 292 Vitest tests и production PWA build green;
- Rust fmt/clippy, 23 native crypto tests, WASM build и полный `make ci` green;
- asymmetric device test доказывает: первая сторона остаётся `waiting_peer`, обе
  становятся `complete` только после encrypted markers/ACK, persisted peer marker
  переживает следующий retry;
- component remount восстанавливает progress, existing trusted job требует MLS
  preparation, а импорт active conversation обновляет timeline без relogin;
- isolated Compose flow пережил API restart между scan/approve, сохранил exact
  existing device и отклонил same-device scan без создания duplicate Device/Session;
- финальная production PWA локально проверена в браузере на desktop и 390×844:
  horizontal overflow/console warnings отсутствуют, старый frozen confirmation text
  не рендерится. Физическая пара iOS/macOS остаётся production acceptance gate.
