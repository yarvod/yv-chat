# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-076 — Independent TLS certificates for production origins

Статус: **in progress**

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
