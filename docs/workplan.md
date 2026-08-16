# Текущий workplan

## WP-090 — Multiple message pins for direct and group conversations

Статус: **completed**
Backlog: `BL-065`

Цель: добавить bounded множественные закрепы сообщений с Telegram-like быстрым
переходом, durable sync и сохранением действующей E2EE границы.

### Scope

- server хранит только opaque pin metadata: conversation/message/user IDs и timestamp;
- direct: закреплять и откреплять может любой active participant;
- group: закреплять и откреплять могут owner/admin, обычный member видит закрепы;
- до 50 активных закрепов на conversation, newest first, idempotent pin/unpin;
- authenticated list/pin/unpin API и recipient-specific durable realtime/cursor event;
- compact pinned-message bar с preview, счётчиком, переключением нескольких закрепов
  и переходом к сообщению, включая подгрузку retained history;
- pin/unpin action доступен из message actions; deleted/expired message не остаётся
  доступным закрепом.

### Security and correctness invariants

- сервер не получает plaintext direct message или ключи; preview строится только
  после client-side decrypt существующего envelope;
- guessed conversation/message IDs не раскрывают existence; active membership
  проверяется на каждом read/write;
- group member не может менять закрепы, direct peer может;
- bounded limit сериализуется conversation row lock и защищён unique constraint;
- WebSocket является hint: missed event восстанавливается cursor sync + pins reload;
- pin metadata каскадно удаляется при physical message purge, а tombstone скрывается
  из list и очищается в delete transaction.

### Verification

- domain/application tests: direct/group permissions, outsider, foreign/deleted
  message, idempotency, limit и durable recipient events;
- HTTP/PostgreSQL tests: CSRF/auth, persistence, ordering, migration fresh upgrade;
- frontend parser/gateway/composable/component tests for multiple pins, navigation,
  permission-aware controls and realtime reload;
- lint, typecheck, full relevant backend/frontend suites and production build;
- integrated Docker Compose stack and in-app browser acceptance.

### Definition of Done

- multiple pins work in direct and group conversations under documented roles;
- selected pin opens the exact message and older retained messages are loadable;
- pin state converges after missed realtime frames through durable sync;
- no plaintext/key fields, logs or server preview are introduced;
- all relevant automated, Docker and browser checks pass.

### Result

- добавлены migration `0028_message_pins`, отдельные domain/application/storage
  boundaries и authenticated list/pin/unpin API;
- direct participant и group owner/admin меняют закрепы, group member получает
  read-only представление; limit `50`, ordering и idempotency покрыты тестами;
- `message_pin_updated` записывается в recipient-specific cursor stream и
  дублируется realtime hint, поэтому клиент после пропуска перечитывает canonical list;
- Nuxt UI показывает несколько закрепов, локально расшифрованный preview, счётчик,
  циклическую навигацию и переход к exact message;
- полный `make ci` прошёл: `271 passed, 12 skipped` backend tests, `23 passed`
  Rust/OpenMLS tests, `309 passed` frontend tests, Ruff, mypy, Clippy, ESLint,
  Nuxt typecheck/build, Compose/deploy/docs checks;
- integrated Compose обновлён до Alembic head `0028_message_pins`; desktop browser
  acceptance подтвердил два закрепа, cycling, exact-message action, persistence
  после reload, unpin и read-only видимость у обычного group member.
