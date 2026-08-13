# Текущий workplan

## WP-081 — Bidirectional encrypted history merge for QR-linked devices

Статус: **completed locally; production rollout held** (`BL-015`, ADR-0004)

Цель: после `WP-080` оба связанных device обмениваются доступной text/tombstone
history в обе стороны. Server хранит только TTL-bounded opaque MLS application
messages. Target проверяет, расшифровывает и заново сохраняет content под собственной
non-extractable archive key; MLS signer/group state/storage key не копируются.

### Scope

- сохранять расшифрованный canonical text payload вместе с immutable envelope только
  внутри существующего AES-GCM encrypted local archive; server refresh не стирает
  уже восстановленную local copy;
- сохранять plaintext исходящего MLS message в encrypted outbox/archive, потому что
  OpenMLS по правилам forward secrecy не может расшифровать message собственного
  sender ratchet после отправки;
- добавить PostgreSQL relay rows, привязанные к authorized pairing, exact sender /
  counterpart target device, direct conversation, monotonic sequence, idempotent
  chunk ID, ACK, byte/record limit и TTL;
- transfer payload защищать стандартным MLS `PrivateMessage` текущего READY epoch;
  не добавлять самостоятельный AES/ECDH/ratchet. Один chunk = один MLS application
  generation, максимум 20 chunks на direction/conversation — значительно ниже
  OpenMLS `maximum_forward_distance=1000`;
- source экспортирует только сообщения, которые уже может локально показать, и
  authenticated tombstones; недоступные записи считаются gap и не угадываются;
- target валидирует version, pairing/conversation/chunk binding, bounded ordered
  records, immutable IDs/sequences/metadata и duplicate consistency до archive put;
- обе стороны запускают export + inbound import; retries/resume используют server
  chunk sequence/ACK и не требуют одновременного peer connection после upload;
- UI различает `history syncing`, `partial/gaps`, `ready`; отсутствие history не
  откатывает успешный MLS enrollment и не блокирует future messages.

### Security invariants

- server не получает plaintext, archive key, signer, epoch secret или candidate proof;
- relay доступен только двум active sessions/devices exact authorized pairing и только
  для direct, где paired account является active member;
- MLS authentication остаётся cryptographic source authentication; HTTP binding не
  заменяет проверку `PrivateMessage`;
- hidden transfer generations bounded; target обрабатывает их по relay sequence, ACK
  только после durable encrypted local commit;
- contradictory duplicate, malformed payload, wrong conversation/target/pairing,
  revoked session/device и expired transfer fail closed без удаления local archive;
- transferred plaintext никогда не попадает в logs, URLs, analytics, Vue debug state
  или обычную message API; memory очищается после encode/decode насколько позволяет JS;
- server ciphertext retention и local archive retention остаются разными политиками.

### Verification

- archive/outbox codec tests: local plaintext encrypted at rest, survives reload,
  server envelope refresh preserves it, corruption fails closed;
- backend application/HTTP/PostgreSQL tests: both directions, wrong device/account /
  conversation, duplicate exact/conflict, byte limits, ACK authorization, TTL/restart;
- frontend transfer tests: mutually missing ranges, own-sent content, tombstone,
  duplicate/out-of-order relay, partial undecryptable source, restart/resume and gaps;
- MLS runtime regression: hidden chunks remain below forward-distance bound and normal
  visible message decrypts after skipped relay generations;
- full backend/frontend/crypto/Compose CI before rollout.

### Exclusions

- attachments/media, preferences/read receipts and history beyond available local/server
  sources;
- peer-to-peer WebRTC optimization, External Commit, key transparency;
- transfer from revoked device or automatic plaintext backup;
- production flag before physical iOS/macOS/Android/browser matrix.

### Definition of Done

- both QR directions perform union, not source overwrite;
- available sent/received text and tombstones survive target reload encrypted at rest;
- duplicate/restart is idempotent and server remains opaque;
- gaps are explicit and future MLS messaging remains usable;
- focused commit, migration, tests and security documentation complete.

### Verification result

- backend Ruff/format/mypy и полный pytest green;
- frontend lint/typecheck, 287 tests и production Nuxt/PWA build green;
- HTTP negative checks подтверждают CSRF и exact target binding;
- fresh PostgreSQL migrations до `0025`, upload, полный engine restart и target
  retrieval прошли на отдельном временном PostgreSQL 17 container;
- rollout удерживается до additive migration/deploy checks и physical
  iOS/macOS/Android PWA matrix; attachment/media transfer остаётся вне этого slice.
