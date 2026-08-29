# Текущий workplan

## WP-139 — Лёгкие image previews и повторная навигация по reply

Статус: **completed and production deployed**
Bugs: `BUG-128`, `BUG-129`

Цель: прикреплённое фото не вызывает лаги при наборе текста, а reply остаётся
компактным, показывает квадратный thumbnail исходной картинки и при каждом клике
переходит к исходному сообщению.

### Scope

- заменить полноразмерный image blob в composer на bounded локальный thumbnail;
- сохранить original file отдельно для upload и exact original pixel dimensions;
- добавить lazy квадратный thumbnail первой картинки в reply preview;
- загружать direct thumbnail только через существующий authorized/decryption boundary;
- сделать переход к reply target императивно повторяемым, даже если route query уже
  содержит тот же `messageId`;
- сохранить bounded target-window loading для сообщения вне текущего DOM.

### Security и privacy

- thumbnail создаётся только client-side из уже разрешённого plaintext blob;
- original file, direct file key и ciphertext contracts не меняются;
- thumbnail не пишется на server, в localStorage или отдельный durable cache;
- object URLs отзываются при удалении attachment/unmount;
- unavailable/deleted reply не пытается читать ciphertext или media secret.

### Tests

- composer использует bounded preview blob, upload продолжает получать original File;
- reply image рендерит квадратный thumbnail и текст/caption;
- два последовательных клика по одному reply дважды центрируют и подсвечивают target;
- thumbnail loader lazy, failure-safe и отзываeт URL;
- frontend full suite, lint, typecheck и production build.

### Exclusions

- server-side thumbnails или изменение media schema;
- persistent thumbnail cache;
- video frame extraction для reply;
- изменение reply protocol payload.

### Definition of Done

- набор текста с прикреплённым большим фото не держит full-resolution preview в DOM;
- reply с картинкой остаётся компактным и не раздувает bubble;
- повторный клик работает без искусственного route nonce;
- проверки и документация обновлены.

### Result

- composer немедленно добавляет original File как upload source, а browser adapter
  асинхронно создаёт отдельный PNG thumbnail с maximum edge 160 px и освобождает
  full-resolution bitmap; original dimensions сохраняются отдельно;
- reply preview отображается перед собственным content, использует квадрат 40×40 и
  лениво создаёт максимум 96 px thumbnail только около viewport;
- direct reply thumbnail проходит через обычный authorized download/decryption flow;
  transient object URL отзывается на remove/unmount и не становится durable cache;
- `revealMessage()` при каждом действии заново вызывает target-window loader, затем
  императивно центрирует и подсвечивает exact DOM row, поэтому неизменившийся route
  query больше не блокирует повторный клик;
- map сообщений устраняет повторный линейный поиск reply target для каждого bubble;
- `71/71` frontend test files и `441/441` tests проходят; ESLint, Nuxt typecheck,
  production/PWA build и `git diff --check` зелёные.
- production rollout коммита `b536c77` выполнен workflow `33281342997`; отдельный
  CI workflow `33281342979` зелёный, immutable tag
  `sha-b536c7714f1887915a81179efc6bfc7665c90013` активен;
- `chat.yoowee.ru`, `chat.yoowee.com.de` и оба `/api/v1/health` вернули HTTP `200`
  с успешной TLS-проверкой.
