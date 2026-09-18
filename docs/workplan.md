# Текущий workplan

## WP-149 — Внешние ссылки и очистка прочитанных уведомлений

Статус: **implemented locally; production and physical Android acceptance pending**
Backlog: `BL-FIX-076`; bugs: `BUG-143`, `BUG-144`.

### Scope и шаги

1. Проверить Android PWA external open: браузер владеет Custom Tab и перехватывает
   intent к себе. Добавить menu перед Android standalone external message link:
   copy/share/explicit ordinary open/cancel; не обещать принудительный browser launch.
   Сохранить canonical href, modified clicks и desktop/iOS/native handling.
2. Добавить platform adapter для списка/удаления доставленных message notifications
   в Web Push/PWA. Существующий click закрывает выбранное уведомление;
   добавить regression assertions перед navigation/fallback.
3. После confirmed read и read-state catch-up удалять только notifications с exact
   conversation/message и sequence <= lastReadSequence. Для сообщений вне timeline
   читать authorized opaque message metadata без decrypt. Ошибки OS/network не
   откатывают read receipt; неизвестные notifications остаются до следующей попытки.
4. Проверить partial read, другие чаты, calls, failed reads, cold start/catch-up,
   click navigation, URL validation, menu close/focus, copy/share failures и platform isolation.
5. Frontend lint/typecheck/tests/build, docs/Compose checks, review и focused commit.

### Security и архитектура

Только HTTP(S) ссылки, без intent workaround; opaque IDs в
notifications, без plaintext/keys. Read-state серверный и authoritative; простое
открытие/загрузка чата не означает прочтения. Новых dependencies, persistence,
crypto и server API contracts нет. Меню позволяет избежать нежелательного открытия Custom Tab; прямой запуск отдельного
browser и поведение его Back/close остаются ограничением Chrome/OS.

### Exclusions

Production deploy, native release/FCM/APNs tray, background cross-device silent push, новый
notification protocol и исправление самого Chrome/Android Custom Tab UI.

### Tests и Definition of Done

Relevant automated checks проходят; docs отражают реальные ограничения; один focused
commit. Physical Android acceptance (external open, Back, возвращение в сохранённый
чат, системная notification tray) отмечается отдельно от unit tests.

### Verification

- Full frontend suite: 79 files / 526 tests passed. ESLint, Nuxt typecheck и
  production Nuxt/PWA build passed; crypto runtime/worker precache присутствуют.
- Browser fixture на 390×844: меню помещается, copy status отображается, Escape
  закрывает dialog и возвращает focus к исходной ссылке. Fixture не использовала
  реальный OS clipboard/share; platform adapters отдельно покрыты unit tests.
- `make docs-check compose-check` и `git diff --check` passed.
- На физическом Android notification tray, system share и Custom Tab/Back не проверялись.
  Force external browser launch не реализован: подтверждено ограничение Chrome.
- Backend/Rust checks, native builds и production deployment не запускались.
