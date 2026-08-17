# Текущий workplan

## WP-099 — Надёжный переход из Web Push в сообщение

Статус: **implemented; full CI, Docker and in-app browser verified; physical mobile acceptance pending**
Backlog: `BL-028`
Bug: `BUG-089`

Цель: клик по уведомлению устойчиво открывает установленную PWA, нужный диалог и
точное сообщение при тёплом и холодном старте, включая Android с замороженной или
discarded app task.

### Root cause

- Service Worker без разбора выбирал первый `WindowClient` из `matchAll()`;
- навигация выполнялась до восстановления/focus окна, что ненадёжно для замороженной
  Android PWA task;
- после успешного focus/navigation не было резервного typed route signal в уже
  запущенное Nuxt-приложение;
- при ошибке первого stale client не проверялись остальные живые окна.

### Scope

- предпочитать visible/focused clients, но fail over по всем найденным окнам;
- сначала восстанавливать/focus client, затем переходить на точный URL сообщения;
- при невозможности использовать существующую task открывать новое scoped окно;
- передавать validated opaque conversation/message UUID внутрь приложения через
  `postMessage`, без plaintext preview;
- приложение принимает только известный typed navigation event с валидными UUID;
- sync, unread, push payload и notification privacy contract не меняются.

### Verification

- service-worker unit tests: warm client, discarded Android task, cold fallback;
- parser tests: typed event, malformed UUID и unknown event rejection;
- frontend lint, typecheck, tests и production build;
- Docker stack и in-app browser smoke точного `/chat?conversation=...&message=...` URL;
- production workflow и public health/assets probe.

### Definition of Done

- stale first client не блокирует открытие PWA;
- focus происходит до navigation;
- exact route сохраняет conversation/message при cold и warm start;
- malformed/untrusted navigation messages игнорируются;
- generic notification не раскрывает содержимое сообщения.

### Result

- warm click сначала focus-ит client, затем открывает exact route и отправляет typed
  route signal активному Nuxt-приложению;
- rejected/discarded client больше не завершает обработку: worker пробует остальные
  tasks и использует `openWindow` как cold-start fallback;
- full `make ci` зелёный: backend `272 passed, 12 skipped`, Rust/OpenMLS `23 passed`,
  весь frontend suite, lint, typecheck, production build и repository gates;
- Docker frontend пересобран, весь stack healthy; in-app browser активировал новую
  локальную PWA, cold deep link сохранил exact query до ожидаемого auth redirect, а
  release Nginx отдаёт обновлённый worker. Реальный notification tap на Android/iOS
  требует post-deploy проверки на физических устройствах.
