# Текущий workplan

## WP-105 — Secure in-call video

Статус: **completed and locally verified; not deployed**
Backlog: `BL-036`

Цель: позволить каждому участнику 1:1 звонка независимо включить или выключить
камеру во время разговора, видеть remote video и своё локальное preview без нового
доверия к signaling/server и без ухудшения стабильного audio path.

### Security и architecture invariants

- audio/video используют один MLS-authenticated WebRTC PeerConnection и один
  DTLS-SRTP transport; FastAPI, Nginx и coturn не получают media keys/plaintext;
- video transceiver согласуется в offer/answer с MLS-authenticated DTLS fingerprint,
  поэтому позднее `replaceTrack()` не требует нового renegotiation;
- камера открывается только после прямого user action, никогда при входящем звонке,
  загрузке чата или автоматическом reconnect;
- локальный camera track немедленно останавливается при выключении, hangup, error,
  reset и dispose; сервер не записывает, не транскодирует и не хранит video;
- remote video отображается только в звонке, чей answer прошёл MLS device binding;
- отказ/отсутствие камеры не завершает audio call и не меняет microphone state;
- UI не обещает фиксированное качество: browser congestion control адаптирует media
  к direct/TURN path в bounded 720p/30fps profile.

### Scope

- pre-negotiated bidirectional video transceiver в 1:1 call;
- camera on/off во время connecting/active call и camera facing switch;
- local muted mirrored preview и remote autoplay/playsinline surface;
- 720p ideal, 24 fps ideal/30 max, bounded sender bitrate и balanced degradation;
- remote track mute/unmute/ended state без отдельного доверенного server event;
- сохранение media при minimize/expand с повторным attach video elements;
- permission/device failure UX и unit/component/security regression tests;
- обновление README/backlog/architecture без production rollout.

### Exclusions

- group calls/SFU, screen sharing, background blur и recording;
- server-side transcoding, thumbnails или media storage;
- native CallKit/ConnectionService и background camera;
- гарантия HD/fps на слабой сети или в browser/OS power-saving mode;
- production, SSH, Nginx/coturn changes, push или deploy.

### Definition of Done

- любой участник может включить камеру после соединения, второй видит video;
- camera off прекращает отправку и освобождает local hardware track;
- front/back switch заменяет track атомарно, не обрывая audio;
- minimize/expand не пересоздаёт PeerConnection или camera capture;
- camera denial/failure оставляет audio call активным с понятным сообщением;
- MLS identity verification остаётся mandatory до active media;
- full local CI и production frontend build зелёные;
- локальная feature branch не pushed/deployed.

### Результат

- caller и callee заранее согласуют `sendrecv` video transceiver внутри offer/answer
  с MLS-authenticated DTLS fingerprint, а камера добавляется без renegotiation через
  `replaceTrack()`;
- fullscreen и compact UI позволяют включить/выключить камеру, fullscreen также
  переключает front/rear camera и показывает remote video с локальным preview;
- camera capture ограничен ideal 720p/24fps, max 720p/30fps и sender cap 1.2 Mbit/s;
  WebRTC congestion control сохраняет право снизить качество на слабом direct/TURN path;
- permission failure оставляет audio path активным; camera-off, hangup, error и cleanup
  останавливают local track, а minimize только безопасно detach-ит DOM video elements;
- unit/component regressions проверяют explicit camera permission, sender caps,
  switch/off, remote mute state, denial fallback, terminal cleanup и UI controls;
- `make ci` прошёл локально: backend `278 passed, 12 skipped`, crypto `26 passed`,
  frontend lint/typecheck/tests/production build и config checks зелёные;
- production, SSH, Nginx/coturn и deploy не затрагивались.
