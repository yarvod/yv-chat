# Текущий workplan

## WP-092 — Telegram-like message interactions

Статус: **implemented, full-CI, Docker and browser verified**
Backlog: `BL-077`
Bug: `BUG-082`

Цель: убрать постоянно видимую строку действий под сообщением и собрать компактный,
предсказуемый interaction flow: swipe-to-reply, long-press/right-click context menu,
расширенные реакции и подтверждаемое открепление из панели закрепов.

### Scope

- свайп сообщения вправо запускает reply и даёт понятный визуальный threshold;
- long-press на touch и правый клик мыши открывают одно контекстное меню;
- меню содержит быстрые реакции, раскрываемую полную палитру и доступные actor action;
- direct participant и group owner/admin могут pin; unpin всегда требует подтверждения;
- крестик в панели закрепов открывает подтверждение для текущего закрепа;
- delete-for-everyone остаётся только для авторизованного actor и подтверждается;
- attachment picker и context/reaction menu закрываются кликом вне, Escape и после action;
- reaction allowlist одинаков на frontend/domain/backend и покрыт regression tests.

### Correctness and UX invariants

- вертикальный scroll не превращается в reply; swipe threshold применяется один раз;
- long-press не срабатывает на интерактивном дочернем control;
- закрытие popover не меняет draft, attachments или выбранный reply;
- pin/delete не выполняются до явного подтверждения и не дублируются double click;
- новые reactions проходят существующие authorization, sync и idempotency paths;
- keyboard/focus/ARIA semantics доступны без touch gestures.

### Verification

- component tests: pin close confirmation/cancel, context actions, expanded reactions,
  swipe threshold, long-press/right-click и outside-click dismissal;
- backend domain/application tests подтверждают расширенный allowlist и invalid reaction;
- frontend lint/typecheck/test/build, backend checks, full `make ci`;
- integrated Docker Compose health, in-app browser desktop acceptance и touch
  PointerEvent regressions для mobile gestures.

### Definition of Done

- message actions не занимают постоянное место в bubble;
- все requested gestures/actions работают и не конфликтуют со scroll/click;
- transient menus закрываются естественно кликом вне или Escape;
- automated, Docker и browser проверки зелёные.

### Result

- постоянная строка message actions удалена; right-click, `Shift+F10` и touch
  long-press открывают единое compact context menu;
- swipe right использует direction guard и threshold, показывает reply indicator и
  не срабатывает при вертикальном scroll gesture;
- quick strip из семи реакций раскрывается до 16; backend domain allowlist принимает
  тот же набор через существующий authorized durable reaction flow;
- pinned header получил крестик; header/context unpin и delete-for-everyone требуют
  отдельного alert dialog, cancel не вызывает mutation;
- attachment/context surfaces закрываются outside click и Escape;
- `make ci` прошёл: backend `272 passed, 12 skipped`, Rust/OpenMLS `23 passed`,
  frontend `312 passed`; lint, typing, build, Compose/deploy/docs gates зелёные;
- Docker images пересобраны, runtime healthy, migration `0028_message_pins` применена
  к local QA volume; браузер подтвердил right-click/keyboard reply, expanded `🥰`
  reaction end-to-end, click-outside и pin → cancel/confirm unpin.
