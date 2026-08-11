# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-010 — Current account API и security reset

Статус: **completed**  
Backlog item: `BL-003E`  
Цель: дать аутентифицированному пользователю безопасный self-service профиль и явные операции смены credentials без ослабления opaque-session policy.

### Результат

`/api/v1/me` возвращает только безопасные account fields, позволяет изменить display name, сменить пароль с step-up проверкой и атомарным отзывом остальных devices/sessions, а security reset отзывает все sessions, включая текущую. Все writes защищены Origin+CSRF и фиксируются bounded typed security events без secret metadata.

### Invariants

1. Current account определяется только authenticated session principal, не `user_id` из body/path.
2. Response не содержит password hash, session credential/hash, activation digest или private metadata.
3. Смена display name не требует пароля, но требует действующую session, Origin и CSRF.
4. Смена пароля и security reset требуют повторной проверки текущего пароля.
5. Password change атомарно обновляет Argon2id hash и отзывает все sessions/devices, кроме текущей.
6. Security reset атомарно отзывает все sessions/devices, включая текущую, и очищает browser cookies transport-слоем.
7. Неверный step-up password не раскрывает внутреннее состояние и не создаёт частичных изменений.
8. Expired/revoked current session не может выполнять операции.
9. IP/GeoIP/User-Agent не используется как factor для step-up или authorization.
10. Security events типизированы, имеют retention и не содержат password/token values.

### План

- [x] Добавить account/application DTO и use cases get/update/change-password/security-reset.
- [x] Расширить domain security event types и repository contract для password update.
- [x] Реализовать атомарный revoke policy внутри identity UoW.
- [x] Добавить отдельный Dishka account provider binding без монолитного provider.
- [x] Добавить versioned `/api/v1/me` router и безопасные transport DTO/errors/cookies.
- [x] Добавить pytest application tests happy/negative/revoked-session cases.
- [x] Добавить HTTP tests Origin/CSRF/step-up/secret-field absence.
- [x] Добавить PostgreSQL integration test для password update и session revocation.
- [x] Обновить OpenAPI/architecture/README/backlog/bugs.
- [x] Прогнать full CI, integration и Docker smoke.
- [x] Создать отдельный commit.

### Не входит в scope

- публичная регистрация;
- email/password recovery;
- MFA/WebAuthn;
- admin password reset другого пользователя;
- conversation API/UI;
- E2EE key reset/recovery (потребует отдельного protocol ADR).

### Проверка готовности

- `/api/v1/me` не принимает client identity и не отдаёт secret fields;
- wrong current password даёт единый safe error и ничего не отзывает;
- password change оставляет только текущую session и новый пароль работает;
- security reset завершает текущую и все другие sessions;
- negative auth/Origin/CSRF tests зелёные;
- full CI/integration/Docker smoke зелёные;
- отдельный commit создан.
