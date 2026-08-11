# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-017 — Admin invitations и activation UI

Статус: **completed**
Backlog item: `BL-037`
Цель: замкнуть admin-controlled onboarding без ручных API-вызовов и без публичной регистрации.

### Результат

Admin из authenticated PWA видит bounded account list, создаёт приглашение и получает activation secret ровно в response этого действия. Logged-out пользователь переключается на activation form, задаёт новый пароль и после успешной активации возвращается к login.

### Invariants

1. Публичной регистрации нет; activation работает только с выданным one-time secret.
2. Admin UI доступен только при `CurrentAccount.isAdmin`; backend остаётся authoritative и проверяет роль.
3. Activation secret не сохраняется в localStorage/IndexedDB и исчезает после закрытия result panel/reload.
4. Secret не логируется и не включается в URL/query/history.
5. Password очищается из component state до ожидания network response; confirmation проверяется локально.
6. API responses runtime-validated; components не используют raw fetch.
7. UI не показывает password/session/activation digest или admin-only fields обычным users.
8. Duplicate username, invalid/expired secret, network failure и success имеют generic bounded UX.
9. Strict TypeScript и component/service tests обязательны.

### План

- [x] Добавить typed parsers/services для managed users, invitation и activation.
- [x] Добавить logged-out activation form без credential persistence.
- [x] Добавить admin-only account list и create-invitation panel.
- [x] Показывать plaintext activation secret только в transient result panel.
- [x] Добавить responsive/accessibility/error states.
- [x] Добавить Vitest critical-path tests.
- [x] Прогнать CI/Docker/browser smoke, обновить docs и создать commit.

### Не входит в scope

- email/SMS delivery;
- public signup;
- account role promotion;
- full device/security settings UI;
- E2EE device enrollment.

### Проверка готовности

- non-admin не видит admin control, прямой API всё равно даёт 403;
- admin создаёт Bob и получает one-time secret без persistence;
- Bob активирует account с валидным password, invalid secret остаётся generic;
- secret/password отсутствуют в rendered UI после завершения/закрытия;
- checks и runtime smoke зелёные, отдельный commit создан.

### Проверено

- frontend ESLint, Nuxt typecheck, 11 Vitest tests и production build;
- full repository `make ci`;
- clean Docker/HTTP runtime smoke;
- browser activation/admin invitation flow на desktop/mobile без console errors.
