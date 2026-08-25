# Текущий workplan

## WP-128 — Reply и long-press непосредственно на media сообщения

Статус: **completed and production deployed**
Backlog: `BL-FIX-057`

Цель: фото и sticker внутри message bubble участвуют в том же touch gesture
contract, что и рамка сообщения: обычный tap открывает media viewer, deliberate
right swipe начинает reply, long-press открывает message context menu.

### Scope

- photo/sticker action surface допускается как message gesture target, несмотря на
  внутренний `<button>`;
- tap без gesture сохраняет существующее открытие viewer;
- после long-press/swipe следующий synthetic click подавляется, чтобы viewer не
  открылся поверх context/reply;
- vertical scroll и остальные interactive controls не меняются;
- существующий video-note gesture contract остаётся тем же.

### Security and data invariants

- attachment download/cache/E2EE, authorization и message mutation не меняются;
- gesture использует только уже отрисованный authorized timeline message;
- context actions продолжают проходить существующие application use cases.

### Tests

- component regression: plain photo tap не подавляется;
- component regression: long-press на фото открывает actions и подавляет viewer click;
- component regression: right swipe на фото начинает reply и подавляет viewer click;
- существующие bubble/video-note gesture tests остаются зелёными;
- полный frontend Vitest, ESLint, Nuxt typecheck и production/PWA build.

### Exclusions

- изменение media viewer zoom/navigation;
- собственные gestures поверх native video controls;
- изменение context-menu actions или reply payload;
- redesign bubble/media layout.

### Definition of Done

- reply и hold работают на самих pixels фото/стикера, не только на рамке bubble;
- tap по-прежнему открывает media;
- scroll не превращается в reply из-за vertical movement;
- tracking docs и frontend checks зелёные, изменение зафиксировано focused commit.

Результат: photo/sticker buttons теперь являются message gesture surfaces. Tap
доходит до viewer как раньше, а long-press/right swipe используют bubble gesture
state и suppress-ят только synthetic click после состоявшегося gesture. Frontend:
`399 passed`, ESLint, Nuxt typecheck и production/PWA build зелёные.

Production rollout: commit `e384a36` развёрнут workflow `32902619863` immutable
образами `sha-e384a36f2bd48299fa228f226c8a788ab672b9b2`. API, cleanup и
frontend healthy; оба public origin вернули frontend/health HTTP `200`,
unauthenticated WebSocket upgrade дошёл до FastAPI с ожидаемым `403`, `nginx -t`
успешен.
