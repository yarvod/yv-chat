# Текущий workplan

## WP-104 — MLS-authenticated WebRTC call identity

Статус: **completed and locally verified; not deployed**
Backlog: `BL-078`

Цель: сделать подмену WebRTC DTLS fingerprint через скомпрометированный signaling
обнаруживаемой до принятия remote SDP и показать одинаковый код сверки на обоих
устройствах. Изменения остаются на локальной feature branch и не деплоятся.

### Security и architecture invariants

- WebRTC media по-прежнему шифруется стандартным DTLS-SRTP; FastAPI и coturn не
  получают media keys или plaintext;
- offer/answer binding подписывается sealed Ed25519 device key, credential которого
  уже является leaf локального MLS group;
- verifier получает public key и identity из локального MLS roster, а не доверяет
  данным signaling backend;
- canonical binding включает protocol/role, `conversation_id`, `call_id`, обе
  user/device стороны и единственный canonical SHA-256 DTLS fingerprint;
- modified/ambiguous fingerprint, stale signature, wrong device или отсутствующий
  MLS leaf отклоняются до `setRemoteDescription`;
- signaling protocol v2 не имеет silent fallback к unauthenticated v1;
- private key не экспортируется из Rust/WASM runtime.

### Scope

- отдельный threat model и ADR;
- Rust/OpenMLS intent API для sign/verify и детерминированного verification code;
- worker/session boundary без выдачи private key в TypeScript;
- version 2 call signaling DTO/parser/snapshot для authenticated offer/answer;
- fail-closed WebRTC integration и MLS-verified state/code в call UI;
- negative Rust, frontend и backend tests, включая answer race semantics;
- immutable `/crypto/v8/` browser asset и обновлённый service-worker precache.

### Exclusions

- production rollout, SSH, Nginx/coturn changes или push/deploy;
- group calls, video calls и native mobile wrapper;
- скрытие signaling metadata или TURN IP metadata;
- обещание Telegram protocol equivalence: Telegram использует другую call/key
  architecture, а здесь identity authentication построена поверх MLS device roster.

### Definition of Done

- обе стороны проверяют remote fingerprint по MLS device identity до применения SDP;
- обе стороны получают один и тот же server-independent verification code;
- tampered SDP/fingerprint, replayed binding и wrong actor device fail closed;
- v1 frames отклоняются parser/server tests;
- full local CI, Rust/WASM build и frontend production build зелёные;
- ветка и коммиты остаются локальными, production не изменён.

### Result

- Rust/OpenMLS sealed runtime подписывает и проверяет domain-separated offer/answer
  bindings без экспорта private key; verifier разрешает public key только из exact
  current MLS leaf локальной conversation;
- signaling v2 передаёт bounded lowercase Ed25519 signature вместе с SDP, сохраняет
  её в reconnect snapshot и полностью отклоняет v1 вместо downgrade;
- caller и callee применяют remote SDP только после MLS-проверки, а UI показывает
  подтверждённый identity status и одинаковый 12-digit comparison code;
- offer остаётся адресованным user, поэтому может звонить на все его MLS devices;
  answer фиксирует exact winning device, а поздний ответ другого device отклоняется;
- строгий SDP parser принимает только один unique SHA-256 DTLS fingerprint и fail
  closed для modified/ambiguous SDP, stale call, wrong conversation/user/device;
- immutable `/crypto/v8/` release WASM с новыми intent APIs собран и включён в PWA
  precache; старые rolling assets сохранены;
- полный локальный `make ci` зелёный: backend `278 passed, 12 skipped`, Rust `26
  passed`, frontend `334 passed`, lint/format/import contracts/mypy/typecheck,
  native+WASM clippy/build, Nuxt production build, Compose/deployment/docs checks;
- production, Nginx, coturn, SSH и GitHub не изменялись.
