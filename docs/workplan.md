# Текущий workplan

## WP-142 — Синхронизация и глобальная доступность аудиоплеера

Статус: **completed locally**
Backlog: `BL-FIX-069`
Bug: `BUG-131`

Цель: каждая play/pause-кнопка аудиосообщения и compact/fullscreen player должны
показывать одно фактическое состояние HTML audio element. Compact bar продолжает
работать поверх остальных authenticated страниц PWA, а touch UI не сохраняет
desktop hover после tap.

### Scope

- поднять единственный audio player из chat workspace в persistent app layout;
- хранить player source/request/playback projection в typed presentation controller;
- оставить текущий track и позицию при переходе из чата в Settings/Admin и обратно;
- синхронизировать play/pause icon, aria-label и status exact активной timeline/media
  карточки с compact/fullscreen player;
- определять toggle по фактическому `HTMLAudioElement.paused/ended`, сохраняя позицию
  при pause/resume и загружая заново только другой/error track;
- ограничить player hover styles устройствами с fine pointer и добавить bounded
  touch active feedback без sticky highlight.

### Security и privacy

- server upload/download, E2EE, authorization, TTL и quota contracts не меняются;
- controller хранит только уже расшифрованный in-memory playlist текущей установки;
- переход между страницами не сохраняет playlist в storage и не раскрывает metadata;
- logout/layout unmount, explicit close и active call по-прежнему
  останавливают playback и отзывают object URL.

### Tests

- active message card меняет play ↔ pause вместе с реальными media events;
- повторный click active card и compact control ставит pause, resume продолжает
  текущую позицию без `loadAttachment` и нового object URL;
- app-layout host переживает route slot changes и показывает compact bar вне `/chat`;
- другой track переключается один раз, close/unmount освобождает URL;
- hover правила player доступны только `(hover: hover) and (pointer: fine)`;
- frontend tests, lint, Nuxt typecheck и production/PWA build;
- Docker Browser acceptance на desktop и 390×844 mobile viewport.

### Exclusions

- общий музыкальный каталог между чатами или persisted playlist;
- background execution guarantees поверх ограничений browser/OS;
- server streaming/transcoding/waveform/ID3 changes;
- изменение поведения calls, media encryption или attachment schema.

### Definition of Done

- кнопка exact активного аудиосообщения и обе player surfaces показывают одинаковый
  play/pause state;
- pause/resume не сбрасывает currentTime, новый track начинает собственное playback;
- compact bar видим и управляем в списке/другом чате/Settings/Admin до close, logout
  или call;
- mobile tap не оставляет hover highlight;
- автоматические проверки и реальный Docker browser smoke проходят.

### Result

- typed app-layout controller хранит только in-memory source/request/playback и
  монтирует единственный HTML audio element над authenticated route content;
- active timeline/media card получает exact track state: `Пауза` + две полоски при
  playback, `Продолжить` + треугольник после pause;
- compact/fullscreen/card toggle использует фактические `paused/ended`; pause/resume
  сохраняет `currentTime` и не вызывает повторный attachment load;
- player продолжает работать при переходе чат → список/другой чат → Settings/Admin,
  а explicit close, call, logout/layout unmount сохраняют cleanup;
- player hover rules ограничены fine pointer media query; touch controls используют
  transient `:active`, `touch-action: manipulation` и отключённый tap highlight;
- `74/74` frontend test files и `450/450` tests, ESLint, Nuxt typecheck и
  production/PWA build проходят;
- Docker Browser acceptance: desktop pause/resume и Settings persistence; mobile
  390×844 list/Settings persistence, exact-width compact bar, fullscreen viewport,
  отсутствие horizontal overflow и console warnings/errors.
