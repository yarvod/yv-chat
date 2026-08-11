# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-015 — Frontend API foundation и auth UI

Статус: **completed**
Backlog item: `BL-020`
Цель: превратить PWA shell в typed same-origin client с полноценным session bootstrap/login/logout и безопасным current-account экраном.

### Результат

Весь network access проходит через один typed API adapter с runtime validation. App bootstrap проверяет HttpOnly session через `/api/v1/me`, показывает login, authenticated shell, loading/offline/revoked states и logout; CSRF берётся только из non-HttpOnly cookie и автоматически добавляется к writes.

### Invariants

1. Frontend не читает и не хранит session credential.
2. `fetch` всегда same-origin с `credentials: include`.
3. Untrusted JSON проходит explicit runtime parsing до попадания в state.
4. CSRF header ставится только для state-changing calls из `__Host-yv_csrf` cookie.
5. Login errors generic; password не логируется и не сохраняется после submit.
6. 401 переводит UI в signed-out/revoked state.
7. Network failure отличается от invalid credentials и имеет retry UX.
8. Strict TypeScript без `any`, `@ts-ignore` и broad unsafe casts.
9. UI keyboard/mobile accessible и не смешивает API parsing с component markup.
10. PWA update/offline shell сохраняются.

### План

- [x] Добавить typed API errors, fetch adapter, cookie CSRF и runtime parsers.
- [x] Добавить auth service для login/me/logout.
- [x] Добавить `useAuth` state machine bootstrap/authenticate/logout.
- [x] Заменить placeholder на login и authenticated app shell/profile.
- [x] Добавить loading/offline/revoked/error states и accessible forms.
- [x] Добавить Vitest service/component critical-path tests.
- [x] Прогнать lint/typecheck/test/build и Docker image smoke.
- [x] Обновить docs и создать отдельный commit.

### Не входит в scope

- conversation/messages UI (`BL-021` следующий);
- IndexedDB/outbox;
- actual E2EE;
- admin user management UI;
- push/WebSocket.

### Проверка готовности

- reload с valid cookie открывает authenticated shell;
- reload без/с revoked cookie показывает login;
- login/logout работают без доступа к credential;
- malformed API response не загрязняет state;
- frontend checks/image зелёные и отдельный commit создан.

### Проверено

- `npm run lint`;
- `npm run typecheck`;
- `npm test` — 3 tests;
- `npm run build`;
- clean `docker build -t yv-chat-frontend:wp-015 frontend`;
- HTTP smoke финального image на isolated `127.0.0.1:18081`.
