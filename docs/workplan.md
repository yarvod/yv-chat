# Текущий workplan

## WP-132 — KeepAlive chat viewport reactivation

Статус: **completed and production deployed; physical iPhone acceptance pending**
Backlog: `BL-FIX-061`

Цель: переход `/chat → /settings → /chat` обязан восстанавливать сохранённый
message-relative viewport при фактическом Nuxt `KeepAlive` lifecycle, включая WebKit
reset скрытого scroll container к `scrollTop=0`.

### Root cause

- `/chat` объявлен с `keepalive: true`, поэтому Settings не размонтирует
  `MessagePanel`, а вызывает `deactivated/activated`;
- прежнее исправление и его 1000-row regression проверяли `unmount/remount`, то есть
  не тот lifecycle, который работает в production;
- `onMounted()` после возврата не вызывается, `restorationPending` не включается, а
  WebKit может вернуть отсоединённый scroll container с `scrollTop=0`.

### Scope

- flush последнего живого/captured viewport anchor при `deactivated`;
- explicit instant restore при `activated`, с повторным подключением layout observer;
- hidden zero-height pane по-прежнему не вычисляет новый anchor;
- live-tail и exact historical anchor остаются разными intent.

### Tests and result

- component regression использует настоящий Vue `KeepAlive`, 1000 сообщений,
  deactivation, принудительный reset `scrollTop=0`, новую строку и reactivation;
- Docker Compose production build с временным QA route: пять настоящих Nuxt
  `/chat-like → settings → chat-like` переходов, каждый раз distance from bottom `0`,
  row `#1000` видна, scroll-to-latest отсутствует, browser warnings/errors отсутствуют;
- временный QA Compose project, volumes/images/routes удалены после проверки;
- полный frontend CI в одноразовом `node:24-alpine` Docker container: `65` files /
  `413` tests, ESLint, Nuxt typecheck и production/PWA build зелёные;
- host Nuxt process не используется и остановлен; QA выполняется только в Docker.

### Definition of Done

- cached chat восстанавливается на activation, а не только на mount;
- bottom/live-tail и historical anchor проходят KeepAlive regression;
- Docker Browser QA и полный containerized frontend CI зелёные;
- production rollout и runtime acceptance успешны.

### Production result

- commit `5f6643d23e2ada5831cffc0959e3df58045c34a4`, manually dispatched production
  workflow `32987332840` success; automatic push event не был зарегистрирован GitHub,
  поэтому exact main SHA был запущен через `workflow_dispatch`;
- workflow verify заново выполнил полный repository CI, оба immutable images собраны,
  migration/isolated rollout успешны;
- exact tag `sha-5f6643d23e2ada5831cffc0959e3df58045c34a4` активен на frontend,
  API и cleanup; frontend/API/PostgreSQL healthy;
- оба origin и health endpoints вернули `200`, unauthenticated WebSocket — ожидаемый
  `403`, `nginx -t` успешен.
