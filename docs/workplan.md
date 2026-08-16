# Текущий workplan

## WP-088 — Telegram-like encrypted video-note playback

Статус: **completed locally; production rollout pending**
Backlog: `BL-043`

Цель: довести отображение уже защищённых `video_note` до понятного Telegram-like
поведения без изменения E2EE/storage boundary.

### Scope

- компактный кружок автоматически воспроизводит загруженный Blob без звука и в loop;
- первый пользовательский click увеличивает кружок, перезапускает запись с начала,
  выключает loop и включает звук;
- повторный click возвращает muted autoplay preview; завершение звучащего playback
  также безопасно возвращает компактный preview;
- только один раскрытый кружок может воспроизводиться со звуком;
- таймер расположен отдельной контрастной pill поверх нижнего края круга, не
  обрезается внутренним `overflow: hidden` и показывает оставшееся время;
- generic video/photo/file flow, encrypted download/cache и MLS content не меняются.

### Security and accessibility invariants

- autoplay всегда `muted` и `playsinline`; звук включается только из user gesture;
- direct ciphertext/key/metadata boundary остаётся без изменений;
- кнопка сообщает compact/expanded действие через динамический `aria-label`;
- unsupported media и download fallback сохраняются;
- motion и sizing остаются bounded responsive CSS без fullscreen navigation.

### Verification

- component tests: autoplay/muted/loop attributes, timer placement/format,
  expand+unmute+restart, collapse+mute+loop и generic video regression;
- frontend lint, typecheck, tests and production build;
- isolated Docker stack and in-app browser visual/interaction acceptance;
- production read-only audit confirms direct attachment rows are opaque ciphertext.

### Definition of Done

- compact video note starts muted automatically when media becomes playable;
- click expands and enables sound, second click collapses back to muted loop;
- timer is readable and no longer clipped by the circular media mask;
- production direct attachment audit and all relevant checks are documented green.

### Result

- compact `video_note` starts automatically as a muted inline loop; click restarts it
  expanded with sound and no loop, while repeat click or natural end returns the muted
  compact preview;
- the countdown pill now lives outside the circular crop, uses `MM:SS`, and the compact
  state exposes an explicit mute badge and state-aware accessible action label;
- production read-only audit found two committed direct-chat attachments. Both are
  stored as `file` / `application/octet-stream`; their 64 KiB prefixes have no known
  image/video magic and have entropy `7.9973`, consistent with client ciphertext. The
  server intentionally cannot distinguish a video note from another direct attachment;
- frontend lint, typecheck, all `306` tests and production build are green; docs-check
  is green;
- isolated Docker Compose is healthy and the in-app browser verified real muted
  autoplay, the unclipped timer/mute overlays, expanded playback without loop, and the
  automatic return to compact muted loop. The fixture used the shared renderer in a
  disposable local group because the automation tab did not expose camera hardware;
  direct storage encryption was verified separately against production bytes.
