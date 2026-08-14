# Текущий workplan

## WP-085 — Prompt peer cancellation during MLS history preparation

Статус: **completed locally; production rollout pending** (`BUG-079`, `BL-015`)

Цель: server-confirmed QR history cancellation должна останавливать не только
history relay и progress card, но и уже запущенную на втором устройстве подготовку
MLS roster.

### Production evidence

- у `admin` последняя pairing получила два `POST .../history-sync/cancel` с `204`;
- PostgreSQL сохранил `history_sync_cancelled_at`, а после отмены relay-запросы
  прекратились;
- trusted client при этом продолжал локальный `EnrollLinkedDevice` и показывал
  `5 из 7`, потому что prepare callback не проверял pairing relay;
- два оставшихся direct-чата имеют server state `blocked / missing_identity`:
  у пользователей `test` и `test3` нет активного MLS-capable device. Это отдельное
  корректное fail-closed условие, а не причина продолжения после cancel.

### Scope

- history sync передаёт enrollment-операции async activity guard;
- guard проверяет local cancel и server relay state между чатами и retry passes;
- server `410` от peer cancellation завершает durable job как `cancelled/stopped`;
- rejected single-flight cleanup promises не создают unhandled rejection;
- tests фиксируют остановку до следующей per-conversation MLS operation.

### Security invariants

- отмена не ослабляет MLS validation и не помечает неподготовленный чат ready;
- activity probe использует существующий authorized pairing endpoint и не раскрывает
  ciphertext, identity keys или session credentials;
- уже завершённая atomic MLS operation не откатывается; следующая операция не
  начинается после подтверждённой отмены.

### Verification

- frontend unit: peer `410` во время target enrollment очищает durable job и даёт
  `cancelled/stopped`;
- linked enrollment проверяет activity до per-conversation work;
- frontend lint, typecheck, full tests and production build;
- production acceptance после rollout: cancel на candidate прекращает trusted
  progress без нового QR и без reload.

### Exclusions

- обход `missing_identity` для direct participant без активного crypto device;
- удаление/изменение production conversations или пользователей `test`/`test3`;
- изменение MLS membership/protocol или pair-level key agreement.

### Definition of Done

- кнопка остановки на любой стороне приводит обе cards к terminal stopped state;
- второй client не начинает следующий chat/retry pass после server cancel;
- full frontend checks green; production physical acceptance recorded after rollout.
