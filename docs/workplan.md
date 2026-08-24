# Текущий workplan

## WP-125 — Годовое server retention для сообщений и media

Статус: **production deployed**
Backlog: `BL-018`
ADR: `ADR-0006`

Цель: переключить production с 30-дневного на годовое хранение server-side
ciphertext и committed media, продлив ещё не удалённые существующие записи без
сокращения их текущего срока.

### Scope

- production ciphertext retention: `31536000` секунд (365 дней);
- production tombstone retention: `63072000` секунд (730 дней), строго больше
  ciphertext и sync windows;
- data migration продлевает active сообщения до `created_at + 365 days`, только если
  новый expiry позже текущего;
- committed attachment expiry выравнивается с продлённым message expiry;
- deploy-time reconciliation повторяет extension-only операцию с фактической typed
  configuration после rollout, закрывая окно между migration и заменой API;
- pending/uncommitted uploads сохраняют bounded TTL 24 часа;
- примеры production configuration и архитектурная документация фиксируют semantics
  увеличения и последующего уменьшения срока.

### Security and data invariants

- ciphertext/media остаются opaque, plaintext, filename и crypto keys не читаются и
  не логируются;
- deleted/tombstoned messages и уже удалённые media не восстанавливаются;
- reconciliation никогда не оживляет tombstone и не сокращает существующий expiry;
- committed media продлевается только через существующую FK-связь с active message;
- cleanup остаётся bounded/idempotent, pending uploads не становятся бессрочными.

### Tests

- application: extension-only для active messages, committed media alignment,
  deleted/pending records untouched, repeat is no-op;
- persistence: bulk updates возвращают точные counts и соблюдают extension-only
  predicates;
- migration graph и fresh database upgrade to head;
- backend Ruff format/lint, mypy и полный pytest;
- production Compose/config/deploy script checks;
- production post-deploy redacted verification: effective settings, Alembic head,
  active message/media expiry boundaries и public health.

### Exclusions

- forever retention и per-conversation/type overrides;
- восстановление уже очищенных ciphertext/media из backups;
- изменение 30-дневного sync-event window;
- изменение local device archive/cache policy;
- global disk quota/dashboard из `BL-019`.

### Definition of Done

- новые production messages получают expiry `created_at + 365 days`;
- все сохранившиеся active сообщения имеют expiry не раньше годовой policy, а их
  committed media — тот же expiry;
- pending media по-прежнему истекает через 24 часа;
- migration, reconciliation и повторный deploy безопасны и idempotent;
- checks проходят, изменения собраны в один focused commit и production rollout
  проверен без вывода content/secrets.

### Acceptance

- backend: Ruff format/lint, import boundaries и mypy проходят; полный suite —
  `293 passed`, `12 skipped`;
- fresh PostgreSQL применил все migrations до `0030_year_retention`; PostgreSQL
  integration — `2 passed`;
- Compose, deploy shell/runbook guards, docs и `git diff --check` проходят;
- production workflow `32769115857` развернул immutable
  `sha-424ab59e3d5bb2b55408cf5c33d90f1ea863b8b0`;
- API и cleanup получают effective `31536000/63072000`, Alembic head —
  `0030_year_retention`;
- production aggregates: `503` active messages, `0` короче 365 дней, minimum
  retention `31536000` секунд; `72` committed active media, `0` короче linked
  message expiry; pending media — `0`;
- оба public origins вернули health/frontend HTTP `200`.
