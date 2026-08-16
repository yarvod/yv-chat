# Текущий workplan

## WP-094 — Video-note message gestures

Статус: **implemented and locally verified; camera browser acceptance pending**
Backlog: `BL-077`
Bug: `BUG-084`

Цель: standalone видеокружок должен поддерживать тот же message-action contract,
что и текст: long-press и swipe-right на touch, context menu и явный reply action
на desktop, без случайного запуска playback после жеста.

### Scope

- touch pointer на `.message-video-note` участвует в long-press и swipe-right;
- long-press открывает существующее context menu со всеми доступными действиями;
- swipe-right запускает reply и использует существующий threshold/indicator;
- right-click и keyboard context path остаются desktop-механизмом действий;
- synthetic click после long-press/swipe подавляется только для текущего кружка;
- short tap продолжает раскрывать кружок и включать звук по существующей логике;
- обычные video attachments и retry/download controls остаются интерактивными.

### Correctness and UX invariants

- mouse drag не превращается в reply и не конкурирует с video controls;
- подавление click живёт только до ближайшего click/task и не ломает следующий tap;
- vertical touch scroll отменяет message gesture;
- reply/context actions не меняют media bytes, E2EE metadata или playback adapter;
- не добавляется отдельная ветка действий для видеокружков.

### Verification

- component regression: video-note child long-press → menu без playback click;
- component regression: video-note swipe-right → reply без playback click;
- component regression: short tap разрешён, right-click → menu → reply;
- existing text gestures, video-note rendering/playback и attachment tests зелёные;
- full `make ci`, Docker Compose health и in-app browser smoke.

### Definition of Done

- на мобильном кружок принимает long-press и swipe-right как сообщение;
- на desktop правый клик открывает меню, reply выбирается явным действием;
- short tap playback и следующий tap после любого gesture не деградируют;
- automated и Docker проверки зелёные; real-camera browser acceptance требует permission.

### Result

- interactive guard теперь делает узкое исключение только для standalone
  `.message-video-note`, поэтому touch long-press/swipe доходят до общего message flow;
- gesture хранит `startedOnVideoNote`, захватывает touch pointer и после long-press
  или horizontal drag подавляет только compatibility click этого кружка;
- suppression имеет bounded fallback, снимается следующим pointerdown и не поглощает
  следующий осознанный playback tap;
- mouse pointer по-прежнему не запускает drag-reply; right-click и keyboard открывают
  общее меню, где reply выбирается явным действием;
- component regressions проверяют short tap, long-press, swipe, следующий tap,
  mouse drag и child-target right-click → reply;
- полный `make ci` прошёл: backend `272 passed, 12 skipped`, Rust/OpenMLS `23 passed`,
  frontend `314 passed`; Docker Compose и health endpoint зелёные;
- свежая PWA и общее action menu проверены через in-app browser; локальный чат не
  содержал кружка, а две попытки создать QA-кружок остались на системном
  «Подключаем камеру…», поэтому recorder был закрыт reload без отправки сообщения.
