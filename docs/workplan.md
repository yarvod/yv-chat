# Текущий workplan

## WP-097 — Cross-release PWA asset continuity

Статус: **implemented, full-CI and production-like Nginx verified; rollout pending**
Backlog: `BL-025`
Bug: `BUG-087`

Цель: установленная или уже открытая PWA не должна ломаться после frontend rollout,
если её предыдущий executable shell ещё запрашивает hashed Nuxt chunks прошлого
релиза.

### Production evidence and root cause

- VPS, Nginx, API/frontend/PostgreSQL были healthy с `restart count = 0`;
- оба public health endpoint и direct loopback upstream отвечали `200`;
- после rollout production access log зафиксировал `404` для предыдущих
  `/_nuxt/entry.*.css` и `/_nuxt/*.js`;
- prompt-mode Service Worker намеренно позволяет старому shell работать до explicit
  activation, но rollout сразу заменял единственный frontend filesystem;
- HTML и `sw.js` не имели explicit revalidation headers, поэтому browser/PWA мог
  повторно открыть stale shell уже после удаления его chunks.

### Scope

- app shell и Service Worker получают `no-cache, no-store, must-revalidate`;
- app-owned Nginx location отдаёт content-hashed `/_nuxt/**` с годовым cache TTL;
- remote deploy собирает bounded shared asset directory из трёх последних trusted
  immutable frontend images и ранее сохранённых файлов не старше семи дней;
- system Nginx читает только deployment-owned `/var/www/yv-chat/current` alias;
- remote deploy устанавливает snippet через backup, `nginx -t`, reload и rollback;
- current unversioned Nuxt build metadata всегда копируется последней;
- API, database, media, E2EE state и соседние VPS services не меняются.

### Safety invariants

- на VPS не выполняется frontend build; используются только уже pulled GHCR images;
- staging directory заменяется атомарно, пока старый container продолжает видеть
  прежний bind mount;
- failed rollout сохраняет previous image rollback и содержит assets обеих версий;
- retained files — только публичные regular `/_nuxt` assets, symlinks удаляются,
  никаких secrets/user data;
- каталог bounded release count + TTL и не растёт бесконечно.

### Verification

- config regression фиксирует shell revalidation и immutable hashed chunks;
- deploy gate фиксирует Nginx alias, extraction последних images и safe snippet install;
- full `make ci`, production-like Docker rollout и healthchecks;
- exact ранее упавшие production asset URLs после rollout отвечают `200`;
- fresh и stale-shell browser smoke не имеют console/load errors.

### Definition of Done

- предыдущие chunks доступны одновременно с текущими после production rollout;
- новая PWA загружается, старая получает update prompt без fatal asset `404`;
- CI/deploy зелёные, оба origins и WebSocket/API остаются доступны.

### Result before rollout

- production incident доказан exact access-log `404`, при этом VPS, Nginx и все
  containers оставались healthy с restart count `0`;
- app shell и `sw.js` в production image отвечают `no-store`, hashed asset — long-lived;
- isolated Nginx smoke отдал synthetic previous-release CSS, отсутствующий в current
  frontend image, с `200`, правильным MIME, годовым TTL и всеми security headers;
- промежуточные Nitro route/middleware варианты были отклонены smoke-тестом, потому
  что precomputed static layer завершает missing-asset `404` раньше application routes;
- final design использует exact Nginx alias и atomic symlink switch, symlinks внутри
  extracted artifacts удаляются;
- full `make ci`: backend `272 passed, 12 skipped`, Rust/OpenMLS `23 passed`, frontend
  `316 passed`; lint, typecheck, build, Compose, deploy и docs gates зелёные.
