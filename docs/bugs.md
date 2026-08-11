# Bugs

Здесь фиксируются воспроизводимые дефекты, найденные во время разработки или проверки. Новые фичи и архитектурные идеи относятся в `backlog.md`, а не сюда.

## Active

### BUG-039 — Device crypto warning не объясняет причину и безопасное восстановление

- Статус: `fix in progress`.
- Найдено в: production user report после `WP-045`.
- Severity: `high` для security UX; crypto path корректно остаётся fail closed.
- Условия воспроизведения: authenticated startup получает Worker/vault/registration
  failure, в частности server registration при отсутствующем local IndexedDB state.
- Ожидаемое поведение: показать bounded человекочитаемую причину и для irrecoverable
  binding failure предложить явное переподключение с новым backend device.
- Фактическое поведение: все причины схлопываются в бесконечное «Криптомодуль не
  готов / Повторить», хотя retry не исправляет потерянный local key.
- Причина: lifecycle state сохранял только `unavailable`, отбрасывая typed
  `DeviceCryptoError`/network category.
- Исправление: сохранять bounded issue category; transient network/runtime/storage
  оставлять retryable, а missing/corrupt/conflicting identity направлять через
  explicit logout → новый login/device без silent key replacement.
- Проверка: Vitest classification + production retest после deploy.

Physical Pixel acceptance для `BUG-033`/`BUG-034` ожидает пользовательского retest
после production deploy и uninstall/reinstall старой установки.

## Формат записи

### BUG-NNN — Краткое название

- Статус: `open` / `investigating` / `fixed` / `verified`.
- Найдено в: commit или workplan ID.
- Severity: `critical` / `high` / `medium` / `low`.
- Условия воспроизведения: точные шаги и входные данные.
- Ожидаемое поведение: что должно происходить.
- Фактическое поведение: что происходит.
- Причина: заполняется после диагностики.
- Исправление: commit и краткое описание.
- Проверка: тест или команда, подтверждающая fix.

## Resolved

### BUG-038 — Authenticated PWA не запускала device crypto lifecycle

- Статус: `verified`.
- Найдено в: E2EE release-gate audit, `WP-045`.
- Severity: `high`.
- Условия воспроизведения: войти или перезагрузить authenticated PWA после
  реализации sealed OpenMLS vault и server identity registry.
- Ожидаемое поведение: current device restore/provision/register выполняется
  автоматически, server public response exact сравнивается и KeyPackage проверяется
  consumer-side перед любым MLS use.
- Фактическое поведение: plugin экспортировал несвязанные manual use cases, но ни
  layout, ни auth orchestration их не вызывали; HTTP claim parser проверял только
  shape/length/base64, а не OpenMLS signature/ciphersuite/leaf binding.
- Причина: Worker runtime и server delivery были реализованы отдельными vertical
  slices без завершающего authenticated application use case.
- Исправление: `InitializeDeviceCrypto` реализует server-first restore-or-provision
  policy, exact public comparison и Worker validation; authenticated layout запускает
  scoped runtime и показывает fail-closed warning. Rust/WASM validator проверяет
  canonical IDs, credential, key, fingerprint, package ref, OpenMLS signature,
  version/ciphersuite и отсутствие trailing bytes.
- Проверка: native Rust и real release WASM tests отвергают substitution/corruption;
  application tests запрещают silent reprovision при registered missing state и
  проверяют exact registration/claim validation calls.

### BUG-037 — Outbox старого login-device мог повторить сообщение под новым device scope

- Статус: `verified`.
- Найдено в: security/idempotency review, `WP-044`.
- Severity: `high`.
- Условия воспроизведения: server commit успешен, но local outbox ack не завершён;
  затем пользователь входит заново и получает новый backend device, после чего PWA
  читает прежнюю user-scoped запись.
- Ожидаемое поведение: envelope одного sender device никогда не отправляется от имени
  другого; retry использует ту же backend uniqueness pair.
- Фактическое поведение: первоначальный adapter был scoped только по
  `owner_user_id + client_message_id`, тогда как backend idempotency scoped по
  `(sender_device_id, client_message_id)`; повтор после нового login мог создать
  второй server message.
- Причина: current `/me` не передавал session `device_id`, и local outbox не связывал
  запись/AAD/query с device.
- Исправление: `/api/v1/me` возвращает authenticated `device_id`; outbox DTO,
  compound key/index, AES-GCM AAD, use cases, flush и receipt reconciliation требуют
  exact owner+device scope. Записи старого device сохраняются, но не переотправляются
  и не удаляются неявно.
- Проверка: backend HTTP test связывает `/me.device_id` с последним login principal;
  IndexedDB test доказывает изоляцию одинакового client ID между devices, а delivery
  tests требуют совпадения receipt sender device.

### BUG-036 — Неотправленное сообщение терялось после reload/restart

- Статус: `verified`.
- Найдено в: local-first send audit, `WP-044`.
- Severity: `high`.
- Условия воспроизведения: отправить текст при network failure, затем закрыть или
  перезагрузить PWA до успешного повторного POST.
- Ожидаемое поведение: exact protected envelope durable сохраняется до HTTP,
  остаётся видимым и повторяется с тем же `client_message_id`.
- Фактическое поведение: старый `send()` создавал ID/envelope только в RAM и сразу
  вызывал API; после exception/reload никакой recoverable queue entry не оставалось.
- Причина: отсутствовали outbox application port/use cases и persistent adapter.
- Исправление: `WP-044` добавил bounded encrypted IndexedDB outbox, explicit states,
  retry/backoff/manual retry, reconnect flush и authoritative receipt reconciliation.
- Проверка: Vitest моделирует network failure, persisted `sending`, restart и
  successful exact retry; оба POST имеют одинаковые ID/protocol/ciphertext, entry
  удаляется только после authoritative message попал в timeline/archive.

### BUG-035 — Список чатов повторно загружался с нуля при каждом входе

- Статус: `verified`.
- Найдено в: production Pixel PWA QA, `WP-043`.
- Severity: `medium`.
- Условия воспроизведения: перейти из settings/admin обратно на `/chat` при уже
  синхронизированном account.
- Ожидаемое поведение: encrypted local snapshot отображается немедленно, затем
  применяется cursor catch-up; full list APIs нужны только при reset/change.
- Фактическое поведение: новый `useMessenger` всегда начинал с `listSync(0)` и
  параллельно заново вызывал directory/conversations/read/delivery endpoints.
- Причина: локально был реализован только message archive, но не messenger snapshot.
- Исправление: `WP-043` добавил typed encrypted snapshot port/codec/IndexedDB adapter
  и cache-first bootstrap от persisted sync cursor.
- Проверка: Vitest подтверждает local render, `listSync(8)` и отсутствие повторных
  directory/conversations/history/read/delivery list calls; corrupt/tampered storage
  fail closed. Physical production navigation остаётся acceptance check.

### BUG-034 — Android launcher показывал квадратную icon artwork внутри маски

- Статус: `fixed`, physical verification pending.
- Найдено в: production Pixel PWA QA, `WP-043`.
- Severity: `medium`.
- Условия воспроизведения: установить PWA из Chrome на Pixel с круглой launcher mask.
- Ожидаемое поведение: отдельный opaque maskable asset заполняет системную форму,
  знак остаётся внутри minimum safe-zone без baked square/card silhouette.
- Фактическое поведение: launcher визуально воспринимался как квадратная картинка,
  неровно вложенная в круглую рамку.
- Причина: install artwork не имел отдельного канонического transparent/maskable
  generation contract и versioned manifest URL для новой установки.
- Исправление: `WP-043` добавил SVG mark без platform shape, transparent `any`,
  full-bleed opaque `maskable`, 40% safe-zone и versioned v2 URLs.
- Проверка: raster dimension/alpha/source tests проходят; старую Pixel PWA нужно
  удалить и установить заново, затем визуально проверить circle crop.

### BUG-033 — Gesture navigation area и pull-to-refresh ломали Android PWA shell

- Статус: `fixed`, physical verification pending.
- Найдено в: production Pixel PWA QA, `WP-043`.
- Severity: `high`.
- Условия воспроизведения: открыть установленную Chrome PWA на Pixel, использовать
  gesture navigation и потянуть root вниз у верхней границы internal scroll.
- Ожидаемое поведение: app surface непрерывно закрашен под gesture pill; системный
  pull-to-refresh не запускается, обновление контролируется PWA lifecycle.
- Фактическое поведение: область под gesture pill имела чужой фон, а browser refresh
  мог перезагрузить приложение и сбросить transient UI state.
- Причина: root не запрещал overscroll default action; bottom bar использовал только
  dynamic inset, а не Chrome 135 dynamic/maximum-inset edge-to-edge pattern.
- Исправление: `WP-043` задаёт root `overscroll-behavior: none`, отдельные internal
  scroll containers, opaque theme surface и max/dynamic safe-area geometry.
- Проверка: CSS/theme contract tests проходят; окончательная standalone проверка
  gesture pill и pull-down выполняется на физическом Pixel после deploy.

### BUG-030 — Существующая история длиннее 100 сообщений загружалась не полностью

- Статус: `verified`.
- Найдено в: storage/history audit, `WP-041`.
- Severity: `high`.
- Условия воспроизведения: открыть после login conversation, в котором до текущего
  client sync baseline уже существует более 100 сообщений.
- Ожидаемое поведение: UI сначала получает bounded latest page, а более старую
  историю догружает стабильными cursor pages без unbounded DOM/RAM.
- Фактическое поведение: gateway запрашивал только первые 100 rows с
  `after_sequence=0`; bootstrap не продолжал pagination, а уже существующие rows
  после сотой не обязательно были представлены новыми sync events.
- Причина: transport имел только forward catch-up cursor и не имел latest/before
  history page contract или encrypted local message archive.
- Исправление: `WP-042` добавил отдельный latest/before use case/repository/HTTP
  contract, encrypted IndexedDB archive, incremental load-older, 300-message UI
  window и явный return-to-latest flow.
- Проверка: application + HTTP regressions с 205 pre-existing envelopes получают
  `106..205`, `6..105`, `1..5`; frontend orchestration повторяет те же страницы без
  пропусков/дублей, IndexedDB tests проверяют encryption, tamper и bounded retention.

### BUG-032 — CI сравнивал platform-dependent WASM binary byte-for-byte

- Статус: `verified`.
- Найдено в: GitHub Actions `CI #8`, production rollout после `WP-041`.
- Severity: `high`.
- Условия воспроизведения: сгенерировать browser WASM package одинаковыми pinned
  Rust/wasm-bindgen версиями на macOS и Linux.
- Ожидаемое поведение: CI проверяет pinned toolchain, release compilation, required
  public API и отсутствие forbidden debug/private exports.
- Фактическое поведение: internal Rust closure hashes и итоговый WASM отличались
  между host platforms, поэтому `git diff --exit-code` отклонял совместимый package.
- Причина: byte identity ошибочно использовалась как cross-platform semantic gate.
- Исправление: Linux CI по-прежнему пересобирает package, но проверяет non-empty WASM,
  required sealed-state API и отсутствие private snapshot exports; pinned toolchain,
  lockfile, clippy/tests и sensitive-feature gate сохранены.
- Проверка: local crypto `make ci` и повторный GitHub Actions run.

### BUG-031 — HTTP security tests зависели от реальной даты expiry cookie

- Статус: `verified`.
- Найдено в: GitHub Actions `CI #8`, production rollout после `WP-041`.
- Severity: `high`.
- Условия воспроизведения: запустить suite после `2026-08-11T15:00:00Z`.
- Ожидаемое поведение: application time полностью задаётся injected test Clock, а
  реальный httpx cookie jar не считает только что выданную cookie истёкшей.
- Фактическое поведение: фиксированное `NOW=12:00Z` и absolute lifetime 3 часа
  превратили cookie в expired ровно в 15:00Z; 20 HTTP/WebSocket тестов получили 401.
- Причина: доменное тестовое время одновременно попало в реальный HTTP `Expires`.
- Исправление: module-scoped UTC clock берётся при старте suite и остаётся
  детерминированным для всех application assertions; PostgreSQL setup дополнительно
  flush-ит parent users до child devices.
- Проверка: 16 HTTP/realtime regressions и полный PostgreSQL suite — `199 passed`.

### BUG-029 — Длинный timeline мог растягивать document и сдвигать messenger chrome

- Статус: `verified`.
- Найдено в: user PWA QA, `WP-041`.
- Severity: `high`.
- Условия воспроизведения: открыть chat с длинным списком диалогов/сообщений на
  desktop или mobile и изменить высоту visual viewport программной клавиатурой.
- Ожидаемое поведение: document остаётся размером с viewport; независимо скроллятся
  list/timeline, header/composer/navigation сохраняют координаты.
- Фактическое поведение: shell и message grid задавали в основном `min-height`,
  поэтому intrinsic content мог увеличивать grid/document; composer и global tabs
  конкурировали за mobile viewport.
- Причина: у grid ancestors не было полного `height/min-height: 0/overflow` contract,
  а mobile conversation не отделялся от top-level navigation slot.
- Исправление: bounded `100dvh` product shell, `height: 100%` + `min-height: 0` на
  chat ancestors, internal overflow containers и URL-backed focused conversation,
  который скрывает global tabs. Timeline scroll coordinator не прыгает вниз при
  входящем сообщении во время чтения истории.
- Проверка: CSS/Vue tests и physical geometry: desktop `1440×900`, mobile
  `390×844`, keyboard-sized `390×500`; document равен viewport, composer имеет
  `bottom=viewport height`, scroll меняет только timeline.

### BUG-028 — Presence терялся при новом диалоге уже подключённых пользователей

- Статус: `verified`.
- Найдено в: multi-client production QA, `WP-039`.
- Severity: `medium`.
- Условия воспроизведения: Alice и Bob открывают WebSocket до существования общего
  conversation, затем один из них создаёт direct conversation.
- Ожидаемое поведение: оба клиента после durable conversation update видят актуальный
  online state; одно устройство пользователя не выключает остальные.
- Фактическое поведение: initial snapshot был пуст, а `conversation_updated` запускал
  только cursor catch-up. Новый conversation не получал presence до reconnect; UI
  дополнительно всегда рисовал зелёный connection dot независимо от socket state.
- Причина: presence snapshot отправлялся только один раз после `hello`; visual
  connection indicator не был связан с lifecycle `onOpen/onClose`.
- Исправление: transport отправляет новый authorized snapshot после
  `conversation_updated`, typed realtime service публикует
  connecting/connected/reconnecting/stopped, UI отображает эти состояния.
- Проверка: backend HTTP/WebSocket regressions покрывают creation-after-connect и две
  сессии одного пользователя; frontend tests проверяют lifecycle и честный label.

### BUG-026 — Mobile navigation следовала за высотой document

- Статус: `verified`.
- Найдено в: user mobile QA, `WP-039`.
- Severity: `medium`.
- Условия воспроизведения: сравнить короткую и длинную authenticated page при ширине
  до 840 px.
- Ожидаемое поведение: bottom navigation остаётся у нижней границы visual viewport и
  учитывает safe area.
- Фактическое поведение: `.mobile-tabs` имела `position: relative` и была второй grid
  row, поэтому bar следовала за document flow и меняла положение с длиной page.
- Причина: shell резервировал nav как content row вместо viewport UI.
- Исправление: fixed `inset-inline/bottom` bar с общей `--mobile-tabs-height` и
  зарезервированным content inset.
- Проверка: Vitest фиксирует CSS contract; physical viewport `390×844` показал
  одинаковые `top=782/bottom=844` для короткой страницы, длинной страницы и после
  scroll на 600 px.

### BUG-025 — Client VPN fake-IP обрывал TLS до origin

- Статус: `verified`.
- Найдено в: user Firefox screenshot и production diagnosis перед `WP-038`.
- Severity: `high`.
- Условия воспроизведения: client proxy/DNS возвращает для `chat.yoowee.ru`
  `198.18.0.111`, но не устанавливает tunnel к реальному origin.
- Ожидаемое поведение: client достигает public origin и завершает validated TLS.
- Фактическое поведение: Firefox показывает `PR_END_OF_FILE_ERROR`; TLS ClientHello
  не получает корректный ответ.
- Причина: `198.18.0.0/15` — synthetic benchmarking/fake-IP range, а VPS origin имеет
  другой public address; сбой происходит до host Nginx.
- Исправление: client VPN/proxy должен корректно tunnel domain либо исключить его из
  fake-IP DNS; certificate validation не отключается.
- Проверка: server loopback SNI согласовал TLS 1.3 с certificate `chat.yoowee.ru`,
  origin health ответил `200`, а server/public DNS отличался от client fake-IP.

### BUG-027 — Production container gateway нарушал общий host ingress

- Статус: `verified`.
- Найдено в: production после `WP-036`; диагностировано и устранено в `WP-038`.
- Severity: `critical`.
- Условия воспроизведения: на VPS одновременно работает общий системный Nginx для
  `yoowee.ru`/`s3.yoowee.ru`/`chat.yoowee.ru` и отдельный production
  `yv-chat-gateway-1`; после container lifecycle/reload часть доменов перестаёт
  отвечать, а остановка gateway восстанавливает соседние vhost.
- Ожидаемое поведение: один системный Nginx владеет public `80/443`, а yv-chat не
  влияет на ingress других проектов.
- Фактическое поведение: контейнер `ca1386492b46` мешал общему ingress; после его
  остановки `yoowee.ru` и `s3.yoowee.ru` восстановились, но chat получал `502`,
  потому что старый vhost всё ещё смотрел в gateway `127.0.0.1:18080`.
- Причина: лишний production proxy-hop имел собственный lifecycle/DNS state и делал
  availability чата и общего ingress зависимой от второго Nginx. Это также
  воспроизводило `BUG-024` при смене IP API.
- Исправление: production Compose больше не содержит gateway; host Nginx напрямую
  разделяет API/WebSocket `127.0.0.1:18081` и frontend `127.0.0.1:18082`. Оба bind
  доступны только с loopback, API доверяет проверенному bridge peer
  `172.30.243.1/32`, старый gateway точечно удалён.
- Проверка: direct/public API и frontend отвечают `200`, корректный unauthenticated
  WebSocket upgrade достигает application и получает `403`, 40 параллельных health
  requests проходят, public listeners принадлежат host Nginx, `18080` отсутствует;
  все восемь исходных `infra-*` container ID сохранились и остаются `Up`.

### BUG-024 — Gateway сохранял устаревший IP пересозданного API

- Статус: `verified`.
- Найдено в: production commit `1c8ffc058459baaab7fe714dd7524de4ce8e7d7c`,
  `WP-036` operational diagnosis.
- Severity: `critical`.
- Условия воспроизведения: deploy пересоздаёт `yv-chat-api-1`, но неизменившийся
  `yv-chat-gateway-1` продолжает работать без reload/recreate.
- Ожидаемое поведение: `/api/v1/*` всегда направляется в текущий healthy API container.
- Фактическое поведение: frontend `/` отвечал `200`, но login, `/me` и health получали
  `502`; API собственный healthcheck при этом оставался `healthy`.
- Причина: обычный `proxy_pass http://api:8000` разрешался Nginx один раз при старте и
  сохранял прежний Docker IP после Compose replacement API.
- Исправление: gateway использует Docker embedded DNS с runtime variable
  `proxy_pass` для API/frontend; live config применён через syntax-check и graceful
  reload без перезапуска соседних services.
- Проверка: isolated network принудительно сменила API container IP и сохранила
  non-502 response после DNS TTL; live public health отвечает `200`.

### BUG-023 — PWA update мог разделить версии crypto JS и WASM

- Статус: `verified`.
- Найдено в: `WP-034`, production PWA build inspection.
- Severity: `high`.
- Условия воспроизведения: обновить release, когда fixed-path generated JS уже новый,
  а service worker/browser cache продолжает отдавать старый WASM или не имеет его
  offline.
- Ожидаемое поведение: binding и binary обновляются одной согласованной PWA revision.
- Фактическое поведение: исходный Workbox glob precache содержал только три entry и
  исключал `.wasm`; unversioned crypto URL не выражал compatibility boundary.
- Причина: default PWA asset glob не включал WASM и provider package ещё не был частью
  production frontend.
- Исправление: package размещён под `/crypto/v1/`, `.wasm` включён в explicit Workbox
  glob, build gate проверяет WASM, Worker chunk и precache entry.
- Проверка: production Nuxt build содержит 40 precache entries, включая versioned JS,
  WASM и hashed Worker; physical Chromium smoke загрузил их same-origin.

### BUG-022 — Worker response parser сохранял неожиданные поля

- Статус: `verified`.
- Найдено в: `WP-034`, trust-boundary review.
- Severity: `high`.
- Условия воспроизведения: Worker ошибочно возвращает валидные public identity fields
  вместе с дополнительным `ciphertext`/vault field.
- Ожидаемое поведение: main thread принимает только exact public DTO schema.
- Фактическое поведение: первоначальный structural validator проверял обязательные
  поля, но возвращал исходный object с extras.
- Причина: validator был type predicate, а не reconstructing decoder.
- Исправление: request/response/error/result используют exact-key validation, identity
  decoder строит новый bounded DTO, malformed message закрывает все pending requests.
- Проверка: Vitest отклоняет response с лишним ciphertext и malformed raw error.

### BUG-021 — `window.crypto` делал sealing несовместимым с Worker

- Статус: `verified`.
- Найдено в: `WP-033`, generated binding review перед Worker integration.
- Severity: `high`.
- Условия воспроизведения: вызвать `sealState` из dedicated Worker, где `window`
  отсутствует.
- Ожидаемое поведение: WebCrypto доступен через Worker-safe global scope.
- Фактическое поведение: первоначальный adapter получал `web_sys::window().crypto()` и
  завершался `SealingFailed` вне Window context.
- Причина: browser runtime ошибочно отождествлялся с DOM Window.
- Исправление: Rust/WASM получает `globalThis.crypto` через `js_sys::global`, сохраняя
  exact `Crypto`/`CryptoKey` validation.
- Проверка: wasm clippy/release build, Node 24 real-WASM tests и Chromium Worker smoke.

### BUG-020 — Cleanup process пытался публиковать в изолированный realtime hub

- Статус: `verified`.
- Найдено в: `WP-028`, composition review отдельного cleanup process.
- Severity: `medium`.
- Условия воспроизведения: запустить TTL cleanup отдельным Compose service и создать
  automatic tombstone.
- Ожидаемое поведение: deletion гарантирован durable sync; realtime является только
  best-effort ускорением внутри API process.
- Фактическое поведение: первоначальный use case принимал process-local notifier и
  после commit публиковал в hub, в котором нет browser connections.
- Причина: ручной delete и automatic cleanup ошибочно получили одинаковый
  post-commit delivery path, хотя работают в разных OS processes без Redis.
- Исправление: cleanup пишет только atomic recipient sync events; reconnect и
  30-second HTTP fallback доставляют deletion корректно. Manual HTTP delete сохраняет
  post-commit realtime publish в API process.
- Проверка: Dishka composition, application tests и production topology review;
  frontend durable hint path остаётся cursor-based и идемпотентным.

### BUG-019 — Alembic revision не помещался в `alembic_version.version_num`

- Статус: `verified`.
- Найдено в: `WP-027`, offline SQL review migration `0013`.
- Severity: `high`.
- Условия воспроизведения: применить первоначальный revision ID
  `0013_conversation_delivery_states` к стандартной Alembic version table с
  `VARCHAR(32)`.
- Ожидаемое поведение: migration фиксирует новый head атомарно.
- Фактическое поведение: 33-символьный ID не помещался бы в version column и
  откатил production migration.
- Причина: descriptive revision ID не был проверен против физического ограничения
  Alembic version table.
- Исправление: ID сокращён до `0013_delivery_states`; добавлен static graph test на
  single head, unique IDs и максимум 32 символа.
- Проверка: pytest migration invariant и Alembic upgrade/downgrade SQL generation.

### BUG-018 — CORS preflight не разрешал существующие PUT endpoints

- Статус: `verified`.
- Найдено в: `WP-027`, HTTP transport audit при добавлении delivery acknowledgement.
- Severity: `medium`.
- Условия воспроизведения: обращаться к read/delivery PUT endpoint из разрешённого
  dev origin с CSRF header, вызывающим browser preflight.
- Ожидаемое поведение: explicit CORS policy разрешает тот же method, который
  зарегистрирован versioned API.
- Фактическое поведение: `allow_methods` содержал GET/POST/PATCH/DELETE, но не PUT.
- Причина: read-state route появился после первоначального bootstrap allowlist.
- Исправление: PUT добавлен в explicit method allowlist; same-origin production
  policy и CSRF/Origin authorization не ослаблены.
- Проверка: backend HTTP suite и FastAPI composition/type checks.

### BUG-017 — Reconnect мог оставить peer в ложном offline после race

- Статус: `verified`.
- Найдено в: `WP-026`, аудит concurrent `last unsubscribe ↔ new subscribe`.
- Severity: `medium`.
- Условия воспроизведения: последняя старая session удаляет subscription, новая
  session успевает создать `0 → 1` и отправить online до завершения offline publish.
- Ожидаемое поведение: итоговый UI state соответствует наличию новой live session.
- Фактическое поведение: без reconciliation запоздавший offline мог прийти после
  нового online и остаться последним transition.
- Причина: hub transition атомарен, но authorized audience lookup/publish намеренно
  выполняется вне hub lock и может пересекаться с новым connection lifecycle.
- Исправление: после offline publish transport повторно проверяет hub; если user уже
  снова online, публикуется corrective idempotent online transition.
- Проверка: hub multi-device tests подтверждают first/last semantics, frontend
  presence store идемпотентен, reconnect snapshot остаётся authoritative reset.

### BUG-016 — Realtime package re-export создавал bootstrap import cycle

- Статус: `verified`.
- Найдено в: `WP-025`, local production-image smoke.
- Severity: `high`.
- Условия воспроизведения: запустить новый backend image после re-export
  `PublishTyping` из `application.realtime.__init__`.
- Ожидаемое поведение: FastAPI bootstrap импортирует realtime ports/use cases и
  запускает healthy process.
- Фактическое поведение: container перезапускался с `ImportError` о partially
  initialized module.
- Причина: `ports.realtime → realtime.events` сначала инициализировал package
  `__init__`, тот импортировал `realtime.typing`, а typing снова импортировал
  `ports.realtime.RealtimeNotifier`.
- Исправление: package `__init__` экспортирует только event primitives без обратной
  port dependency; provider, transport и tests импортируют typing use case из
  конкретного cohesive модуля.
- Проверка: import contracts/unit suite и повторный production-image health smoke.

### BUG-015 — Ephemeral typing hint запускал бы ненужный durable sync

- Статус: `verified`.
- Найдено в: `WP-025`, расширение frontend realtime closed union.
- Severity: `medium`.
- Условия воспроизведения: передать новый `typing` frame в прежний общий callback,
  который запускал `/sync` для любого события кроме `ping`.
- Ожидаемое поведение: ephemeral typing обновляет только bounded transient state и
  не создаёт cursor-sync traffic.
- Фактическое поведение: исходный lifecycle различал только heartbeat и общий
  durable wake-up, поэтому новый event автоматически попадал бы в catch-up branch.
- Причина: до появления первого ephemeral event realtime union не требовал явной
  классификации delivery semantics.
- Исправление: parser выдаёт discriminated `TypingRealtimeFrame`, lifecycle
  направляет его отдельному `TypingIndicatorService`, а durable branch остаётся
  единственным источником `/sync` wake-up.
- Проверка: Vitest подтверждает typing callback без увеличения catch-up calls,
  expiry/stop dedup и socket-disconnect cleanup.

### BUG-014 — Собственные отправленные сообщения учитывались как unread

- Статус: `verified`.
- Найдено в: `WP-024`, проверка server-derived unread semantics.
- Severity: `medium`.
- Условия воспроизведения: отправить сообщение через API и запросить read summary до
  отдельного foreground mark-read от клиента.
- Ожидаемое поведение: sender уже видел timeline при отправке, поэтому его новое
  сообщение не увеличивает собственный unread counter.
- Фактическое поведение: первоначальный batch count считал все message rows после
  cursor, а send use case не продвигал cursor отправителя.
- Причина: send и read-state были реализованы как независимые application operations
  без server invariant «send implies read through allocated sequence».
- Исправление: `SendOpaqueMessage` в той же transaction монотонно обновляет shared
  sender cursor и добавляет durable `read_receipt` каждому active recipient; exact
  retry остаётся без новых events.
- Проверка: application и PostgreSQL integration tests подтверждают sender cursor,
  exact retry, concurrent sequence allocation и recipient event counts.

### BUG-013 — Скрытый haptics checkbox расширял mobile settings viewport

- Статус: `verified`.
- Найдено в: `WP-022`, in-app browser QA при viewport 390×844.
- Severity: `medium`.
- Условия воспроизведения: открыть `/settings` на ширине 390 px и сравнить
  `documentElement.scrollWidth` с `clientWidth`.
- Ожидаемое поведение: карточки и скрытые form controls не создают горизонтальный
  scroll.
- Фактическое поведение: общий `input { width: 100% }` применялся к абсолютно
  позиционированному прозрачному checkbox внутри switch и расширял страницу до
  395 px.
- Причина: visually hidden native control не имел собственного bounded размера.
- Исправление: input/textarea получили `min-width: 0`, а switch checkbox — явный
  доступный 1×1 px box без pointer events.
- Проверка: повторная production-build QA показала `scrollWidth === clientWidth
  === 390`, zero overflowing elements и пустой warning log.

### BUG-012 — Invite fragment попадал в Vue Router warning как CSS selector

- Статус: `verified`.
- Найдено в: `WP-020`, local browser smoke `/activate#token=<secret>`.
- Severity: `high`.
- Условия воспроизведения: открыть activation URL с one-time secret в fragment при стандартном Vue Router scroll behavior.
- Ожидаемое поведение: fragment не отправляется серверу, немедленно очищается из address bar и не появляется в console/logs.
- Фактическое поведение: до mount activation page router пытался использовать полный `#token=...` как CSS selector и включал его в development warning.
- Причина: default hash scroll logic не различал navigation anchors и credential-bearing fragments.
- Исправление: custom Nuxt `router.options.ts` перехватывает `#token=` и возвращает top position без selector lookup; page затем потребляет и очищает fragment.
- Проверка: новый browser tab очистил URL до `/activate`; его dev logs содержат только Vite/Vue informational entries и не содержат token/warning.

### BUG-011 — Appleboy SCP transport завершался до remote deploy без диагностируемой причины

- Статус: `verified`.
- Найдено в: `WP-019`, GitHub Actions run `31451487597` для `a06e056`.
- Severity: `high`.
- Условия воспроизведения: verify и оба GHCR build jobs зелёные, затем `appleboy/scp-action@v1` завершается exit code 1 до появления versioned artifacts на VPS.
- Ожидаемое поведение: SSH readiness проверяется до resource-heavy builds, artifacts копируются через pinned host identity, затем запускается remote deploy.
- Фактическое поведение: opaque action annotation не показывала публично ничего кроме exit code; remote script не запускался, server stack не менялся.
- Причина: transport boundary не имел отдельного проверяемого SSH preflight и полагался на opaque third-party SCP action; после его замены диагностика также выявила неверный `DEPLOY_KEY` fingerprint.
- Исправление: non-secret target зафиксирован как `devuser@chat.yoowee.ru:22`, host ED25519 key pinned; отдельный job проверяет `DEPLOY_KEY`/SSH до build, а deploy использует native `ssh/scp` и передаёт GHCR token только через stdin.
- Проверка: production workflow `31452613018` прошёл `deployment-config`, artifact copy, remote migration и health-checked rollout; четыре `yv-chat-*` containers healthy, public HTTPS API отвечает.

### BUG-010 — Deploy verify запускал PostgreSQL integration tests без schema

- Статус: `verified`.
- Найдено в: `WP-019`, GitHub Actions run `31451233832` для `c12d94d`.
- Severity: `high`.
- Условия воспроизведения: push в `main` поднимает свежий PostgreSQL service, задаёт `TEST_DATABASE_URL` и запускает `make ci` без предварительного Alembic upgrade.
- Ожидаемое поведение: deploy verify повторяет backend CI и выполняет все PostgreSQL integration tests против актуальной schema.
- Фактическое поведение: обычные backend/frontend/compose CI jobs были зелёными, а deploy `verify` падал на шаге `make ci`; build/deploy корректно оставались skipped.
- Причина: отдельный backend CI применял `uv run alembic upgrade head`, а агрегированный deploy verify пропустил этот шаг для своей независимой fresh database.
- Исправление: deploy workflow явно применяет Alembic migrations после frozen dependency install и до `make ci`.
- Проверка: local workflow/YAML checks и повторный production workflow должны показать зелёные verify/integration tests перед build/deploy.

### BUG-009 — Gateway loopback port не активировался на internal-only network

- Статус: `verified`.
- Найдено в: `WP-018`, production-like Docker smoke.
- Severity: `critical`.
- Условия воспроизведения: gateway подключён только к Compose network с `internal: true`, хотя `HostConfig.PortBindings` содержит `127.0.0.1:18082`.
- Ожидаемое поведение: host loopback принимает HTTP и только gateway имеет published port.
- Фактическое поведение: container был healthy, но Docker не создавал активный `NetworkSettings.Ports` binding; host curl получал connection refused.
- Причина: internal-only network не предоставляла gateway edge path для published port в проверяемом Docker runtime.
- Исправление: gateway подключён к отдельной non-internal edge network и одновременно к internal private network; остальные services остаются только private.
- Проверка: production Compose `ps` показывает `127.0.0.1:18082->80/tcp`, оба health endpoints отвечают, API/frontend/PostgreSQL ports не опубликованы.

### BUG-008 — Frontend называл любой неожиданный HTTP error потерей сети

- Статус: `verified`.
- Найдено в: `WP-016`, browser smoke с rejected Origin.
- Severity: `medium`.
- Условия воспроизведения: auth endpoint возвращает 403 или malformed response вместо network exception.
- Ожидаемое поведение: offline UX показывается только при `ApiError.kind=network`; HTTP rejection получает нейтральную retry/error формулировку.
- Фактическое поведение: все ошибки кроме 401 переводили auth state в `offline` и вводили пользователя в заблуждение.
- Причина: первоначальный auth error mapper различал только unauthorized и общий fallback.
- Исправление: network, 401 и прочие HTTP/invalid-response outcomes отображаются раздельно без раскрытия server detail.
- Проверка: Vitest воспроизводит 403 и подтверждает отсутствие сообщения «Сервер недоступен».

### BUG-007 — Frontend bootstrap мог пропустить sync event между snapshot и cursor

- Статус: `verified`.
- Найдено в: `WP-016`, test initial snapshot/cursor ordering.
- Severity: `high`.
- Условия воспроизведения: resource list завершается, затем другой device создаёт сообщение, после чего frontend запрашивает stream cursor и принимает его без применения события.
- Ожидаемое поведение: любое событие либо уже входит в snapshot, либо приходит последующим cursor catch-up.
- Фактическое поведение: первоначальный порядок `snapshot → current cursor` создавал окно для безвозвратно пропущенного события.
- Причина: cursor использовался как отметка после загрузки ресурсов, а не как baseline до snapshot.
- Исправление: startup сначала фиксирует stream cursor, затем получает resource snapshot и poll выполняет catch-up строго после baseline; reset также фиксирует cursor до полного reload.
- Проверка: Vitest проверяет порядок вызовов и получение `message_created` с cursor после baseline.

### BUG-006 — Sync events одного пользователя могли менять причинный порядок

- Статус: `verified`.
- Найдено в: `WP-014`, retention-gap application test.
- Severity: `high`.
- Условия воспроизведения: передать несколько pending events одного user одним append.
- Ожидаемое поведение: cursors сохраняют порядок application operation.
- Фактическое поведение: первоначальная реализация сортировала события по случайному UUID `event_id`.
- Причина: deadlock-safe сортировка recipients ошибочно включала event ID.
- Исправление: user IDs сортируются для стабильного lock order, input order внутри каждого user stream сохраняется.
- Проверка: pagination/retention tests подтверждают cursors `1,2,3` в причинном порядке.

### BUG-005 — Alembic повторно применял naming convention к имени check constraint

- Статус: `verified`.
- Найдено в: `WP-010`, PostgreSQL upgrade `0006 -> 0007`.
- Severity: `medium`.
- Условия воспроизведения: вызвать `op.drop_constraint` с уже форматированным именем `ck_security_events_event_type_allowed` при активной naming convention.
- Ожидаемое поведение: migration заменяет допустимый набор typed security events.
- Фактическое поведение: Alembic строил несуществующее имя с двойным `ck_security_events_` и транзакционно откатывал migration.
- Причина: существующее физическое имя не было помечено как уже отформатированное convention.
- Исправление: drop/create используют `op.f(...)`, исключая повторное преобразование имени.
- Проверка: `0006↔0007` и чистый `base→head` проходят на PostgreSQL.

### BUG-004 — Healthcheck endpoint обходил versioned API prefix

- Статус: `verified`.
- Найдено в: `WP-005`, проверка HTTP transport contract.
- Severity: `low`.
- Условия воспроизведения: запросить healthcheck и сравнить path с обязательным `/api/v1` prefix.
- Ожидаемое поведение: публичный endpoint доступен как `/api/v1/health`.
- Фактическое поведение: bootstrap endpoint оставался на `/api/health`.
- Причина: healthcheck был создан до фиксации versioned API contract.
- Исправление: router, Compose healthcheck, README и tests переведены на `/api/v1/health`.
- Проверка: HTTP test и OpenAPI image smoke test подтверждают `/api/v1/health`.

### BUG-003 — `uv run` не запускался под непривилегированным пользователем container

- Статус: `verified`.
- Найдено в: `WP-003`, финальный backend image smoke test.
- Severity: `high`.
- Условия воспроизведения: запустить `uv run alembic heads` внутри backend image под настроенным `USER 65532:65532`.
- Ожидаемое поведение: operational `uv run` commands выполняются без root privileges.
- Фактическое поведение: `uv` пытался создать `/.cache/uv` и завершался с `Permission denied`.
- Причина: у numeric runtime user нет домашнего каталога, default cache path оказался недоступен, а обычный `uv run` дополнительно пытался синхронизировать dev dependencies в root-owned `.venv`.
- Исправление: после frozen build-time sync runtime image переключает cache на отдельный `/tmp/uv-runtime-cache` и задаёт `UV_NO_SYNC=1`, используя готовое read-only окружение.
- Проверка: финальный image под `65532:65532` успешно выполняет `uv run alembic heads`.

### BUG-002 — Backend image не содержал Alembic migration environment

- Статус: `verified`.
- Найдено в: `WP-003`, Docker migration smoke test.
- Severity: `high`.
- Условия воспроизведения: собрать backend image и выполнить внутри него `uv run alembic heads` или production migration.
- Ожидаемое поведение: image содержит `alembic.ini` и все migration scripts, поэтому может проверить и применить schema revision.
- Фактическое поведение: runtime image содержал application package, но не Alembic config/migrations.
- Причина: `backend/Dockerfile` копировал только `pyproject.toml`, lockfile и `src/`.
- Исправление: в image явно копируются `alembic.ini` и каталог `migrations/`.
- Проверка: clean backend image успешно выполнил `uv run alembic heads` и показал `0002_account_activation (head)`.

### BUG-001 — Frontend image не собирался из чистого Docker context

- Статус: `verified`.
- Найдено в: `WP-002`, проверка bootstrap Dockerfile.
- Severity: `medium`.
- Условия воспроизведения: выполнить clean `docker build` для `frontend/`.
- Ожидаемое поведение: Nuxt PWA production image успешно собирается.
- Фактическое поведение: generated `.nuxt` types не знали о PWA module, затем typecheck завершался ошибкой.
- Причина: `npm ci` запускал `nuxt prepare` до копирования `nuxt.config.ts` в build stage.
- Исправление: dependency install выполняется с `--ignore-scripts`, затем после `COPY . .` явно запускаются `npm run postinstall` и `npm run build`.
- Проверка: clean `docker build -t yv-chat-frontend:wp002-check frontend` завершён успешно, PWA service worker сгенерирован.
