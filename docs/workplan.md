# Текущий workplan

## WP-093 — Touch long-press ownership and explicit copy

Статус: **implemented and locally verified**
Bug: `BUG-083`

Цель: на Pixel/iPhone long-press должен принадлежать message action menu, а не
системному выделению текста, Google Lens/search или iOS callout; копирование текста
остаётся доступным как явное действие внутри меню.

### Scope

- coarse-pointer message bubbles отключают native text selection, touch callout и drag;
- links внутри bubble сохраняют обычный short tap, но не открывают native long-press menu;
- context menu показывает «Копировать текст» только для available non-empty body;
- copy идёт через существующий `ClipboardPort`, без прямого browser API в UI;
- success/failure получает доступный transient feedback без логирования plaintext;
- reply, pin, reactions, delete, vertical scroll и swipe остаются совместимыми.

### Correctness and UX invariants

- selection blocking применяется только на coarse pointer и не ломает desktop selection;
- copy получает уже отображаемый decrypted body из memory и не меняет E2EE/storage boundary;
- empty, deleted и attachment-only messages не предлагают бессмысленный copy action;
- clipboard rejection не закрывает задачу молча и не оставляет stale toast/timer;
- long-press timer не запускает native selection или второе действие.

### Verification

- component tests: long-press → menu → copy success/failure, no copy for empty/deleted;
- CSS regression: coarse-pointer bubble owns selection/callout while desktop stays selectable;
- existing swipe/right-click/reaction/pin/delete regressions remain green;
- full `make ci`, Docker Compose health и in-app browser copy smoke.

### Definition of Done

- Pixel/iPhone long-press не показывает selection handles/native search surface;
- явный copy action копирует точный отображаемый текст и показывает результат;
- tap по ссылке, swipe reply и vertical scrolling не деградируют;
- automated, Docker и browser проверки зелёные.

### Result

- coarse-pointer bubbles отключают native selection/callout/drag, не затрагивая
  desktop pointer selection;
- long-press по тексту или ссылке открывает application menu, где доступно явное
  «Копировать текст» через `ClipboardPort` с success/failure feedback;
- attachment-only и пустые сообщения не показывают copy action;
- `make ci`, 314 frontend tests, Docker Compose health и real-browser PWA smoke
  (menu → copy → «Текст скопирован») прошли локально 2026-08-17.
