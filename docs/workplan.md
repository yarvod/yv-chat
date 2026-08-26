# Текущий workplan

## WP-130 — Authoritative chat recovery, tab scroll continuity и pairing pacing

Статус: **completed locally; production pending**
Backlog: `BL-FIX-059`

Цель: cache-first bootstrap никогда не должен принимать частичную IndexedDB-копию
за полную server history; возврат из Settings должен открывать тот же chat и exact
message-relative viewport; два устройства за одним NAT не должны упираться в
production pairing ingress во время bounded encrypted relay.

### Production evidence

- PostgreSQL хранит все сегодняшние сообщения «Озёрной» `149–155`, включая входящие
  `149–154`, и admin stream содержит соответствующие `message_created` events;
- телефон показывал только собственное `155`: hydrated snapshot имел cursor уже после
  пропущенных events, а наличие одной cached row запрещало authoritative latest fetch;
- laptop показывал transient «Локальная история недоступна» и не повторял
  authoritative archive write до следующей message операции;
- новый pairing `fd05d978…` сохранил `15` opaque chunks, `0` ACK и получил `4 × 429`;
  production Nginx объединяет control polling и authenticated history relay в одну
  per-IP zone `120r/m`, `burst=40`.

### Scope

- после cache paint hydrated active window всегда сверяется с server history API;
- exact non-latest viewport сверяется вокруг message anchor, latest — через latest page;
- unavailable archive повторяет authoritative active-window fetch/write во время
  обычного cursor poll;
- snapshot store сериализует межстраничные save/load, чтобы unmount anchor не проиграл
  следующему `/chat` mount;
- app layout запоминает exact `/chat?conversation=…` при переходе в Settings;
- symmetric relay polling получает bounded device-staggered pacing ниже существующей
  production per-IP квоты без изменения Nginx security limits.

### Security and data invariants

- PostgreSQL остаётся authoritative только в retention window; local archive не
  объявляется источником полной server history;
- direct ciphertext по-прежнему decrypt-ится только client-side, ключи/ plaintext не
  попадают в server logs или новые snapshot поля;
- sync cursor не сохраняется при недоступном archive;
- pairing остаётся authenticated, device/session bound, idempotent и bounded server
  limits; client pacing не ослабляет ingress или proof/binding validation.

### Tests

- partial cache + advanced cursor всё равно получает отсутствующие latest messages;
- anchored cache сохраняет exact viewport и одновременно выполняет API reconciliation;
- concurrent viewport save/load возвращает последнюю snapshot;
- Settings → Chats сохраняет conversation query;
- authoritative recovery retry снимает transient archive warning;
- полный frontend Vitest, ESLint, Nuxt typecheck, production/PWA build и production QA.

### Definition of Done

- сообщения `149–155` снова видны admin на телефоне после обычного reload без очистки;
- смена вкладки не меняет chat и scroll anchor;
- transient IndexedDB failure самовосстанавливается либо остаётся честно обозначенным;
- history relay проходит без Nginx `429` при двух устройствах за одним Wi-Fi;
- focused commit, зелёный CI, production deploy и runtime acceptance.

### Local result

- hydrated latest и anchored windows теперь всегда выполняют server reconciliation;
  local rows вне server retention сохраняются до explicit tombstone;
- unavailable archive повторяет authoritative fetch/write на fallback poll, а sync
  cursor не сохраняется до восстановления archive status;
- singleton snapshot store гарантирует read-after-write между route instances, app
  layout возвращает exact conversation query;
- relay ждёт drain control burst и использует `4–6s` device-staggered peer polling;
  production Nginx security limits не менялись;
- frontend: `65` files / `407` tests passed, ESLint, Nuxt typecheck и production/PWA
  build зелёные.
