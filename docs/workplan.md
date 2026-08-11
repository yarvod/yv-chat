# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-016 — Conversations и messaging UI

Статус: **completed**
Backlog item: `BL-021`
Цель: дать авторизованному пользователю usable direct/group chat: выбрать или создать диалог, увидеть ordered timeline, отправить сообщение и восстановить изменения через durable sync.

### Результат

Authenticated shell становится рабочим messenger UI. Normal user получает безопасный каталог активных участников через отдельный backend use case, создаёт direct/group conversation, загружает bounded message pages и отправляет idempotent opaque envelope. Client polling cursor sync обновляет список/активный timeline после пропущенных событий.

### Invariants

1. Vue components не вызывают raw `fetch` и не разбирают transport JSON.
2. User directory возвращает только active account ID, username и display name; admin/password/session metadata отсутствуют.
3. Directory use case зависит от identity port, SQLAlchemy adapter реализует narrow query, Dishka wiring остаётся capability-based.
4. Conversation membership/authorization полностью повторно проверяется backend.
5. Message rendering строго по server `sequence`, client timestamps не задают порядок.
6. Send использует client UUID как idempotency key.
7. До E2EE используется изолированный synthetic opaque codec с видимым предупреждением; он не называется secure/E2EE и имеет явный removal path `BL-012`–`BL-014`.
8. Plaintext synthetic transport не логируется и не сохраняется frontend в persistent storage.
9. Sync cursor хранится только in-memory в этом этапе; `reset_required` выполняет полный reload ресурсов.
10. 401 завершает frontend session, network failure показывает reconnect/retry state.
11. Strict TypeScript без `any`, `@ts-ignore` и широких casts.
12. Критические backend authorization/response-shape и frontend interaction paths покрыты pytest/Vitest.

### План

- [x] Добавить active-user directory port/query/use case, SQLAlchemy adapter и HTTP DTO.
- [x] Разнести Dishka binding и добавить composition/application/HTTP tests.
- [x] Добавить frontend parsers/services для directory, conversations, messages и sync.
- [x] Добавить изолированный temporary synthetic opaque codec с явной маркировкой non-E2EE.
- [x] Реализовать conversation list, create direct/group и active timeline.
- [x] Реализовать idempotent composer и optimistic-safe reload по server sequence.
- [x] Реализовать bounded cursor sync polling/reconnect/reset reload.
- [x] Добавить responsive/accessibility states и Vitest critical paths.
- [x] Прогнать полный CI, Docker/HTTP smoke, обновить docs и создать commit.

### Не входит в scope

- actual E2EE/protocol/device keys (`BL-012`–`BL-014`);
- durable IndexedDB archive/outbox (`BL-022`, `BL-023`);
- read receipts/typing/presence (`BL-009`);
- WebSocket/Push (`BL-011`, `BL-026`–`BL-028`);
- attachments и delete-for-everyone.

### Проверка готовности

- Alice видит Bob в directory, создаёт direct/group conversation;
- только members видят timeline, directory не раскрывает inactive/admin/security fields;
- send создаёт один ordered message и exact retry не дублирует его;
- sync event после polling обновляет conversation/timeline, reset выполняет full reload;
- empty/loading/offline/error states usable на desktop/mobile;
- backend/frontend checks и image smoke зелёные, отдельный commit создан.

### Проверено

- backend Ruff check/format, import-linter, mypy и полный pytest;
- directory application/HTTP/security shape и production Dishka graph;
- frontend ESLint, Nuxt typecheck, 9 Vitest tests и production build;
- full repository `make ci`;
- clean frontend/backend Docker builds и integrated HTTP smoke.
- Browser smoke: desktop/mobile login, authenticated empty state и console без errors.
