# Текущий workplan

## WP-110 — Reaction delight, animated stickers/GIFs and mobile composer polish

Статус: **completed and production deployed**
Backlog: `BL-077`, `BL-043`; bug `BUG-098`

Цель: сделать частые chat interactions более живыми: расширить
реакции, добавить motion/haptic feedback, дать GIF/WebP отдельный
стикерный flow и выровнять кнопку «+» в iOS PWA.

### Подтверждённое состояние

- backend и frontend сейчас принимают только 16 exact emoji;
- quick reaction row и full palette не имеют coordinated enter/selection motion;
- semantic haptics port уже существует, но message reaction/reply/menu paths его
  не вызывают;
- GIF играет как generic image, а sticker presentation не закодирован;
- iOS Safari может применять native button appearance/padding к sidebar «+»,
  потому SVG визуально смещается.

### Security и resource invariants

- reaction по-прежнему выбирается только из bounded exact server allowlist;
- direct sticker/GIF bytes шифруются client-side тем же attachment flow;
- group v1 sticker/GIF остаётся явно server-readable, как другие group media;
- не добавляются external GIF/sticker provider, tracking или plaintext preview;
- media size/count/TTL/cache limits не изменяются;
- `prefers-reduced-motion` подавляет decorative motion;
- web haptics остаётся no-op без `navigator.vibrate`; PWA не имитирует
  private Apple Taptic Engine API.

### Scope

- 48 exact reactions, scrollable animated palette и reaction pop/burst feedback;
- haptic intents для long-press menu, palette expand, reaction add/remove и completed reply swipe;
- local GIF/WebP sticker picker, versioned `sticker` attachment presentation и frameless render;
- animated-image badge/reveal и existing authenticated full-screen viewer;
- iOS-normalized «+» button geometry/appearance;
- backend/frontend/component/CSS regressions и full checks.

### Exclusions

- hosted sticker packs, GIF search/API, autoplay video-GIF transcoding и server thumbnails;
- custom Lottie/TGS protocol и Telegram pack import;
- изменение auth, MLS, attachment upload API, DB schema и media quotas;
- обещание vibration/Taptic feedback на iOS Safari, где browser API нет.

### Definition of Done

- full palette показывает 48 server-accepted emoji и не ломает mobile sheet;
- add/remove reaction и reply/menu gestures дают semantic haptic на supported devices;
- reaction/menu/sticker animations плавные и reduced-motion safe;
- local GIF/WebP можно отправить как frameless animated sticker;
- direct sticker metadata/bytes остаются в E2EE content/attachment boundary;
- iPhone «+» имеет exact square geometry и centered SVG;
- backend/frontend tests, lint, typecheck и production build проходят.

### Выполнено

- backend/frontend exact allowlist расширен до 48 emoji без изменения reaction API/DB;
- quick/full palette получила staged reveal, reaction chips — pop, а успешный add —
  короткий burst у точки нажатия;
- semantic haptics подключены к long-press/context menu, раскрытию palette,
  add/remove reaction, завершённому reply swipe и открытию attachment/new-chat UI;
- GIF/WebP получили локальный sticker picker, versioned `sticker` presentation,
  direct protected-envelope roundtrip и frameless animated render; обычный GIF
  сохраняет authenticated viewer и получил badge/reveal;
- iOS button appearance/padding сброшены, target зафиксирован как 40×40, SVG как
  21×21 с точным совпадением центров.

### Проверка

- frontend: ESLint, Nuxt typecheck, `357 passed`, production build;
- backend: Ruff check/format, mypy, `279 passed, 12 skipped`;
- focused regressions: `64 passed`; Compose config валиден;
- in-app browser, viewport `390×844`: `48` reaction buttons, horizontal overflow
  отсутствует (`390/390`), center delta кнопки/SVG «+» равен `0/0`.
- production rollout workflow `32355715677` и параллельный CI `32355715710`
  завершились успешно; frontend и `/api/v1/health` вернули HTTP `200` на обоих
  официальных origins.
