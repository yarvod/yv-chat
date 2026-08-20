# Текущий workplan

## WP-111 — MLS generation barrier before QR history relay

Статус: **completed locally; production rollout pending**
Backlog: `BL-015`; bug `BUG-099`

Цель: устранить воспроизводимую гонку при подключении третьего и последующих
устройств, когда QR-auth завершается, но history relay шифруется stale MLS epoch и
новое устройство не может подтвердить chunks.

### Подтверждённое состояние

- разные official origins не являются причиной: pairing и relay используют общий
  server state при раздельных cookie/IndexedDB boundaries;
- при одном trusted leaf локальный browser flow переносит историю полностью;
- при ранее подключённом активном leaf другой device может стать coordinator новой
  generation;
- enrollment считал conversation готовым по server roster, не проверяя, что
  approving leaf локально применил именно эту generation;
- stale approving leaf затем создавал MLS application messages старым epoch, target
  fail-closed отклонял их и не отправлял ACK.

### Security invariants

- relay остаётся обычным MLS PrivateMessage; server не получает plaintext или keys;
- stale/mismatched generation не получает fallback и не ослабляет authentication;
- transfer начинается только после exact generation ID/number agreement между
  authoritative server state и локально reconciled approving leaf;
- retry остаётся bounded, resumable и cancellable.

### Scope

- хранить подтверждённую local/server generation по каждому direct во время
  enrollment;
- повторно reconcile-ить approving leaf при stale или изменившейся generation;
- не начинать archive relay до exact generation match;
- regression на server READY target roster при stale local READY;
- production-like browser acceptance с несколькими независимыми origins/devices.

### Exclusions

- изменение QR state machine, cookies, origin allowlist или relay API;
- передача/копирование MLS signer, provider snapshot или archive key;
- восстановление уже созданных stale ciphertext chunks без новой pairing session;
- group MLS и attachment/media transfer.

### Definition of Done

- stale approving leaf не объявляет target enrollment готовым;
- следующий retry применяет current generation и только затем запускает relay;
- third/fourth-device browser flow переносит доступные чаты без crypto errors;
- focused и full frontend tests, lint, typecheck и production build проходят.

### Выполнено

- `EnrollLinkedDevice` теперь всегда сверяет результат локального reconcile с exact
  server generation ID/number, содержащей target leaf;
- совпадение кэшируется только на время enrollment и инвалидируется, если server
  generation меняется;
- добавлена regression stale-local/current-server generation race;
- browser skill воспроизвёл defect на третьем устройстве и подтвердил fix на
  четвёртом при трёх уже активных devices: 4/5 доступных direct и 9 records
  синхронизированы, один proof-backed `missing_identity` ожидаемо skipped.

### Проверка

- focused `linked-device-enrollment`: `6 passed`;
- production-like in-app browser: отдельные cookie/IndexedDB origins, exact QR code
  confirmation, multiple active leaves, zero console warning/error после fix;
- frontend: ESLint, Nuxt typecheck, `358 passed`, production build;
- Compose config и `git diff --check` валидны.
