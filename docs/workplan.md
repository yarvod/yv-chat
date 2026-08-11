# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-011 — Conversation API и authorization

Статус: **completed**  
Backlog item: `BL-005`  
Цель: открыть versioned direct/group conversation operations через тонкий FastAPI transport с обязательной active-membership authorization.

### Результат

Authenticated user создаёт, перечисляет и читает direct/group conversations; owner/admin управляют membership в пределах явной role policy, участник может выйти. Application состоит из отдельных use cases, работает через ConversationUnitOfWork и возвращает DTO без ORM.

### Invariants

1. Actor identity берётся только из opaque-session principal.
2. Неактивный/отсутствующий member получает тот же not-found outcome, что guessed conversation ID.
3. Direct membership immutable; direct pair уникальна и self-direct запрещён.
4. Group owner один и не может выйти/быть удалён/понижен без отдельного ownership-transfer дизайна.
5. Owner может add/remove и менять member↔admin; admin может add/remove только ordinary member.
6. Target account должен существовать и быть active; membership IDs/roles из client не дают authorization.
7. List возвращает только conversations с active actor membership.
8. Writes выполняются в одной row-locked transaction и защищены Origin+CSRF.
9. DTO содержат только safe user profile/member metadata, без auth/crypto secrets.
10. Все transport ошибки bounded; ORM/SQL errors не выходят в HTTP.

### План

- [x] Расширить conversation domain role/membership operations и tests.
- [x] Добавить safe bulk user lookup port для member DTO/validation.
- [x] Добавить conversation DTO mapper и отдельные create/list/get use cases.
- [x] Добавить add/remove/leave/change-role use cases с explicit policy.
- [x] Добавить fake Conversation UoW и application pytest tests.
- [x] Добавить отдельный Dishka ConversationUseCaseProvider.
- [x] Добавить `/api/v1/conversations` router/DTO/error mapping.
- [x] Добавить HTTP negative tests: non-member, guessed ID, role escalation, CSRF.
- [x] Добавить PostgreSQL integration flow membership authorization/update.
- [x] Обновить architecture/README/backlog/bugs и OpenAPI checks.
- [x] Прогнать full CI, integration, migration и Docker smoke.
- [x] Создать отдельный commit.

### Не входит в scope

- messages/ciphertext;
- pagination/activity ordering beyond current bounded 10–15-user MVP;
- ownership transfer;
- invite links/public discovery;
- realtime/sync/WebSocket;
- frontend conversation UI.

### Проверка готовности

- non-member/removed member не различает unknown и inaccessible conversation;
- direct duplicate race остаётся 409 typed outcome;
- admin не удаляет/promote owner/admin и не повышает роли;
- owner/member leave policy покрыта tests;
- HTTP writes требуют exact Origin+CSRF;
- application/ORM/transport DTO разделены;
- full CI/integration/Docker smoke зелёные;
- отдельный commit создан.
