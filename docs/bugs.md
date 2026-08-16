# Bugs

Здесь фиксируются воспроизводимые дефекты, найденные во время разработки или проверки. Новые фичи и архитектурные идеи относятся в `backlog.md`, а не сюда.

## Active

### BUG-084 — Видеокружок исключался из mobile message gestures

- Статус: `fixed and locally verified in WP-094; real-camera browser acceptance pending`.
- Severity: `high mobile interaction inconsistency`.
- Reproduction: долго нажать или свайпнуть вправо по самому standalone кружку;
  `button/video` interactive guard не запускает message long-press/swipe state.
- Desktop: right-click всплывает до article, но этот child-target path и reply action
  не были закреплены regression test.
- Ожидаемая семантика: long-press/swipe работают на кружке как на сообщении,
  right-click открывает те же действия, short tap по-прежнему управляет playback.
- Инвариант: после long-press/swipe synthetic click не должен раскрывать кружок,
  включать звук или поглощать следующий обычный tap.
- Исправление: standalone `.message-video-note` участвует в общем touch gesture state;
  pointer capture удерживает release, bounded suppression гасит только compatibility
  click после действия, а новый pointerdown немедленно снимает stale guard.
- Проверка: component regression покрывает short tap, long-press, swipe-right,
  следующий tap, mouse drag и child-target right-click → reply; full CI и Docker
  зелёные. In-app browser не получил camera permission и не смог создать fixture.

### BUG-083 — Native selection перехватывал long-press сообщения на Pixel/iPhone

- Статус: `fixed and locally verified in WP-093; physical Pixel/iPhone acceptance pending`.
- Severity: `high mobile interaction conflict`.
- Reproduction: долго нажать на текст сообщения в Chrome/Pixel или Safari/iPhone;
  одновременно с application context menu появляются selection handles и native
  search/copy surface, как на приложенном physical-device screenshot.
- Ожидаемая семантика: coarse-pointer bubble владеет long-press целиком; копирование
  доступно явным пунктом context menu, short link tap и timeline scroll сохраняются.
- Инварианты: desktop text selection не блокируется, UI использует `ClipboardPort`,
  plaintext не логируется и не сохраняется дополнительно.
- Исправление: coarse-pointer CSS передаёт long-press приложению, links больше не
  исключаются из gesture ownership, а context menu предлагает явное копирование.
- Проверка: component/CSS regressions, full CI, Docker health и real-browser PWA
  smoke подтверждают menu → copy → success; финальный physical-device acceptance
  остаётся за пользователем на Pixel/iPhone.

### BUG-082 — Popover действий закрывался только повторным нажатием на trigger

- Статус: `verified locally in WP-092`.
- Severity: `medium interaction UX`.
- Reproduction: открыть attachment/reaction picker и нажать на timeline или composer;
  окно остаётся открытым, пока пользователь не нажмёт исходную кнопку повторно.
- Ожидаемая семантика: click/tap вне transient surface и Escape закрывают её без
  изменения draft, attachments или сообщения; context menu использует тот же contract.
- Исправление: attachment picker использует document-level outside-pointer dismissal,
  context menu — bounded backdrop; Escape централизованно закрывает transient surfaces.
- Проверка: component regression и real-browser smoke подтверждают open → outside click
  → hidden без повторного нажатия trigger.

### BUG-081 — Минутный видеокружок исчезал до неявной отправки

- Статус: `fixed locally in WP-091; physical camera permission acceptance pending`.
- Severity: `high messaging UX and send-intent clarity`.
- Reproduction: удерживать запись видеокружка до 60 секунд; timer вызывает общий
  finish/send path, overlay сразу закрывается, а сообщение появляется только после
  client processing/upload, поэтому пользователь не понимает, отправлена ли запись.
- Ожидаемая семантика: лимит только останавливает capture; готовый локальный кружок
  остаётся в review с явными «Отправить»/«Удалить», а контур preview заранее показывает
  прогресс до минуты.
- Инварианты: camera/microphone освобождаются на лимите, Blob не уходит в upload до
  явного send, delete/unmount освобождают object URL, direct E2EE flow не меняется.

### BUG-080 — Неподготавливаемый direct блокировал history sync всех чатов

- Статус: `fixed and production deployed` (`WP-086`, workflow `31761641522`,
  image `sha-5db642f`).
- Severity: `critical multi-device history availability`.
- Production reproduction: у `admin` пять direct generations `ready`, а два чата с
  `test`/`test3` — `blocked / missing_identity`; QR history sync остаётся на `5 из 7`
  и не объединяет доступную историю остальных разговоров.
- Требуемая семантика: proof-backed blocked chat даёт явный partial skip; неизвестная
  или временная ошибка не скрывается. Обе стороны согласуют skipped IDs внутри
  encrypted MLS completion manifest и завершают доступные чаты.
- Исправление: version 3 completion marker переносит encrypted skip manifest через
  готовый MLS direct; `missing_identity`/terminal `protocol_failure` исключаются из
  transfer, а pending/network/неизвестные состояния продолжают retry/error.
- Проверка: двусторонний application test завершает ready+skipped transfer с ACK,
  enrollment и UI regressions проверяют skip/pending; полный frontend suite/build
  зелёные. Реальный existing-device QR flow между двумя изолированными browser
  origins завершился на обеих сторонах как `1 из 2`, один `missing_identity` direct
  был пропущен, ready-сообщение появилось на втором устройстве, а PostgreSQL получил
  четыре history chunks и четыре ACK без browser errors или backend 5xx.

### BUG-079 — Peer cancel не прерывал уже запущенную MLS-подготовку

- Статус: `fixed and production deployed` (`WP-085`, workflow `31761641522`,
  image `sha-5db642f`).
- Severity: `high multi-device cancellation correctness and resource usage`.
- Production reproduction: trusted Mac показывает `Подготавливаем защищённые чаты:
  5 из 7`; Android нажимает `Остановить на обоих устройствах`; backend дважды
  отвечает `204` и сохраняет `history_sync_cancelled_at`, relay прекращается, но Mac
  продолжает local `EnrollLinkedDevice`.
- Причина: cancel был observable только через history relay endpoints. Пока outer
  history operation ожидала target preparer, local cancelled set и server `410`
  не проверялись между conversation reconcile/retry operations.
- Исправление: async activity guard проверяет local state и authorized relay перед
  per-conversation MLS work; peer `410` переводит durable job в `cancelled/stopped`.
- Отдельный production blocker `5 из 7`: direct-чаты с `test` и `test3` находятся в
  `blocked / missing_identity`, потому что у peer нет активного MLS-capable device.
  Он не отменяет и не оправдывает продолжение работы после cancel.

### BUG-078 — Несколько QR jobs одной пары вызывали server deadlock без возможности отмены

- Статус: `fixed and production deployed` (`WP-084`, `fee284e`). Physical acceptance
  обнаружила отдельный остаточный defect `BUG-079`.
- Severity: `critical multi-device synchronization availability`.
- Production reproduction: после нескольких QR attempts новая PWA восстанавливает
  три-четыре durable jobs одного телефона/компьютера, одновременно запускает для
  каждой MLS preparation/history relay и показывает одинаковые retry cards.
- Фактическая server ошибка: PostgreSQL `DeadlockDetectedError` на `devices FOR
  UPDATE` во время concurrent history/crypto requests; API отвечает 500, но client
  сворачивает причину в бесконечное «повторяем автоматически».
- Причина: job identity равнялась `pairingId`, поэтому store/runtime не знали, что
  разные QR относятся к одной unordered device pair; resume запускал все jobs
  параллельно, server не имел unique active-pair invariant, а UI не имел cancel.
- Требуемое исправление: server-arbitrated single active pairing per device pair,
  peer-visible cancel, legacy job dedupe, sequential local execution и terminal
  error state вместо бесконечного retry.
- Проверено: concurrent PostgreSQL approvals, включая QR с противоположными ролями
  trusted/candidate, оставляют один active relay без deadlock; migration сворачивает
  четыре legacy duplicates в один active; frontend восстанавливает одну newest card,
  исполняет jobs последовательно и сохраняет cancel intent до server ACK.

### BUG-077 — QR sync зависал после authorization и ложно объявлял перенос фоновым

- Статус: `fixed locally; production rollout pending` (`WP-083`).
- Severity: `critical multi-device history availability and UX`.
- Production reproduction: залогиненный телефон сканирует QR залогиненного компьютера,
  компьютер подтверждает; обе Settings cards навсегда остаются на
  «Подтверждено, завершаем вход…»/«перенос продолжится в фоне», а расшифрованные на
  компьютере direct messages на телефоне остаются недоступными.
- Причина 1: existing-device branch сразу запускал history relay и, в отличие от
  new-device branch, пропускал exact target MLS enrollment; target мог не уметь
  decrypt импортируемые MLS PrivateMessages.
- Причина 2: клиент считал три пустых poll завершением, не имея peer completion marker
  или ACK, поэтому первая сторона могла вернуть `complete` до запуска второй.
- Причина 3: прогресс жил только в локальном state Settings component; authorized
  `view` не очищался, navigation скрывала статус, а импорт archive не обновлял уже
  открытый timeline.
- Исправление: `WP-083` вводит durable trusted enrollment + двусторонние encrypted
  completion markers/ACK, observable background stages и refresh импортированного
  active conversation.

### BUG-076 — Авторизованный scanner не мог синхронизировать историю с компьютером

- Статус: `pairing deployed; incomplete completion semantics superseded by BUG-077`
  (`WP-082`, `WP-083`).
- Severity: `critical multi-device history availability`.
- Reproduction: телефон и компьютер уже авторизованы в одном account, но имеют
  mutually missing расшифрованные записи; компьютер показывает Settings
  `enrollment_offer`, телефон сканирует его внутри Settings PWA. Frontend отклоняет
  scan сообщением, что candidate обязан использовать login page, поэтому pairing не
  связывает существующие devices и history union не запускается.
- Причина: `WP-079` моделировал offer только как enrollment нового anonymous device;
  server state не имел exact existing-candidate session/device binding, а frontend
  жёстко разделял authenticated и anonymous scanners.
- Исправление: `WP-082` делает offer mode server-authenticated: anonymous scanner
  сохраняет прежний enrollment, authenticated same-account scanner привязывает
  existing device и после approval обе стороны запускают один resumable history job.

### BUG-075 — Server refresh снова делал уже прочитанное MLS-сообщение недоступным

- Статус: `fixed locally; production rollout pending` (`WP-081`).
- Severity: `critical multi-device history availability`.
- Reproduction: device успешно расшифровывает retained MLS message, затем обычный
  history refresh возвращает тот же opaque server envelope; после epoch advance или
  reload sender key уже удалён, timeline заменяет локально доступный экземпляр на
  «защищённое сообщение недоступно».
- Причина: encrypted local archive сохранял только server ciphertext envelope и не
  фиксировал canonical content после успешного decrypt; для собственного MLS sender
  повторный decrypt по правилам OpenMLS вообще невозможен.
- Исправление: successful decrypt и encrypted outbox делают local AES-GCM
  write-through; identical server refresh сохраняет local content, tombstone его
  удаляет, contradictory envelope fail-closed. Это же является source для bounded
  QR history union.
- Проверка: archive regression покрывает encrypted-at-rest round-trip, refresh,
  contradiction и tombstone; bidirectional transfer regression объединяет независимо
  сохранённые own-sent records двух devices.

### BUG-074 — Installed PWA сама перезагружала active UI после deployment

- Статус: `fixed and production deployed` (`WP-078`, `053bfd7`).
- Severity: `high PWA runtime continuity`.
- Production reproduction: оставить installed macOS PWA открытой во время
  deployment или вернуть её на foreground после deployment; UI внезапно делает
  full reload/remount, что видно как рывок всей картинки.
- Причина: `registerType: 'autoUpdate'` включал Workbox `skipWaiting`/
  `clientsClaim`; Vite PWA handler на updated Service Worker activation вызывал
  `window.location.reload()`. Project coordinator сам вызывал `registration.update()`
  каждую минуту и при foreground resume, поэтому activation быстро обнаруживалась.
- Исправление: prompt-mode install/download и explicit user-controlled activation/reload.

### BUG-073 — Logout одного device делал историю другого device нечитаемой

- Статус: `fixed and production deployed` (`WP-077`, `2caa048`, workflow
  `31721953404`).
- Severity: `critical direct-message history availability`.
- Production reproduction: direct conversation имеет не прочитанные/не закэшированные
  MLS messages на Mac; logout/relogin phone того же account меняет device roster;
  Mac применяет Commit, после чего этот один conversation показывает всю не
  закэшированную историю как недоступную; у peer его independent state/cache читается.
- Причина: OpenMLS group/join создавались с default `max_past_epochs = 0`, а startup
  и durable roster-change path применяли Commit **до** загрузки/локального
  encrypted caching retained messages. Decrypt дополнительно запускал hidden
  reconciliation, поэтом само открытие истории могло уничтожить нужный epoch secret.
- Почему не все chats: MLS state и encrypted content cache раздельны для каждого
  conversation/device; уже открытые cached messages оставались читаемыми.
- Исправление: explicit retained-history drain до epoch advance, decrypt без hidden
  reconciliation и bounded OpenMLS past-epoch window для новых groups.

### BUG-072 — Первый mobile tap по диалогу выглядел как hover без открытия

- Статус: `fixed locally; physical mobile acceptance pending` (`WP-073`).
- Severity: `high mobile conversation navigation usability`.
- Production reproduction: на iOS/Android тапнуть строку диалога; строка получает
  визуальное состояние, но chat pane появляется только после завершения async history
  и crypto refresh, из-за чего пользователь успевает нажать второй раз.
- Причина: mobile pane определялась только route query, который обновлялся после
  `await messenger.selectConversation(...)`; общий `:hover` дополнительно оставлял
  sticky mouse-style feedback на touch browser.
- Исправление: первый tap сразу переводит mobile workspace в optimistic conversation
  pane, блокирует повторный selection до завершения и затем синхронизирует route;
  row hover ограничен `(hover: hover) and (pointer: fine)`, а touch использует
  `touch-action: manipulation` и существующий `:active` press feedback.
- Проверка: frontend regression фиксирует optimistic pane state, cleanup и mouse-only
  hover; physical iOS/Android acceptance остаётся после rollout.

### BUG-071 — Safe area и PWA canvas применялись локально

- Статус: `fixed locally; physical iOS acceptance pending` (`WP-073`).
- Severity: `high installed-PWA navigation usability`.
- Production reproduction: settings content при скролле и форма нового диалога
  заходят под iPhone status bar/notch; после поиска с открытой клавиатурой bottom tabs
  поднимаются над ней; обычный iOS rubber-band на settings открывает белый фон вместо
  фонового цвета текущей светлой темы.
- Причина: top inset принадлежал отдельным chat/list headers вместо общего mobile
  shell; tabs не знали о text-entry state; светлый `theme-color` был жёстко задан как
  белый, а внутренний scroll canvas не фиксировал общий theme background.
- Исправление: mobile shell единолично резервирует top safe area и тем самым задаёт
  границу всех внутренних scrollers/routes; локальные header insets удалены. Text
  entry скрывает bottom tabs; HTML/Nuxt/app/scroll/page layers и PWA `theme-color`
  используют тот же theme canvas (`#f4f2fb` light / `#0a0b10` dark).
- Проверка: CSS regression фиксирует global top inset без list/header duplication и
  keyboard tabs state; theme regression фиксирует одинаковые canvas/system colors.

### BUG-070 — Pixel long-press конфликтовал с записью и кружок наследовал рамку сообщения

- Статус: `fixed locally; physical Android acceptance pending` (`WP-073`).
- Severity: `medium video-note gesture/presentation UX`.
- Production reproduction: удержание camera control на Pixel даёт системный haptic
  long-press и может завершить capture gesture; отправленный круг отображается внутри
  общей прямоугольной message card.
- Причина: pointer/context suppression не закрывала отдельные native touch selection,
  selectstart/drag и touch-callout paths; timeline применял generic bubble chrome ко
  всем сообщениям независимо от presentation metadata.
- Исправление: capture control подавляет только собственные native long-press paths,
  не запрещая выделение текста сообщений; одиночный `video_note` без подписи получает
  frameless bubble variant, а обычные video и сообщения с текстом не меняются.
- Проверка: component tests фиксируют cancelled native gesture events и selection
  class; CSS regression требует touch-callout suppression и прозрачный frameless shell.

### BUG-069 — iOS PWA перекрывала toolbar и переносила composer под вырез

- Статус: `fixed locally; iPhone acceptance pending` (`WP-073`).
- Severity: `high mobile chat usability`.
- Production reproduction: на iPhone 13/iOS 18 в установленной PWA кнопка нового
  чата пересекается со status bar; после фокуса composer и открытия клавиатуры
  видимая часть chat shell смещается, а composer оказывается у верхнего выреза.
- Причина: list toolbar не резервировал `safe-area-inset-top`; viewport plugin
  отслеживал только высоту `VisualViewport`, но не его `offsetTop` и `scroll` event.
- Исправление: mobile shell фиксируется внутри текущего visual viewport по height и
  top offset, bottom tabs привязаны к shell. Первичный локальный inset list toolbar
  затем обобщён в `BUG-071`: верхний safe area теперь принадлежит общему shell.
- Проверка: frontend regression фиксирует safe-area toolbar rules, visual viewport
  offset variable и resize/scroll listeners; повторная проверка на iPhone обязательна.

### BUG-068 — PWA не объясняла отсутствие повторного camera/microphone prompt

- Статус: `fixed locally; installed-PWA acceptance pending` (`WP-073`).
- Severity: `medium video-note availability/UX`.
- Production reproduction: на устройстве, где camera/microphone ещё не запрашивались,
  удержать кнопку кружка; native prompt не появляется, browser сразу возвращает
  permission error. После persisted denial повторный hold имеет тот же симптом.
- Причина: production Nginx отправлял `Permissions-Policy: camera=(), microphone=()`,
  то есть запрещал обе возможности до user permission layer. Для отдельного recovery
  path client также распознавал denial только через realm-sensitive
  `instanceof DOMException` и показывал слишком общий совет.
- Исправление: production policy разрешает camera/microphone только top-level
  same-origin PWA через `(self)`, не делегируя их cross-origin content; deploy-check
  запрещает возврат empty allowlist. Denial классифицируется по стандартному error
  name, а сообщение объясняет persisted denial и повторный hold после настроек.
- Проверка: recorder regression покрывает cross-realm-style `PermissionDeniedError`,
  component regression подтверждает понятный текст, закрытие overlay и повторный
  hold; deployment regression проверяет exact same-origin policy.

### BUG-067 — MLS roster обновлялся только при открытии того же личного чата

- Статус: `fixed locally; QR enrollment extension verified; production rollout pending`
  (`WP-069`, `WP-080`).
- Severity: `critical multi-device E2EE availability`.
- Production reproduction: новый Mac PWA создаёт `blocked/device_roster_changed`, а
  старые валидные leaves остаются online. Пока на одном из них вручную не открыт этот
  же direct, Commit не создаётся; вход offline-собеседника случайно лечит чат, потому
  что его старый leaf становится coordinator.
- Причина: durable `conversation_updated` инвалидировал crypto cache любого
  conversation, но messenger запускал reconcile только для активного. Дополнительно
  message protocol сам инвалидировал READY cache перед каждым envelope и создавал
  bootstrap/KeyPackage request storm при загрузке истории. Оставшийся QR/new-device
  gap: первая crypto identity registration создавала новый capable leaf, но сама не
  публиковала durable roster event; Settings вне chat workspace не запускал enrollment.
- Исправление: startup и sync reset последовательно reconciles все direct chats, а
  обычный durable event — каждый изменившийся direct независимо от active selection.
  READY cache живёт до sync invalidation; server exact-generation gate остаётся
  authoritative и не допускает stale send. `WP-080` атомарно публикует события при
  первой identity registration и запускает target-verified background enrollment из
  QR settings с retention drain до каждого Commit.
- Проверка: два frontend regression теста покрывают cold inactive direct и inactive
  roster event; production metadata доказала, что `Julproh` Welcome создал собственный
  Android leaf и новый Mac отправил v2 сообщение без участия peer.

### BUG-066 — Reload длинного диалога показывал неверное окно и прокручивал к anchor

- Статус: `fixed locally; automated and real-browser verified` (`WP-068`).
- Severity: `high core chat UX/performance`.
- Reproduction: остановиться в середине длинного conversation и перезагрузить PWA либо
  открыть push/deep-link; timeline сначала показывает latest/начало и затем заметно
  прокручивается, а hidden mobile pane иногда окончательно сбрасывает позицию в конец.
- Причина: cold hydrate предпочитал cached latest anchored window; archive умел читать
  только записи перед sequence; CSS включал smooth programmatic scroll; нулевая высота
  скрытой pane интерпретировалась как `atLatest`; route target мог опередить DOM.
- Исправление: bounded window читается до и после anchor, timeline показывается после
  exact restore без smooth animation, zero-height viewport не сохраняется, deep-link
  остаётся pending до target с достаточным контекстом.
- Проверка: 51 focused tests; production Docker build; real browser с 1000 fake rows —
  target `#500` сразу внутри `451..550`, reload сохраняет visible `#512..#517` с
  offset delta 6 px, 100 DOM rows и нулём browser errors. Release OpenMLS/WASM test
  дополнительно расшифровывает 100 v2 envelopes и после reload читает anchored
  `40..90` из encrypted content cache без повторного движения receiver ratchet.

### BUG-065 — iOS PWA наследовала Safari session без локальных MLS-ключей

- Статус: `fixed locally; production iOS acceptance pending` (`WP-067`).
- Severity: `critical multi-device E2EE availability`.
- Production reproduction: Safari на iPhone расшифровывает direct chat, а
  установленная Home Screen PWA остаётся authenticated под тем же server device и
  показывает `not-provisioned`; обычный deploy/reload делает проблему заметной после
  перезапуска Worker.
- Причина: iOS 17.2+ копирует auth cookies в новый Web App container, но не копирует
  IndexedDB. Server identity принадлежит `device_id` из cookie, тогда как отдельная
  PWA не имеет соответствующего `yv-chat-crypto-v1` vault. Приложение верно запрещало
  silent identity replacement, но предлагало только разрушительный logout/login.
- Исправление: password-confirmed in-app re-enrollment вызывает существующий login
  boundary, получает новую device/session cookie только в текущем PWA container и
  запускает обычный MLS provision, не отзывая здоровую Safari session. Password
  очищается до ожидания network; persistent storage запрашивается best-effort.
- Проверка: component regression фиксирует password lifetime; browser adapter
  покрывает persistent/denied/unsupported; существующий backend HTTP flow доказывает,
  что повторный login создаёт второй current device, оставляя первый active.

### BUG-064 — Возврат в открытый чат очищал timeline и терял viewport

- Статус: `fixed locally; automated and real-browser verified` (`WP-066`).
- Severity: `high core chat UX/performance`.
- Reproduction: открыть длинный chat A, остановиться в середине истории, открыть B и
  сразу вернуться в A; сообщения исчезают до повторного IndexedDB/network load, а
  scroll возвращается поздно или к неверному месту.
- Причина: conversation switch всегда сбрасывал reactive window; anchor lookup был
  network-first; 220-ms debounce вычислял anchor уже после смены active conversation.
- Исправление: bounded 12-window RAM cache рисуется синхронно, encrypted IndexedDB
  остаётся cold source, network только reconciles; anchor захватывается при scroll и
  flush-ится до switch, stale async result игнорируется.
- Проверка: unit regressions с искусственно задержанным server; isolated Docker + два
  browser origins, 45 сообщений появились за 47 ms, sequence 16/тот же message ID
  восстановлен за 625 ms с offset delta 14 px; после reconciliation drift и console
  warnings/errors отсутствуют.

### BUG-063 — Параллельная history decrypt повреждала device-local MLS ratchet

- Статус: `fixed locally; production rollout pending`.
- Severity: `critical multi-device E2EE availability`.
- Production reproduction: один READY direct conversation и одна MLS epoch; шесть
  корректных ciphertext полностью читаются на одном device, на втором доступно
  только первое сообщение, остальные помечены corrupt, на третьем весь E2EE runtime
  становится unavailable и send блокируется.
- Причина: history page вызывала `Promise.all` для state-changing OpenMLS decrypt;
  несколько операций одновременно меняли один receiver ratchet и пытались сохранить
  одинаковую следующую IndexedDB revision. Победивший checkpoint мог содержать уже
  продвинутый in-memory ratchet без атомарно сохранённого plaintext остальных записей.
- Исправление: history decrypt выполняется строго в server order, а общий crypto
  runtime сериализует все ratchet mutations и продолжает очередь после bounded error.
- Проверка: release OpenMLS/WASM regression из шести сообщений стабильно падал до
  исправления; теперь вся пачка читается, переживает runtime reload из sealed vault,
  повторно читается из encrypted content cache и receiver успешно отправляет reply.

### BUG-062 — Legacy device без MLS identity ложно блокировал READY direct send

- Статус: `fixed and deployed` (`WP-063`, production run `31591911253`).
- Severity: `critical direct-message availability`.
- Production reproduction: direct generation `READY` содержит все четыре active
  crypto-capable leaves, но у одного участника остаётся второй active Safari device,
  который никогда не регистрировал crypto identity/KeyPackage. Bootstrap считает
  roster актуальным, а каждый message POST возвращает `409`.
- Причина: bootstrap строил required snapshot только из MLS-capable devices и требовал
  минимум один capable leaf на участника; send-time drift gate ошибочно сравнивал
  snapshot со всеми active devices, включая intentional legacy non-leaf.
- Исправление: shared application roster projection используется обеими операциями;
  legacy device игнорируется, но participant без capable leaf блокируется, а device
  с только что зарегистрированной identity требует rotation до следующего send.
- Проверка: красный regression воспроизвёл exact `MLS roster does not match active
  conversation devices`; unit и PostgreSQL tests подтверждают успешный offline send
  до provisioning legacy device и обязательный conflict сразу после provisioning.

### BUG-061 — Restart/deploy мог отключить отправку на всех existing devices

- Статус: `fixed, automated and production-like browser verified` (`WP-062`).
- Severity: `critical authentication/E2EE availability`.
- Reproduction: перезагрузить два browser devices одного аккаунта во время API
  restart/container recreation; UI возвращается в READY без crypto warning, но
  отправка не доходит до message endpoint. Password login создаёт новый device и
  временно восстанавливает работу.
- Причины: transient `502` ошибочно считался logout; deploy одновременно пересоздавал
  API/frontend при auto-update PWA; failed decrypt старого MLS ciphertext из эпохи
  до enrollment уничтожала runtime без немедленного sealed restore; два replacement
  devices попеременно создавали `blocked/device_roster_changed` generations; любой
  server `409` ложно отображался как identity conflict.
- Исправление: только `401` очищает подтверждённую session; transient bootstrap
  bounded-retry-ится, API становится healthy до frontend rollout; failed mutation
  автоматически откатывается к durable crypto checkpoint; immutable blocked roster
  переиспользуется всеми новыми devices, пока previous READY leaf не координирует
  Commit; generic conflict получил честный UI label.
- Проверка: API остановлен, оба клиента reload-нуты в окно `502`, API поднят снова;
  обе session/device identity сохранились, оба devices отправили v2 сообщения, peer
  расшифровал их, device/generation counters не выросли.

### BUG-060 — Pixel показывал квадратную PWA icon внутри белого круга и серый splash

- Статус: `fixed, automated/browser/production verified` (`WP-059`, `59495f0`,
  production run `31577182322`).
- Severity: `high install/brand UX`.
- Reproduction: установить production PWA из Chrome на Pixel; launcher показывает
  белую системную окружность, внутри которой остаётся отдельный midnight square с
  уменьшенным line mark; generated splash использует серое полотно и ту же квадратную
  картинку вместо цельного brand surface.
- Причина: production HTML не содержит `<link rel="manifest">`, хотя сам файл
  доступен по URL. Chrome поэтому создаёт fallback home-screen surface вместо
  manifest-aware install и не применяет объявленные `maskable`/`background_color`.
  Старые `icon-v2-*` URL и radial maskable canvas дополнительно мешают обновлению и
  делают квадрат видимым на fallback splash.
- Ожидаемое исправление: explicit manifest link, новые versioned URLs, отдельные
  transparent `any` и opaque solid full-bleed `maskable`, exact match maskable
  canvas/manifest background, safe-zone regression и проверенный reinstall flow.
- Production verification: HTML manifest-link присутствует, manifest содержит только
  `v3` 192/512 `any`/`maskable`, assets доступны; API/Nginx/соседние domains healthy.

### BUG-059 — Cached directory не видел только что активированного пользователя

- Статус: `open, captured during WP-057 browser acceptance`.
- Severity: `medium account/group UX`.
- Reproduction: admin открывает messenger и сохраняет directory snapshot, затем в
  другом tab активирует приглашённого пользователя; reload/chat startup восстанавливает
  snapshot и делает cursor sync, но форма новой группы не показывает active account.
  Чистый browser origin без snapshot сразу показывает пользователя.
- Причина: account create/activation не публикует directory sync event, а cache-first
  startup при успешном snapshot не выполняет authoritative directory refresh.
- Ожидаемое исправление: после cache paint directory обязательно reconciled с API
  либо account lifecycle публикует bounded user-directory invalidation; offline startup
  по-прежнему использует snapshot.

### BUG-058 — Attachment StreamingResponse терял rotated session cookie

- Статус: `fixed, automated/browser/production verified` (`WP-057`, `09177e7`,
  production run `31556674459`).
- Severity: `critical authentication availability`.
- Reproduction: attachment GET попадает в окно credential rotation;
  `authenticate_request` выставляет новый cookie на injected `Response`, после чего
  route возвращает другой `StreamingResponse`. Новый `Set-Cookie` не попадает клиенту,
  а server уже хранит новый digest; после previous-token grace дальнейшие запросы
  получают unauthorized/replay handling.
- Ожидаемое поведение: фактический streaming response переносит все auth boundary
  `Set-Cookie`, и следующий запрос с обновлённым credential остаётся valid.

### BUG-057 — Фото открывалось вне PWA и получало unauthorized

- Статус: `fixed, automated/browser/production verified` (`WP-057`, `09177e7`,
  production run `31556674459`).
- Severity: `high group-media usability`.
- Reproduction: нажать group photo в установленной standalone PWA; обычный
  `<a target="_blank">` может открыть внешний browser context/cookie partition без
  текущей PWA session, и attachment endpoint отвечает `401`.
- Ожидаемое поведение: PWA получает bytes через credentialed application gateway,
  показывает фото во встроенной gallery, а file download использует краткоживущий
  Blob URL без навигации на protected endpoint.

### BUG-056 — Concurrent retry attachment upload мог оставить orphan blob

- Статус: `fixed, full-CI and production verified` (`WP-056`, `5135a50`).
- Severity: `medium storage correctness`.
- Reproduction: два запроса одного device одновременно загружают разные HTTP body с
  одинаковым `client_attachment_id`; оба проходят ранний idempotency lookup.
- Ожидаемое поведение: один metadata row/opaque blob, compatible retry получает тот
  же результат, incompatible retry получает `409`, лишний blob удаляется.
- Причина: ранняя проверка до streaming write не сериализует конкурентные requests.
- Исправление: после write uploader row блокируется, client ID повторно читается
  `FOR UPDATE`, quota считается под той же serialization boundary, лишний object
  удаляется до возврата результата/ошибки.

### BUG-055 — Existing media volume мог остаться недоступным non-root backend

- Статус: `fixed, full-CI and production verified` (`WP-056`, `5135a50`).
- Severity: `high deployment availability`.
- Reproduction: named volume уже создан Docker как root-owned directory, новый API
  image запускается UID 65532 и пытается создать `/data/media/<prefix>`.
- Ожидаемое поведение: deploy повторяемо подготавливает persistent volume, не меняя
  host nginx и не требуя root API process.
- Причина: ownership из Dockerfile применяется к image layer, но не гарантируется
  для уже существующего mounted volume.
- Исправление: bounded one-shot `media-init` с `CHOWN/FOWNER`, без network/ports и с
  drop остальных capabilities; API/cleanup ждут его успешного завершения.

### BUG-054 — Stable connection status постоянно съедал высоту messenger shell

- Статус: `fixed, frontend checks verified` (`WP-055`).
- Severity: `medium UX`; после успешного health probe приложение постоянно
  показывало «Соединено» и резервировало отдельную верхнюю grid-строку.
- Reproduction: открыть authenticated shell при доступном API; после перехода
  monitor в `connected` баннер остаётся, а chat viewport короче на status/safe-area.
- Ожидаемое поведение: transient/offline состояния видимы поверх интерфейса,
  подтверждённый `connected` скрыт и не влияет на геометрию shell.
- Причина: `ConnectionStatus` безусловно рендерил все состояния, а
  `.product-shell` всегда включал `--connection-bar-height` в rows.
- Проверка: component regression переключает checking/connected/offline, CSS shell
  использует один full-height row на desktop и mobile.

### BUG-053 — Потеря conversation checkpoint требовала logout/login

- Статус: `fixed, full-CI and production rollout verified` (`WP-054`, `01ef0ac`).
- Severity: `critical availability`; после deploy/reload existing non-coordinator
  device получал READY bootstrap HTTP 200, но не мог отправлять direct MLS v2 message.
- Reproduction: sealed `yv-chat-crypto-v1` snapshot содержит действующий OpenMLS group,
  а запись этого conversation в `yv-chat-conversation-crypto-v1` отсутствует/сброшена;
  server возвращает READY generation без нового Welcome, client начинает catch-up с 0
  и трактует существующий leaf как конфликт.
- Причина: reconciliation не имел read-only способа сопоставить сохранённый local
  epoch/roster с server generation. Logout/login маскировал дефект созданием нового
  `device_id`, KeyPackage и Welcome, а не ремонтом старого устройства.
- Security invariant: checkpoint можно восстановить только по exact conversation,
  epoch и полному roster; при отсутствии/несовпадении private state direct chat
  остаётся fail-closed без v1 downgrade.
- Проверка: real WASM/Worker regression восстанавливает потерянный control checkpoint
  и применяет следующий Commit без logout/login; mismatch/missing-group tests остаются
  blocked. CI `31549397608` и production deploy `31549397629` green.

### BUG-052 — Direct generation could omit a participant with no capable device

- Статус: `fixed and full-CI verified; production rollout pending`.
- Severity: `critical security/availability`; incremental enrollment filtered active
  devices without crypto identity, but did not require at least one capable device for
  every direct participant. A self-only READY roster could therefore accept a message
  that the other user could never decrypt later.
- Исправление: generation remains `blocked/missing_identity` until every active member
  has at least one active crypto identity. Extra legacy devices do not block a member
  who already has another capable device.
- Tests: absent peer identity blocks without consuming packages; one capable device
  plus an extra legacy device remains valid and claims only the peer package.

### BUG-051 — Full direct roster rotation caused bootstrap 422

- Статус: `fixed and production-verified in 194090f`.
- Severity: `critical`; existing direct conversation became unable to send when every
  device from the latest READY MLS generation had been revoked and both users logged
  in from replacement devices.
- Reproduction: current generation has a revoked coordinator, latest READY roster has
  no active leaves, both replacement devices have identities and available
  KeyPackages; `POST /crypto/bootstrap` returns 422.
- Причина: full-roster recovery selected the current replacement device as coordinator,
  but also left it in `added_device_ids`; bootstrap then attempted to bind the
  coordinator's own KeyPackage, violating the domain invariant.
- Исправление: coordinator is always excluded from Welcome/KeyPackage targets,
  including recovery from an entirely revoked previous roster; regression covers two
  replacement devices and proves only the peer package is claimed.
- Data impact: message ciphertext/history is not modified; failed transactions did not
  persist partial generations or consume packages.

### BUG-050 — Direct recipient badge оставался stale после Welcome catch-up

- Статус: `fixed, browser- and production-verified in WP-050`.
- Severity: `high`; второй device успешно применял Welcome и расшифровывал новое
  direct v2 сообщение, но UI продолжал показывать «E2EE недоступно» из состояния,
  полученного до завершения sender bootstrap.
- Причина: incoming `message_created` запускал exact-version history decrypt, который
  reconciliation-ил MLS state внутри adapter, но presentation crypto phase повторно
  обновлялась только для `conversation_updated`.
- Исправление: после active message catch-up `useMessenger` повторно запрашивает
  authoritative conversation crypto state. Group path остаётся no-op и не вызывает
  MLS endpoint. Regression моделирует `pending → message_created → ready`.
- Проверка: production-like recipient применил Welcome, расшифровал direct v2, после
  rebuild/reload warning отсутствует; browser console и backend 5xx logs пусты.

### BUG-049 — Revoke/relogin оставлял устройства на разных MLS generations

- Статус: `fixed`, production `WP-049`, verified 2026-08-12.
- Severity: `critical`; после завершения всех sessions один новый device не мог
  дочитать roster history, а другой шифровал новым client message со старой
  generation binding и получал HTTP 409 (`Конфликт идентификатора`).
- Причины: ready generation кэшировалась без обязательной сверки перед crypto
  operation; catch-up считал generation до enrollment конфликтом вместо skip;
  Welcome acknowledgement ошибочно разрешался только пока generation остаётся
  current, хотя новый device обязан последовательно догнать несколько generations.
- Исправление: encrypt/decrypt сначала invalidates cached generation и single-flight
  reconcile-ит server state; pre-enrollment generations пропускаются; Welcome exact
  device можно идемпотентно подтвердить для historical generation.
- Security: server по-прежнему отклоняет новый ciphertext со старой generation/epoch;
  revoked leaf не получает возможность продолжать future messaging.
- Production: immutable release `fb650ae` deployed; health/container checks green,
  новых HTTP 500/traceback в post-deploy backend logs не обнаружено.

### BUG-048 — Retry blocked crypto bootstrap падал на unique constraint

- Статус: `fixed`, production `WP-049`, verified 2026-08-12.
- Severity: `critical`; UI показывал недоступную защищённую группу, а повторный
  `POST .../crypto/bootstrap` завершался HTTP 500.
- Причина: первый request корректно создавал generation `blocked/missing_identity`,
  но same-device/same-request retry находил idempotency record и не возвращал его.
  Затем use case пытался вставить новую generation с той же парой
  `(coordinator_device_id, bootstrap_request_id)`, и PostgreSQL отклонял её по
  `uq_conversation_crypto_bootstrap_request`.
- Исправление: exact retry немедленно materialize-ит существующую generation любого
  статуса; request, уже связанный с другой conversation, по-прежнему даёт typed
  conflict. Regression повторяет blocked request и требует одну generation/commit.
  После terminal blocked frontend заранее сохраняет новый operation ID: следующий
  reconciliation может продолжить bootstrap, если недостающий device уже прошёл
  provisioning, вместо бесконечного повтора исторического blocked результата.
- Отдельное ожидаемое состояние: `missing_identity` не является миграционной
  потерей ключей. Production-аудит конкретного legacy conversation показал 11
  non-revoked devices, из которых только 3 уже имели MLS identity. Legacy devices
  без identity теперь не входят в required MLS roster и не блокируют capable
  devices; после первого provisioning они добавляются следующим roster Commit.
  `missing_identity` сохраняется как fail-closed состояние только для current device,
  которое пытается координировать bootstrap до собственного provisioning.
- Production: GitHub Actions run `31539053027` полностью green, release `fb650ae`
  deployed; повторных unique constraint/HTTP 500 в post-deploy logs нет.

### BUG-047 — Layout мог уничтожить MLS runtime во время cache-first восстановления

- Статус: `verified` в production-like two-origin browser acceptance `WP-047`.
- Severity: `critical`; live MLS v2 обмен работал, но после reload оба сообщения
  отображались как «Защищённое сообщение недоступно на этом устройстве».
- Условия воспроизведения: два чистых browser origin/device создают direct
  conversation, обмениваются MLS v2 сообщениями, затем отправитель перезагружает
  active conversation с encrypted local archive.
- Причина: layout lifecycle и messenger startup одновременно владели одним
  `DeviceCryptoSession`. Layout перед каждым same-device `initialize()` сначала
  вызывал `dispose()`, поэтому мог остановить Worker между cache hydration и
  `unprotectMessage`; два одинаковых `GET crypto-identity` в access-log подтвердили
  конкурирующие initialization paths.
- Исправление: same-account lifecycle переиспользует idempotent/single-flight
  `DeviceCryptoSession.initialize`; dispose выполняется только при исчезновении
  authenticated account либо unmount.
- Проверка: два browser origin/device повторно показывают исходное и ответное MLS
  v2 сообщение после reload; warning/console errors отсутствуют. Unit regression
  требует отсутствие dispose перед same-account initialize.

### BUG-046 — Device roster мог измениться раньше создания следующей MLS generation

- Статус: `fixed`, ожидает multi-device browser acceptance.
- Найдено в: `WP-047`, аудит revoke/logout и фоновой outbox отправки.
- Severity: `critical`; старая generation оставалась READY в коротком окне до
  клиентского reconciliation и server проверял только наличие sender leaf.
- Исправление: каждый новый v2 send сравнивает exact required-device snapshot с
  фактическими non-revoked MLS-capable devices всех active members. Любой capable
  drift даёт conflict, legacy non-leaf без identity не участвует в MLS roster.
  Explicit device revoke/logout дополнительно создают durable `conversation_updated`
  для всех active участников и realtime wake-up после commit.
- Проверка: негативный send test добавляет новое active device после READY generation
  и подтверждает отказ; revoke test проверяет per-recipient sync и notifications.

### BUG-045 — Offline device не мог применить несколько Commit или rejoin после remove/re-add

- Статус: `fixed`, ожидает multi-device browser acceptance.
- Найдено в: `WP-047`, reconnect/re-add release-gate audit.
- Severity: `critical`; клиент принимал только текущую generation и требовал ровно
  `local + 1`, а повторный Welcome конфликтовал с сохранённой group того же UUID.
- Исправление: authorized `/crypto/updates` возвращает ordered READY generations,
  где current device входит в immutable roster. Client последовательно checkpoint-ит
  Commit, а Welcome после доказанного generation gap вызывает explicit rejoin:
  старую group удаляет OpenMLS, новый state сохраняется только после valid Welcome.
  При ошибке runtime уничтожается и восстанавливает последний sealed snapshot.
- Проверка: application tests покрывают ordered filtering и ack crash resume;
  native и release-WASM проходят add → remove → future decrypt denial → same-device
  re-add/rejoin → successful decrypt.

### BUG-044 — Текущий OpenMLS WASM не помещался в стандартный Workbox precache limit

- Статус: `fixed`, ожидает installed-PWA acceptance.
- Найдено в: `WP-047`, production Nuxt build immutable `/crypto/v5/` и `/crypto/v6/`.
- Severity: `high`; build завершался ошибкой, а исключение WASM из app shell снова
  сделало бы crypto runtime зависимым от сети после установки/перезапуска PWA.
- Причина: release WASM вырос до 2.16 MiB после membership operations, а Workbox по
  умолчанию принимает в precache не более 2 MiB.
- Исправление: локальный явный limit поднят до 3 MiB; rolling v1–v5 исключены, а
  только binding-compatible v6 JS/WASM входит в текущий service worker precache.
- Проверка: production build содержит 51 precache entry и Makefile проверяет exact
  v6 WASM path в `sw.js`.

### BUG-043 — Старый MLS outbox мог пережить rotation без точной server binding

- Статус: `fixed`, ожидает multi-device browser acceptance.
- Найдено в: `WP-047`, аудит group mutation и offline retry.
- Severity: `critical`; шифротекст, созданный до смены roster, мог быть повторно
  отправлен после готовности новой generation, если server проверял лишь `READY`.
- Исправление: protocol v2 требует immutable `crypto_generation_id + crypto_epoch`
  во frontend outbox/API/domain/PostgreSQL. Backend сравнивает их с current READY
  generation и sender leaf; response scope тоже обязан вернуть exact binding.
- Идемпотентность: exact retry уже принятого envelope возвращает прежний receipt
  после rotation, но новый client message со старой binding отклоняется.
- Проверка: backend negative tests покрывают missing/stale/substituted binding и
  retry после supersede; frontend tests покрывают persistence и exact gateway args.

### BUG-042 — Параллельная подготовка истории могла повторно bootstrap-ить MLS group

- Статус: `fixed`, ожидает browser acceptance.
- Найдено в: `WP-047`, проверка initial history из 100 сообщений.
- Severity: `critical`; второй concurrent bootstrap получал `GroupAlreadyExists` и
  fail-closed уничтожил бы активный runtime после успешного первого bootstrap.
- Причина: timeline готовит bounded page через `Promise.all`, а каждый v2 adapter
  независимо запускал server reconciliation одной conversation.
- Исправление: authenticated `DeviceCryptoSession` single-flight-ит reconciliation
  по conversation, разделяет один promise между всеми decrypt и кэширует только
  подтверждённый `ready` до explicit invalidation/device-session dispose.
- Проверка: 20 параллельных вызовов выполняют один server GET и один Welcome join;
  повторный read не вызывает сеть, explicit invalidation проверяет generation снова.

### BUG-041 — Повторное открытие MLS сообщения выглядело бы как повреждение

- Статус: `fixed`, ожидает production E2E retest.
- Найдено в: `WP-047`, аудит v2 cutover.
- Severity: `critical`; после первого decrypt история на этом device могла стать
  недоступной при повторном render/reload.
- Условия воспроизведения: обработать MLS PrivateMessage, checkpoint-нуть receive
  ratchet, затем повторно подготовить тот же transport envelope из local archive.
- Причина: OpenMLS намеренно отвергает повтор как replay, а UI до v2 хранил только
  ciphertext и вызывал decrypt при каждом render.
- Исправление: Worker сначала читает encrypted device-local content cache; первый
  decrypt/protect атомарно записывает content cache вместе с новым sealed MLS state
  одной IndexedDB transaction. Replay protection не отключалась.
- Проверка: release WASM test повторно читает собственное/полученное сообщение до и
  после runtime reload без второго ratchet advance; vault test проверяет отсутствие
  plaintext в raw IndexedDB ciphertext.

### BUG-040 — OpenMLS runtime не доходил до регистрации устройства

- Статус: `fixed`, ожидает retest affected device.
- Найдено в: production после `WP-045`.
- Severity: `high`; все новые устройства оставались без crypto identity.
- Симптом: после каждого открытия PWA отображалось «Криптомодуль этого устройства
  не готов», а Network показывал только повторяющийся
  `GET /api/v1/devices/current/crypto-identity` → `404`.
- Первая подтверждённая причина: `404` корректно запускал первичное provisioning, но production CSP не
  содержал `script-src 'wasm-unsafe-eval'`. Браузер загружал Worker, JS glue и WASM
  с HTTP 200, затем запрещал компиляцию WebAssembly; поэтому локальный sealed state
  не создавался и обязательный `PUT` регистрации не выполнялся.
- Исправление: chat-only host Nginx CSP разрешает узкий `'wasm-unsafe-eval'`,
  сохраняя запрет более широкого `'unsafe-eval'`; deploy-check фиксирует оба
  инварианта. Соседние vhost `yoowee.ru` и `s3.yoowee.ru` не меняются.
- Повторный production retest после CSP всё ещё показал общий
  `runtime-unavailable`, хотя Worker/JS/WASM отвечали `200`. Тот же production build
  отдельно прошёл в чистом Firefox весь `Worker → WASM → DeviceBootstrap →
  non-extractable WebCrypto key → IndexedDB sealed state` path. Значит второй сбой
  локален для активного PWA/Workbox cache или профиля, а не требует Rust container.
- Второе исправление: Worker сначала перешёл на immutable `/crypto/v3/`, а текущий
  KeyPackage-pool binding — на `/crypto/v4/`, исключая
  mixed cached JS/WASM; `/crypto/v1/` сохранён на rolling window. Import, invalid
  binding, WASM init, Worker crash/protocol/timeout теперь показываются раздельно,
  не раскрывая raw exception или private state.
- Backend/WASM production smoke после deploy подтвердил `crypto-identity 200`, JS
  и WASM v3 `200 application/wasm`; остаётся retest именно affected browser profile.
- Приёмка: после применения vhost и полного перезапуска PWA один первоначальный
  `GET 404` должен сопровождаться успешным `PUT 200`; следующие запуски получают
  `GET 200`, а криптомодуль переходит в `ready`.

### BUG-039 — Device crypto warning не объясняет причину и безопасное восстановление

- Статус: `fixed`, ожидает user retest конкретного device.
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
- Исправление: commit `249e3dc` сохраняет bounded issue category; transient network/runtime/storage
  оставлять retryable, а missing/corrupt/conflicting identity направлять через
  explicit logout → новый login/device без silent key replacement.
- Проверка: 126 Vitest; production deploy `249e3dc` healthy, окончательная причина
  пользовательского device будет видна после полного reopen установленной PWA.

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

### BUG-053 — Второй device существующего участника не мог войти в READY direct MLS

- Статус: `fixed, full-CI and production verified in f69a191`.
- Severity: `critical availability`; новый Android device успешно регистрировал
  crypto identity/KeyPackage, но `POST /crypto/bootstrap` возвращал HTTP 422 и UI
  оставался в fail-closed состоянии «Личный диалог недоступен».
- Production reproduction: conversation `d2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e`
  имел READY generation 19 с двумя старыми leaves; второй device пользователя стал
  третьим capable active device, но не был добавлен в current roster.
- Причина: server правильно выбирал coordinator из предыдущего READY roster, однако
  claim нового KeyPackage ошибочно записывал request device как claiming device.
  Для нового телефона target и claimant совпадали, поэтому domain invariant
  «device cannot claim its own KeyPackage» завершал bootstrap как 422.
- Дополнительный lifecycle gap: регистрация нового crypto identity не создавала
  durable wake-up для старого coordinator, поэтому pending roster update мог ждать
  ручного открытия диалога на нужном старом leaf.
- Browser acceptance дополнительно воспроизвёл PostgreSQL deadlock при одновременном
  wake-up нескольких старых leaves; все roster mutations теперь используют единый
  порядок `conversation → actor device → generation/packages/required rows`.
- Исправление: новый device публикует idempotent blocked announcement без package
  claim; любое прежнее leaf становится actual coordinator, durable/realtime events
  доводят generation до READY, а generation-number gap не путается с MLS epoch gap.
- Проверка: local two-origin acceptance прочитал новое post-enrollment сообщение на
  обоих devices; GitHub CI/deploy успешны, production `f69a191` healthy без свежих
  `422/500`. Исходный 422 rollback не изменил generation 19, packages или messages.

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

- Статус: `partially fixed; Chrome-owned navigation bar background remains`.
- Найдено в: production Pixel PWA QA, `WP-043`.
- Severity: `high`.
- Условия воспроизведения: открыть установленную Chrome PWA на Pixel, использовать
  gesture navigation и потянуть root вниз у верхней границы internal scroll.
- Ожидаемое поведение: app surface непрерывно закрашен под gesture pill; системный
  pull-to-refresh не запускается, обновление контролируется PWA lifecycle.
- Фактическое поведение: область под gesture pill имела чужой фон, а browser refresh
  мог перезагрузить приложение и сбросить transient UI state.
- Причина: root не запрещал overscroll default action; дополнительно ошибочно
  предполагалось, что manifest/meta `theme-color` или CSS safe-area могут управлять
  нижним Android system navigation surface установленного Chrome WebAPK.
- Исправление: `WP-043` задаёт root `overscroll-behavior: none`, отдельные internal
  scroll containers и safe-area geometry; `WP-064` синхронизирует status-bar theme.
  Однако нижний navigation bar остаётся platform/Chrome-owned и не принимает цвет
  сайта через standard PWA API.
- Проверка: pull-to-refresh/layout contract tests проходят; production Pixel retest
  подтвердил чёрную подложку под gesture handle. Telegram-like exact control требует
  отдельного Android TWA/APK wrapper с native edge-to-edge/navigation-bar policy либо
  принятия platform rendering для обычной installed PWA.

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
