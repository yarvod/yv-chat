# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-005 — Session HTTP transport и browser security boundary

Статус: **planned**  
Backlog item: `BL-003B`  
Цель: подключить готовые login/authenticate/logout use cases к versioned FastAPI API через защищённую same-origin cookie, строгую Origin/CSRF policy и явный composition root.

### Пользовательский результат

Активированный пользователь может войти через `/api/v1/auth/login`, получить browser session в `Secure`/`HttpOnly` cookie, проверить текущую identity и выйти. Ротация credential прозрачно обновляет cookie на обычном authenticated response; bearer/JWT/localStorage не используются.

### Security invariants

1. Session cookie имеет `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, не имеет `Domain` и не доступна JavaScript.
2. Credential не принимается из query string, JSON body или `Authorization`; единственный browser transport — cookie.
3. Login failure одинаков для unknown/inactive user и неверного пароля.
4. Cookie-authenticated state-changing requests требуют разрешённый exact `Origin` и CSRF proof.
5. CORS не использует wildcard с credentials; разрешены только явно настроенные same-origin значения.
6. WebSocket scope отсутствует, но HTTP middleware/dependencies не создают bearer-token shortcut.
7. `Set-Cookie` rotation выполняется только когда application result вернул новый credential.
8. Logout идемпотентно отзывает серверную сессию и удаляет cookie даже для неизвестного/устаревшего credential.
9. Client IP берётся из socket peer; proxy headers доверяются только при явно настроенном trusted proxy.
10. Ошибки API не раскрывают password hash, session hash, внутренний SQL или stack trace.

### План реализации

- [ ] Добавить typed HTTP/security settings: allowed origins, cookie name/attributes и trusted proxy policy.
- [ ] Создать composition root для engine, UoW, password/session adapters и session policy.
- [ ] Добавить transport DTO для login и безопасного current-session response.
- [ ] Реализовать exact Origin validation и CSRF boundary для state-changing cookie requests.
- [ ] Реализовать безопасное извлечение client IP без доверия произвольному `X-Forwarded-For`.
- [ ] Добавить `POST /api/v1/auth/login` с generic 401 и защищённой cookie.
- [ ] Добавить authenticated `GET /api/v1/auth/session` с transparent credential rotation.
- [ ] Добавить `POST /api/v1/auth/logout` с server revoke и cookie deletion.
- [ ] Добавить application-error → HTTP mapping без утечки внутренних деталей.
- [ ] Добавить API tests для cookie flags, отсутствия bearer/query auth и rotation `Set-Cookie`.
- [ ] Добавить negative CSRF/Origin/trusted-proxy tests.
- [ ] Обновить OpenAPI/README/docs и выполнить полный `make ci`/Docker smoke test.
- [ ] Зафиксировать фичу отдельным коммитом.

### Не входит в scope

- list/rename/revoke devices и revoke-all-others;
- admin invitation/activation HTTP endpoints;
- password reset;
- WebSocket authentication;
- GeoIP enrichment и risk scoring;
- frontend login UI.

### Проверка готовности

- cookie flags и отсутствие `Domain` проверены тестом;
- credential не возвращается в response body и не читается из bearer/query;
- неверный/просроченный/revoked credential получает одинаковый 401;
- rotation устанавливает новый cookie, обычный touch — нет;
- logout отзывает session и очищает cookie;
- missing/cross-origin Origin или CSRF proof отклоняются до use case;
- spoofed forwarding headers не меняют client IP без trusted proxy config;
- API schema не содержит password/session secret fields;
- `make ci` и transport security tests проходят;
- изменения зафиксированы отдельным коммитом.
