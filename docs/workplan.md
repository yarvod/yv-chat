# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-002 — Persistence foundation: User и Device

Статус: **in progress**  
Backlog item: `BL-001`  
Цель: создать минимальный PostgreSQL persistence foundation для последующей закрытой регистрации и управления устройствами.

### Пользовательский результат

После этой фичи backend имеет версионируемую схему `users` и `devices`, а код может безопасно создавать async SQLAlchemy sessions через bootstrap-конфигурацию. HTTP API пользователей в эту фичу не входит.

### Архитектурные решения

1. `User` и `Device` являются отдельными доменными сущностями.
2. Domain не импортирует SQLAlchemy, FastAPI или Pydantic.
3. ORM-модели находятся в infrastructure и не выходят за её границу.
4. Время в доменной логике передаётся явно и хранится как timezone-aware UTC.
5. Идентификаторы генерируются приложением как UUID, а не зависят от ORM lifecycle.
6. Production-схема изменяется только Alembic migration; `metadata.create_all()` не используется как migration strategy.
7. `username` уникален без учёта регистра на уровне PostgreSQL expression index.
8. Устройство всегда принадлежит пользователю; удаление пользователя каскадно удаляет его устройства.

### План реализации

- [ ] Добавить SQLAlchemy, asyncpg и Alembic через `uv` и обновить lockfile.
- [ ] Расширить typed settings значением `DATABASE_URL`.
- [ ] Создать доменные сущности `User` и `Device` с базовыми инвариантами.
- [ ] Создать SQLAlchemy declarative base и отдельные ORM-модели.
- [ ] Добавить async engine/session factory на infrastructure boundary.
- [ ] Настроить Alembic на async PostgreSQL URL и metadata проекта.
- [ ] Создать начальную migration для `users` и `devices` с PK/FK/unique/check constraints и indexes.
- [ ] Добавить domain и mapping/schema tests, включая negative cases.
- [ ] Проверить offline SQL генерацию migration для PostgreSQL.
- [ ] Обновить `docs/backlog.md`, `docs/bugs.md` и этот workplan перед коммитом.

### Не входит в scope

- repositories и application use cases;
- admin bootstrap и activation tokens;
- password hashing;
- login, cookies и sessions;
- crypto identity устройства;
- HTTP endpoints пользователей.

### Проверка готовности

- `cd backend && uv run ruff check .`
- `cd backend && uv run ruff format --check .`
- `cd backend && uv run mypy .`
- `cd backend && uv run pytest`
- `cd backend && uv run alembic upgrade head --sql`
- `make ci`
- migration не содержит plaintext/message/crypto secret полей;
- ORM не импортируется domain/application слоями;
- изменения зафиксированы отдельным коммитом.

