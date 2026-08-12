# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-069 — Automatic MLS roster reconciliation

Статус: **implemented and full-CI verified locally**

Цель: уже подключённый MLS device автоматически подтверждает добавление нового
device во всех затронутых личных чатах, даже если эти чаты не открыты и собеседники
offline.

### Production reproduction

- новый Mac PWA публикует identity/KeyPackages и открывает существующий direct chat;
- backend корректно создаёт `blocked/device_roster_changed` и durable
  `conversation_updated` для всех участников;
- старый leaf остаётся online, но frontend запускает reconciliation только для
  активного conversation;
- новый PWA не получает Commit/Welcome, пока кто-либо со старым leaf — часто сам
  собеседник — вручную не откроет тот же чат;
- history decrypt дополнительно вызывает `/crypto/bootstrap` для каждого envelope,
  создавая десятки повторных HTTP/KeyPackage checks на одной READY generation.

### Scope

- [x] cold startup последовательно reconciles все direct conversations;
- [x] durable `conversation_updated` reconciles именно изменившийся direct, даже если
  он неактивен;
- [x] sync reset reconciles authoritative direct roster после reload;
- [x] ошибка неактивного direct остаётся fail-closed локально и не ломает активный чат;
- [x] stable READY generation кэшируется до явного sync invalidation, а не сбрасывается
  перед каждым message protect/unprotect;
- [x] тест воспроизводит inactive direct + roster-change event и доказывает background
  reconciliation без выбора этого чата.

### Security invariants

- новый device не назначает себя coordinator старой READY group;
- Commit всё ещё создаёт только сохранившийся previous leaf;
- server остаётся authoritative: message POST принимает только exact current READY
  generation/epoch и active required-device roster;
- потерянное local MLS state, отсутствие всех previous leaves и v1 fallback не
  маскируются автоматическим downgrade;
- никакие message payload, private keys или Welcome bytes не логируются.

### Exclusions

- recovery, если offline или потеряны все прежние leaves — `BL-064`/`BL-015`;
- перенос pre-enrollment history на новый device;
- изменение MLS framing, server schema или cryptographic primitives.

### Definition of Done

- inactive direct reconciles после durable roster event;
- startup reconciles все direct chats bounded sequentially;
- два protect/unprotect на stable generation не инвалидируют её дважды и не создают
  повторный bootstrap storm;
- frontend lint/typecheck/tests/build, Rust/OpenMLS regression и полный `make ci`
  проходят;
- production metadata подтверждает READY generation и offline send без входа peer.

### Verification evidence

- production цепочка `Julproh`: новый Mac announcement → Android previous leaf Commit
  → READY Welcome/ack → Mac v2 send, пока peer не участвовал в coordination;
- regression: active direct A + inactive direct B + durable roster event B вызывает
  reconcile B без reconcile A;
- frontend `42 files / 232 tests`, backend `238 passed, 9 skipped`, OpenMLS `21 tests`;
- полный `make ci`: green.
