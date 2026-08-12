# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-055 — Ненавязчивый статус соединения без потери viewport

Статус: **completed**
Backlog: `BL-041`
Bug: `BUG-054`

Цель: показывать глобальный сетевой статус только во время проверки, обновления,
переподключения или отсутствия сети. После подтверждённого восстановления статус
исчезает и не резервирует постоянную строку в messenger viewport.

### Scope

- [x] stable `connected` не рендерит видимый баннер;
- [x] `checking`, `updating`, `reconnecting` и `offline` остаются различимыми и
  доступны через polite live-region;
- [x] временный статус располагается поверх shell и не меняет высоту chat list,
  timeline, composer или mobile navigation;
- [x] desktop и mobile shell занимают полный `100dvh` с учётом safe area;
- [x] regression test фиксирует скрытие stable-state и показ transient/offline states.

### Tests

- [x] focused Vitest для connection status;
- [x] frontend lint, typecheck, test и build;
- [x] diff/checks документов и отсутствие новых secrets.

### Ограничения

- этот slice не меняет health probe, WebSocket reconnect или sync algorithms;
- device crypto warnings остаются отдельным security signal;
- групповые media attachments выполняются следующим отдельным workplan/commit.

### Definition of Done

- устойчивое соединение не занимает место и не показывает «Соединено»;
- процесс соединения/обновления и потеря связи остаются видимыми;
- восстановление автоматически убирает индикатор;
- tests, docs и focused commit завершены.
