# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-043 — Pixel PWA edge-to-edge and local conversation startup

Статус: **completed**
Backlog: `BL-022`, `BL-025`, `BL-041`
Цель: установленная через Chrome на Pixel PWA корректно закрашивает Android gesture
navigation area, не запускает browser pull-to-refresh, использует адаптивную иконку
без квадратной подложки и открывает список чатов из encrypted local snapshot до
authoritative catch-up.

### Инварианты

1. Document приложения не становится scroll container. `overscroll-behavior: none`
   на root отключает Chrome pull-to-refresh, а chat/list/page продолжают скроллиться
   только в своих bounded containers.
2. `viewport-fit=cover` сохраняется. Bottom navigation/composer учитывают dynamic
   `safe-area-inset-bottom` и maximum inset по Chrome 135 edge-to-edge pattern;
   непрозрачный app surface визуально продолжается под Android gesture pill.
3. Navigation controls никогда не перекрываются system gesture area или keyboard,
   а iOS standalone safe-area поведение не ухудшается.
4. Manifest имеет разные `any` и `maskable` assets. Maskable background полностью
   opaque, важный знак находится в minimum safe circle radius 40%, platform сама
   применяет circle/squircle mask; rounded square не baked внутрь adaptive asset.
5. Icon asset URL versioned, чтобы новая установка не получила старый cached icon.
   Уже установленная Android PWA может потребовать uninstall/reinstall, это явно
   документируется, поскольку launcher icon не обязан обновляться сразу.
6. Conversation/directory/read/delivery/sync snapshot хранится за отдельным
   application port в versioned IndexedDB adapter, зашифрован AES-256-GCM под
   non-extractable per-account key и не содержит session credential/plaintext.
7. При входе на `/chat` valid snapshot рендерится до сети. Catch-up начинается с
   persisted cursor и вызывает full list APIs только без snapshot, при reset или
   соответствующих sync events; PostgreSQL/sync остаются authoritative.
8. Snapshot cursor сохраняется только вместе с согласованными DTO после успешного
   применения страницы. Corrupt/unsupported snapshot fail closed и приводит к
   обычному network bootstrap без потери online функциональности.
9. Local snapshot schema и service-worker release проверяются compatibility tests;
   executable assets и user data остаются в разных browser stores.

### План

- [x] Зафиксировать BUG-033..035 и Pixel acceptance contract.
- [x] Исправить root overscroll и Chrome 135 edge-to-edge bottom surface.
- [x] Обновить versioned standard/maskable icon assets и manifest tests.
- [x] Добавить typed encrypted messenger snapshot port/codec/IndexedDB adapter.
- [x] Перевести messenger bootstrap на cache-first + cursor catch-up reconciliation.
- [x] Покрыть Pixel CSS, manifest/safe-zone, snapshot tamper/reload/no-refetch tests.
- [x] Обновить architecture/backlog/bugs и инструкции Android reinstall/update.
- [x] Прогнать полный CI, commit/push, production deploy и external smoke-test.

### Definition of Done

- root overscroll не может инициировать pull-to-refresh, внутренний timeline/list
  сохраняет независимый scroll;
- background bottom bar/composer покрывает gesture area в Chrome 135+ и имеет
  безопасный fallback для iOS/старых браузеров;
- round/squircle/circle crop не показывает квадратную рамку, а ключевой знак не
  обрезается минимальной maskable safe-zone;
- повторный переход на `/chat` сначала показывает encrypted local snapshot и при
  отсутствии новых sync events не вызывает directory/conversations APIs;
- offline/corrupt snapshot приводит к документированному fallback без credential
  leakage или ложного authoritative state;
- frontend lint/typecheck/Vitest/build и полный repository CI проходят.
