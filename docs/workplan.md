# Текущий workplan

## WP-127 — Стабильная media-лента и восстановление local history после PWA update

Статус: **completed locally**
Backlog: `BL-041`, `BL-025`

Цель: cached фото/видео не меняют геометрию timeline после async OPFS/IndexedDB
read/decrypt/decode, а временный IndexedDB lifecycle failure после обновления PWA
не объявляет сохранённую локальную историю потерянной навсегда.

### Scope

- image/video attachment metadata переносит bounded pixel dimensions для новых
  сообщений; старые сообщения используют стабильный fallback aspect ratio;
- loading, ready и unavailable media states занимают один и тот же layout box;
- появление decoded bitmap меняет только содержимое зарезервированного box, не его
  высоту и не scroll position;
- message archive повторно открывает IndexedDB после transient failure и снимает
  degraded status после успешной операции;
- IndexedDB connections закрываются на `versionchange`/page lifecycle, чтобы старая
  PWA page не блокировала новую schema/open operation;
- snapshot availability больше не маскируется под недоступность message archive;
- media cache остаётся cache-first и после transient open failure может повторно
  открыть существующий store вместо постоянного network fallback.

### Security and data invariants

- local ciphertext, media keys, MLS state и plaintext не удаляются и не мигрируют
  destructive способом;
- direct media dimensions находятся только внутри существующего MLS content
  envelope; server по-прежнему видит opaque attachment bytes/metadata;
- восстановление не создаёт новый key при наличии существующего valid key record;
- corrupt/tampered encrypted records остаются fail-closed и не очищаются молча;
- server TTL, local cache quota и authorization не меняются.

### Tests

- attachment codecs принимают paired bounded dimensions, round-trip-ят их и
  отвергают partial/invalid/file dimensions;
- component/CSS tests фиксируют одинаковый aspect-ratio box для loading/ready image
  и video, включая legacy fallback;
- message archive test подтверждает recovery после transient storage failure;
- messenger test подтверждает, что snapshot failure не объявляет archive
  unavailable и последующий snapshot save может восстановиться;
- IndexedDB tests проверяют закрытие stale connection на version change;
- полный frontend Vitest, ESLint, Nuxt typecheck и production/PWA build.

### Exclusions

- новая media transcoding/thumbnail pipeline;
- server-side preview plaintext или расшифровка direct media;
- изменение 2 GiB media-cache quota или server retention;
- восстановление данных, реально удалённых browser/OS eviction;
- полная virtualization timeline.

### Definition of Done

- при прокрутке loading/cached media не изменяет высоту сообщения после появления;
- старые attachment envelopes также не вызывают layout shift;
- transient IndexedDB failure после update самовосстанавливается без logout,
  очистки Site Data или генерации новых crypto keys;
- сообщение «Локальная история недоступна» показывается только при фактической
  недоступности message archive;
- tracking docs и frontend checks зелёные, изменения зафиксированы focused commit.

Результат: новые image/video envelopes несут bounded dimensions, а legacy media
получает стабильный fallback box; loading → decoded переход больше не меняет layout.
Archive/snapshot/media stores освобождают stale IndexedDB connections, transient
failure повторно открывается следующей операцией, а snapshot failure больше не
выдаётся за потерю message archive. Frontend: `398 passed`, ESLint, Nuxt typecheck и
production/PWA build зелёные.
