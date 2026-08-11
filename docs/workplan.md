# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-012 — Versioned opaque message envelope

Статус: **completed**  
Backlog item: `BL-006`  
Цель: принять и сохранить только bounded opaque ciphertext envelope, не создавая server-side plaintext dependency и не выдавая временный transport за E2EE.

### Результат

Domain/application/persistence знают versioned opaque `Message`, sender user/device и server timestamp. Authenticated participant может отправить envelope только от собственной active device; backend не понимает содержимое ciphertext и не содержит decrypt/text/key полей.

### Invariants

1. Message body — непустые opaque bytes с bounded size; plaintext schema/field отсутствует.
2. Protocol version положительна и входит в поддерживаемый transport set; это ещё не выбранный E2EE protocol.
3. Sender user берётся из authenticated principal; client не присылает `sender_user_id`.
4. Sender device берётся из current session principal и проверяется как active owned device.
5. Sender имеет active conversation membership в момент create.
6. Server задаёт timezone-aware `created_at`; client timestamps не определяют порядок.
7. ORM не выходит infrastructure; API использует base64 только как encoding opaque bytes.
8. Base64 strict, payload size проверяется до persistence.
9. Server не логирует ciphertext/password/token и не пытается decrypt.
10. Временный version-1 envelope явно документирован как non-E2EE transport foundation.

### План

- [x] Добавить Message domain entity/policy и domain tests.
- [x] Добавить narrow MessageRepository/MessagingUoW ports.
- [x] Добавить SQLAlchemy model/adapter/UoW и Alembic `0008`.
- [x] Добавить Dishka persistence/application providers.
- [x] Добавить SendOpaqueMessage use case с membership/device authorization.
- [x] Добавить strict base64 `/api/v1/conversations/{id}/messages` POST DTO.
- [x] Добавить metadata/OpenAPI forbidden plaintext/key tests.
- [x] Добавить application/HTTP negative auth/device/size/version tests.
- [x] Добавить PostgreSQL integration persistence/authorization test.
- [x] Проверить migration roundtrip/base→head, full CI и Docker head.
- [x] Обновить docs и создать отдельный commit.

### Не входит в scope

- реальный E2EE protocol/key establishment;
- message idempotency/sequence/pagination (следующий `BL-007`);
- sync/WebSocket/push;
- receipts/delete/TTL cleanup;
- attachments;
- frontend composer/decryption.

### Проверка готовности

- DB/OpenAPI не содержат plaintext/message-key поля;
- non-member и foreign/revoked device не создают row;
- invalid base64/version/empty/oversized envelope отклоняется bounded ответом;
- persisted bytes идентичны decoded opaque input;
- migration/CI/integration/Docker smoke зелёные;
- отдельный commit создан.
