# Текущий workplan

## WP-089 — Higher-quality bounded video-note capture

Статус: **completed locally; production rollout pending**
Backlog: `BL-043`

Цель: повысить резкость, плавность и качество речи в новых `video_note`, сохранив
60-second / 8 MiB admission boundary и существующее E2EE/storage поведение.

### Scope

- output canvas увеличивается с 480×480 до 720×720;
- camera target увеличивается с 20 до bounded 30 fps без hard minimum для слабых
  устройств;
- encoder budget увеличивается с 420 до 900 Kbit/s video и с 48 до 96 Kbit/s mono
  audio;
- video/audio tracks получают standard content hints `motion`/`speech`, canvas crop
  использует high-quality smoothing;
- codec negotiation, camera switch, gestures, encrypted attachment flow и playback
  presentation не меняются.

### Security and accessibility invariants

- target bitrate budget остаётся ниже 8 MiB для полной 60-second записи с запасом
  на container overhead;
- constraints остаются `ideal`, а не `exact`/`min`, чтобы low-end camera могла
  выбрать поддерживаемое разрешение/FPS;
- client по-прежнему fail closed отклоняет итоговый Blob больше 8 MiB;
- direct bytes шифруются до upload; server-side transcoding/decryption не появляется;
- all tracks по-прежнему останавливаются при stop/cancel/error.

### Verification

- recorder tests: camera/audio constraints, codec, increased bounded bitrates,
  track cleanup and permission mapping;
- frontend lint, typecheck, tests and production build;
- isolated Docker stack and in-app browser visual/interaction acceptance;
- browser camera permission/capture acceptance where hardware is exposed.

### Definition of Done

- new recorder options request 720-square / 30 fps with 900/96 Kbit budgets;
- maximum target payload remains bounded below 8 MiB for 60 seconds;
- permission/capture fallbacks and existing video-note interaction remain green;
- Docker/browser acceptance and all relevant checks are documented.

### Result

- recorder target вырос с 480×480 / 20 fps / 420 Kbit video / 48 Kbit audio до
  720×720 / 30 fps / 900 Kbit video / 96 Kbit mono speech audio;
- camera/audio tracks маркируются `motion`/`speech`, square crop использует high-quality
  smoothing, а canvas draw loop throttled до output 30 fps вместо лишних redraws;
- полный 60-second target составляет около 7.47 MB до container overhead и имеет
  запас до 8 MiB; exact final Blob ceiling и graceful camera fallback сохранены;
- frontend lint, typecheck, all `306` tests и production build green; recorder tests
  фиксируют constraints, bitrates, byte budget, canvas size/FPS/smoothing, hints и
  cleanup всех tracks;
- финальный Docker Compose stack healthy, свежая PWA открыла direct MLS chat и
  recorder control без runtime/API failure. In-app automation получила persisted
  camera/microphone denial без нового system prompt, поэтому sensor-level A/V quality
  остаётся короткой physical-device acceptance после rollout; denial recovery UI
  сработал корректно.
