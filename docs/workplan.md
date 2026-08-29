# Текущий workplan

## WP-138 — Копирование и скачивание изображения из контекстного меню

Статус: **completed locally**
Bug: `BUG-127`

Цель: правый клик или long-press по конкретной карточке изображения в timeline
открывает существующее меню сообщения с рабочими действиями «Копировать изображение»
и «Скачать изображение».

### Scope

- определить exact image attachment по DOM target, не смешивая несколько фото одного
  сообщения;
- добавить image-only действия в существующее desktop/mobile context menu;
- копировать загруженный attachment blob через browser Clipboard API;
- передавать в clipboard PNG representation для JPEG/WebP/GIF/AVIF совместимости;
- сохранять user activation, передавая pending blob в `ClipboardItem` до завершения
  чтения/конвертации;
- скачивать exact blob с исходным безопасным display name;
- показать понятный success/failure toast и не закрывать меню при ошибке.

### Security и privacy

- действия доступны только для `contentState=available` и уже авторизованного
  attachment exact conversation;
- direct media продолжает загружаться и расшифровываться через существующий
  `loadAttachment` boundary; server не получает plaintext или file key;
- object URL остаётся transient и отзывается после запуска скачивания;
- clipboard остаётся browser capability за application port, без browser API внутри
  crypto/storage application flow.

### Tests

- exact right-click image показывает оба image action, а клик по остальной карточке — нет;
- copy получает exact pending blob и сообщает успех/ошибку;
- download создаёт transient anchor с исходным именем и отзывает object URL;
- browser clipboard вызывает `write()` до завершения pending load и нормализует
  non-PNG image в PNG;
- frontend tests, lint, typecheck и production build.

### Exclusions

- копирование video/file как изображения;
- изменение media TTL/cache/E2EE contracts;
- отдельное системное меню macOS или native share sheet;
- server-side преобразование изображения.

### Definition of Done

- действия работают для обычного фото и sticker attachment в desktop menu и mobile
  long-press sheet;
- clipboard/download failures не приводят к unhandled rejection;
- регрессии context menu, image viewer и attachment loading покрыты тестами;
- документация дефекта и итог проверок обновлены.

### Result

- context menu связывает действие с exact `data-attachment-id`, поэтому gallery из
  нескольких фото копирует и скачивает именно выбранную карточку; обычный right-click
  по bubble не показывает нерелевантные image actions;
- pending authorized/decrypted blob передаётся в `ClipboardItem` немедленно, а
  JPEG/WebP/GIF/AVIF локально приводятся к portable `image/png`; PNG не перекодируется;
- download использует исходный validated display name и отзывает transient object URL;
- copy/load/download failure оставляет меню открытым и показывает понятный toast;
- `69/69` frontend test files и `436/436` tests проходят; ESLint, Nuxt typecheck,
  production/PWA build и `git diff --check` зелёные;
- локальный Nuxt shell открыт во встроенном браузере без console errors; exact
  authenticated timeline visual acceptance не выполнялся, потому что локальный backend
  остановлен, а component regressions покрывают desktop context target и action surface.
