# Текущий workplan

## WP-091 — Video-note max-duration review and progress ring

Статус: **implemented and full-CI verified; physical camera permission acceptance pending**
Bug: `BUG-081`

Цель: при достижении минутного лимита не отправлять видеокружок неявно, а сохранить
его в явном review state с кнопками отправки/удаления и показывать оставшееся время
через доступный progress ring по контуру live preview.

### Scope

- 60-second timer останавливает MediaRecorder и materializes bounded local Blob;
- завершённый по лимиту кружок остаётся в overlay и не передаётся upload/send flow;
- review показывает записанный muted loop, `1:00`, кнопки «Удалить» и «Отправить»;
- явная отправка emits Blob ровно один раз, удаление освобождает Blob URL без upload;
- hold/release, swipe-left cancel и locked-mode send/cancel остаются совместимыми;
- live/review preview получает круговой progress indicator от 0 до 60 секунд,
  включая заметное near-limit состояние и semantic `progressbar`.

### Correctness and resource invariants

- запись физически прекращается ровно на bounded limit и не продолжает использовать
  camera/microphone во время review;
- pending Blob живёт только в памяти текущего component instance и не сохраняется
  в plaintext storage;
- object URL всегда revoke при send, delete, unmount или capture reset;
- hidden document отменяет только active capture, но не молча удаляет готовый review;
- double send/delete и race timer↔pointer release не создают два сообщения;
- существующие 60-second / 8 MiB checks и direct client-side encryption не меняются.

### Verification

- component regression: max duration stops without emit, shows full progress/review,
  explicit send emits once, delete emits nothing and revokes URL;
- existing hold/release, cancel, lock, permission and camera-switch tests remain green;
- CSS/mobile tests cover circular progress geometry and safe overlay controls;
- full `make ci`, integrated Docker Compose build/health and in-app browser acceptance.

### Definition of Done

- at 60 seconds the user always sees whether the recording is ready and chooses send/delete;
- progress ring advances continuously and communicates the one-minute boundary;
- no media resource leak, implicit upload, duplicate send or E2EE boundary change;
- all automated, Docker and browser checks pass.

### Result

- max-duration timer теперь завершает `MediaRecorder`, освобождает sensor tracks и
  переводит bounded Blob в memory-only review вместо неявного `recorded` event;
- review воспроизводит готовый muted loop, показывает `1:00` и ждёт явного send/delete;
- круговой conic-gradient progress обновляется каждые 100 мс, краснеет на последних
  10 секундах и имеет semantic `progressbar` с текущей секундой;
- send/delete/background/unmount и timer↔pointer races покрыты component regressions;
- полный `make ci` прошёл: `271 passed, 12 skipped` backend, `23 passed` Rust/OpenMLS,
  а финальный frontend suite — `311 passed`; lint/typecheck/build/Compose/deploy/docs gates green;
- Docker images пересобраны, пять runtime services healthy; свежая PWA и реальный
  capture entry открылись, но in-app browser ожидает пользовательское системное
  разрешение camera/microphone, поэтому sensor-level минутный прогон ещё не закрыт.
