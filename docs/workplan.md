# Текущий workplan

## WP-113 — Device-scoped multi-device call terminal semantics

Статус: **completed and production deployed** (`c581131`, workflow
`32417561086`)
Backlog: `BL-034`; bug `BUG-101`

Цель: устранить ложный `busy` и signaling teardown, когда один пользователь принимает
входящий звонок на одном из нескольких одновременно онлайн-устройств.

### Подтверждённое состояние

- один `call_offer` fan-out-ится всем online devices callee;
- busy frontend device отправлял общий `call_rejected(reason=busy)` для чужого
  `call_id`, хотя другое устройство того же пользователя могло принять звонок;
- coordinator удалял весь call по первому rejection до выбора `callee_device_id`;
- поздний answer другого device становился `CallStateConflictError`, после чего
  WebSocket transport закрывался кодом 4403;
- production API/coturn оставались healthy, поэтому ложный `busy` возникал до media
  connectivity и не являлся TURN outcome.

### Scope

- сделать автоматический busy строго device-local и совместимым со старыми PWA;
- сохранить first-answer-wins binding без возможности заменить выбранный endpoint;
- вернуть losing device terminal `answered_elsewhere` без signaling conflict;
- fan-out explicit decline sibling devices, чтобы их ringing UI не оставался stale;
- добавить backend и frontend regression tests.

### Security и protocol invariants

- actor, owned active device, direct membership и v2 authenticated SDP validation
  остаются обязательными;
- server не принимает SDP/identity binding проигравшего device как новый endpoint;
- неизвестные и invalid-order call transitions по-прежнему fail-closed;
- SDP, ICE, media и call identity material не добавляются в persistence/logging;
- WebRTC media остаётся DTLS-SRTP direct/TURN и не проходит через FastAPI.

### Exclusions

- durable call history или server-side media;
- group calls и native incoming-call integration;
- изменение TURN topology, credentials или Nginx;
- исправление отдельной path-specific packet loss между Wi-Fi ISP и VPS.

### Definition of Done

- busy одного callee device не завершает shared ringing call;
- другое device может после busy успешно стать authoritative callee endpoint;
- losing answer получает `answered_elsewhere` без `CallStateConflictError`;
- explicit decline закрывает ringing state на caller и sibling callee devices;
- targeted и full backend/frontend checks проходят;
- diff, docs и focused commit проверены.

### Реализация

- frontend игнорирует новый offer при локальном busy state без global rejection;
- coordinator игнорирует legacy `reason=busy` от callee на любой стадии call binding;
- late answer другого device возвращает ему targeted `call_ended/answered_elsewhere`;
- explicit pre-answer decline создаёт дополнительный terminal event всем sibling
  callee devices кроме отклонившего.

### Проверка

- targeted backend application/realtime call paths: `17 passed`;
- frontend `tests/voice-calls.test.ts`: `17 passed`;
- backend: Ruff check/format, mypy, `282 passed, 12 skipped`;
- frontend: ESLint, Nuxt typecheck, `360 passed`, production build;
- `docker compose config --quiet` и `git diff --check` прошли.

### Production rollout

- deployment workflow `32417561086` для `c581131` завершился успешно;
- API, cleanup и frontend запущены из immutable images
  `sha-c58113185b8b2b79dd42debbf35ce7d33f0716e0`;
- PostgreSQL, API и frontend healthy, оба production origin вернули health
  `200`, свежих API errors после rollout нет;
- coturn продолжает слушать UDP/TCP `3478` и TLS `5349`; TURN и
  Nginx configuration не менялись.
