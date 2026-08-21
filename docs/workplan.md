# Текущий workplan

## WP-119 — Multi-select и копирование сообщений

Статус: **completed locally**
Backlog: `BL-080`

Цель: добавить Telegram-подобный режим выделения нескольких сообщений из
существующего long-press/context menu и безопасное копирование выбранного текста с
именем отправителя и локальными датой/временем.

### Scope

- действие «Выбрать» в существующем message context menu;
- transient selection state только для доступных локально расшифрованных timeline
  messages;
- круговые markers/checks и tap-to-toggle для каждого selectable сообщения;
- selection header с количеством, копированием и отменой;
- chronological clipboard format `Имя, [ДД.ММ.ГГГГ ЧЧ:ММ]` + тело сообщения;
- безопасные локальные labels для выбранных вложений/звонков без ciphertext fallback;
- keyboard/Escape, conversation-change и removed-message cleanup;
- responsive web/PWA/Capacitor UI и regression tests.

### Security и compatibility invariants

- форматирование использует только `contentState=available`, `displayBody`, уже
  расшифрованные attachment metadata и conversation member display names;
- ciphertext, MLS/provider state, attachment secrets и unavailable placeholder не
  попадают в clipboard;
- selection state не сохраняется в IndexedDB/localStorage и не отправляется backend;
- API, sync, crypto, message ordering и existing single-message actions не меняются;
- pointer selection не ломает long-press, swipe-to-reply, links, reactions и video
  note controls вне selection mode.

### Exclusions

- массовая пересылка и новый forwarding protocol;
- массовое удаление и server authorization orchestration;
- выбор ещё не загруженных страниц истории;
- копирование бинарного media content.

### Definition of Done

- long-press → «Выбрать» включает mode с исходным сообщением;
- tap/keyboard добавляет и снимает несколько сообщений, markers отражают состояние;
- copy выдаёт chronological blocks, разделённые пустой строкой, и очищает selection
  только после успешной clipboard operation;
- смена разговора, Escape и явная отмена гарантированно очищают selection;
- frontend tests/lint/typecheck/build зелёные, web/PWA behavior сохранено.

### Проверка

- `npm test`: 63 files, 379 tests passed;
- `npm run lint`: passed;
- `npm run typecheck`: passed;
- `npm run build`: passed, включая PWA `generateSW` (67 precache entries);
- local browser Nuxt bootstrap открылся без console errors, но authenticated chat
  visual acceptance не выполнялась: backend/auth runtime в этой локальной сессии не
  был поднят, поэтому проверка interaction/UI выполнена через mounted component tests.
