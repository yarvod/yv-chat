# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-042 — Bounded message history and encrypted local archive

Статус: **completed**
Backlog: `BL-022`
Цель: разговор с историей длиннее одной HTTP-страницы открывается с последних
сообщений, позволяет стабильно догружать старые страницы и восстанавливает
локально сохранённый ciphertext без хранения расшифрованного текста.

### Инварианты

1. PostgreSQL остаётся authoritative source в пределах server retention. Новый
   history contract возвращает bounded latest/before pages в стабильном ascending
   порядке и повторно проверяет active user/membership authorization.
2. Existing forward `after_sequence` API и cursor sync сохраняют совместимость.
   `before_sequence` всегда exclusive; server вычисляет `has_more` через bounded
   `limit + 1`, а не по непрерывности sequence после TTL purge.
3. Клиент открывает latest page, а не первые 100 сообщений. `load older` не создаёт
   пропусков/дублей и сохраняет visual scroll anchor.
4. Local archive реализует application port и отдельный IndexedDB adapter. В нём
   сохраняются только transport `OpaqueMessage`, зашифрованные AES-256-GCM под
   non-extractable browser-installation key с AAD, связывающим owner/conversation/
   sequence/schema.
5. `TimelineMessage.displayBody`, plaintext, message keys, session credentials и
   crypto private state никогда не сериализуются в archive records или логи.
6. Archive bounded per conversation; client reactive window также bounded. При
   переходе в старую историю пользователь может явно вернуться к latest page.
7. Corrupt/tampered/swapped records удаляются или игнорируются fail-closed. Отказ,
   eviction или запрет IndexedDB не ломает online messaging и отражается понятным
   non-blocking storage status.
8. Realtime/sync additions, duplicate retries и tombstones обновляют archive
   idempotently через authorized single-message fetch; read/delivery cursor
   продвигается только до реально полученного newest sequence.
9. Изменение покрывается application, HTTP, PostgreSQL repository, IndexedDB,
   orchestration и Vue interaction tests, включая >100 pre-existing messages.

### План

- [x] Добавить backend latest/before history Query/Result DTO и repository port.
- [x] Реализовать SQLAlchemy/fake adapters и versioned HTTP history response.
- [x] Покрыть stable ordering, authorization, gaps, bounds и >100 history tests.
- [x] Добавить typed frontend history DTO/parser/gateway method.
- [x] Добавить `MessageArchive` port и AES-GCM IndexedDB adapter с bounded retention.
- [x] Подключить cached hydration, network reconciliation и idempotent archive writes.
- [x] Добавить load-older/latest state и bounded reactive timeline orchestration.
- [x] Добавить UI controls с сохранением scroll anchor и accessible status.
- [x] Проверить storage corruption/unavailability, duplicates, tombstones и reload.
- [x] Обновить architecture/backlog/bugs, прогнать полный CI и commit/push.

### Definition of Done

- conversation с 205 сообщениями сначала показывает sequences `106..205`, затем
  догружает `6..105` и `1..5` без пропусков/дублей и с устойчивой позицией scroll;
- reload может показать зашифрованную local page до завершения network reconcile;
- raw IndexedDB inspection не содержит `displayBody`/plaintext и ключ не extractable;
- altered ciphertext/AAD не превращается в UI plaintext и не ломает network fallback;
- active timeline/archive имеют явные bounds и не растут бесконечно;
- старый `after_sequence` endpoint и reconnect/cursor sync tests остаются зелёными;
- backend Ruff/format/mypy/pytest, frontend lint/typecheck/Vitest/build и repository
  config/security gates проходят.
