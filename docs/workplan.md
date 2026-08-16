# Текущий workplan

## WP-087 — Encrypted direct attachments and video notes

Статус: **completed locally; production rollout pending**
Backlog: `BL-013`, `BL-017`, `BL-043`

Цель: разрешить фото, видео, произвольные файлы и видеокружки в личных MLS v2
чатах без передачи server-у plaintext, filename, MIME, media kind или file key.

### Scope

- direct client валидирует bounded source, создаёт отдельные random AES-256-GCM
  key/96-bit nonce и шифрует whole file локально до upload;
- AES-GCM AAD связывает schema, conversation, client attachment ID, исходный kind,
  MIME и byte size; ciphertext corruption и metadata substitution fail closed;
- direct upload использует существующий streaming `MediaStorage`, но передаёт только
  `file`, `application/octet-stream`, ciphertext size/digest и opaque IDs;
- original name/type/kind/size, key и nonce доставляются только внутри MLS v2
  application content; Vue получает только display projection без key/nonce;
- server разрешает attachment commit для exact direct MLS v2 generation/epoch и
  сохраняет прежний group v1 server-readable flow без изменения его маркировки;
- download сначала получает/cache-ит client-encrypted bytes, затем локально проверяет
  scope/AES-GCM tag и возвращает plaintext Blob только в memory/UI;
- direct composer, picker, paste/drop и `video_note` включаются только при READY MLS;
  pending/blocked/unavailable MLS остаётся fail closed;
- first slice ограничивает обычный direct file/media 25 MiB, video note — 8 MiB и
  60 секунд; resumable/chunk crypto остаётся отдельным hardening.

### Security invariants

- backend DB/storage/logs/API не получают direct plaintext, filename, original MIME,
  media kind, file key или nonce;
- один key/nonce не переиспользуется; key material не попадает в Vue props/state,
  `localStorage` или незашифрованный IndexedDB metadata;
- outsider, removed member, cross-conversation attachment, direct v1, group v2,
  non-opaque direct upload metadata и tampered ciphertext отклоняются;
- server-side preview/transcoding отсутствует, client filename не используется как path;
- существующие group attachments и исторические messages читаются exact-version flow.

### Verification

- backend unit/HTTP/PostgreSQL: direct opaque upload, exact MLS v2 binding,
  authorization, idempotency, metadata rejection, cleanup and group regression;
- frontend unit: codec round-trip/tamper, AES-GCM corruption/AAD mismatch, upload,
  direct/group download, key absence in display projection, composer/video-note gates;
- Rust/OpenMLS and frontend crypto regression suites, lint/typecheck/build;
- full backend checks, migrations, Docker Compose config and isolated Docker stack;
- real in-app browser: READY direct chat sends and opens a file and video note,
  reload still decrypts them, group warning remains honest, console/API have no 5xx.

### Definition of Done

- два MLS-capable devices обмениваются direct file/video note и расшифровывают их
  только локально, включая после reload;
- server stores only opaque encrypted bytes and routing metadata;
- direct composer stays disabled unless current MLS generation is READY;
- relevant/full checks and Docker/browser acceptance are green;
- README, architecture, backlog and bugs reflect the implemented boundary.

### Result

- direct MLS v2 file/photo/video/video-note payloads are encrypted in the browser
  with per-attachment AES-256-GCM material and uploaded as opaque
  `application/octet-stream` bytes;
- the MLS application message carries the protected display metadata and file
  material; reload restores it from the encrypted local archive without exposing
  the material to Vue props or server metadata;
- full backend/frontend/OpenMLS checks, production builds and an isolated Docker
  stack are green (`266 passed, 12 skipped`; `306 passed`; `23 passed`);
- two independent browser origins exchanged an encrypted file, the recipient
  restored it after reload, and a subsequent MLS text message still decrypted;
  PostgreSQL stored only `file`/`application/octet-stream` and the 67-byte stored
  blob did not contain the 51-byte fixture plaintext;
- the in-app browser exposed no camera/microphone device, so physical video-note
  capture correctly reached the permission error path. The same `video_note`
  encryption/upload/decrypt contract is covered by the direct-attachment tests;
  real-device camera acceptance remains part of the production/browser matrix.
