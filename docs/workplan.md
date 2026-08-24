# Текущий workplan

## WP-124 — Responsive список упоминаний в composer

Статус: **production deployed**
Backlog: `BL-041`
Bug: `BUG-110`

Цель: заменить ломающие grid горизонтальные mention cards на Telegram-подобную
вертикальную панель над composer, которая не сжимает поле ввода и остаётся удобной
на mobile.

### Scope

- mention suggestions не участвуют в grid layout строки composer;
- панель открывается над всей строкой ввода и получает bounded desktop/mobile height;
- все действующие участники, кроме текущего пользователя, доступны через вертикальный
  scroll; покинувшие группу исключаются;
- строка участника показывает компактный avatar initial, display name и username;
- touch/pointer selection и существующая вставка username сохраняются;
- Arrow Up/Down, Enter и Tab позволяют выбрать участника без ухода из textarea;
- listbox/combobox ARIA связывает textarea, список и активный option.

### Security invariants

- member eligibility по-прежнему строится только из уже authorized conversation state;
- composer не отправляет и не сохраняет дополнительный profile/member metadata;
- mention payload остаётся существующим набором `mentionedUserIds`, crypto и transport
  contracts не меняются.

### Tests

- component: доступны все eligible group members, self/left members исключены;
- component: keyboard navigation меняет active option и вставляет exact username;
- полный frontend Vitest, ESLint, Nuxt typecheck и production/PWA build;
- visual QA в in-app browser на desktop `1280×720` и mobile `390×844`.

### Exclusions

- avatar upload/profile schema;
- server-side member search;
- изменение синтаксиса или transport semantics упоминаний;
- redesign остальных composer surfaces.

### Definition of Done

- открытый список не меняет высоту и колонки основной строки composer;
- mobile viewport не получает horizontal overflow;
- длинный список имеет реальный vertical scroll и keyboard-follow selection;
- relevant docs и checks обновлены, временный preview route удалён;
- изменения готовы к одному focused commit.

### Acceptance

- frontend: `65 passed` files, `392 passed` tests;
- ESLint и Nuxt typecheck проходят без diagnostics;
- production/PWA build завершён, service worker precache сгенерирован;
- desktop `1280×720`: textarea сохраняет `1090 px`, panel имеет
  `position: absolute`, `clientHeight: 300`, `scrollHeight: 706`;
- mobile `390×844`: textarea сохраняет всю среднюю колонку `272 px`, panel имеет
  `clientHeight: 294`, `scrollHeight: 682`, а document остаётся ровно `390 px`;
- семь Arrow Down прокручивают panel до `scrollTop: 158` и сохраняют active option;
- `git diff --check` проходит, temporary preview route и dev server удалены;
- production workflow `32757622621` (attempt 3) развернул immutable
  `sha-97ef4cdde6336fb89992aa0af70d1285ee8bcc51`; оба public origins вернули
  health/frontend HTTP `200`.
