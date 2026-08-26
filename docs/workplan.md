# Текущий workplan

## WP-129 — Retry-safe device history sync и спокойный iOS date separator

Статус: **completed and production deployed**
Backlog: `BL-FIX-058`

Цель: двусторонний history relay не должен уничтожать durable job при временном
Nginx rate limit, а sticky date separator на iOS не должен рисовать тяжёлый серый
ореол поверх media.

### Production evidence

- pairing `3008a1c6…` создал 15 opaque chunks с двух устройств и `0` ACK;
- exact pairing ingress вернул `64 × 200` и `2 × 429`;
- UI показал `126` экспортируемых записей, `0/7` подтверждённых чатов и terminal
  «непредвиденную ошибку»;
- Nginx pairing zone ограничена `120r/m`, `burst=40`, поэтому два устройства на
  одном Wi-Fi закономерно могут получить transient `429` во время burst;
- date pill использует `0 4px 14px / 8%` shadow вместе с `blur(14px)`, который
  Safari визуально раздувает над светлым изображением.

### Scope

- централизованная history-sync failure policy различает transient `408/429/5xx`
  и permanent authorization/validation `4xx`;
- `429` сохраняет durable job, показывает понятное rate-limit состояние и повторяет
  тот же pairing/envelopes с bounded backoff;
- существующая single-flight очередь и idempotent chunk IDs сохраняются;
- iOS/browser date pill получает меньший blur и компактную малоконтрастную тень;
- regressions покрывают auto-retry после `429`, UI copy и CSS contract.

### Security and data invariants

- binding mismatch, чужой pairing/device/conversation и permanent `4xx` не
  превращаются в бесконечный retry и остаются fail-closed;
- retry не создаёт новый pairing, device identity, archive key или logical chunk ID;
- ACK выполняется только после durable local import;
- server не получает plaintext direct history или local archive key;
- group v1 остаётся server-readable и синхронизируется обычным cursor sync; этот fix
  не объявляет группы E2EE и не меняет crypto protocol.

### Tests

- application regression: первый history request получает `429`, job остаётся и
  следующий запуск автоматически продолжает тот же pairing;
- component regression: rate limit не показывается как terminal unknown failure;
- CSS regression: date separator использует bounded shadow/blur;
- полный frontend Vitest, ESLint, Nuxt typecheck и production/PWA build.

### Definition of Done

- подтверждённый transient `429` больше не удаляет sync job;
- UI сообщает об автоматическом продолжении, а не требует нового QR;
- permanent security errors не ретраятся;
- date separator на iPhone не создаёт большой тёмный ореол;
- tracking docs и frontend checks зелёные, изменение зафиксировано focused commit.

Результат: HTTP `429` выделен в transient `rate_limited`, durable job больше не
удаляется и повторяется с bounded `5–30s` device-staggered backoff. Banner и Settings
объясняют автоматическое продолжение без нового QR. Date pill использует компактные
`0 2px 6px / 5%` shadow и `blur(7px)` вместо тяжёлых `14px`. Frontend: `403 passed`,
ESLint, Nuxt typecheck и production/PWA build зелёные; локальный mobile browser QA
`390×844` подтвердил лёгкую тень над светлым media fixture.

### Production rollout

- commit `9d08b10b6d2768eca68e218c3c996cce3de883b7`;
- deploy workflow `32961867768` и отдельный CI `32961867712` завершились успешно;
- backend/frontend развёрнуты с immutable tag
  `sha-9d08b10b6d2768eca68e218c3c996cce3de883b7`;
- оба production origin и health endpoint вернули HTTP `200`;
- корректный unauthenticated WebSocket upgrade достиг приложения с ожидаемым `403`,
  `nginx -t` успешен, production-контейнеры healthy.
