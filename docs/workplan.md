# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-009 — Conversation domain и persistence

Статус: **completed**  
Backlog item: `BL-004`  
Цель: создать транзакционно надёжную основу direct/group conversations и membership lifecycle без transport/UI зависимостей.

### Результат

Domain моделирует direct/group conversation и membership roles/invariants. PostgreSQL хранит conversations/members, не допускает duplicate direct pair при concurrency, а application получает узкие repository/UoW ports без ORM leakage.

### Invariants

1. Direct conversation содержит ровно двух различных пользователей и не имеет title.
2. Для unordered пары пользователей существует не более одной direct conversation.
3. Group имеет bounded title и creator-owner membership.
4. Membership user уникален внутри conversation; `left_at >= joined_at`.
5. Direct members не имеют group privilege roles.
6. Creator/direct pair IDs ссылаются на существующих users; conversation delete каскадно удаляет memberships, user delete не используется как shortcut.
7. Domain/application не импортируют SQLAlchemy; ORM не выходит repository.
8. Transaction boundary принадлежит conversation application operation.
9. List/get queries не возвращают conversations, где membership пользователя завершён.
10. Schema не содержит plaintext message fields — messaging envelope появится отдельной фичей.

### План

- [x] Добавить Conversation/ConversationMember entities и enums.
- [x] Добавить creation/membership invariants и domain tests.
- [x] Добавить conversation repository/UoW ports.
- [x] Добавить SQLAlchemy models, constraints и indexes.
- [x] Добавить Alembic migration `0006`.
- [x] Реализовать ORM↔domain mapping и repository queries.
- [x] Добавить ConversationUnitOfWork и Dishka persistence binding.
- [x] Добавить metadata tests без forbidden plaintext columns.
- [x] Добавить PostgreSQL concurrent duplicate-direct test.
- [x] Проверить fresh/roundtrip migration, full CI и Docker head.
- [x] Обновить docs и сделать отдельный commit.

### Не входит в scope

- conversation HTTP API;
- message rows/ciphertext;
- sync/WebSocket;
- E2EE protocol state;
- frontend conversations UI.

### Проверка готовности

- domain отклоняет self-direct, invalid member count/roles/title/timestamps;
- DB сериализует duplicate unordered direct pair;
- repository возвращает domain aggregate без ORM;
- active-membership list исключает left conversations;
- migration base→head и 0005↔0006 roundtrip проходят;
- CI/integration/Docker smoke зелёные;
- отдельный commit создан.
