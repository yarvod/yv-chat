# ADR-0004: MLS application-message relay для device history transfer

- Статус: **accepted for WP-081 text/tombstone slice**
- Дата решения: 2026-08-13
- Связанные задачи: `BL-015`, `WP-081`
- Базовый протокол: [ADR-0001](0001-e2ee-mls.md)
- Pairing boundary: [ADR-0003](0003-qr-device-pairing.md)

## Контекст

Новый independent MLS leaf не получает pre-membership epoch secrets, но пользователь
явно хочет перенести доступную локальную историю между своими связанными устройствами.
Копирование signer, sealed group или device-local storage key нарушает independent
device/revocation model. Самодельный QR-derived AES/ECDH channel запрещён проектом.

## Решение

После того как `WP-080` подтвердил exact target leaf в READY roster конкретного direct,
source создаёт обычный OpenMLS application `PrivateMessage`. Его plaintext — bounded
versioned archive chunk для одного conversation и exact authorized pairing/target.
FastAPI хранит/маршрутизирует только opaque MLS bytes и metadata authorization; target
расшифровывает через тот же isolated OpenMLS Worker и сохраняет records под собственной
non-extractable AES-GCM archive key.

Relay двусторонний: trusted и candidate devices независимо публикуют свои доступные
ranges counterpart-у. Union определяется immutable server message IDs/sequences;
target не удаляет записи, которых нет в manifest другого устройства.

## Почему MLS application messages

RFC 9420 `PrivateMessage` уже даёт group-member confidentiality/authentication и
sender ratchets. Новый leaf получает current epoch только после стандартного Welcome,
поэтому отдельный key agreement не нужен. OpenMLS удаляет использованный sender key;
author не может позже расшифровать собственный ciphertext, поэтому application обязано
сохранять свою plaintext copy — WP-081 делает это только внутри encrypted outbox/archive.

Relay messages не fan-out-ятся как timeline events, поэтому остальные conversation
leaves могут пропустить несколько sender generations. RFC 9420 требует bounded policy;
OpenMLS 0.8 default `maximum_forward_distance` равен 1000. WP-081 ограничивает transfer
20 chunks на direction/conversation и target читает их по server sequence. Это не
безграничный скрытый stream; превышение лимита становится explicit partial gap.

## Server и authorization

- row привязан к authorized `device_pairing`, sender device/session и exact counterpart;
- account обязан быть active member direct conversation; groups не принимаются;
- `(pairing, sender, client_chunk_id)` уникален: exact retry возвращает существующий
  row, иной immutable payload конфликтует;
- ciphertext/metadata bounded, expires/ACK durable, raw bytes не логируются;
- ACK разрешён только target и только после local durable import;
- server не заявляет cryptographic authenticity: target обязан успешно обработать MLS
  message и проверить внутренний payload binding.

## Local archive

`local_plaintext` — canonical encoded application content, не display-only строка. Оно
является optional local field рядом с immutable opaque envelope и шифруется существующей
non-extractable archive key/AAD. Network parser никогда не принимает это поле. Server
refresh с тем же immutable message сохраняет local copy; contradictory envelope не
перезаписывает её молча. Tombstone не воскресает plaintext.

## Ограничения

- любой current MLS group member криптографически способен обработать PrivateMessage,
  если malicious Delivery Service отдаст ему bytes; это не расширяет confidentiality
  относительно участников самого direct, но relay API всё равно restrict-ит target;
- доступна только history, которую source ещё может показать/имеет local copy;
- text/tombstone first; media остаётся отдельным bounded protocol;
- transfer повышает sender generation, поэтому строгие chunk/byte limits являются
  protocol invariant, а не tuning option.

## Отклонённые варианты

- общий archive/storage key или копия MLS signer/group state;
- QR scan token/candidate proof как history encryption key (server/bootstrap знает
  material либо оно не является отдельной authenticated E2EE boundary);
- самописный WebCrypto ECDH + AES-GCM framing;
- plaintext upload или перешифрование старых server message rows;
- обязательный live WebRTC channel как correctness dependency.
