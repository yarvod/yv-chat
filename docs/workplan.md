# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-072 — Device data controls and safe message links

Статус: **complete; local browser acceptance and full CI green**

Цель: пользователь видит объём локального media cache и может безопасно очистить
его в Settings, не затрагивая переписки/session/device identity/MLS; `http(s)` URL
в сообщениях открываются обычной ссылкой через browser/OS устройства.

### Scope

- [x] account+device-scoped media cache statistics: bytes, entries, 2 GiB ceiling;
- [x] explicit confirm перед очисткой и понятное описание точной области удаления;
- [x] persistent OPFS/IDB media entries, отдельный media key и hot decrypted RAM
  очищаются как одна user action;
- [x] concurrent in-flight download после clear не может снова записать старый cache;
- [x] message renderer linkify-ит только valid `http:`, `https:` и `www.` URL;
- [x] normal `<a target="_blank">` делегирует открытие default browser/OS без
  privileged API и сохраняет `noopener noreferrer external`;
- [x] входной message text остаётся escaped Vue text, без `v-html`.

### Security and data invariants

- clear не открывает и не меняет `yv-chat-messages-v1`, snapshot, outbox,
  conversation crypto или `yv-chat-crypto-v1`;
- clear не удаляет session credential, device identity, MLS wrapping key или archive;
- операция ограничена exact authenticated `user_id + device_id`; media другого
  аккаунта/device в том же browser origin остаются;
- unsafe schemes (`javascript:`, `data:`, `file:`) никогда не становятся ссылками;
- link click не выполняет содержимое сообщения и не получает `window.opener`.

### Exclusions

- destructive clear всей encrypted переписки или crypto identity;
- pinned media, per-chat cache controls и configurable cache ceiling;
- composer draft storage и local message retention controls;
- URL preview fetching, unfurl metadata и server-side URL inspection.

### Definition of Done

- Settings показывает текущий media usage и entry count;
- confirm clear освобождает только media cache и сразу показывает zero state;
- reopen доступного media после clear выполняет обычный authenticated download;
- сообщения, MLS keys/checkpoints и данные другого device переживают clear;
- URL с punctuation и mention рядом отображается корректно; unsafe scheme inert;
- frontend tests/lint/typecheck/build и полный repository CI проходят;
- local Docker/browser проверяет settings clear и real external-link element.

### Verification evidence

- targeted storage/link tests: `21 passed`;
- full frontend: `46 files / 250 tests`, lint/typecheck/build green;
- local Docker/browser: real group message produced one safe external anchor with
  exact `href`, `_blank`, `noopener noreferrer external`; `javascript:` stayed text;
  Settings reported `836 B / 1 file`, required confirm, then reported `0 B / 0 files`;
  reopening the chat preserved message/link, re-downloaded PNG and returned cache to
  `836 B / 1 file` without console errors;
- full `make ci`: backend `241 passed / 9 skipped`, Rust `21 passed`, frontend
  `46 files / 250 tests`, lint/typecheck/build/docs/config checks green.
