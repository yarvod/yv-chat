# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-070 — Telegram-like chat interactions

Статус: **implemented and locally verified**

Цель: сделать повседневную работу с перепиской привычной: свежие диалоги всегда
сверху, внутри чата доступны локальный поиск, reply, mentions и reactions, а фото
и видео удобно смотреть inline и в полноэкранном viewer.

### Scope

- [x] атомарно обновлять activity time при создании сообщения и сортировать список
  по последней message activity;
- [x] выполнять bounded поиск по расшифрованной client-side истории без server
  plaintext index;
- [x] хранить reply target и intended mention IDs внутри versioned protected content;
- [x] добавить mention autocomplete/highlight и reply composer/jump UX;
- [x] добавить авторизованные idempotent reactions, агрегаты и durable sync event;
- [x] добавить pinch/double-click zoom, bounded pan/reset и swipe navigation фото;
- [x] сохранить inline/fullscreen playback поддерживаемого browser video и честный
  download fallback для неподдерживаемого codec;
- [x] документировать действующие per-item limits и per-user active-media quota.

### Security invariants

- server не получает plaintext direct message, search query, reply preview или
  intended mentions;
- search работает только с доступным этому device decrypted content;
- reaction API проверяет active conversation membership и не принимает client user ID;
- media остаётся streamed и bounded; user-provided filename не становится storage path;
- group v1 media по-прежнему явно не называется E2EE.

### Exclusions

- direct encrypted attachment flow (`BL-017`);
- server-side plaintext full-text index или server-generated thumbnails/transcoding;
- unlimited uploads/quota и remote guarantee для expired media;
- edit/forward/pin сообщений.

### Definition of Done

- два чата меняют порядок после сообщения без ручного membership update;
- поиск находит доступные historical messages и открывает найденное сообщение;
- reply/mention round-trip совместим с legacy raw text и group attachment envelopes;
- reactions idempotent, агрегируются, синхронизируются и закрыты negative auth tests;
- mouse/touch/keyboard media interaction и inline video покрыты frontend tests;
- backend lint/type/tests, frontend lint/typecheck/tests/build и migration upgrade
  проходят.

### Verification evidence

- backend: Ruff check/format, mypy, `240 passed, 9 skipped`;
- frontend: ESLint, Nuxt typecheck, `43 files / 237 tests`, production build;
- fresh PostgreSQL: Alembic `base -> 0022_message_reactions` прошёл в отдельной
  временной БД, после проверки БД удалена;
- Compose development config валиден; `git diff --check` проходит.
