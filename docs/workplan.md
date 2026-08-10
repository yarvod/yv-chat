# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-004 — Opaque session core

Статус: **planned**  
Backlog item: `BL-003`  
Цель: реализовать application и persistence core для входа, проверки, безопасного обновления и завершения device-bound opaque-сессий без HTTP/cookie transport.

### Пользовательский результат

Активированный пользователь может войти с паролем на конкретном устройстве, получить случайный session credential и завершить сессию. Последующие запросы проверяют credential, idle/absolute expiry и revocation. Credential периодически ротируется без поломки параллельных запросов, а PostgreSQL хранит только его производные lookup-значения.

### Security invariants

1. Вход разрешён только активному пользователю с корректным Argon2id password hash.
2. Session credential генерируется криптографически безопасно и возвращается plaintext только при создании или ротации.
3. PostgreSQL не хранит plaintext текущего или предыдущего credential.
4. Каждая сессия связана с одним `user_id` и одним `device_id`; клиент не выбирает владельца сессии.
5. Idle expiry может скользить только до неизменяемого absolute expiry.
6. `last_seen_at` и idle expiry обновляются с throttling, а не на каждый запрос.
7. Credential rotation выполняется атомарно; предыдущий credential действует только в короткий grace period для конкурентных запросов.
8. Replay предыдущего credential после grace period отклоняется и отзывает скомпрометированную сессию.
9. Смена IP/User-Agent сама по себе не отзывает валидную сессию: это только обновляемые risk metadata.
10. Use cases зависят от узких repository/password/token/clock ports; ORM не выходит из infrastructure.

### План реализации

- [ ] Уточнить domain-модели `Device` и `Session`, их состояния и timezone-aware инварианты.
- [ ] Добавить typed session policy/settings: idle timeout, absolute lifetime, rotation interval, previous-token grace и touch interval.
- [ ] Добавить Alembic migration для session credential hashes, expiry/rotation/revocation и минимальных device metadata.
- [ ] Расширить password hasher port безопасной password verification.
- [ ] Создать session credential generator/hasher и repository/UoW ports.
- [ ] Реализовать login use case с device enrollment и generic invalid-credentials error.
- [ ] Реализовать authenticate/touch use case с expiry, throttling и атомарной rotation.
- [ ] Реализовать logout/revoke-current-session use case.
- [ ] Реализовать SQLAlchemy repositories с блокировкой строки на критических переходах.
- [ ] Добавить unit tests для policy/state transitions и application use cases.
- [ ] Добавить PostgreSQL integration tests для concurrent rotation, grace/replay, expiry и revocation.
- [ ] Проверить fresh migration upgrade и downgrade/upgrade roundtrip.
- [ ] Обновить README/docs, выполнить полный `make ci` и Docker migration smoke test.
- [ ] Зафиксировать фичу отдельным коммитом.

### Не входит в scope

- HTTP login/logout endpoints и установка cookie;
- CSRF middleware и Origin/CORS policy;
- trusted-proxy parsing и GeoIP enrichment;
- UI списка устройств, rename и revoke-all-others;
- password reset;
- WebSocket authentication.

### Проверка готовности

- inactive/revoked/unknown user и неверный пароль дают одинаковую внешнюю ошибку;
- credential и его hashes не попадают в логи или application DTO после выдачи;
- idle-expired, absolute-expired и revoked session отклоняются;
- absolute expiry никогда не продлевается;
- частые запросы не создают DB write на каждый touch;
- два конкурентных запроса переживают rotation через grace period;
- previous credential после grace period вызывает compromise handling;
- смена IP сама по себе не отзывает сессию;
- `make ci`, PostgreSQL integration tests и migration roundtrip проходят;
- изменения зафиксированы отдельным коммитом.
