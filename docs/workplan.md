# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-044 — Encrypted offline outbox and idempotent recovery

Статус: **completed**
Backlog: `BL-023`
Цель: отправка из PWA сначала надёжно фиксируется в bounded encrypted local outbox,
показывается пользователю как optimistic message и безопасно повторяется после
network failure/restart без дублей или потери уже committed server message.

### Инварианты

1. До первого network request immutable envelope получает один UUID
   `client_message_id`, проходит protocol protection и атомарно сохраняется локально.
   Retry никогда не создаёт новый ID и не меняет conversation/protocol/ciphertext.
2. В persistent outbox нет plaintext, session credentials или private crypto state.
   Записи шифруются AES-256-GCM под per-account non-extractable key; AAD связывает
   schema, owner, authenticated sender device и client message ID.
3. Состояния явные: `pending → sending → sent`; retryable network/5xx/invalid-response
   возвращает запись в `pending` с bounded exponential backoff, permanent 4xx делает
   `failed`, manual retry переводит только `failed` обратно в `pending`.
4. Crash в любой точке безопасен. Persisted `sending`/`sent` после restart снова
   отправляется тем же exact envelope; backend idempotency возвращает существующий
   authoritative result после crash-between-commit-and-ack.
5. Entry удаляется только после server acknowledgement и локального reconciliation.
   Для активного conversation authoritative message сначала попадает в history
   archive/timeline; для неактивного conversation durable sync остаётся источником
   истины.
6. Reconnect WebSocket, fallback poll и ручной retry запускают flush, но одновременно
   работает не более одного account+device-scoped flush loop.
7. Queue ограничена количеством записей и размером envelope. При quota/full/corrupt
   storage отправка не выполняется напрямую в обход durable enqueue; UI сохраняет
   draft и показывает честную ошибку.
8. UI различает `В очереди`, `Отправляем`, `Отправлено` и `Не отправлено`; failed
   bubble имеет доступную кнопку повторной попытки. Pending status не выдаётся за
   server delivery/read receipt.
9. Logout/account/device switch не смешивает записи: каждый query/mutation scoped
   по owner и текущему authenticated `device_id`; stale outbox старого login-device
   никогда не отправляется под новым backend idempotency scope. API не принимает
   owner/device ID от UI как authorization boundary — оба берутся из principal.

### План

- [x] Проверить backend exact-idempotency и transport response contract.
- [x] Добавить typed outbox domain model, ports и отдельные use cases.
- [x] Реализовать bounded encrypted IndexedDB adapter и strict codec.
- [x] Возвращать typed authoritative send receipt из HTTP gateway.
- [x] Интегрировать enqueue/flush/reconcile/retry в messenger и realtime reconnect.
- [x] Добавить optimistic status/retry UX без plaintext persistence.
- [x] Покрыть encryption/tamper/quota, crash/restart, retry/backoff/conflict и UI tests.
- [x] Обновить architecture/backlog/bugs и local-first security limitations.
- [x] Прогнать полный CI, commit/push, production deploy и external smoke-test.

### Definition of Done

- offline submit очищает composer только после durable encrypted enqueue и остаётся
  видимым после reload;
- reconnect доставляет exact envelope один раз логически, включая server commit без
  полученного client acknowledgement;
- permanent failure виден на конкретном optimistic bubble и допускает manual retry;
- outbox не растёт без лимита и не содержит recoverable plaintext в raw IndexedDB;
- successful reconciliation удаляет queue entry и оставляет authoritative message;
- lint/typecheck/Vitest/build и полный repository CI проходят.
