# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-060 — Byte-accurate attachment upload progress

Статус: **completed and production-verified**
Backlog: visual/messaging polish slice `BL-041`

Цель: при отправке фото, видео и файлов в group chat пользователь видит плавный,
реальный прогресс передачи данных как в привычном messenger UI, а не только счётчик
«файл N из M».

### Product scope

- [x] показывать общий процент по сумме байтов всех выбранных вложений;
- [x] показывать progress bar и процент на каждом attachment preview/file card;
- [x] уже загруженные элементы остаются на 100%, текущий отражает реальные network
  bytes, ожидающие остаются на 0%;
- [x] различать «загружаем» и короткую финальную фазу «сохраняем сообщение»;
- [x] не позволять удалить/переставить выбранные элементы во время активной загрузки;
- [x] progress semantics доступны screen reader через `role=progressbar` и ARIA values;
- [x] batch до 10 mixed image/video/file сохраняет существующий sequential,
  idempotent и retry-safe upload contract.

### Implementation и проверки

- [x] добавить typed byte-progress callback в attachment application port/use case;
- [x] реализовать same-origin binary upload через `XMLHttpRequest.upload.onprogress`
  с прежними cookie, CSRF, status/error и strict JSON semantics;
- [x] агрегировать sent/total bytes в `useMessenger`, не переносить transport detail в Vue;
- [x] отрисовать stable progress UI без изменения composer height/scroll geometry;
- [x] покрыть transport events, use-case forwarding, aggregate byte math и component UX;
- [x] выполнить frontend lint/typecheck/Vitest/build и полный repository CI;
- [x] commit/push/deploy и проверить production health/logs/соседние домены.

### Security и correctness invariants

- auth credential остаётся только в `HttpOnly` cookie; progress transport не создаёт
  bearer token, query credential или новый storage;
- CSRF header и same-origin credential policy не меняются;
- callback получает только bounded byte counts и не видит содержимое файла;
- direct MLS attachments по-прежнему запрещены до отдельного E2EE media flow;
- failure не создаёт ложный 100%/sent state и не очищает выбранные файлы, чтобы
  пользователь мог безопасно повторить отправку с теми же idempotency IDs.

### Exclusions

- parallel/chunked/resumable uploads, background upload после закрытия PWA и cancel
  endpoint не входят в эту итерацию;
- download progress и E2EE direct attachments планируются отдельно;
- server API, database schema, media TTL и storage adapter не меняются.

### Local acceptance evidence

- transport regression подтверждает `PUT`, `withCredentials`, CSRF header, unchanged
  binary body и events `0 → partial bytes → exact size`;
- use-case test подтверждает forwarding typed callback, composable regression —
  aggregate snapshots `2/10` и `7/10` для sequential 4+6-byte batch с reset после send;
- component regression отображает overall `25%`, per-item `100%/25%/0%`, ARIA labels,
  disabled removal и финальную фазу `Сохраняем сообщение… 100%`;
- browser acceptance на desktop и Pixel viewport `390×844`: cards не меняют composer
  geometry, strip scroll остаётся локальным, page horizontal overflow отсутствует;
- `make ci`: backend `224 passed, 8 skipped`, Rust `21 passed`, frontend
  `201 passed`; lint, typecheck, production build, Compose/deploy/docs checks зелёные.

### Production acceptance evidence

- implementation commit `ddf76f9` доставлен immutable frontend/backend images через
  успешный workflow `Deploy production` run `31579379964`;
- production API `/api/v1/health` ответил `{"status":"ok"}`, frontend и API containers
  healthy и запущены на `sha-ddf76f9fb75c6046deb9898b492d652d13c37393`;
- host nginx активен, отдельный nginx container отсутствует; свежие API logs не содержат
  `ERROR`, `Traceback` или HTTP 500;
- external probes: `chat.yoowee.ru=200`, `yoowee.ru=302`, `s3.yoowee.ru=403`, у всех
  `ssl_verify_result=0`, поэтому rollout не нарушил соседние production services.

### Definition of Done

- крупное видео на throttled connection показывает монотонный byte-accurate progress;
- mixed batch корректно переходит `completed → current → pending` без скачков;
- success очищает composer после server message enqueue, failure сохраняет selection;
- автоматические проверки и production rollout зелёные, worktree чистый.
