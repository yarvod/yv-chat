# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-040 — Atomic one-time MLS KeyPackage delivery

Статус: **completed**
Backlog: `BL-013`
Цель: авторизованное устройство может поддерживать ограниченный пул публичных
одноразовых MLS KeyPackage и атомарно получить пакет другого активного устройства
только в общем conversation, не раскрывая private MLS state и не включая E2EE до
завершения group lifecycle.

### Инварианты

1. Владелец current device определяется только opaque-session principal; пополнять
   или смотреть inventory чужого/revoked device нельзя.
2. Claim разрешён active device только для другого active device, принадлежащего
   active member того же conversation. Outsider, removed member и self-device
   получают закрытый ответ без directory oracle.
3. Один KeyPackage выдаётся не более одного раза. PostgreSQL row lock с
   `FOR UPDATE SKIP LOCKED`, complete claim metadata и constraints сохраняют
   инвариант при параллельных запросах.
4. `claim_request_id` scoped к claiming device. Exact retry с теми же conversation
   и target возвращает тот же пакет после повторной актуальной authorization;
   повтор ID с иной binding даёт conflict.
5. Ответ связывает KeyPackage с immutable server registry: target user/device,
   protocol version, credential, Ed25519 public key, fingerprint и package ref.
   Private key, sealed vault state и session credential не передаются.
6. Replenishment принимает 1–16 canonical base64 packages, каждый не более 1 MiB,
   суммарно не более 4 MiB; duplicate внутри batch или durable registry отклоняется.
7. Transport DTO, application commands/results, domain entity и ORM model остаются
   отдельными. Routes тонкие, use cases получают UoW/Clock через Dishka.
8. Frontend использует typed application port/use cases и strict runtime parser.
   Стабильный request ID принадлежит caller/outbox; автоматическая provisioning,
   MLS group creation и отправка protocol v2 этим milestone не включаются.

### План

- [x] Расширить доменную модель claim metadata и bounded batch invariants.
- [x] Добавить application inventory/replenish/claim use cases и узкие repository ports.
- [x] Реализовать SQLAlchemy adapter с atomic selection и exact retry lookup.
- [x] Добавить Alembic migration с FK/check/unique/partial-index constraints.
- [x] Разделить identity и KeyPackage HTTP transports; сохранить Origin/CSRF/session checks.
- [x] Добавить typed frontend gateway и отдельные list/replenish/claim use cases без auto-run.
- [x] Покрыть domain/application/HTTP/parser и PostgreSQL concurrency contracts.
- [x] Проверить offline fresh-schema Alembic SQL, обновить architecture/backlog/README.
- [x] Выполнить полный repository CI; commit/push — финальный шаг focused change.

### Definition of Done

- parallel consumers физически не получают один KeyPackage дважды;
- exact network retry возвращает byte-identical claim, а изменённая binding закрывается;
- unauthorized/revoked/cross-conversation/self claims не расходуют pool;
- pool limits и duplicate references проверяются до commit и constraints в БД;
- API/frontend не раскрывают private crypto/session material;
- fresh migration chain, backend pytest/type checks, frontend tests/typecheck/build и
  repository CI зелёные.
