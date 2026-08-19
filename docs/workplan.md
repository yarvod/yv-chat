# Текущий workplan

## WP-101 — Voice-call UX, encrypted call history и audio routing

Статус: **in progress**
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
