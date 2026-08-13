# Текущий workplan

## WP-080 — Automatic MLS enrollment after trusted QR pairing

Статус: **implemented and locally verified; production rollout held for `WP-081`**
(`BL-015`, ADR-0001, ADR-0003)

Цель: после успешного QR pairing уже доверенное устройство автоматически добавляет
новый independent MLS leaf во все доступные direct conversations. Пользователь не
открывает каждый чат, не ждёт online собеседника и не делает повторный password login.
Ни existing leaf state, ни signer/storage key между устройствами не копируются.

### Scope

- при первой immutable crypto-identity регистрации нового active device атомарно
  записывать durable `conversation_updated` для всех его active conversations;
- событие должно будить все устройства участников, переживать WebSocket loss/restart
  и не создаваться повторно при exact idempotent identity registration;
- после QR authorization approving device запускает bounded background enrollment:
  ждёт регистрации identity/KeyPackages candidate, инвалидирует stale READY cache,
  reconciles каждый direct и проверяет, что exact candidate device вошёл в READY
  required roster;
- сохранять multi-epoch invariant: перед каждым Commit существующий leaf сначала
  скачивает/расшифровывает ещё retained messages текущего epoch в encrypted archive;
- обработка независима от выбранного UI chat: Settings может оставаться открытым,
  scanner/display role не задаёт permanent primary device;
- ошибки одного direct не блокируют остальные; unfinished список явно отображается и
  retry-ится по durable events/повторному foreground pass;
- не менять OpenMLS ciphersuite, credential identity, signer ownership, Welcome/
  Commit framing и server ciphertext opacity.

### Security invariants

- только устройство, уже являющееся leaf latest READY generation, может author-ить
  add-leaf Commit; candidate не перепрыгивает это правило;
- backend `Device` или pairing approval сами по себе не означают MLS membership;
- candidate учитывается в roster только после immutable public identity и валидного
  one-time KeyPackage; missing package остаётся fail-closed;
- перед epoch advance выполняется retention drain; network/storage/decrypt failure
  останавливает конкретный Commit, а не уничтожает local state;
- никакие private keys, epoch secrets, plaintext или archive keys не проходят server,
  QR payload, Vue component state, logs или sync events;
- device/session revoke и logout по-прежнему создают отдельный removal reconciliation,
  а pairing не меняет чужие conversations/accounts.

### Verification

- application test: first identity registration emits one event per affected user /
  conversation, exact retry emits none, wrong/revoked device emits none;
- PostgreSQL integration: identity + initial KeyPackage + roster events commit одной
  транзакцией и доступны после нового engine lifecycle;
- frontend service tests: candidate identity delay, stale READY cache, several direct,
  partial failure/retry, target roster verification и bounded timeout;
- component test: successful pairing starts enrollment without navigation/open-chat;
- existing messenger startup/durable roster-event regressions remain green;
- Ruff/format/mypy/pytest, frontend lint/typecheck/test/build, Compose and full CI.

### Exclusions / next slice

- pre-membership history/old epoch secrets не выдаются новому leaf;
- двусторонний archive manifest/chunk union остаётся `WP-081`;
- media archive transfer, key transparency и External Commit recovery не входят;
- physical iOS/macOS pairing acceptance и production rollout выполняются после
  `WP-081`, чтобы UI не обещал полную history sync раньше реализации.

### Definition of Done

- QR-linked candidate появляется в READY roster каждого доступного direct без открытия
  чатов и без online собеседника;
- restart/missed WebSocket не теряет enrollment wake-up;
- approving existing leaf сохраняет retained history до каждого epoch advance;
- partial failures видимы, безопасно повторяемы и не вызывают downgrade/reset;
- focused commit и полный verification suite завершены.

### Verification result

- backend Ruff/format/mypy и `259 passed, 12 skipped` прошли;
- PostgreSQL integration после fresh migration подтвердил atomic durable events,
  exact retry без дублей и чтение после нового engine lifecycle;
- frontend lint/typecheck, `285 passed` и production build прошли;
- service regressions покрывают delayed candidate identity, stale READY, target roster,
  bounded incomplete result, independent direct failures и epoch drain callback;
- component regression подтверждает запуск enrollment прямо из Settings без перехода
  в chat; Compose/deploy checks и `git diff --check` прошли.
