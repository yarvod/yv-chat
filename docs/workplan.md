# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-021 — Admin account lifecycle и безопасный password recovery

Статус: **completed**  
Backlog item: `BL-039`  
Цель: дать администратору полный безопасный lifecycle закрытых аккаунтов —
поиск и просмотр, блокировку/разблокировку, перевыпуск invitation и отдельный
одноразовый password-reset flow, в котором администратор никогда не видит и не
задаёт постоянный пароль пользователя.

### Результат

Admin page вызывает отдельные typed application use cases через gateway и
показывает явные состояния аккаунта. Для уже активированного пользователя
администратор может выпустить короткоживущую одноразовую reset-ссылку. Сервер
хранит только SHA-256 digest purpose-bound reset credential; открытие ссылки не
отправляет secret в HTTP/referrer, а пользователь сам задаёт новый Argon2id
password. Успешный reset атомарно погашает token и отзывает все sessions/devices.

### Security invariants

1. Activation и password reset — разные domain entities, таблицы, repositories,
   use cases, DTO и endpoints; credential одного purpose не подходит другому.
2. Plaintext reset secret возвращается только один раз непосредственно в ответе
   на admin action, не хранится в БД, audit event, exception или log.
3. Reset token имеет bounded TTL, SHA-256 lookup digest, single-use/revocation
   lifecycle и row lock; два конкурентных consume не могут оба успешно пройти.
4. Admin не задаёт новый password. Public reset endpoint принимает purpose-bound
   credential и новый password, проверяет общий password policy и возвращает
   одинаковую bounded ошибку для unknown/expired/used/revoked token.
5. Target account должен быть активирован. Invitation account использует только
   activation flow; disabled account reset не делает активным автоматически.
6. Успешный reset отзывает все target sessions и devices в той же transaction,
   обновляет Argon2id hash и добавляет bounded security event без secret.
7. Admin endpoint требует active admin session, exact Origin и CSRF. Нельзя
   reset-ить свой admin account этим endpoint: для него есть step-up settings flow.
8. Frontend читает secret только из URL fragment, немедленно очищает address bar,
   держит его в памяти формы и очищает после submit/unmount.
9. Vue components не вызывают raw HTTP/browser APIs; block/reactivate/reissue/
   reset operations проходят presentation → application → port → infrastructure.
10. API/OpenAPI и session/admin list responses не раскрывают token hashes,
    password hashes, session credentials или внутренние persistence objects.

### План

- [x] Завершить WP-020 implementation: PWA shell, frontend layers и full CI;
  physical 390px visual acceptance перенесён в `BL-041`/release checklist.
- [x] Добавить `PasswordResetToken` domain entity, repository port/adapter,
  identity UoW binding, ORM model и Alembic `0011`.
- [x] Добавить configurable reset TTL, secure secret port/adapter и небольшие
  Dishka bindings в существующие тематические providers.
- [x] Реализовать `IssuePasswordReset` и `ResetPasswordWithToken` use cases с
  authorization, self-safety, revocation и audit event.
- [x] Добавить admin/public HTTP endpoints, uniform error translation, Origin/
  CSRF contracts и schema-leak regression tests.
- [x] Расширить frontend account domain/application gateway: block/reactivate,
  activation reissue, password-reset issuance и transient link handling.
- [x] Добавить `/reset-password`, fragment consumption и password form; обновить
  guest middleware/navigation без browser credential persistence.
- [x] Добавить pytest domain/application/HTTP/PostgreSQL concurrency tests и
  Vitest frontend use-case/page-state tests.
- [x] Обновить `.env.example`, architecture/backlog/bugs и migration/deployment
  documentation.
- [x] Прогнать полный `make ci`, проверить diff/secrets и подготовить отдельный
  commit; production rollout выполнять после успешного protected workflow.

### Не входит в scope

- profile/device settings UI (`BL-040`);
- visual regression/install-update polish (`BL-041`);
- WebSocket/receipts/presence (`BL-009`, `BL-011`);
- E2EE, encrypted local archive, attachments и push.

### Проверка готовности

- invitation secret не принимается reset endpoint и наоборот;
- unknown/expired/used/revoked reset credentials внешне неразличимы;
- одновременное двойное использование даёт ровно один success;
- reset отзывает все target sessions/devices, но не затрагивает admin session;
- normal user, missing CSRF и foreign Origin не могут issue reset;
- self-admin reset через admin API отклоняется;
- URL fragment очищается до первого network request и secret не сохраняется;
- backend lint/typecheck/pytest/migration, frontend lint/test/typecheck/build и
  repository compose/deploy checks зелёные.

### Проверено

- `make ci`: Ruff/format/import contracts, mypy, 135 pytest passed и 6
  PostgreSQL tests skipped без URL; ESLint, Nuxt typecheck/build, 17 Vitest и
  Compose/deploy checks прошли;
- на изолированной локальной PostgreSQL выполнен fresh `base → 0011` Alembic
  upgrade и все 6 integration tests, включая concurrent reset consume;
- HTTP critical path подтверждает CSRF/Origin/admin/self restrictions,
  purpose separation, немедленный revoke, replay rejection и новый login;
- persistence/OpenAPI tests не находят plaintext secret, password/session hash
  или credential fields в публичных schemas;
- временные local test database/role после проверки удалены.
