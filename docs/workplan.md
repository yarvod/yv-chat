# Текущий workplan

## WP-103 — Выбор аудиовыхода в полноэкранном звонке

Статус: **implemented and locally verified; deployment pending**
Backlog: `BL-035`

Цель: дать пользователю понятный полноэкранный выбор доступного маршрута звука
во время голосового звонка: громкий динамик, разговорный динамик, проводные или
Bluetooth-наушники — если конкретный браузер действительно предоставляет этот
аудиовыход, и системный маршрут как безопасный fallback.

### Security и architecture invariants

- переключение меняет только sink удалённого WebRTC audio element и не затрагивает
  microphone track, signaling, TURN credentials или MLS state;
- UI не изображает неподдерживаемый разговорный динамик как работающую кнопку;
- browser/system picker вызывается только прямым действием пользователя;
- server и Nginx не участвуют в выборе аудиоустройства и не получают его label/id;
- отсутствие browser API не прерывает звонок: маршрут остаётся под контролем ОС.

### Scope

- capability-aware панель «Куда выводить звук» в полноэкранном call UI;
- системный маршрут и отдельные кнопки для реально enumerated audio outputs;
- понятные типы: громкая связь, телефон, наушники, Bluetooth и другой аудиовыход;
- native browser/system output picker через `MediaDevices.selectAudioOutput()`, если
  он доступен;
- сохранение выбранного устройства при повторном enumerate и корректный fallback
  на системный маршрут при отключении гарнитуры;
- component/service tests и platform limitation copy.

### Exclusions

- принудительное управление iOS earpiece/speaker там, где WebKit не предоставляет
  Audio Output Devices API;
- native iOS/Android wrapper, CallKit/ConnectionService;
- изменение WebRTC encryption, signaling, coturn или Nginx.

### Definition of Done

- fullscreen UI показывает текущий маршрут и доступные реальные варианты;
- Bluetooth/наушники можно выбрать непосредственно или через browser picker;
- отключённое устройство безопасно возвращает звонок на системный маршрут;
- на неподдерживаемой платформе UI объясняет, что выбор выполняется средствами ОС;
- frontend tests, lint, typecheck и production build зелёные;
- rollout проверен на production.

### Result

- fullscreen call UI получил отдельную панель «Куда выводить звук» с текущим
  system default и реальными browser-enumerated routes;
- browser labels классифицируются только для presentation как «Громкая связь»,
  «Телефон», «Наушники», «Bluetooth» или общий аудиовыход; несуществующий sink не
  синтезируется;
- `MediaDevices.selectAudioOutput()` вызывается из прямого клика и добавляет
  разрешённое устройство к selector, затем routing выполняется через `setSinkId()`;
- `devicechange` удаляет пропавшую гарнитуру и возвращает remote audio на системный
  sink; отказ/cancel picker не роняет текущий звонок;
- unsupported mobile WebKit получает явную подсказку про системное меню вместо
  ложного phone/speaker toggle;
- frontend `332` tests, ESLint, Nuxt typecheck и production build зелёные;
- полный repository CI зелёный: backend `276 passed, 12 skipped`, Rust/OpenMLS
  `23 passed`, frontend `332 passed`, lint/format/import boundaries/mypy/typecheck,
  production build и Compose/deployment checks;
- local browser shell smoke выполнен без console errors; end-to-end physical
  speaker/earpiece/Bluetooth acceptance и production rollout ещё ожидаются.
