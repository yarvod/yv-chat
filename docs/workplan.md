# Текущий workplan

## WP-096 — Android long-link timeline sizing regression

Статус: **implemented, full-CI, Docker and browser verified; physical Android acceptance pending**
Backlog: `BL-077`
Bug: `BUG-086`

Цель: вернуть корректную высоту сообщений с длинными ссылками и media на Android,
сохранив 48×48 touch target коротких bubbles и все новые message gestures.

### Root cause

- `WP-095` добавил explicit `min-height: 48px` только для coarse pointer;
- `.message-timeline` — column flex container, а bubbles сохраняли default
  `flex-shrink: 1`;
- explicit minimum заменил content-based automatic minimum, поэтому высокий bubble
  мог сжаться до touch minimum, пока link/media content рисовался за его границами;
- desktop не затронут, потому что coarse media query там не активен.

### Scope

- message bubble явно запрещает shrink по block axis внутри timeline;
- 48×48 coarse minimum остаётся только нижней границей короткого сообщения;
- long URL продолжает переноситься через существующий `overflow-wrap: anywhere`;
- media/gallery bubble занимает реальную intrinsic/content height;
- ordering, sticky day labels, scroll restoration и gestures не меняются.

### Correctness and UX invariants

- bubble height не может стать меньше laid-out text/media content;
- длинные ссылки не выходят за рамку и не накладываются на следующие messages;
- короткий touch target не уменьшается ниже 48×48;
- desktop layout и максимальная ширина messages остаются прежними;
- fix не использует fixed height или content clipping.

### Verification

- CSS regression фиксирует `flex-shrink: 0` на base bubble и coarse 48×48 minimum;
- existing long-link segmentation/wrapping и media layout tests зелёные;
- full `make ci`, Docker Compose health и in-app browser long-link smoke;
- после production rollout оба HTTPS health endpoint зелёные.

### Definition of Done

- Android timeline с длинными ссылками/media не схлопывается и не перекрывается;
- touch target и message actions предыдущих WP не деградируют;
- automated, Docker, browser и production проверки зелёные.

### Result

- root cause подтверждён: `flex-shrink: 1` вместе с coarse-only explicit
  `min-height` позволял column flex container сжимать высокий bubble до touch minimum;
- base `.message-bubble` получил `flex-shrink: 0`, сохранив 48×48 minimum коротких
  сообщений и полную content height длинных ссылок/media;
- backend: `272 passed, 12 skipped`; Rust/OpenMLS: `23 passed`; frontend:
  `315 passed`; lint, typecheck, build, Compose/deploy/docs gates зелёные;
- свежий production frontend image поднят локально в Docker, healthchecks и
  `/api/v1/health` зелёные;
- in-app browser smoke отправил три сообщения с длинными URL: bubbles сохранили
  независимую высоту без overlap; QA fixtures затем удалены;
- проверка на физическом Android остаётся acceptance-шагом после production rollout.
