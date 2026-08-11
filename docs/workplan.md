# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-013 — Idempotent message creation и ordering

Статус: **completed**
Backlog item: `BL-007`
Цель: сделать retry безопасным, а порядок concurrent messages стабильным и пригодным для cursor pagination.

### Результат

Каждая device отправляет client-generated UUID; повтор идентичного envelope возвращает тот же message, конфликтующее переиспользование ID отклоняется. Conversation row lock сериализует выделение monotonically increasing sequence. Authenticated members читают bounded ascending pages после sequence.

### Invariants

1. Idempotency key уникален в scope sender device.
2. Идентичный retry не создаёт новый row/sequence.
3. Тот же key с другим conversation/version/ciphertext даёт conflict.
4. Sequence положителен и уникален внутри conversation.
5. Conversation row lock сериализует concurrent allocation.
6. Ordering не зависит от client timestamp.
7. Pagination bounded, строго ascending `(sequence, id)` и membership-authorized.
8. Message create и sequence allocation находятся в одной transaction.
9. List возвращает ciphertext только как base64 opaque envelope.
10. Plaintext/key fields по-прежнему отсутствуют.

### План

- [x] Расширить Message client ID/sequence invariants и tests.
- [x] Расширить repository port/adapter idempotency lookup, next sequence и list-after.
- [x] Добавить migration `0009` с backfill и unique constraints.
- [x] Обновить send use case для row lock и exact retry comparison.
- [x] Добавить ListMessages use case и bounded HTTP pagination.
- [x] Добавить concurrency/retry/application/HTTP/PostgreSQL tests.
- [x] Проверить migration roundtrip/base→head, full CI и Docker head.
- [x] Обновить docs и создать отдельный commit.

### Не входит в scope

- global sync event cursor/WebSocket;
- edits/deletes/receipts;
- TTL;
- actual E2EE;
- frontend timeline.

### Проверка готовности

- concurrent sends получают разные последовательные sequence;
- exact retry возвращает исходный ID/sequence и один DB row;
- conflicting retry даёт 409;
- list-after не пропускает/не дублирует rows;
- full checks зелёные и отдельный commit создан.
