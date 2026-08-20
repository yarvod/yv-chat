# Текущий workplan

## WP-109 — Unified QR routing across trusted production origins

Статус: **implemented, full-CI verified and production deployed**
Backlog: `BL-015`, `BL-075`; bug `BUG-097`

Цель: один scanner на телефоне должен принимать QR компьютера во всех трёх
поддержанных состояниях и маршрутизировать результат по pairing purpose/session
state, даже если два устройства открыли разные официальные production origins.

### Подтверждённая причина

- `enrollment_request` уже моделирует вход неавторизованного компьютера через
  авторизованный телефон;
- `enrollment_offer` уже моделирует как вход неавторизованного телефона через
  авторизованный компьютер, так и history/MLS sync двух авторизованных устройств;
- client decoder до обращения к backend требовал `payload.origin ===
  window.location.origin`;
- `chat.yoowee.ru` и `chat.yoowee.com.de` используют общий backend/pairing store, но
  имеют разные origin-scoped cookies, PWA storage и device identities;
- поэтому корректный QR одного production origin отклонялся scanner-ом другого как
  недействительный, хотя server state machine могла безопасно обработать pairing.

### Security invariants

- QR принимается только от current origin или exact origins из уже настроенного
  backend `ALLOWED_ORIGINS`, переданного frontend как non-secret runtime config;
- wildcard, arbitrary payload origin, path, query, fragment и credential-bearing URL
  не принимаются;
- QR origin не выбирает network destination: scanner обращается только к своему
  same-origin `/api/v1`, сохраняя cookie/CSRF/Origin boundary;
- backend по-прежнему проверяет pairing UUID, one-time scan token, expiry, purpose,
  account, active session и distinct device;
- `enrollment_request` требует authenticated trusted scanner;
- anonymous scanner допускается только для `enrollment_offer` и получает отдельную
  session/device после подтверждения trusted side;
- два authenticated устройства одного account используют existing-device branch и
  не выпускают новую session.

### Scope

- передать exact `ALLOWED_ORIGINS` в Nuxt public runtime config production frontend;
- безопасно разобрать/нормализовать allowlist с fail-closed fallback на current
  origin;
- расширить QR decoder/service до exact trusted-origin set;
- добавить component regressions для трёх phone-scans-computer сценариев;
- сохранить arbitrary-origin rejection и candidate proof secrecy;
- обновить архитектуру/bug/backlog и выполнить frontend/full repository checks.

### Exclusions

- cross-origin cookies, CORS requests или перенос IndexedDB/MLS state между origins;
- изменение backend pairing state machine, API schema, migration или TTL;
- QR, созданные сторонними/self-hosted deployments вне exact allowlist;
- автоматическое подтверждение без сверки authentication code.

### Definition of Done

- logged-in phone на origin A принимает login QR неавторизованного компьютера с
  trusted origin B и подтверждает вход компьютера;
- logged-out phone принимает offer QR авторизованного компьютера и после approval
  получает отдельную session/device;
- logged-in phone принимает тот же offer type и запускает existing-device
  MLS/history union без новой session;
- arbitrary origin отклоняется до backend request;
- browser cookies/storage остаются origin-scoped;
- lint, typecheck, tests, production build и Compose config проходят.

### Результат локальной проверки

- production frontend получает exact `ALLOWED_ORIGINS` через
  `NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS`; собранный Nitro runtime реально выдал оба
  production origin в public payload;
- parser принимает только exact HTTP(S) origins, удаляет duplicates и fail-closed
  возвращает current origin при malformed/missing/current-origin-absent config;
- service regression проводит `enrollment_request`, anonymous `enrollment_offer` и
  authenticated existing-device `enrollment_offer` между двумя trusted origins и
  отклоняет arbitrary origin;
- component regressions подтверждают approval входа компьютера авторизованным
  телефоном, выдачу отдельной session неавторизованному телефону и history union
  двух уже авторизованных устройств;
- frontend: `352 passed`, ESLint, Nuxt typecheck и production build зелёные;
- `make compose-check deploy-check` проходит для development/integrated/production
  Compose и deployment scripts.
- production workflow `32317318386` успешно развернул commit `575b1a2`
  как immutable tag `sha-575b1a24cb0e65f972d0d64067b73354c044af10`;
- оба public origin вернули HTTP `200` и одинаковый exact runtime
  allowlist из `chat.yoowee.ru` и `chat.yoowee.com.de`.
