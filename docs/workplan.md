# Текущий workplan

## WP-101 — Voice-call UX, encrypted call history и audio routing

Статус: **implemented and deployed; physical mobile UX acceptance pending**
Backlog: `BL-035`

Цель: довести уже развернутые голосовые звонки в личных чатах до пригодного
повседневного UX, сохранив текущие WebRTC/TURN и MLS trust boundaries.

### Security и architecture invariants

- ringtone/ringback генерируются локально и никогда не передаются на backend;
- системный Push остаётся generic wake-up без имени, SDP, ICE и message preview;
- история звонка кодируется как typed direct-message content, шифруется обычным MLS
  message path и хранится на server только как opaque ciphertext;
- выбор audio output использует только стандартный browser API и не обещает
  несуществующий earpiece/proximity control;
- TURN по-прежнему требует short-lived authenticated credentials для relay и не
  получает доступ к audio plaintext/media keys.
- public coturn дополнительно ограничивает unauthenticated UDP challenge reflection,
  allocation count и per-session/aggregate relay bandwidth.

### Scope

- foreground incoming ringtone и outgoing ringback с корректной остановкой на всех
  terminal paths и graceful autoplay fallback;
- background incoming-call notification с vibration/action hint там, где это
  поддерживает OS/browser;
- обнаружение `audiooutput`, обновление по `devicechange` и выбор sink через
  `HTMLMediaElement.setSinkId()` с системным fallback;
- call overlay с mute, audio-output control, явным platform limitation notice и
  корректным accessible status;
- typed encrypted call summary (`completed`, `missed`, `declined`, `busy`,
  `cancelled`, `failed`) с direction, duration и отдельным timeline rendering;
- tests для tone lifecycle, routing, push и direct-content/timeline rendering;
- документация PWA-ограничений: proximity screen-off и гарантированный native
  earpiece/audio-session требуют native wrapper.

### Exclusions

- video/group calls, recording, server media processing;
- собственный crypto protocol или Telegram-compatible safety-number protocol;
- имитация proximity через камеру/ambient-light/таймер;
- принудительный custom notification sound, запрещённый browser/OS policy.

### Definition of Done

- при foreground incoming call клиент звонит, а caller слышит ringback;
- background push открывает exact conversation и не раскрывает sensitive metadata;
- доступные speaker/headset/Bluetooth outputs появляются и переключаются без разрыва
  звонка; unsupported browser честно оставляет routing системе;
- caller создаёт один E2EE call-history item с понятным исходом и duration;
- terminal/reset paths освобождают microphone, peer, timers, tones и device listeners;
- frontend lint/typecheck/tests/build и repository CI зелёные;
- production rollout и физический smoke подтверждены отдельно.

### Result

- foreground PWA синтезирует отдельный incoming ringtone и outgoing ringback через
  Web Audio, останавливает tone/vibration вместе с call state и сохраняет явный tap
  fallback для browser autoplay policy;
- background `incoming_call` Push получил generic action/vibration без имени, SDP,
  ICE или audio; permission prompt и Settings теперь явно включают звонки;
- после microphone permission client перечисляет `audiooutput`, отслеживает
  `devicechange` и переключает поддерживаемые speaker/headset/Bluetooth sinks через
  `setSinkId`; unsupported browser оставляет routing системе;
- caller один раз ставит typed call summary в обычный direct MLS v2 outbox; timeline
  показывает completed/missed/declined/busy/cancelled/failed и duration, а server
  хранит только прежний opaque message ciphertext;
- proximity/forced screen-off и гарантированный native earpiece честно оставлены за
  будущим native wrapper: текущий web Proximity Sensor не реализован engines;
- coturn production получил stateless nonce, UDP `401` limit 10 rps/source,
  `256 KiB/s` per allocation и `4 MiB/s` aggregate caps; root-managed backup
  `turnserver.conf.pre-wp101` сохранён, Nginx/соседние services не менялись;
- feature commit `191e314`, heartbeat test fix `ccbdb07`; GitHub CI
  `32267603203` и production deploy `32267603231` зелёные;
- full local CI зелёный: backend `276 passed, 12 skipped`, Rust/OpenMLS `23 passed`,
  frontend `325 passed`, lint/format/import boundaries/mypy/typecheck/build/Compose;
- оба public origins отвечают health `200`, unauthenticated call config — `401`,
  production app tag `sha-ccbdb07…`; authenticated TURN relay self-test — `2/2`,
  `0%` packet loss.
