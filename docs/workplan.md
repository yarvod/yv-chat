# Текущий workplan

## WP-102 — Сворачиваемый голосовой звонок

Статус: **implemented and deployed; physical mobile acceptance pending**
Backlog: `BL-035`

Цель: позволить продолжать пользоваться чатами во время голосового звонка, сохраняя
доступ к его статусу и основным действиям через компактную панель в шапке приложения.

### Security и architecture invariants

- сворачивание меняет только локальное представление и не затрагивает WebRTC,
  signaling, TURN credentials или MLS history;
- единственный `BrowserVoiceCallService` продолжает владеть media stream и call state;
- компактная панель не раскрывает данные за пределами уже открытого authenticated UI;
- новый звонок и terminal state не должны оставаться скрытыми;
- криптографическая привязка DTLS fingerprint к MLS identity остаётся отдельным
  security milestone с threat model, protocol documentation и tests.

### Scope

- явная кнопка «Свернуть» в полноэкранном call UI;
- компактная call-панель поверх шапки приложения с peer, status/duration и mute state;
- разворачивание панели без остановки media и без смены выбранного диалога;
- быстрые accept/reject для свёрнутого входящего и hangup для остальных active phases;
- автоматическое полноэкранное открытие нового звонка, error и ended state;
- responsive/safe-area layout и component tests.

### Exclusions

- изменение signaling/media plane, background OS call UI или Picture-in-Picture;
- video/group calls;
- DTLS fingerprint ↔ MLS identity binding и verification code — следующий отдельный
  security workplan, а не UI-изменение этого feature.

### Definition of Done

- ongoing звонок сворачивается, а список диалогов и любой чат остаются доступны;
- компактная панель показывает актуальный status/timer и возвращает полный call UI;
- accept/reject/hangup из панели вызывают те же call-service операции;
- смена диалога не меняет peer текущего звонка и не прерывает media;
- новый звонок и terminal state открываются полностью;
- frontend tests, lint, typecheck и build зелёные; rollout проверен на production.

### Result

- полноэкранный call UI получил явную кнопку «Свернуть» и сохраняет прежний
  `BrowserVoiceCallService`/WebRTC session без media restart;
- compact row занимает отдельную responsive grid-строку над списком и workspace,
  поэтому не перекрывает conversation header и остаётся видимой при переходе между
  диалогами на desktop/mobile;
- compact state показывает peer, live status/duration и mute, даёт accept/reject для
  incoming и mute/hangup для остальных ongoing phases; tap по основной области
  возвращает полный call UI;
- новый `call_id`, `idle`, `ended` и `error` автоматически сбрасывают minimization;
- добавлен `BL-078` для следующего отдельного MLS-authenticated DTLS fingerprint
  milestone, без смешивания crypto protocol changes с presentation feature;
- frontend `329` tests, ESLint, Nuxt typecheck и production build зелёные; локальный
  browser shell smoke выполнен, end-to-end active-call visual smoke ожидает production;
- полный repository CI зелёный: backend `276 passed, 12 skipped`, Rust/OpenMLS
  `23 passed`, frontend `329 passed`, lint/format/import boundaries/mypy/typecheck,
  production build и Compose/deployment checks.
- feature commit `8aca541`; GitHub CI `32272004038` и production deploy
  `32272004059` зелёные; оба public origins отвечают health `200`, unauthenticated
  call config — `401`, production app tag `sha-8aca541…`.
