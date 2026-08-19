# Текущий workplan

## WP-106 — Call reliability and fullscreen video regression hardening

Статус: **completed and production deployed; physical two-device acceptance pending**
Backlog: `BL-036`, bugs `BUG-091`–`BUG-093`

Цель: устранить intermittent WebRTC connection failure после MLS call binding,
сделать remote video симметрично видимым обоим участникам и вернуть глобальное
разворачивание звонка, одновременно перестроив fullscreen UI вокруг remote video.

### Подтверждённые причины

- browser отправляет trickle ICE сразу после `setLocalDescription()`, пока MLS
  sign/verification code ещё не завершены и offer/answer не принят coordinator;
  backend fail-closed отклоняет out-of-order candidate и закрывает WebSocket;
- remote `<video>` создаётся только после derived `remoteVideoEnabled=true`, поэтому
  browser playback lifecycle зависит от track mute/unmute event и может остаться
  без DOM sink на одной стороне;
- fullscreen overlay вложен в `.workspace-main`, который mobile list route скрывает
  через `display:none`, поэтому expand работает только после возврата в conversation;
- audio routing постоянно занимает значительную часть fullscreen call surface, а
  remote video ограничен отдельной карточкой вместо viewport media layer;
- `connecting` не имеет bounded timeout после answer и может висеть бесконечно.

### Security invariants

- offer/answer применяются только после прежней MLS device/fingerprint проверки;
- ICE ordering fix не добавляет доверия candidate/signaling и не ослабляет v2-only
  fail-closed parsing;
- camera capture остаётся explicit, local tracks останавливаются при terminal state;
- remote track-derived UI state не меняет identity trust и отображается только в
  уже MLS-verified call lifecycle;
- FastAPI/coturn по-прежнему не получают media keys/plaintext и не записывают media;
- timeout завершает только локальный ephemeral call и отправляет bounded terminal
  hint; message/session/MLS state не меняются.

### Scope

- buffer local ICE до успешного offer/answer send и затем flush в исходном порядке;
- bounded initial connection/disconnect timeout с понятным terminal состоянием;
- always-mounted remote video sink, playback fallback и symmetric track regressions;
- viewport-filling remote video, corner local PiP, compact overlay metadata/controls;
- audio route picker как explicit sheet вместо постоянной большой панели;
- global call overlay вне route-hidden workspace subtree;
- frontend/backend security regressions, full CI и production rollout после checks.

### Exclusions

- ICE restart/renegotiation protocol, SFU/group calls и recording;
- изменение MLS call binding, TURN credentials, Nginx/coturn configuration;
- гарантия fixed HD/fps/latency на любой сети или background camera в PWA.

### Definition of Done

- никакой local ICE candidate не отправляется раньше соответствующего offer/answer;
- неуспешное соединение завершается за bounded interval, а не висит бесконечно;
- camera-on peer появляется у обеих сторон, включая track, ставший active позднее;
- remote video занимает viewport, local preview остаётся corner PiP;
- audio routes открываются отдельным действием и не перекрывают звонок постоянно;
- expand работает из списка и любого другого direct/group conversation;
- MLS tamper/wrong-device/v1 downgrade tests остаются зелёными;
- full `make ci` и production build зелёные;
- post-rollout two-device acceptance подтверждает symmetric audio/video.

### Результат локальной проверки

- delayed MLS signing regressions подтверждают exact `offer → ICE` и
  `answer → ICE` ordering для обеих ролей;
- backend negative test сохраняет отказ callee candidate до authenticated answer;
- 30-second connection timeout завершает зависший verified call понятной ошибкой;
- component regressions подтверждают always-mounted remote sink и app-scoped overlay;
- browser QA пройден на `1280×720` и `390×844`: viewport remote media, corner PiP,
  compact metadata/actions без overflow;
- `make ci`: `279 passed`, `12 skipped`; Rust call identity/crypto, frontend tests,
  lint, mypy, typecheck и production Nuxt build зелёные.
- GitHub CI `32286917754` и production deploy `32286917649` зелёные; на `ru1`
  запущены frontend/backend/worker images `sha-cba2997f8c76c04ae7d6844cc1a8109e19894703`;
  оба production chat-домена возвращают `ok` на post-rollout healthcheck.
