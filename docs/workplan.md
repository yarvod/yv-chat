# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-065 — Desktop attachment paste and drag/drop

Статус: **implemented and verified locally**

Цель: пользователь desktop PWA добавляет изображения и файлы в composer привычным
`Ctrl/Cmd+V` или перетаскиванием, видит понятную drop-zone и отправляет их через уже
существующий ordered attachment flow без обхода лимитов или E2EE boundary.

### Reproduction

- composer принимает вложения только через скрытые media/file inputs и attachment menu;
- clipboard image/file paste всплывает как обычное событие, но файл не попадает в
  attachment preview;
- drag/drop файла на открытый диалог не имеет visual affordance и может привести к
  browser navigation вместо добавления в сообщение.

### Scope

- [x] извлекать file clipboard items при paste внутри открытого desktop chat;
- [x] не перехватывать обычную текстовую вставку;
- [x] принимать ordered `DataTransfer.files` через drag/drop по message panel;
- [x] показывать устойчивую drop-zone без flicker при проходе через дочерние элементы;
- [x] переиспользовать единый count/type/size validator для picker, paste и drop;
- [x] давать clipboard image без имени безопасное понятное display name;
- [x] не разрешать paste/drop в direct conversation до готового E2EE media flow;
- [x] покрыть clipboard, text paste, drag state/drop order и direct boundary тестами.

### Security invariants

- текущий group v1 attachment flow остаётся явно server-readable и не получает
  secure/E2EE badge;
- direct MLS conversation не загружает plaintext media через новый input path;
- paste/drop не ослабляет лимит 10 файлов и существующие image/video/file byte limits;
- browser filename остаётся display metadata и не используется как storage path;
- файл только подготавливается в composer и отправляется после явного submit.

### Exclusions

- direct E2EE attachment encryption/upload/download;
- recursive directory traversal и folder upload;
- offline-persisted attachment drafts, cancel/retry и OPFS media cache;
- изменение backend attachment API, TTL или quota policy;
- системная mobile share sheet и camera capture.

### Definition of Done

- `Ctrl/Cmd+V` добавляет clipboard image/file, сохраняя обычный text paste;
- drag-over показывает доступную drop-zone, drop добавляет файлы в исходном порядке;
- picker, paste и drop одинаково применяют лимиты и attachment preview;
- direct chat показывает честное E2EE-boundary сообщение и ничего не загружает;
- frontend lint, typecheck, tests и production build проходят.

### Verification evidence

- frontend `42` files / `221` tests, ESLint, Nuxt typecheck и production PWA build: green;
- полный `make ci`: backend `238 passed, 9 skipped`, Rust `21 passed`, frontend
  `221 passed`; Ruff/format/import-linter/mypy/clippy/build/config/docs contracts green;
- authenticated visual drop-zone acceptance требует доступного local session/backend;
  unauthenticated desktop shell загружается без console warnings/errors.
