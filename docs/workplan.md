# Текущий workplan

## WP-137 — Демонстрация экрана в WebRTC-звонке

Статус: **completed locally; production rollout and physical two-device acceptance pending**
Backlog: `BL-084`

Цель: участник действующего 1:1 звонка может по явному нажатию открыть системный
browser picker, выбрать отдельный монитор, всё содержимое экрана, окно или вкладку
и передать изображение собеседнику через существующий MLS-authenticated WebRTC
media path.

### Scope

- capability-aware кнопка «Показать экран» в fullscreen call UI;
- системный `getDisplayMedia()` picker без client-side перечисления мониторов;
- browser hint включает monitor surfaces и source switching, не ограничивая выбор;
- замена существующего video sender track без нового signaling или renegotiation;
- detail-oriented capture до 2560×1440, 15 fps target и sender cap 1.8 Mbit/s;
- явный локальный preview и статус активной демонстрации;
- остановка из UI и из browser/system sharing indicator;
- автоматическое восстановление камеры, если она была включена до демонстрации;
- cleanup capture track при hangup/error/reset и отсутствие влияния на audio track;
- disabled capability UX на платформах без screen-capture API.

### Security и privacy

- browser/OS остаётся единственным владельцем списка экранов и разрешения;
- приложение не получает изображение до явного выбора пользователя;
- screen media идёт тем же DTLS-SRTP direct/TURN transport и не проходит через
  FastAPI/WebSocket, не сохраняется и не логируется;
- signaling schema, MLS call identity binding и session credentials не меняются;
- захват не начинается автоматически и всегда прекращается при terminal cleanup.

### Tests

- camera → selected screen → system stop → restored camera;
- picker cancellation сохраняет текущую камеру и аудиозвонок;
- screen constraints, `detail` content hint и resolution-priority sender parameters;
- fullscreen и compact UI, unsupported capability, non-mirrored screen preview;
- frontend full suite, lint, typecheck и production build;
- local browser shell smoke без console errors.

### Exclusions

- одновременная передача камеры и экрана двумя отдельными video tracks;
- server-side recording, screenshots или media proxy;
- собственный список мониторов вместо защищённого system picker;
- обещание screen capture в iOS/Android WebView, где platform API его не даёт;
- system audio sharing: текущий slice передаёт microphone audio и screen video.

### Result

- screen share использует negotiated video transceiver и `replaceTrack()`, поэтому
  собеседник получает поток без нового trust/signaling lifecycle;
- системный picker предлагает доступные browser/OS поверхности, включая весь экран
  и конкретный монитор там, где это поддерживает desktop browser;
- при активной демонстрации camera track освобождается, локальный preview не
  зеркалится, UI явно показывает состояние; после browser/system stop камера
  безопасно запрашивается заново только если была включена до share;
- `68/68` frontend files и `433/433` tests проходят; ESLint, Nuxt typecheck,
  production/PWA build, Compose config и `git diff --check` зелёные;
- локальная production-сборка отрисована в in-app browser без console errors;
  permission picker и packet delivery между двумя физическими устройствами остаются
  production/physical acceptance, потому что browser automation не должна принимать
  screen-capture permission за пользователя.
