# Текущий workplan

## WP-131 — Live-tail restoration и bounded device-history completion

Статус: **completed locally; production pending**
Backlog: `BL-FIX-060`

Цель: возврат Settings → Chats должен различать exact historical anchor и durable
intent «я был на актуальном хвосте»; history relay не должен после исчерпания
bounded попытки сам запускать тот же полный цикл каждые 30 секунд.

### Reproduction evidence

- `ConversationViewportAnchor.atLatest=true` сейчас всё равно проходит через
  `alignMessage(anchor.messageId, anchor.offset)`, поэтому сохранённая последняя строка
  восстанавливается как historical anchor вместо прокрутки к текущему концу;
- unmount предпочитает ранее captured debounced anchor свежему DOM-положению, поэтому
  быстрый переход после ручной прокрутки может сохранить промежуточную строку;
- `SynchronizeDeviceHistory.run()` после исчерпания peer polling возвращает
  `waiting_peer` и оставляет durable job; recurring `resume()` через 30 секунд запускает
  новый полный export/list/ACK цикл без пользовательского решения;
- после исчерпания retryable exceptions `retryJob()` не публикует terminal state и не
  удаляет job, что также разрешает бесконечный background restart.

### Scope

- `atLatest` восстанавливается как live-tail intent через instant scroll к текущему
  концу, exact offset используется только для `atLatest=false`;
- unmount сохраняет фактический видимый anchor, используя debounced capture только
  когда DOM уже скрыт/недоступен;
- completed, terminal и exhausted relay attempts получают однозначное durable/UI
  состояние; automatic recurring resume не перезапускает exhausted transfer;
- stable chunk IDs, ACK idempotency, pairing/device/conversation binding и server
  per-conversation ceiling остаются неизменными.

### Tests

- component stress: 1000 timeline rows, bottom → unmount/settings → remount/chat
  остаётся на новой последней строке без scroll-to-latest action;
- stale pending anchor не побеждает фактический bottom position on unmount;
- application stress: 1000 записей из нескольких direct conversations сходятся
  на обоих peer archives с полными ACK и без duplicate/conflict;
- group rows проверяются через authoritative server history path: они намеренно не
  идут через direct MLS relay, но входят в общий mixed-history acceptance;
- exhausted peer wait и retryable failures не запускаются снова recurring timer-ом;
- focused/full frontend tests, lint, typecheck, production/PWA build;
- local in-app browser QA на временном 1000-message fixture с реальным MessagePanel.

### Security and data invariants

- direct historical plaintext переносится только внутри existing MLS-protected relay;
- group history остаётся server-authoritative in retention window и не маскируется под
  E2EE device relay;
- никакие local archive/key/session данные не очищаются для восстановления viewport;
- retry bounding не ослабляет fail-closed binding validation и не повышает Nginx quota.

### Definition of Done

- актуальный хвост после Chats → Settings → Chats остаётся актуальным;
- historical reader возвращается к exact message-relative offset;
- 1000 mixed records проходят автоматизированный union/server-history stress без
  потерь, конфликтов и duplicate chunks;
- исчерпанная попытка остаётся остановленной до explicit нового user action;
- local browser QA, полный CI и production rollout зелёные.

### Local result

- `atLatest=true` теперь сначала загружает authoritative latest window при
  `historyHasNewer`, затем мгновенно открывает текущий конец; historical anchors
  сохраняют exact message-relative offset;
- route unmount сохраняет фактическую DOM-позицию и использует debounced capture
  только как fallback;
- peer wait/retry exhaustion сохраняет durable blocked reason, не запускается
  recurring timer-ом после remount и предлагает explicit «Повторить»;
- stress union: `1000` mixed records (`600` direct / `400` group), exact `40` unique
  relay chunks, все ACK, на target archive все `1000` записей;
- in-app Browser: реальный MessagePanel с `1000` DOM rows, `5` циклов
  Chat → Settings → Chat; каждый раз distance from bottom `0`, last row visible,
  scroll-to-latest action absent, console errors absent;
- frontend: `65` files / `413` tests passed, ESLint, Nuxt typecheck и production/PWA
  build зелёные.
