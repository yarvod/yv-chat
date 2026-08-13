# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-074 — Standalone managed registration invitations

Статус: **implemented and locally verified; production rollout pending**

Цель: администратор выпускает и управляет одноразовыми приглашениями без создания
псевдопользователя, а приглашённый сам выбирает уникальный username, display name и
пароль и сразу получает защищённую device-bound session.

### Scope

- отдельная `registration_invitations` persistence model с label, creator, TTL,
  `used_at`, `revoked_at` и ссылкой на созданного пользователя;
- admin-only create/list/revoke API; plaintext secret возвращается только при create;
- admin UI показывает active/used/expired/revoked invitations и позволяет копировать
  одноразовую ссылку, показать QR и немедленно отозвать active invitation;
- activation fragment удаляется из address bar сразу после чтения и живёт только в
  памяти до HTTPS request body; DOM input для token отсутствует;
- приглашённый вводит username, display name и пароль дважды с корректными
  `autocomplete=username/new-password` hints;
- username проверяется case-insensitively и атомарно; conflict не потребляет invite;
- успешная регистрация создаёт user, device и opaque session в одной transaction и
  сразу открывает приложение без повторного login;
- legacy user-bound activation links продолжают работать до естественного expiry,
  но новые pseudo-user invitations больше не создаются;
- public registration endpoint защищён per-IP Nginx rate limit, строгим Origin,
  bounded body и дешёвой проверкой invitation до Argon2id.

### Security and abuse invariants

- публичная self-registration отсутствует: без active server-issued secret user не
  создаётся;
- БД хранит только SHA-256 digest secret; API list/HTML/logs никогда не содержат
  secret или digest, старую ссылку невозможно восстановить после закрытия карточки;
- revoked, expired и used invitations дают одинаковый bounded public failure;
- username conflict сообщается только после валидного invite, чтобы endpoint не стал
  общедоступным username-enumeration oracle;
- row lock и database constraints допускают не более одного successful redemption;
- rate limit защищает application/Argon2 от обычного abuse, но не обещает выдержать
  volumetric distributed DDoS без upstream filtering.

### Exclusions

- public signup без invitation;
- хранение plaintext links для повторного просмотра;
- IP/device blacklist как identity/authorization boundary;
- CAPTCHA, email/SMS delivery и внешняя invitation infrastructure;
- удаление legacy activation schema до окончания compatibility window.

### Definition of Done

- admin может создать, увидеть status и отозвать invite; non-admin не может;
- QR/copy доступны только в transient create result;
- valid invite регистрирует выбранный unique username и автоматически логинит device;
- duplicate username не расходует invite; retry с другим username succeeds;
- invalid/expired/revoked/used invite не запускает password hash и не создаёт user;
- concurrent redemption создаёт ровно одного user/session;
- Nginx возвращает 429 сверх bounded registration burst;
- migration проходит fresh `base -> head` и upgrade с previous head;
- backend/frontend tests, lint, typecheck, build и repository CI проходят.

### Verification

- полный `make ci` проходит: backend Ruff/import contracts/mypy и 255 pytest,
  frontend lint/typecheck/Vitest/build, Rust fmt/clippy/21 tests, Compose/deploy/docs
  checks;
- отдельная PostgreSQL database прошла fresh `base -> head`, downgrade
  `0023 -> 0022`, повторный upgrade и concurrent redemption integration tests;
- локальная browser-проверка на viewport `390x844` подтвердила отсутствие
  horizontal overflow, token/code input в DOM и console errors; username/password
  autocomplete hints корректны, fragment очищается;
- production acceptance для фактического `429` остаётся частью rollout: перед
  reload выполняются scoped config install и `nginx -t`; другие virtual hosts и
  общий Nginx не изменяются без успешной проверки.
