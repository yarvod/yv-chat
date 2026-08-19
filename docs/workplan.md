# Текущий workplan

## WP-100 — E2EE голосовые звонки в личных чатах

Статус: **implemented; full CI and production coturn acceptance passed; application rollout and physical two-network call pending**
Backlog: `BL-034`, `BL-035`

Цель: добавить в direct conversations браузерные голосовые звонки с Telegram-like
основным UX, не смешивая signaling с MLS-сообщениями и не передавая media через
FastAPI.

### Security и architecture invariants

- media plane — только WebRTC (`DTLS-SRTP`); backend/coturn не расшифровывают audio;
- SDP и ICE передаются только по authenticated same-origin WebSocket между active
  участниками direct conversation и никогда не попадают в Push;
- server не хранит записи звонков, audio, media keys или SDP в PostgreSQL;
- используется browser WebRTC и стандартный coturn TURN REST credential mechanism,
  без собственной криптографии;
- group/video/screen sharing не входят в этот workplan;
- PWA не обещает нативный background incoming-call UX там, где browser/OS его не даёт.

### Scope

- bounded versioned call signaling: offer, answer, ICE candidate, reject, end;
- server-side direct-membership authorization, device routing, one active call per
  conversation, answer-on-one-device и bounded call timeout;
- reconnect snapshot для ещё активного in-memory звонка;
- authenticated ICE config с short-lived coturn credentials и STUN-only local mode;
- generic `incoming_call` Web Push wake-up без SDP, ICE, имени или media metadata;
- frontend call state machine, microphone permission/capability UX, mute, accept,
  reject, hangup, duration и remote audio playback;
- responsive incoming/active overlay и call button только в личном чате;
- unit/HTTP/parser/service/component tests и production configuration docs.

### Verification

- backend authorization/state-machine/timeout/multi-device tests;
- WebSocket malformed/outsider/group/offer-answer-candidate-end tests;
- frontend parser и WebRTC service tests with fake browser media/peer connection;
- backend Ruff/format/mypy/pytest;
- frontend lint/typecheck/Vitest/build;
- Compose config, включая coturn profile/configuration.

### Definition of Done

- два active direct participants могут начать, принять и завершить audio call;
- outsider, removed member, group member и spoofed device не могут signal call;
- media не проходит через FastAPI/WebSocket и остаётся зашифрованной WebRTC;
- TURN получает только DTLS-SRTP ciphertext и не имеет storage/recording path;
- один callee device принимает звонок, остальные прекращают звонить;
- permission/NAT/reconnect/failure имеют явное, не зависающее состояние;
- Push раскрывает только opaque IDs и generic incoming-call hint;
- проверки зелёные, ограничения PWA и production TURN setup документированы.

### Result

- direct-chat header получил call action и responsive Telegram-like full-screen
  incoming/outgoing/active UI с accept/reject, mute, duration и hangup;
- browser создаёт audio-only `RTCPeerConnection`, запрашивает microphone только
  после user action и завершает tracks/peer connection на всех terminal paths;
- FastAPI/WebSocket реализует strict versioned offer/answer/ICE/reject/end frames,
  active direct membership + owned-device authorization, one call per conversation,
  first-answer device routing, reconnect snapshot и bounded in-memory lifetime;
- `GET /api/v1/calls/config` выдаёт authenticated STUN/TURN config и short-lived
  HMAC coturn REST credentials, не раскрывая shared secret;
- Push `incoming_call` остаётся generic wake-up и не содержит SDP/ICE/name/content;
- production env/Compose wiring и отдельный root-managed coturn project добавлены;
  `ru1` использует pinned `4.16.0-r0-alpine` digest, host networking, read-only root,
  unprivileged UID/GID, `64 MiB`/64 PID limits, private-peer denylist, bounded relay
  range и отдельную TLS copy с Certbot deploy hook;
- external UDP STUN и TLS acceptance на `31.192.110.84`, а также authenticated
  client-to-client TURN REST relay self-test прошли; Nginx и соседние `infra-*`
  services не изменялись;
- `make ci` зелёный: backend `276 passed, 12 skipped`, Rust/OpenMLS `23 passed`,
  frontend `322 passed`, lint/format/import boundaries/mypy/typecheck/build и все
  Compose/repository gates прошли.
