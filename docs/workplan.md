# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-049 — Production hotfix idempotent blocked MLS bootstrap

Статус: **in progress**
Bug: `BUG-048`
Цель: убрать HTTP 500 при повторной reconciliation старых conversations и честно
возвращать стабильный `blocked/missing_identity` до регистрации всех active devices.

### План

- [x] Подтвердить production traceback без чтения ciphertext/private state.
- [x] Найти нарушенный idempotency path и сохранить cross-conversation conflict.
- [x] Вернуть exact existing generation для retry независимо от её статуса.
- [x] Добавить regression для repeated blocked bootstrap: одна generation, один commit.
- [x] После terminal blocked сохранить новый durable request ID, чтобы следующая
  reconciliation могла проверить уже появившиеся identity/KeyPackages.
- [x] Не считать legacy device без зарегистрированной MLS identity обязательным leaf;
  добавлять его следующим roster Commit после provisioning.
- [x] Исправить revoke/relogin catch-up: skip pre-enrollment generations, historical
  Welcome ack и обязательная server reconciliation перед message crypto operation.
- [x] Прогнать backend/full CI, PostgreSQL integration и diff/security review.
- [ ] Commit/push, production deploy и проверить отсутствие новых 500.
- [ ] Вернуть `WP-048` encrypted attachments в active workplan после hotfix commit.

### Definition of Done

- same request получает одинаковый blocked/pending/ready result и не пишет вторую row;
- request ID другой conversation остаётся conflict, а не утечкой чужого state;
- production перестаёт логировать unique violation и UI получает bounded block reason;
- после устранения block reason клиент создаёт новую операцию и автоматически
  продолжает bootstrap, не нарушая идемпотентность старой попытки;
- старые non-revoked device rows без MLS identity не блокируют переписку уже
  подготовленных устройств и не получают ciphertext до собственного enrollment;
- `missing_identity` объяснён как состояние непрошедшего provisioning другого active
  device, а не как повреждение миграцией.
