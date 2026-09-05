# Текущий workplan

## WP-146 — Мобильный возврат и прочтение видимых сообщений

Статус: **completed locally; physical gesture acceptance pending**
Backlog: `BL-FIX-073`
Bugs: `BUG-137`, `BUG-138`

Цель: history transition сохраняет список до открытия чата; read cursor продвигается
по реально показанному сообщению в активном окне, а отправитель видит прочтение.

### Scope и шаги

1. Записать route до смены mobile pane и загрузки conversation; проверить Back/Forward.
2. Наблюдать timeline после render/restoration, при scroll/resize/focus, исключить
   hidden, inactive, detached и перекрытые страницы.
3. Отправлять exact visible sequence с дедупликацией и retry; исключить auto-read
   загруженного tail и ложное обнуление unread при частичном просмотре.
4. Добавить read sequence из существующей таблицы в participant receipt response,
   восстановление через sync/reload и отдельное отображение прочтения.
5. Запустить Docker stack и проверить mobile browser, выполнить regression checks.

### Security и архитектура

- Только существующие opaque conversation/user IDs и sequence; plaintext/keys не
  добавляются в transport, persistence или logs.
- Membership authorization, CSRF/session/Origin и monotonic server cursors сохраняются.
- Read и delivery остаются разными состояниями; read cursor общий для user, delivery
  учитывает действующие устройства. Schema и crypto protocol не меняются.
- Серверный cursor означает «прочитано по sequence включительно»; не вводится новая
  таблица индивидуальных просмотренных сообщений.

### Tests и Definition of Done

- Нет read на load/poll без viewport report, в фоне, скрытом pane или до restoration.
- Scroll/focus/new render дают read без ожидания 30-second fallback; частичный viewport
  не подтверждает невидимый tail, ошибки допускают retry, cursor не регрессирует.
- Read receipt обновляет sender UI и восстанавливается после reload/catch-up;
  non-member не видит чужие receipts.
- Frontend tests/lint/typecheck/build, backend relevant tests/lint/types,
  PostgreSQL query verification и Compose config проходят.
- Документы обновлены; focused local commit создан.

### Exclusions

- Production deployment, Android/iOS release, физический OS gesture emulator.
- Изменения E2EE, retention, session policy и схемы БД.

### Verification

- Полный frontend suite: 75 files, 471 tests passed; final receipt parser suite
  после compatibility correction: 12 passed. ESLint и Nuxt typecheck passed.
- Production Nuxt build выполнен Dockerfile; API/frontend пересобраны, local Nginx
  перезапущен после смены container IP. Compose config и docs checks passed.
- Backend: 295 passed, 12 integration tests skipped без общего TEST_DATABASE_URL;
  отдельный PostgreSQL container получил fresh `alembic upgrade head`, затем
  relevant integration/application/HTTP suite: 17 passed (включая 2 PostgreSQL tests).
  Ruff check/format, mypy (402 files), import-linter (3 contracts) passed.
- Browser 412×915: `/chat -> conversation -> Back -> /chat -> Forward` passed;
  unread badge QA-чата оставался 30 на Settings/list, открытие tail подтвердило 30.
  При загруженном, но offscreen №31 серверный read cursor оставался 30;
  scroll-to-latest продвинул его до 31. Финальный IntersectionObserver build
  повторил проверку с №34: read оставался 33 вне экрана и стал 34 после scroll.
  Sender показывает `Прочитано: 1/1`;
  статус сохранился после reload. Console errors отсутствовали.
- Focus/visibility, occlusion, tall/clipped messages, retry, in-flight coalescing,
  KeepAlive deactivation и IntersectionObserver/fallback покрыты component tests.
  Две вкладки встроенного Browser не воспроизвели надёжно OS background/focus;
  это не считается physical foreground acceptance.
- Изменений схемы/crypto нет; Rust rebuild и полный `make ci` не запускались.
  Системная predictive Back animation Android/iOS требует физического устройства;
  production deployment и native package release не выполнялись.
