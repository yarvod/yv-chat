# Текущий workplan

## WP-095 — Reliable small-message touch target

Статус: **implemented and locally verified; physical Pixel acceptance pending**
Backlog: `BL-077`
Bug: `BUG-085`

Цель: на Pixel короткое сообщение должно легко принимать long-press по всей
видимой рамке, даже при небольшом естественном дрейфе пальца, без конфликта с
вертикальной прокруткой и swipe-to-reply.

### Scope

- coarse-pointer text bubbles получают minimum touch target 48×48 px;
- вся площадь рамки article остаётся зоной message long-press, не только glyphs текста;
- small pointer movement внутри touch slop не отменяет long-press;
- вся shell-область загруженного кружка использует тот же tolerant gesture surface;
- contextmenu ловится article в capture-фазе даже поверх внутренних media layers;
- заметный vertical movement по-прежнему передаёт управление timeline scroll;
- deliberate horizontal movement сохраняет существующий swipe-to-reply threshold;
- standalone видеокружки и desktop sizing не растягиваются этим изменением.

### Correctness and UX invariants

- touch-target расширяется только для coarse pointer и только внутри рамки сообщения;
- соседние messages не получают overlapping invisible hit areas;
- jitter tolerance не блокирует scroll и не запускает reply;
- long-press timer открывает одно context menu и корректно очищается;
- native selection guard, links и interactive child controls не деградируют.

### Verification

- component regression: pointerdown по article padding + micro vertical jitter → menu;
- component regression: video-note shell jitter/right-click → menu;
- component regression: large vertical gesture → no menu/reply;
- component regression: deliberate horizontal swipe → reply;
- CSS regression: coarse text bubble имеет 48×48 target, video note исключён;
- full `make ci`, Docker Compose health и in-app browser smoke.

### Definition of Done

- короткая рамка сообщения легко удерживается пальцем на Pixel-class viewport;
- небольшой дрейф пальца не сбрасывает меню действий;
- scroll, swipe reply, links, кружки и desktop layout работают как раньше;
- automated, Docker и browser проверки зелёные.

### Result

- coarse-pointer non-video bubbles имеют реальную framed minimum size 48×48 px,
  без overlapping pseudo hit-area и без изменений desktop layout;
- общий gesture state игнорирует до 10 px micro-jitter, после чего различает
  vertical scroll и deliberate horizontal reply как раньше;
- загруженный видеокружок считает и внутреннюю кнопку, и свободную shell-область
  одной gesture surface; retry/download controls остаются интерактивными;
- article ловит `contextmenu` в capture-фазе, поэтому right-click по media child
  гарантированно открывает одно message action menu;
- component/CSS regressions покрывают padding hit, jitter, vertical cancel, swipe,
  video-note shell long-press и shell right-click;
- полный `make ci` прошёл: backend `272 passed, 12 skipped`, Rust/OpenMLS `23 passed`,
  frontend `314 passed`; Docker Compose и health endpoint зелёные;
- свежая PWA проверена через in-app browser на коротком QA-сообщении «Ок»;
  тестовое сообщение удалено, coarse Pixel hardware acceptance остаётся за устройством.
