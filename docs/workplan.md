# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-036 — Docker gateway upstream re-resolution hotfix

Статус: **completed**
Bug: `BUG-024`
Цель: исключить production `502` после пересоздания API/frontend контейнера, не
затронув соседние Compose projects и не ослабив ingress/security boundaries.

### Инварианты

1. Gateway остаётся единственным loopback-published container проекта.
2. Upstream names разрешаются через Docker embedded DNS во время запросов, а не
   закрепляются к container IP на момент запуска Nginx.
3. API/frontend остаются только в internal network; PostgreSQL наружу не публикуется.
4. Hotfix не выполняет project-wide `down`, `--remove-orphans` или prune и не трогает
   containers `infra-*`.

### План

- [x] Read-only production diagnosis: host/gateway/API health и scoped logs.
- [x] Восстановить доступ перезапуском только `yv-chat-gateway-1`.
- [x] Добавить runtime Docker DNS resolution для API и frontend upstreams.
- [x] Добавить deploy contract checks, фиксирующие resolver/variable proxy passes.
- [x] Проверить Nginx syntax/runtime against isolated production network.
- [x] Прогнать deploy/full repository checks, обновить bug record и сделать commit.

### Definition of Done

- public `/api/v1/health` снова отвечает `200`;
- новый gateway config проходит `nginx -t` и переживает replacement upstream address;
- соседние services не перезапущены;
- CI/deploy contracts зелёные, BUG-024 документирован и commit отправлен.

### Проверка

- production diagnosis: frontend `200`, API routes `502`, API container own health
  `200/healthy`, gateway log `connect() failed (111)` к прежнему upstream address;
- scoped recovery: restart только `yv-chat-gateway-1`, public health восстановлен;
- pinned production Nginx image: `nginx -t` passed с новым config;
- isolated Docker network: request до replacement `404`, API address принудительно
  изменён, request после resolver TTL также `404` вместо `502`;
- live config установлен с backup/automatic rollback guard, `nginx -t`, graceful
  reload и final public health `200`; соседние `infra-*` не изменялись;
- repository `make ci` выполняется перед commit.
