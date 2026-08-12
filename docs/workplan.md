# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-062 — Deploy-safe auth and multi-device MLS recovery

Статус: **completed locally; production rollout pending**

Цель: существующие browser devices переживают API/frontend container recreation
без ложного logout, нового `device_id`, потери доступного local MLS state и
зацикленного создания BLOCKED generations.

### Reproduced defects

- reload во время краткого API `502` переводит auth bootstrap в `signed-out` и
  направляет пользователя на password login, хотя opaque session остаётся valid;
- новый password login создаёт новую device identity, поэтому старый local MLS leaf
  больше не соответствует текущему session `device_id`;
- два новых devices без online previous leaf по очереди supersede-ят один
  `blocked/device_roster_changed` snapshot и создают unbounded generation/sync storm;
- undecryptable historical MLS ciphertext уничтожает текущий in-memory runtime;
  UI остаётся в READY, но следующая отправка падает локально как `not-provisioned`,
  поэтому logout/login только маскирует дефект созданием нового runtime/device;
- любой message HTTP `409` отображается как «Конфликт идентификатора», включая
  `conversation encryption is not ready`.

### Scope

- [x] считать network/invalid response/408/429/5xx временной auth-недоступностью,
  не очищать уже подтверждённого пользователя и не требовать password login;
- [x] bounded retry current-session bootstrap и успешный переход с offline login
  обратно в messenger без создания нового device;
- [x] выкатывать/health-check API раньше frontend, чтобы новый auto-update PWA не
  активировался в заведомое backend downtime window;
- [x] переиспользовать один `blocked/device_roster_changed` generation для любого
  нового device при неизменном active roster, сохраняя право previous leaf начать
  следующий PENDING Commit;
- [x] автоматически восстанавливать подтверждённый sealed MLS snapshot после failed
  mutation/decrypt, не продолжая потенциально сдвинутый ratchet и не требуя login;
- [x] заменить ложный UI-текст «Конфликт идентификатора» на честное bounded описание
  server conflict без раскрытия внутренних деталей;
- [x] добавить regression tests для двух replacement devices, transient auth,
  automatic runtime restore, outbox conflict UX и deploy ordering contract.

### Security invariants

- только HTTP `401` доказывает недействительную browser session; 5xx/transport failure
  не создаёт новую identity и не ослабляет authorization;
- новый device без previous MLS state не может самовольно author add-leaf Commit,
  пока существует active previous leaf;
- full-roster recovery остаётся разрешён только когда previous leaves явно revoked;
- server не принимает stale generation/epoch и не делает v2→v1 downgrade;
- никакие private keys, plaintext messages или session credentials не логируются и
  не переносятся через backend.

### Verification

- backend unit/integration suite для generation coordination и message gate;
- frontend Vitest для auth policy, outbox label и existing MLS reconciliation;
- Ruff, mypy, ESLint, Nuxt typecheck, production build и deploy checks;
- production-like two-origin browser acceptance: API stop/recreate, frontend reload,
  session/device ID сохраняются, post-restart direct send/decrypt успешны;
- generation count остаётся bounded и не растёт после стабильного BLOCKED result.

### Acceptance evidence

- backend: Ruff/format/import-linter/mypy green; `237 passed, 8 skipped`;
- OpenMLS/Rust: clippy native+WASM и `21 passed`;
- frontend: ESLint/Nuxt typecheck, `214 passed` и production PWA build;
- repository: full `make ci`, Compose/deploy/docs contracts green;
- production-like three-origin browser: frontend recreated, затем API остановлен,
  оба account devices reload-нуты в окно `502`, API снова запущен;
- оба devices сохранили `/chat` session и отправили v2 сообщения без login, peer
  расшифровал оба; device counters остались `17/10`, current generation — READY
  `3325`, новых generations после `10:21:04Z` не появилось.

### Exclusions

- secure device-to-device historical key transfer;
- silent recovery при утрате всех private MLS leaves без explicit device revocation;
- изменение MLS primitives, ciphersuite или wire protocol.

### Definition of Done

- container recreation не требует повторного ввода пароля;
- два replacement devices не создают generation storm;
- старые valid devices продолжают direct messaging после рестарта;
- пользователь видит точную категорию ошибки, а не ложный identity conflict;
- проверки зелёные, документация обновлена, worktree содержит только намеренные изменения.
