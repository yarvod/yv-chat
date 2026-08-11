# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-038 — Single host-Nginx production ingress

Статус: **completed**
Bug: `BUG-027`
Цель: production использует единственный уже установленный host Nginx + system
Certbot. Контейнерный Nginx остаётся только в local integrated Compose; production
host напрямую проксирует loopback-only frontend/API ports.

### Security and availability invariants

1. Только host Nginx слушает public `80/443`; yv-chat API/frontend публикуются строго
   на `127.0.0.1`, PostgreSQL/cleanup наружу не публикуются.
2. `/api/` и `/api/v1/realtime` идут напрямую в API; `/` — во frontend. WebSocket
   upgrade, original Host, scheme и trusted `X-Forwarded-For` chain сохраняются.
3. API доверяет только фактическому Docker bridge peer host-proxy, проверенному на
   production после rollout; arbitrary client XFF не становится authoritative.
4. Production Compose не содержит gateway service/image. Project-owned non-internal
   ingress network нужна только для Docker loopback port publishing. Local
   `compose.yml` сохраняет Nginx для integrated development smoke.
5. Deploy не выполняет `down`, `--remove-orphans` или prune; старый gateway удаляется
   только explicit scoped command после успешной прямой проверки обоих upstreams.
6. Host vhost меняется через temp file + `nginx -t` + atomic install/reload с backup
   rollback. Certbot certificate paths не меняются.
7. `infra-*` container IDs/start times и их host vhost остаются неизменны. Устаревший
   duplicate `sites-enabled/yoowee.ru` отключается только при сохранении рабочего
   `/etc/nginx/conf.d/esp.conf` route.
8. Rollback возвращает previous chat vhost и production Compose gateway без изменения
   database/media volumes.

### План

- [x] Проверить host listeners, оба домена, container baseline и duplicate vhost.
- [x] Отключить только устаревший duplicate `yoowee.ru` symlink с rollback checks.
- [x] Перевести production Compose на loopback API/frontend ports без gateway.
- [x] Обновить host HTTPS/HTTP vhost, deploy script/workflow contracts и runbook.
- [x] Выполнить local config/tests и server preflight на свободные ports.
- [x] Scoped production rollout: containers → trusted peer → host vhost → remove gateway.
- [x] Проверить parallel clients/WebSocket routing, TLS, root/chat и infra invariants.
- [x] Full CI и docs/bugs sync; отдельный commit/push выполняются после diff review.

### Definition of Done

- `docker compose -f compose.prod.yml config` не содержит production gateway;
- host `ss` показывает единственный Nginx owner public 80/443;
- chat frontend/API/WebSocket работают через разные loopback upstreams;
- API видит и доверяет только проверенный bridge peer, spoofed XFF tests остаются green;
- `yoowee.ru` и `chat.yoowee.ru` доступны, duplicate warning исчез;
- все pre-existing `infra-*` containers имеют прежние IDs и остаются `Up`;
- CI/deploy checks и live acceptance зелёные.
