# Текущий workplan

## WP-140 — Защита демонстрации экрана от рекурсивного захвата

Статус: **completed locally**
Bugs: `BUG-130`

Цель: демонстрация всего монитора или окна звонка не должна создавать «зеркальный
коридор», в том числе когда оба участника одновременно показывают экран.

### Scope

- попросить browser/OS picker не предлагать текущую вкладку приложения;
- запретить динамическое переключение share на текущую вкладку после выбора;
- до передачи первого screen frame убрать remote video из локально рисуемого окна;
- не показывать локальный screen preview внутри захватываемого call surface;
- сохранить получение remote WebRTC stream, audio, controls и camera restore;
- явно объяснить в UI, почему видео временно скрыто.

### Security и privacy

- browser/OS остаётся владельцем выбора monitor/window/tab и может игнорировать
  preference hints;
- screen bytes по-прежнему идут только через существующий DTLS-SRTP media plane;
- новый signaling/server state, запись кадров и анализ содержимого экрана не
  добавляются;
- защита работает локально даже при одновременном share обоих участников.

### Tests

- picker получает `selfBrowserSurface: exclude` и отключённый surface switching;
- remote video element остаётся подключённым, но не рисуется во время local share;
- local screen stream не присоединяется к call preview;
- UI показывает anti-recursion placeholder и возвращает обычный video mode после
  остановки share;
- frontend tests, lint, typecheck и production build.

### Exclusions

- собственный список доступных экранов вместо системного picker;
- распознавание содержимого захваченных кадров;
- новый call signaling event только для координации share ownership;
- одновременный camera + screen track.

### Definition of Done

- окно звонка не рисует screen-derived video, пока само передаёт screen track;
- два одновременно sharing клиента не усиливают изображение друг друга;
- audio/call lifecycle и camera restore не регрессируют;
- проверки и документация обновлены.

### Result

- `getDisplayMedia()` получает стандартный `selfBrowserSurface: exclude`, а
  динамическое переключение source отключено, чтобы browser не предлагал текущую
  вкладку как capture target;
- сразу после выбора source и до `replaceTrack()` UI включает локальный
  anti-recursion guard: remote video продолжает приниматься, но не рисуется;
- screen stream больше не присоединяется к local preview element, а вместо call
  video пользователь видит понятное объяснение до остановки share;
- остановка из UI/system indicator сохраняет прежний camera restore и WebRTC cleanup;
- full `71/71` frontend test files и `441/441` tests, ESLint, Nuxt typecheck и
  production/PWA build проходят.
