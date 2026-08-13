# ADR-0003: QR device pairing и passwordless device-bound session bootstrap

- Статус: **accepted for WP-079 transport slice**
- Дата решения: 2026-08-13
- Связанные задачи: `BL-015`, `WP-079`
- E2EE protocol: [ADR-0001](0001-e2ee-mls.md)

## 1. Контекст

Обычный password login создаёт новую server `Device`/session, но не доказывает доверие
существующего E2EE device и не переносит его MLS/history state. Пользователь должен
связать новый browser install уже доверенным устройством без камеры на компьютере и
без зависимости от online собеседника. Restart/deploy не должен сбрасывать progress.

QR linking меняет authentication/device trust boundary, поэтому он отделён от
последующих MLS enrollment и archive transfer. `WP-079` выдаёт только независимую
device-bound HTTP session; он не копирует и не меняет cryptographic state.

## 2. Решение

Поддерживаются две роли одной durable state machine:

```text
enrollment_request: candidate computer displays → trusted phone scans/approves
enrollment_offer:   trusted computer displays   → candidate phone scans → computer approves
```

Компьютер всегда показывает QR, телефон всегда сканирует. Permanent primary device
не возникает: после успешного linking новый device имеет собственные identity,
session и будущий MLS leaf.

Pairing хранится в PostgreSQL и проходит monotonic состояния:

```text
created → confirmation_pending → approved → authorized
   └──────────────→ cancelled
any non-terminal state + TTL → expired
```

`authorized` связывает pairing с ровно одним созданным `device_id/session_id`.
Повтор exact authorize не создаёт второй device и может повторно установить cookie
в пределах TTL; иной proof/account/device получает fail-closed conflict.

## 3. Разделение QR capability и candidate proof

Candidate генерирует browser WebCrypto CSPRNG secret минимум 256 bit и передаёт
server только `SHA-256(secret)` до approval. Это одноразовый symmetric preimage proof,
а не MLS/message crypto и не самодельный ratchet. Реализация использует только
browser CSPRNG/SHA-256 и существующую server SHA-256 credential boundary.

QR содержит versioned JSON/HTTPS payload:

```text
origin, version, purpose, pairing_id, scan_token, expires_at
```

`scan_token` — независимая 256-bit one-time capability; в DB хранится только digest.
Candidate secret/proof, password, session cookie, MLS signer, archive/storage keys и
plaintext в QR не попадают. Знание/фотография QR позволяет лишь предъявить scan
capability; оно не позволяет пройти candidate proof или trusted-device approval.

Для mutual user verification server показывает обоим экранам одинаковый short
authentication code, детерминированный из pairing ID и stored token commitments.
Code не является credential и никогда сам не авторизует operation. Его назначение —
обнаружить подмену отображаемого flow человеком до explicit approval.

После approval candidate предъявляет secret по HTTPS. Server constant-time сравнивает
его digest с commitment и использует exact 256-bit secret как первое opaque session
credential: его hash уже безопасно хранится, а повтор после потерянного HTTP response
может idempotently вернуть тот же `Set-Cookie`, не сохраняя plaintext credential в DB.
Browser немедленно удаляет JS copy после успешного cookie exchange. Proof нельзя
класть в URL, logs, localStorage или IndexedDB; bounded `sessionStorage` допустим
только на время незавершённого pairing, чтобы reload не убивал flow.

## 4. Authorization rules

- `enrollment_request` создаётся anonymous candidate, затем exact active trusted
  session сканирует и одновременно привязывает account + approving device.
- `enrollment_offer` создаётся exact active trusted session и уже привязан к account;
  anonymous scanner добавляет candidate commitment/device metadata.
- Only exact scanner (`request`) или creator (`offer`) может approve/cancel.
- До `approved` server не создаёт `Device`/session. Manual/authentication code не
  заменяет scan token, trusted cookie/CSRF и candidate proof.
- Anonymous mutations проверяют strict allowed Origin. Authenticated mutations также
  требуют normal session authentication и CSRF.
- Revoked/expired trusted session, wrong account/origin/purpose, second scanner,
  replayed token/proof и state rollback отвергаются.

## 5. Persistence, restart и privacy

Pairing row содержит только bounded metadata, token/proof digests, state timestamps,
trusted/candidate IDs после соответствующих transitions и TTL. Backend restart
теряет только long-poll/WebSocket latency; candidate и trusted device восстанавливают
status через HTTP polling.

API/logs не возвращают и не печатают raw token/proof/session. Pairing rows очищаются
после bounded retention; expired row никогда не оживляется. QR feature rollout
additive: старые клиенты продолжают password login и существующий MLS v2.

## 6. MLS и history boundary

`authorized` означает только HTTP/device trust bootstrap. Затем отдельный worker/slice:

1. генерирует новую independent MLS identity/KeyPackages на candidate;
2. атомарно enroll-ит pending leaf во все доступные direct без остановки healthy
   generation и без online собеседника;
3. запускает authenticated bidirectional history manifest/chunk union.

Существующий signer, sealed provider, current/past MLS state и device-local storage key
не передаются. Старые epochs не перешифровываются. Пока эти slices не завершены, UI
не называет pairing полной E2EE/history синхронизацией.

## 7. Отклонённые варианты

- **Password/cookie/private key в QR:** утечка через screenshot, URL history,
  camera/landing и logs; запрещено.
- **Server хранит plaintext issued credential до polling:** увеличивает credential
  breach surface и ломает действующее правило hash-only sessions.
- **QR scan сразу создаёт session:** screenshot/replay становится account takeover.
- **Копирование signer/MLS state между devices:** превращает независимые devices в
  один shared client и ломает revocation/PCS/state ownership ADR-0001.
- **Только in-memory pairing/WebSocket:** deployment/restart сбрасывает flow.
- **Собственный asymmetric handshake в WP-079:** не нужен для transport bootstrap;
  простая split-capability + preimage proof использует уже проверенные primitives и
  уменьшает protocol surface. E2EE transfer channel проектируется отдельно.

## 8. Consequences и gates

Плюсы: passwordless bootstrap, hash-only persistence, restart-safe idempotency, camera
только на телефоне, отсутствие влияния на current MLS groups.

Ограничения: trusted server всё ещё управляет account sessions и может отказать в
service; защита от malicious Authentication Service требует linked-device
attestations/key transparency в следующих slices. Human authentication code полезен
только если пользователь реально сравнил оба экрана.

До production flag обязательны negative tests wrong proof/approver/account/origin,
TTL/cancel/replay/concurrency, lost-response retry, migration upgrade и physical
iOS/macOS PWA camera/persistence acceptance.
