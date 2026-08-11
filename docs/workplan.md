# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-028 — Delete-for-everyone, tombstones и server TTL

Статус: **completed**
Backlog item: `BL-010`
Цель: позволить авторизованно удалить ciphertext для всех участников, доставить
удаление offline devices и ограничить server-side хранение сообщений без повторного
использования sequence после физической очистки.

### Invariants

1. Active message хранит opaque ciphertext только до `expires_at`; plaintext/key
   material на backend не появляется.
2. Delete-for-everyone разрешён sender, а для чужого сообщения в group — только
   active owner/admin. Обычный участник direct/group не может удалить чужое.
3. Actor, conversation и message проверяются server-side; guessed foreign ID не
   раскрывает существование сообщения вне доступной conversation.
4. Первое удаление атомарно scrubs ciphertext, создаёт tombstone и durable
   recipient-specific `message_deleted`; повтор является idempotent no-op без events.
5. Tombstone сохраняет immutable routing metadata/sequence, но не ciphertext. UI
   честно сообщает, что уже просмотренную/скопированную копию уничтожить нельзя.
6. Automatic TTL использует server time, превращает expired ciphertext в тот же
   tombstone и отправляет тот же event; cleanup bounded, retry-safe и допускает
   concurrent workers через row locks.
7. Tombstone retention длиннее ordinary sync retention. При cursor retention gap
   полный message resync всё ещё возвращает tombstone в документированном окне.
8. После tombstone retention row можно физически удалить, но sequence никогда не
   переиспользуется: conversation хранит отдельный monotonic high-water counter.
9. Read summary использует high-water sequence, а unread считает только живые
   ciphertext rows; TTL/deleted gaps не создают ложный unread.
10. Frontend применяет `message_deleted` идемпотентно, не пытается decode null
    ciphertext и предоставляет явное подтверждение destructive action.
11. Cleanup запускается отдельным малоресурсным process из того же backend image;
    сбой cleanup не делает API недоступным и не затрагивает соседние VPS services.
12. Backup/restore и документация не обещают хранить TTL-deleted ciphertext вечно.

### План

- [x] Domain tombstone lifecycle и configurable retention/cleanup policies.
- [x] Persistent conversation sequence high-water и Alembic `0014` с backfill.
- [x] Message repository: lock/update, expired batch, purge batch и gap-safe summaries.
- [x] Authorized delete use case + bounded automatic cleanup use case.
- [x] Dishka, thin DELETE transport, cleanup CLI и isolated Compose worker.
- [x] Typed frontend tombstone DTO/parser/gateway/use case и idempotent timeline merge.
- [x] Confirm UX, permission-aware delete control и deleted/expired presentation.
- [x] Domain/application/HTTP/static migration/Vitest negative, retry и concurrency specs.
- [x] Architecture/backlog/bugs/deployment/env docs, full non-Docker CI and Compose config.

### Не входит в этот slice

- remote erasure guarantee для уже просмотренных или экспортированных копий;
- deletion encrypted local archive старше tombstone retention без local-first storage;
- attachment blob cleanup до появления encrypted attachments;
- per-message user-selected timer UI;
- E2EE protocol-level authenticated deletion command.

### Проверка готовности

- sender/admin policy и negative authorization доказаны tests;
- first delete scrubs ciphertext + emits, duplicate delete does neither;
- automatic expiry и manual deletion дают одинаковый client tombstone contract;
- offline sync/full resync применяют older-sequence tombstone;
- purge не позволяет reuse sequence и не увеличивает unread;
- fresh/upgrade/downgrade migration, cleanup process и production-like Compose healthy;
- ни API, sync, logs, docs, migration, image не содержат deleted ciphertext/secrets.

### Verification record

- backend Ruff format/check, mypy: passed;
- backend pytest: `172 passed, 6 skipped` после финальных security tests;
- frontend ESLint, Nuxt typecheck, Vitest (`34 passed`) и production build: passed;
- Alembic single-head/static model checks и offline upgrade/downgrade SQL: passed;
- production Compose config, shell/deploy contract и diff/secret review: passed;
- real PostgreSQL migration/concurrency tests и container health smoke остаются release
  gate: локальный Docker daemon недоступен в текущем sandbox; production DB для tests
  намеренно не использовалась.
