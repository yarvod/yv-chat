# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-039 — Mobile shell and multi-client realtime correctness

Статус: **completed**
Bugs: `BUG-025`, `BUG-026`, `BUG-028`
Цель: mobile PWA держит navigation у visual viewport, UI честно показывает состояние
WebSocket, а уже подключённые пользователи получают корректный presence при создании
нового диалога и при нескольких устройствах одного аккаунта.

### Инварианты

1. Mobile tabs имеют fixed viewport position, учитывают safe-area и не перекрывают
   scrollable content; desktop rail/layout не меняются.
2. Зелёный connection indicator означает только фактический WebSocket `open`, а не
   сам факт отображения страницы. Connecting/reconnecting/stopped различаются.
3. WebSocket остаётся wake-up/ephemeral каналом; durable cursor sync сохраняет роль
   источника истины и запускается при `hello`/durable hint/reconnect.
4. Новый conversation, созданный после подключения обоих пользователей, инициирует
   новый authorized presence snapshot без раскрытия посторонних user IDs.
5. Disconnect одной сессии не публикует offline, пока у пользователя остаётся другая
   активная WebSocket subscription.
6. Origin/cookie authentication, heartbeat/revalidation и typing authorization не
   ослабляются; session credential не появляется в URL, JS state или логах.
7. TLS troubleshooting отличает origin failure от client VPN fake-IP и никогда не
   предлагает отключать certificate validation.

### План

- [x] Воспроизвести document-flow mobile navigation и восстановить fixed/safe-area CSS.
- [x] Передать typed WebSocket connection state из application service в UI.
- [x] После `conversation_updated` отправлять новый authorized online snapshot.
- [x] Добавить regressions для new-conversation race и multi-device disconnect.
- [x] Добавить frontend tests для connection state и mobile CSS contract.
- [x] Выполнить physical short/long mobile viewport smoke.
- [x] Обновить bugs/deployment/architecture и выполнить полный CI; commit/push —
  финальный шаг focused change.

### Definition of Done

- короткая и длинная mobile page держат tabs на одинаковом `bottom: 0`;
- content имеет отдельный inset высотой tabs + safe-area;
- UI не показывает зелёный realtime dot до `onopen` и после disconnect;
- два already-online пользователя видят presence после создания direct conversation;
- закрытие одной из двух сессий одного пользователя не создаёт ложный offline event;
- backend/frontend relevant tests, typecheck/lint/build и full CI зелёные.
