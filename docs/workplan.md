# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-076 — Independent TLS certificates for production origins

Статус: **completed and production verified** (`5083743`, workflow
`31704063495`)

Цель: отказ DNS/регистрации или ACME validation одного production-домена не мешает
автоматическому продлению и работе TLS второго домена.

### Scope

- отдельный Certbot certificate lineage для `chat.yoowee.ru`;
- отдельный Certbot certificate lineage для `chat.yoowee.com.de`;
- два HTTPS `server`-блока выбирают сертификат по exact `server_name`;
- единый project-owned Nginx snippet содержит общие security headers, rate limit,
  API/WebSocket и frontend proxy rules без копирования конфигурации;
- общий port-80 server сохраняет ACME webroot и exact HTTPS redirect для обоих имён.

### Security and rollout invariants

- private keys не читаются, не копируются в repository и не выводятся;
- каждый renewal config содержит только свой domain и `webroot` authenticator;
- chat vhost и shared snippet устанавливаются с отдельными backups;
- общий `nginx -t` выполняется до graceful reload; при ошибке оба файла
  восстанавливаются как единый rollback set;
- strict Origin allowlist и origin-scoped cookie/PWA/E2EE semantics не меняются;
- соседние vhost, certificates и containers не изменяются.

### Definition of Done

- TLS handshake каждого имени отдаёт сертификат только с соответствующим DNS SAN;
- Certbot показывает две независимые lineage и renewal configs;
- API/frontend отвечают `200`, WebSocket без session — `403` на обоих доменах;
- registration rate limit и security headers одинаковы через shared snippet;
- старый combined `.ru` certificate безопасно заменён на `.ru`-only после
  переключения `.com.de` на собственный certificate;
- full CI, deploy checks и production acceptance проходят.

### Verification

- full repository CI и production workflow `31704063495` прошли; immutable tag —
  `sha-5083743982e407791478511b107a12da622de8e6`;
- active `.ru` certificate содержит только `DNS:chat.yoowee.ru`, active `.com.de`
  certificate — только `DNS:chat.yoowee.com.de`; SNI serial каждого ответа совпал
  с соответствующей lineage на disk;
- отдельные `certbot renew --dry-run --no-random-sleep-on-renew` успешно прошли для
  каждой lineage; обе используют `webroot` `/var/www/html`;
- общий `nginx -t` и graceful reload прошли; rollback set сохранён как
  `chat.yoowee.ru.conf.before-5083743` и `yv-chat-server.conf.before-5083743`;
- оба public/loopback HTTPS origin вернули API/frontend `200`, unauthenticated
  WebSocket `403`, HSTS присутствует; shared registration rule вернул `429` после
  bounded burst;
- yv-chat healthy, соседние `infra-*` containers сохранили uptime.
