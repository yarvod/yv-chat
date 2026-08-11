# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-022 — User settings, devices и security center

Статус: **completed**  
Backlog item: `BL-040`  
Цель: превратить settings placeholder в рабочий self-service security center,
который использует существующие защищённые backend operations через typed
frontend layers и не раскрывает credential/hash material.

### Результат

Пользователь меняет display name, видит active device-bound sessions, может
переименовать устройство, отозвать отдельное чужое устройство или все остальные
сеансы. Отдельные step-up формы меняют пароль либо выполняют полный security
reset. Theme/haptics остаются локальными несекретными preferences и не
смешиваются с server account state.

### Invariants

1. Presentation вызывает account/security use cases; raw HTTP и untrusted DTO
   parsing остаются в infrastructure adapters.
2. Device/session DTO не содержит session credentials, token hashes, password
   hashes или private crypto material.
3. Current device нельзя отозвать guessed DELETE: для него используются logout
   или explicit security reset; foreign device ID остаётся 404 на backend.
4. Rename/revoke/revoke-others/profile/password/reset требуют cookie session,
   exact Origin и CSRF; password/reset дополнительно требуют current password.
5. Password fields очищаются до ожидания network response и при unmount; они не
   попадают в URL, storage, logs или persistent Vue state.
6. Password change сохраняет current session и отзывает остальные. Security
   reset отзывает все sessions/devices, очищает auth state и ведёт на login.
7. IP и best-effort browser metadata отображаются только как approximate
   security context, никогда как authorization/risk verdict.
8. Device actions имеют явное подтверждение, busy/error/empty/offline states и
   не допускают повторного destructive submit.
9. Theme/haptics сохраняются только как non-secret preference; security events
   читаются bounded page и отображаются без свободного server payload.

### План

- [x] Добавить frontend domain DTO для device sessions/security events и
  account-security gateway port.
- [x] Реализовать HTTP adapter/runtime parsers для profile, devices, revoke,
  revoke-others, password change, security reset и recent events.
- [x] Добавить по одному application use case на каждую operation и wiring в
  Nuxt composition root.
- [x] Разбить settings UI на ProfileCard, DeviceSessionsCard,
  PasswordSecurityCard и SecurityEventsCard; page оставить composition shell.
- [x] Реализовать rename/revoke confirmation, revoke-all-others и безопасные
  password/reset forms с очисткой secrets.
- [x] Синхронизировать изменённый profile с auth state без reload и завершать
  local auth state после security reset.
- [x] Добавить Vitest для parsers/use cases/critical UI flows и negative secret
  persistence contract.
- [x] Обновить architecture/backlog/bugs и подготовить полный CI/diff/security
  review перед отдельным commit/push.

### Не входит в scope

- device model enrichment User-Agent/GeoIP полями, которых ещё нет в schema;
- Web Push preferences/subscriptions (`BL-026`–`BL-028`);
- E2EE identity/device enrollment и crypto reset (`BL-012`–`BL-015`);
- visual regression/install-update polish (`BL-041`).

### Проверка готовности

- settings page не содержит raw `fetch`, localStorage или browser identity logic;
- current/other device визуально различаются, current revoke action отсутствует;
- rename и revoke отражаются после server response;
- password mismatch/weak/wrong-current/network outcomes bounded и credentials
  очищены;
- security reset удаляет local auth state и redirect-ит на login;
- session/event API parsers reject malformed/secret-bearing assumptions;
- full repository CI зелёный.

### Проверено

- `make ci`: backend Ruff/format/import contracts/mypy/pytest, frontend
  ESLint/typecheck/Vitest/build и Compose/deploy checks прошли полностью;
  backend — 135 passed, 6 PostgreSQL-only tests skipped без integration URL,
  frontend — 21 passed.
- In-app browser QA локальной production-сборки: desktop и viewport 390×844,
  console warnings отсутствуют, `scrollWidth === clientWidth === 390`, найденный
  overflow скрытого haptics input исправлен.
- Profile, theme, haptics, device, password/reset и event cards визуально
  проверены; переименование текущего тестового устройства прошло через реальный
  HTTP flow и отобразило authoritative server state.
- Смена пароля/security reset вручную не отправлялись: очистка credential refs до
  завершения запроса, double-confirm reset и redirect проверяются Vitest без
  лишней мутации локальных credentials.
