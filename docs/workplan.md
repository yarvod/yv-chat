# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-003 — User repositories и admin-controlled activation

Статус: **planned**  
Backlog item: `BL-002`  
Цель: реализовать application flow, в котором только администратор создаёт неактивного пользователя, а пользователь один раз активирует аккаунт по ограниченному во времени секрету и задаёт пароль.

### Пользовательский результат

Администратор может создать приглашённого пользователя и получить одноразовый activation secret. Пользователь активирует свой аккаунт до expiry, после чего secret становится недействительным, а пароль хранится только как Argon2id hash. HTTP endpoints в эту фичу не входят — use cases будут готовы для последующего transport layer.

### Security invariants

1. Public self-registration отсутствует.
2. Создавать приглашения может только активный администратор.
3. Activation secret генерируется криптографически безопасно и возвращается plaintext только один раз.
4. В PostgreSQL хранится только SHA-256 lookup hash activation secret.
5. Secret имеет expiry, одноразовое использование и не может быть применён к другому пользователю.
6. Пароль никогда не логируется и хранится только как Argon2id hash.
7. Повторный username отклоняется независимо от регистра.
8. Use cases зависят от repository/password/token/clock ports, а не от SQLAlchemy или системного времени.
9. Transaction boundary охватывает одну application operation.

### План реализации

- [ ] Добавить Argon2 password-hashing dependency через `uv`.
- [ ] Расширить domain-модель lifecycle пользователя: invited → active.
- [ ] Добавить `activation_tokens` и nullable `password_hash` новой Alembic migration.
- [ ] Создать typed application commands/results/errors для create invitation и activate account.
- [ ] Создать узкие repository, transaction, password hasher, secret generator и Clock ports.
- [ ] Реализовать use case создания пользователя с admin authorization.
- [ ] Реализовать use case одноразовой активации с expiry и Argon2id hashing.
- [ ] Реализовать SQLAlchemy repositories/mappers без выхода ORM наружу.
- [ ] Добавить unit tests с in-memory fakes и PostgreSQL integration tests для concurrency/uniqueness.
- [ ] Проверить fresh migration upgrade и downgrade/upgrade roundtrip.
- [ ] Обновить README/docs и выполнить полный `make ci`.
- [ ] Зафиксировать фичу отдельным коммитом.

### Не входит в scope

- HTTP admin/activation endpoints;
- login и opaque sessions;
- cookie/CSRF/Origin handling;
- device enrollment;
- password reset;
- email delivery activation link.

### Проверка готовности

- non-admin не может создать приглашение;
- inactive/revoked admin не может создать приглашение;
- duplicate username не создаёт вторую запись;
- expired/used/unknown activation secret отклоняется;
- token hash и password hash не выходят из infrastructure/API;
- concurrent activation допускает только один success;
- `make ci` проходит;
- fresh PostgreSQL migration и roundtrip проходят;
- изменения зафиксированы отдельным коммитом.

