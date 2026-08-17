# Текущий workplan

## WP-098 — Viewport-bounded video-note autoplay

Статус: **implemented, full-CI and Docker shell verified; authenticated browser history pending**
Backlog: `BL-073`
Bug: `BUG-088`

Цель: видеокружки автоматически воспроизводятся без звука только пока реально видны
в viewport; длинная история не должна одновременно декодировать все уже загруженные
кружки.

### Root cause

- lazy media observer загружает media около viewport и затем `unobserve`-ит shell;
- `<video autoplay loop muted>` запускается при появлении после загрузки;
- уход сообщения за экран не ставит video на pause, поэтому число активных decoder-ов
  растёт по мере прокрутки истории.

### Scope

- убрать нативный `autoplay` у timeline video note;
- отдельный `IntersectionObserver` без preload margin управляет только playback;
- входящий в viewport кружок запускается muted/loop, вышедший немедленно pause-ится;
- пользовательский expanded playback также не продолжает звук за экраном;
- при возврате видимого элемента observer возобновляет его в текущем playback mode;
- при отсутствии `IntersectionObserver` остаётся click-to-play без массового autoplay;
- обычные video/image, attachment crypto/cache/API и recording flow не меняются.

### Verification

- component test моделирует enter/leave/re-enter и проверяет `play/pause`;
- regression фиксирует отсутствие нативного `autoplay` и metadata-only preload;
- frontend lint, typecheck, tests и production build;
- Docker stack и in-app browser smoke с несколькими кружками и прокруткой.

### Definition of Done

- ни один невидимый timeline video note не играет;
- все видимые кружки могут играть muted одновременно;
- expand-with-sound и timer/progress продолжают работать;
- observer-ы отключаются при update/unmount без утечек.

### Result

- нативный timeline `autoplay` удалён, `preload` ограничен `metadata`;
- отдельный zero-margin observer управляет playback независимо от 500 px load-ahead;
- controlled component test подтвердил invisible initial pause, enter `play`, leave
  `pause` и re-enter `play`, сохранив expand-with-sound и timer lifecycle;
- full `make ci`: backend `272 passed, 12 skipped`, Rust/OpenMLS `23 passed`, весь
  frontend suite, lint, typecheck, production build, Compose/deploy/docs gates зелёные;
- Docker stack пересобран и healthy; in-app browser загрузил локальный login shell без
  console errors. Authenticated local history недоступна без тестовой session, поэтому
  реальный scroll acceptance с пользовательскими кружками не заявляется.
