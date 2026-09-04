# Текущий workplan

## WP-145 — Ответ на звонок после открытия Web Push

Статус: **completed locally**
Backlog: `BL-FIX-072`
Bug: `BUG-136`

Цель: нажатие на уведомление о входящем звонке не должно перезагружать уже живую
PWA и превращать lifecycle cleanup в явный `call_rejected`.

### Scope

- передавать validated notification target живому window client через
  `postMessage` до любой hard navigation;
- подтверждать получение одноразовым `MessageChannel`, чтобы service worker мог
  отличить живой Nuxt listener от выгруженного или старого client;
- выполнять SPA `navigateTo` без размонтирования `ChatWorkspace` и потери pending
  WebRTC offer/candidates;
- сохранить bounded hard-navigation fallback для discarded/unresponsive client и
  `openWindow` для полного cold start.

### Security и privacy

- notification payload по-прежнему содержит только opaque UUID routing IDs без
  SDP, ICE, имени пользователя или message content;
- page-side handler принимает только exact typed message с валидными UUID;
- acknowledgement не содержит account, conversation, call или message data;
- серверная MLS-аутентификация offer/answer, WebSocket Origin/session checks и
  call snapshot не меняются.

### Tests

- живой background client подтверждает notification navigation и не вызывает
  `WindowClient.navigate()`;
- не отвечающий client после bounded timeout использует exact hard-navigation URL;
- discarded client открывает и фокусирует новое scoped window;
- page handler отклоняет malformed message, вызывает SPA navigation для valid target
  и отправляет exact acknowledgement;
- существующие WebRTC, realtime, native/web push и route suites остаются зелёными.

### Exclusions

- изменение SDP/ICE/DTLS/MLS call protocol;
- CallKit, PushKit, Android Telecom или новое native notification action;
- хранение звонков либо signaling в PostgreSQL;
- production rollout и проверка физического Android/iOS устройства.

### Definition of Done

- notification click не уничтожает pending incoming call в живой PWA;
- cold/discarded client по-прежнему попадает в exact conversation;
- frontend tests, lint, typecheck, production build и Docker Browser smoke зелёные;
- focused commit создан и готов к отдельному rollout.

### Verification

- regression подтвердил прежний порядок `focus -> navigate -> postMessage`, при
  котором `ChatWorkspace` вызывал `calls.dispose()` и отправлял `call_rejected`;
- после исправления live-client test подтверждает только `focus -> postMessage`,
  без document teardown;
- no-ack и discarded-client fallbacks проверены отдельно;
- targeted frontend call/realtime/push suite: `39/39` tests passed;
- полный frontend suite: `74` test files, `457/457` tests passed;
- `npm run lint`, `npm run typecheck`, `npm run build` — passed;
- backend call/realtime suite: `17/17` tests passed;
- Docker frontend image rebuilt, все `5` сервисов healthy/running,
  `/api/v1/health` и `/sw-push.js` вернули `200`;
- встроенный Browser открыл пересобранную PWA с active sync без console errors;
  настоящий microphone/WebRTC media path в Browser sandbox недоступен, поэтому
  physical native/PWA notification acceptance остаётся rollout gate.
