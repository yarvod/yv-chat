# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-073 — Telegram-style group video notes

Статус: **production permission and iOS safe-area blockers fixed locally; rollout pending**

Цель: участник server-readable group v1 записывает компактное круглое видео прямо
из composer, управляет записью привычными мобильными жестами и получает устойчивое
воспроизведение через уже существующие media TTL/cache/sync boundaries.

### Scope

- browser camera/microphone capture только после user gesture и только в group;
- удержание кнопки начинает запись, swipe-left отменяет, swipe-up фиксирует запись;
- locked mode предоставляет явные stop/send, cancel и front/back camera controls;
- квадратный 480×480 capture, максимум 60 секунд и bounded low-bitrate encoding;
- runtime MIME negotiation для MP4/WebM без предположения одного browser codec;
- `video_note` presentation metadata внутри version-tolerant group content;
- круглый player с play/pause, progress и duration без server thumbnail/transcoding;
- существующие authorized upload, quota, TTL, cleanup и encrypted device cache
  переиспользуются без нового media backend или schema migration.

### Security and data invariants

- video note доступен только в явно non-E2EE group v1 и сохраняет warning в UI;
- direct MLS composer не получает camera control и не обходит `BL-017`;
- camera/microphone tracks останавливаются при cancel, error, unmount, conversation
  switch и background visibility transition;
- backend получает group plaintext media как и для существующего group video, но
  никогда не получает browser path или произвольный filesystem key;
- запись не логируется, не сохраняется в `localStorage` и не добавляет plaintext push;
- server не декодирует, не crop-ит и не транскодирует media.

### Exclusions

- direct MLS/E2EE video notes и attachment keys;
- persisted offline video-note draft/background upload;
- filters, beauty effects, server thumbnails и server transcoding;
- unbounded recording, HD/4K capture и calls/WebRTC signaling.

### Definition of Done

- hold/release отправляет один `video_note`; swipe-left не отправляет байты;
- swipe-up сохраняет запись после release и позволяет переключить camera;
- 60-second boundary автоматически завершает запись;
- permission denial, unsupported recorder, capture error и too-large output имеют
  понятный recoverable UI, а active tracks всегда остановлены;
- повторный PWA capture после уже отклонённого native prompt объясняет, что browser
  больше не может открыть prompt сам, и направляет в настройки PWA/site;
- старый metadata consumer безопасно воспринимает video note как обычное video;
- получатель видит круглый player, а generic video rendering не меняется;
- frontend tests/lint/typecheck/build и полный repository CI проходят.

### Verification evidence

- targeted recorder/gesture/metadata/rendering/message-panel suite: `41 passed`;
- full frontend: `48 files / 260 tests`, lint/typecheck/production build green;
- full `make ci`: backend `241 passed / 9 skipped`, Rust `21 passed`, frontend
  `48 files / 260 tests`, lint/typecheck/build/docs/config checks green;
- physical Android/iOS installed-PWA camera, permission and codec acceptance не
  запускались в текущем environment и остаются обязательным pre-deploy smoke.
- production rollout `31645619731` успешно развернул основной video-note flow;
  последующий permission-recovery и same-origin Permissions Policy fix закрывают
  `BUG-068` локально;
- iPhone 13/iOS 18 acceptance выявил top safe-area overlap и keyboard viewport pan;
  mobile shell теперь следует за размером и offset visual viewport, а list toolbar
  резервирует верхний safe area (`BUG-069`);
- Pixel acceptance выявил native long-press conflict и generic square bubble вокруг
  круглого player; gesture zone теперь подавляет selection/callout только локально,
  а standalone video note отображается без общей rectangular card (`BUG-070`);
- дополнительный iPhone acceptance перенёс top safe area с отдельных chat headers на
  общий mobile shell; keyboard text-entry скрывает bottom tabs, а PWA canvas и
  `theme-color` совпадают с фоном выбранной темы при iOS rubber-band (`BUG-071`);
- bottom navigation получила общий press animation на iOS/Android и короткий
  `selection` vibration на поддерживающем Vibration API Android при смене раздела;
- первый mobile tap по строке диалога теперь сразу открывает optimistic chat pane,
  пока history/crypto selection завершается; hover ограничен mouse input (`BUG-072`).
