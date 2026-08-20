# Текущий workplan

## WP-108 — Installed-PWA zoom policy and swipe overflow containment

Статус: **implemented, full-CI verified and production deployed**
Backlog: `BL-041A`, `BL-077`; bug `BUG-096`

Цель: исключить случайный viewport zoom установленной mobile PWA и горизонтальную
scroll-area при swipe-to-reply, сохранив управляемое увеличение фотографий и
системное воспроизведение видео.

### Подтверждённая причина

- message timeline задавал только `overflow-y: auto`; при translated bubble browser
  создавал горизонтальную scroll-area;
- swipe-to-reply сдвигает bubble вправо до 76 px, что особенно заметно для own
  message, уже выровненного по правому краю;
- viewport оставался масштабируемым и в standalone PWA, поэтому случайный pinch мог
  увеличить всю оболочку приложения;
- media viewer уже имеет отдельный bounded image transform 1×–5×, pinch, double-click
  и кнопки; видео использует стандартный `video controls`/system fullscreen.

### Scope

- запретить горизонтальный overflow только у message timeline, сохранив vertical
  scroll и reply gesture;
- подавить accidental double-tap zoom оболочки через `touch-action: manipulation`;
- в standalone/installed PWA динамически применить `maximum-scale=1` и
  `user-scalable=no`, оставив обычную browser-вкладку масштабируемой;
- сохранить custom pinch/pan/double-click/buttons для фотографий 100%–500%;
- не изменять video controls, playsinline и system fullscreen;
- добавить CSS/config/component regressions и выполнить frontend checks.

### Exclusions

- изменение gesture thresholds или направления reply swipe;
- переписывание media viewer, video player или attachment crypto/storage;
- запрет browser zoom для обычной неустановленной web-вкладки;
- изменение backend/API/MLS/session behavior.

### Definition of Done

- reply swipe не создаёт горизонтальную scroll-area;
- установленная PWA не масштабирует app shell pinch/double-tap жестом;
- обычная browser-вкладка сохраняет доступный viewport zoom;
- фото продолжают увеличиваться custom pinch и кнопками до 5×;
- видео продолжает открываться с native controls без app-level zoom UI;
- lint, typecheck, relevant tests и production build проходят.

### Результат локальной проверки

- `.message-timeline` явно использует `overflow-x: hidden` вместе с сохранённым
  `overflow-y: auto`;
- app root подавляет accidental double-tap zoom, а client plugin блокирует viewport
  pinch только при `display-mode: standalone` или iOS `navigator.standalone`;
- обычный Nuxt viewport не содержит `user-scalable=no`/`maximum-scale=1`;
- component regression подтверждает custom two-finger photo zoom с 100% до 200%,
  bounded controls и отсутствие app zoom controls у video;
- frontend: `349 passed`, ESLint, Nuxt typecheck и production build зелёные.

### Production rollout

- commit `ac92a32` развёрнут workflow `32315884198`; отдельный CI workflow
  `32315884207` также завершился успешно;
- production использует immutable images
  `sha-ac92a32ed571c20d3b31f7a34cfc0ab39bd7ecc4`;
- `chat.yoowee.ru` и `chat.yoowee.com.de` вернули HTTP `200` для frontend и
  `{"status":"ok"}`/HTTP `200` для `/api/v1/health`;
- system Nginx и соседние сервисы не изменялись; rollout использовал штатный
  isolated `yv-chat` workflow.
