# Текущий workplan

## WP-112 — Dismissible completed history-sync banner

Статус: **completed locally; production rollout pending**
Backlog: `BL-015`; bug `BUG-100`

Цель: позволить пользователю явно убрать глобальную плашку после успешной
синхронизации устройств, не отменяя pairing и не затрагивая перенесённую историю.

### Подтверждённое состояние

- глобальный `DeviceHistorySyncBanner` выбирает последний terminal progress и поэтому
  завершённая плашка остаётся сверху без ограничения времени;
- application service уже имеет безопасный `dismiss(pairingId)`, удаляющий только
  локальный job/status;
- Settings использует этот контракт для terminal failed/cancelled attempts, но
  success banner не предоставлял действие пользователю.

### Scope

- отдельный доступный крестик только у completed banner;
- `dismiss` completed status без вызова server cancellation;
- сохранить переход «Подробнее» в Settings;
- mobile-safe geometry, focus/hover states и bounded ellipsis;
- component regression и full frontend checks.

### Security и data invariants

- dismiss не вызывает relay cancel, revoke, logout или удаление archive;
- pairing/session/MLS state и синхронизированные сообщения не меняются;
- active transfer остаётся недоступен для случайного закрытия этим крестиком.

### Definition of Done

- completed/partially completed banner показывает крестик;
- нажатие сразу убирает banner и вызывает только `dismiss(pairingId)`;
- ссылка «Подробнее» остаётся отдельной валидной interactive областью;
- active progress не получает success-dismiss control;
- tests, lint, typecheck и production build проходят.

### Выполнено

- link-container заменён на status-region с отдельными link и button;
- completed banner получил 26×26 dismiss control с accessible label и focus ring;
- длинный текст ограничен ellipsis и не вытесняет крестик на mobile;
- regression подтверждает локальное скрытие без вызова `cancel`.

### Проверка

- focused `device-history-sync-banner`: `1 passed`;
- frontend: ESLint, Nuxt typecheck, `359 passed`, production build;
- `git diff --check` валиден.
