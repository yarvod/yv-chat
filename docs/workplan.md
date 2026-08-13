# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-075 — Dual production origins

Статус: **in progress**

Цель: один и тот же production messenger безопасно работает через
`https://chat.yoowee.ru` и `https://chat.yoowee.com.de`, не затрагивая соседние
сервисы общего VPS/Nginx.

### Scope

- оба DNS A records указывают на production VPS;
- один scoped yv-chat vhost обслуживает оба `server_name` и использует один
  Certbot SAN-сертификат с обоими именами;
- backend strict `ALLOWED_ORIGINS` содержит оба HTTPS origin;
- versioned Nginx source, deploy assertions, architecture и runbook фиксируют
  dual-origin contract;
- cookies, PWA/Service Worker, IndexedDB и E2EE device state остаются
  origin-scoped; междоменный перенос local state не добавляется.

### Security and rollout invariants

- cookies сохраняют `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict` и не получают
  `Domain` attribute;
- CORS/Origin wildcard не используется;
- certificate выпускается существующим webroot Certbot без автоматического
  редактирования чужих vhost;
- до каждого graceful reload сохраняется unique chat-vhost backup и выполняется
  общий `nginx -t`; при ошибке восстанавливается только chat-vhost;
- `yoowee.ru`, S3 и остальные Nginx configs/containers не изменяются.

### Definition of Done

- сертификат содержит оба DNS SAN и renewal config сохраняет оба имени;
- API/frontend отвечают `200` через оба HTTPS origin;
- unauthenticated WebSocket через оба origin доходит до backend (`403`, не `502`);
- state-changing request с новым exact Origin проходит Origin boundary и получает
  application response, а неизвестный Origin остаётся запрещён;
- yv-chat healthy, соседние `infra-*` containers сохраняют uptime;
- deploy/docs checks проходят, production evidence записан.
