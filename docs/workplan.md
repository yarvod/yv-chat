# Текущий workplan

## WP-114 — Symmetric MLS readiness barrier for retried QR history sync

Статус: **completed locally; production rollout pending**
Backlog: `BL-015`; bug `BUG-102`

Цель: устранить частичный и невозобновляемый history relay между уже
авторизованными устройствами, особенно после прерванной и повторно запущенной
QR-попытки на одном или разных разрешённых origins.

### Подтверждённое состояние

- production Nginx принимает pairing envelopes: исследованные upload/list/ACK
  запросы завершались `200`, поэтому прежний `16k` ingress defect не повторился;
- одна Firefox/macOS ↔ Chrome/Android попытка сохранила `24` opaque chunks, но
  ACK получила только `13`; обратная повторная попытка сохранила `26`, но ACK
  получила только `2`;
- после частичного импорта следующий conversation-specific MLS chunk остаётся
  unacked, client показывает generic unexpected failure;
- approving/display side выполняет exact local/server MLS generation barrier,
  а scanner side — как уже авторизованное устройство, так и новый passwordless
  candidate — создаёт history job с `prepareTarget: false` и начинает relay,
  полагаясь только на server READY projection;
- повторный QR меняет relay authorization, но не обязан сам по себе выравнивать
  local MLS checkpoint scanner-а во всех direct.

### Scope

- запускать exact current-generation reconciliation перед relay на обеих сторонах
  независимо от scanner/display роли и от того, был scanner уже авторизован либо
  получил новую passwordless session;
- сохранить new-device passwordless enrollment semantics без копирования signer,
  provider state или archive key;
- разрешить desktop-сессии использовать существующий scanner flow, чтобы два
  изолированных browser origin могли проходить тот же протокол без подмены API;
- передавать тот же fail-closed `ALLOWED_ORIGINS` в frontend и API локального
  Compose, как уже делается в production Compose;
- покрыть scanner-side job regression и interrupted/retried history lifecycle;
- повторить local browser acceptance на изолированных origins и проверить
  production traces после rollout отдельно.

### Security и protocol invariants

- server READY roster без exact local generation checkpoint не разрешает history
  protect/unprotect;
- relay остаётся MLS `PrivateMessage`; server не получает plaintext, archive key,
  signer или epoch secret;
- malformed/corrupt MLS payload остаётся fail-closed без synthetic fallback;
- новый QR отменяет stale relay, но не удаляет уже импортированный encrypted archive;
- роли scanner/display не определяют направление transfer и не создают permanent
  primary device.

### Exclusions

- перенос signer/provider/archive storage key между устройствами;
- изменение MLS protocol version или cryptographic primitives;
- увеличение server retention/chunk limits;
- изменение login/password/session policy.

### Definition of Done

- scanner flow ставит MLS preparation barrier до первого history chunk как для
  existing-device union, так и после новой passwordless authorization;
- display и scanner подтверждают exact current generation каждого доступного direct;
- частично выполненная попытка может быть отменена и новая QR-попытка завершается
  без stale local epoch;
- targeted frontend/OpenMLS regressions, full frontend checks и relevant backend
  relay tests проходят;
- local two-origin browser acceptance не показывает unexpected sync failure;
- diff, docs и focused commit проверены.

### Проверка

- production `ru1`: investigated pairing upload/list/ACK requests returned `200`;
  opaque relay state confirmed partial ACK rather than ingress failure;
- local existing-device union: `localhost:8080` ↔ `127.0.0.1:8080` completed on
  both sides, synchronized `4/5` available chats and skipped the one expected
  unavailable-participant chat;
- local passwordless enrollment: fresh `wp114.localhost:8080` received a separate
  session/MLS leaf and opened the synchronized local history;
- frontend lint, typecheck, production build and all `360` tests pass;
- relevant backend relay/pairing tests: `6 passed`; Compose config validates.
