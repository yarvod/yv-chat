# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-068 — Instant anchored chat open and reload

Статус: **implemented and real-browser verified locally**

Цель: длинный диалог открывается сразу около сохранённой позиции или указанного
сообщения без показа начала/конца и последующей видимой прокрутки.

### Reproduction

- открыть диалог с 1000 сообщениями, остановиться в середине и перезагрузить страницу;
- до исправления cached latest window рисовался раньше anchored window, а
  `scroll-behavior: smooth` показывал длинную прокрутку к сохранённой позиции;
- скрытая mobile detail-pane имела нулевую высоту и могла перезаписать корректный
  anchor как `atLatest`;
- push/deep-link мог увидеть route target раньше DOM и упасть обратно на старый anchor.

### Scope

- [x] IndexedDB и HTTP загружают bounded окно `49 before + target + 50 after`;
- [x] cold startup выбирает сохранённый anchored window вместо cached latest;
- [x] timeline остаётся невидимым только до первой точной расстановки и не использует
  smooth scrolling для programmatic restore;
- [x] скрытый/нулевой viewport не читает и не сохраняет scroll position;
- [x] deep-link ждёт target в DOM и требует достаточный контекст вокруг sparse cache hit;
- [x] одинаковые prepared envelopes переиспользуются без повторной дешифровки;
- [x] пустой диалог после завершённого restore остаётся видимым.

### Performance bounds

- initial/latest и anchored window содержат не более 100 сообщений;
- reactive timeline остаётся bounded существующим пределом 300 сообщений;
- encrypted local archive остаётся bounded существующим пределом 2000 сообщений;
- размер lifetime history не превращает startup в загрузку/рендер всех сообщений.

### Exclusions

- virtual scrolling для десятков тысяч одновременно отрисованных rows — не нужен при
  bounded timeline;
- изменение server retention, pagination API или E2EE framing;
- перенос encrypted archive между devices.

### Definition of Done

- reload в середине восстанавливает тот же message-relative viewport без видимого jump;
- deep-link сразу показывает target с контекстом до и после;
- тестовый conversation из 1000 сообщений держит в DOM только bounded window;
- unit regressions покрывают IndexedDB forward range, cold anchor, hidden viewport и
  ранний route target;
- frontend lint/typecheck/tests/build и полный `make ci` проходят.

### Verification evidence

- `51` focused frontend tests, ESLint и Nuxt typecheck: green;
- Docker production build: green;
- real browser / 1000 messages: deep-link `#500` загрузил contiguous `451..550`;
- после scroll к `#512..#517` reload восстановил те же visible rows с offset delta
  `6 px`; в DOM осталось `100` messages, browser errors отсутствуют.
