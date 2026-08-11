# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-053 — Branded shell, safe logout и automatic PWA lifecycle

Статус: **completed**
Backlog: `BL-041`, `BL-025`

Цель: убрать дублирующий брендовый и account chrome, использовать канонический
фирменный знак во всех app surfaces, сделать выход с устройства осознанным и
показывать понятное состояние server connection/update без ручного обновления PWA.

### Scope и UX/security contract

- [x] Канонический `design/brand/yv-chat-symbol.svg` используется через один
  presentation-компонент вместо текстовой `Y`; launcher/maskable assets и manifest
  остаются воспроизводимыми из того же brand source.
- [x] Desktop оставляет логотип только сверху navigation rail; chat sidebar не
  дублирует logo/`yv-chat`, но сохраняет доступную кнопку создания диалога.
- [x] Нижние desktop account/avatar/username surfaces удалены из rail и sidebar;
  conversation list занимает освободившуюся высоту без layout shift.
- [x] «Выйти с этого устройства» находится только в Settings и всегда требует
  отдельного confirm step с cancel, busy/error состояниями и честным объяснением
  последствий для device-bound MLS keys и локальной истории.
- [x] Confirmed logout вызывает существующий application use case ровно один раз,
  отзывает server session/device, очищает только reactive authenticated state и не
  притворяется переносом старых device keys в следующий login.
- [x] Глобальный top connection indicator различает initial check, connected,
  reconnect/update и offline; browser offline event отражается сразу, восстановление
  сети подтверждается same-origin health probe.
- [x] Browser APIs и raw fetch не попадают в Vue-компоненты: connection monitor
  разделён на typed application service/port и browser/http adapter.
- [x] PWA проверяет Service Worker update при старте, при возврате приложения в
  foreground и bounded периодически; найденная совместимая версия активируется и
  перезагружает controlled page автоматически.
- [x] Automatic update не удаляет IndexedDB crypto/archive/outbox data; registration
  failure отображается как non-blocking status и не вызывает reload loop.

### Tests и acceptance

- [x] Unit tests: connection state machine, offline/online recovery, bounded retries,
  cleanup listeners/tasks и отсутствие parallel probes.
- [x] Component tests: один desktop brand mark, нет sidebar/account footer, logout
  нельзя выполнить без подтверждения, cancel безопасен, double-submit закрыт.
- [x] PWA config/build tests фиксируют `autoUpdate`, periodic update check и canonical
  manifest/icon contract.
- [x] Frontend lint, typecheck, Vitest, production build и полный `make ci` зелёные.
- [x] Desktop browser acceptance: brand placement, sidebar height, settings confirm,
  connected/reconnecting/offline visual states и отсутствие console errors.
- [x] Mobile viewport acceptance: status не перекрывает safe area/header, navigation
  остаётся fixed, update/reload не ломает standalone shell.
- [x] Immutable production deploy, health/log check и подтверждение нового frontend
  image без изменений соседних `yoowee.ru`/`s3.yoowee.ru` services.

Production verification: GitHub Actions run `31547393463` успешно развернул
`sha-12dac1a479277bb1d2bc851370e5b240b0488af4`; API/frontend containers healthy,
public API/shell отвечают HTTP 200 с валидным TLS, свежие API logs не содержат
`5xx`/`ERROR`/`Traceback`, соседние host services сохранили ожидаемые ответы.

### Ограничения

- logout не является secure device-to-device history transfer и не обещает
  восстановление pre-enrollment E2EE history после повторного входа;
- автоматическое обновление не выполняется во время незавершённого page navigation,
  если browser сам откладывает Service Worker activation;
- этот slice не меняет backend session/device revocation semantics и MLS protocol.

### Definition of Done

- интерфейс использует фирменный знак без дублирующего `yv-chat`/account chrome;
- пользователь не может случайно отозвать текущий device без ясного подтверждения;
- состояние сети/сервера видно глобально и корректно восстанавливается;
- новая PWA-версия обнаруживается и применяется автоматически без ручной кнопки;
- проверки, browser acceptance, документация, commit и production rollout завершены.
