# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-008 — Admin user management и activation HTTP API

Статус: **completed**  
Backlog item: `BL-003D`  
Цель: открыть закрытый invitation/activation lifecycle через versioned API и дать администратору безопасное управление пользователями без public registration.

### Пользовательский результат

Активный администратор видит пользователей, создаёт приглашение, один раз получает activation secret, повторно выпускает secret для ещё не активированного аккаунта и деактивирует/реактивирует ранее активных пользователей. Приглашённый пользователь активирует аккаунт по одноразовому secret и задаёт пароль.

### Security invariants

1. Public registration отсутствует: новую identity создаёт только authenticated active admin.
2. Admin authorization выполняется application use case, а не только route/UI.
3. Activation secret возвращается только при create/reissue, хранится только digest и не попадает в list DTO/logs.
4. Reissue атомарно инвалидирует предыдущие неиспользованные secrets пользователя.
5. Activation errors снаружи bounded/generic и не раскрывают digest, SQL или account internals.
6. Деактивация атомарно отзывает все sessions/devices target user.
7. Администратор не может деактивировать себя; invited account без password нельзя активировать через PATCH.
8. Обычный пользователь получает `403` независимо от guessed target ID.
9. Authenticated writes требуют exact Origin + CSRF; activation требует exact Origin, но до session cookie не требует CSRF.
10. DTO/OpenAPI не содержат password/session/activation hashes.

### План реализации

- [x] Добавить managed-user records и узкие repository operations.
- [x] Добавить domain transitions display-name/deactivate/reactivate.
- [x] Реализовать list users и update user state с atomic session revoke.
- [x] Реализовать activation-secret reissue с invalidation старых credentials.
- [x] Подключить create-invitation/activate-account через Dishka providers.
- [x] Добавить `/api/v1/admin/users` list/create/update/reissue endpoints.
- [x] Добавить `/api/v1/auth/activate` без public registration semantics.
- [x] Добавить typed HTTP error mapping без internal leakage.
- [x] Добавить unit/HTTP authorization, ownership, CSRF/Origin и secret-schema tests.
- [x] Добавить PostgreSQL concurrency tests для reissue/activation/session revoke.
- [x] Проверить migration compatibility, full CI и Docker/OpenAPI smoke.
- [x] Синхронизировать README/backlog/architecture/bugs и сделать отдельный commit.

### Не входит в scope

- изменение admin role;
- password reset/change;
- удаление user row;
- frontend admin UI;
- email/SMS delivery activation secret.

### Проверка готовности

- normal user не может list/create/update/reissue users;
- create/reissue показывает plaintext secret ровно в response и не хранит его;
- старый secret после reissue не активирует account;
- concurrent activation успешна ровно один раз;
- deactivate отзывает все target sessions, не затрагивая admin;
- invited user нельзя активировать простым `is_active=true`;
- response/OpenAPI не раскрывают hashes/credentials;
- PostgreSQL integration, full CI и image smoke проходят;
- изменения зафиксированы отдельным коммитом.
