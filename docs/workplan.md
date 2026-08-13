# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-075 — Dual production origins

Статус: **completed and production verified** (`dda65a4`, workflow
`31702700102`)

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

### Verification

- DNS с production VPS: оба имени резолвятся в `31.192.110.84`;
- immutable deployment tag —
  `sha-dda65a4d85b531fb38c16bd41d42fa4db3994335`; yv-chat containers healthy;
- Let’s Encrypt certificate SAN: `chat.yoowee.ru`, `chat.yoowee.com.de`, срок до
  `2026-11-11`; renewal authenticator — `webroot`, path `/var/www/html`;
- общий `nginx -t` и graceful reload прошли; scoped vhost backup —
  `/etc/nginx/conf.d/chat.yoowee.ru.conf.before-dda65a4`;
- оба HTTPS origin вернули API/frontend `200`, unauthenticated WebSocket `403`;
  публичный DNS/TLS request к `.com.de` также вернул `200`;
- exact `.com.de` Origin дошёл до application validation (`400` на synthetic invalid
  invite), неизвестный Origin отклонён (`403`);
- соседние `infra-*` containers сохранили uptime; temporary `.env` backup с
  production secrets удалён после проверки нового mode-`0600` файла.
