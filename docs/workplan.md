# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-059 — Pixel adaptive icon and Android generated splash repair

Статус: **completed and production-verified** (`59495f0`, CI `31577182353`,
deploy `31577182322`)
Backlog: visual/PWA polish slice `BL-041`, defect `BUG-060`

Цель: установленная из Chrome PWA на Pixel выглядит как нормальное Android
приложение: launcher использует full-bleed adaptive icon без вложенного квадрата и
белой fallback-плашки, а Android-generated splash имеет единый фирменный фон без
видимой квадратной картинки и серого системного полотна.

### Product scope

- [x] сохранить текущий фирменный line mark без AI-redraw и изменения identity;
- [x] production HTML явно подключает `/manifest.webmanifest`, чтобы Chrome создавал
  manifest-aware WebAPK, а не fallback home-screen shortcut;
- [x] выпустить новые versioned `v3` URLs для `any` и `maskable`, чтобы Chrome/WebAPK
  не продолжал использовать install-time cache старых `v2` ресурсов;
- [x] transparent `any` остаётся пригодной для favicon/desktop surfaces без baked
  square/squircle;
- [x] opaque `maskable` имеет однотонный full-bleed canvas, совпадающий с manifest
  `background_color`, и важный artwork целиком находится в radius-40% safe zone;
- [x] manifest не предлагает Android лишнюю 64px install icon и явно разделяет
  `any` и `maskable` purposes;
- [x] Android-generated splash визуально сливает icon canvas с launch background;
- [x] пользователь получает документированный update/reinstall guidance, потому
  что launcher/WebAPK assets не обязаны мгновенно меняться внутри уже установленной PWA.

### Implementation и проверки

- [x] обновить воспроизводимый `generate-pwa-icons.mjs`, не редактировать PNG вручную;
- [x] сгенерировать 192/512 `v3` install assets и оставить старые files только для
  безопасного обслуживания уже закэшированных клиентов;
- [x] расширить tests: dimensions, alpha contract, exact solid background corners,
  manifest link/version/purpose и отсутствие install-time 64px candidate;
- [x] визуально проверить circle/squircle crop и generated-splash simulation;
- [x] frontend lint/typecheck/Vitest/build и repository CI зелёные;
- [x] commit/push/deploy, затем проверить production manifest, asset headers/dimensions,
  health/logs и соседние домены.

### Exclusions

- Android launcher/splash нельзя заменить произвольным экраном из PWA: Chrome и ОС
  генерируют их из manifest metadata;
- изменение фирменного знака, animated splash, native Android wrapper и отдельная
  Play Store сборка не входят в этот fix;
- уже установленный WebAPK может потребовать удаления и повторной установки после
  production deploy; приложение не может принудительно очистить launcher cache ОС.

### Local acceptance evidence

- production-like Nuxt output до исправления не содержал `link[rel="manifest"]`;
  после исправления browser acceptance получает `/manifest.webmanifest` из `<head>`;
- manifest содержит ровно четыре `v3` install resource: 192/512 для отдельных
  `any` и `maskable`, без старых `v2` URL и без 64px Android candidate;
- pixel-level regression подтверждает transparent corners у `any`, полностью opaque
  `maskable`, точный edge color `#07111f` и artwork внутри radius-40% safe zone;
- circle-crop и generated-splash previews проверены визуально: белого кольца,
  вложенного midnight square и серого launch canvas нет;
- `make ci`: backend `224 passed, 8 skipped`, Rust `21 passed`, frontend
  `197 passed`; lint, typecheck, production build, Compose/deploy/docs checks зелёные.

### Production acceptance evidence

- immutable backend/frontend release `sha-59495f01295f82e552c4cd4e390f12f6469e0b29`
  выложен workflow `31577182322`; GitHub CI `31577182353` зелёный;
- `https://chat.yoowee.ru/` содержит `<link rel="manifest"
  href="/manifest.webmanifest">`, production manifest использует только четыре
  ожидаемых `icon-v3-*` URL и `background_color: #07111f`;
- обе production 512px icon загружаются как PNG и имеют точные dimensions 512×512;
- API/direct upstream healthy, frontend upstream доступен, системный Nginx active,
  в свежих API logs нет `ERROR`, `Traceback` или HTTP 500;
- `yoowee.ru` сохраняет штатный redirect, `s3.yoowee.ru` имеет валидный TLS и
  ожидаемо отвечает 403 без S3 credentials; соседние `infra-*` containers не
  перезапускались и остаются Up.

### Definition of Done

- новый install на Pixel показывает крупный фирменный знак без вложенного квадрата;
- splash использует midnight background и не показывает отдельную квадратную плитку;
- standard desktop/macOS icon не деградирует;
- generator/tests/docs/production verification завершены и worktree чистый.
