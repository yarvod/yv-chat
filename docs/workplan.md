# Текущий workplan

## WP-147 — Надёжность звонков и экономичная демонстрация экрана

Статус: **implemented locally; production and physical acceptance pending**
Backlog: `BL-FIX-074`; bugs: `BUG-139`, `BUG-140`, `BUG-141`.

### Scope и шаги

1. Сериализовать incoming signaling: ICE ждёт async MLS verification offer/answer;
   повторный reconnect snapshot не сбрасывает текущий peer.
2. Устранить race fast-connected против identity state и завершения старого media
   setup против нового звонка. Ограничить ICE buffer.
3. Ограничить screen capture 1920×1080 / 15 fps, сохранить detail/bitrate control;
   освободить ненужные video sinks без остановки звука.
4. Каждое явное повторное нажатие заново вызывает системный picker. При сохранённом
   OS denial показать понятный путь к настройкам; не обещать обход запрета macOS.
5. Добавить regression tests и выполнить frontend checks, docs/Compose checks.

### Security и архитектура

SDP применяется только после MLS binding verification; protocol, device binding,
DTLS-SRTP, sessions и server authorization сохраняются. Media остаётся в WebRTC;
нет новых logs, секретов, persistence, dependencies или API schemas.

### Tests и Definition of Done

- Delayed verification + immediate ICE, duplicate offer/answer, fast connected,
  hangup во время setup, stale peer events покрыты тестами.
- Capture caps, permission retry, camera/audio continuity, cleanup проверены.
- Frontend tests/lint/typecheck/build, docs и Compose validation проходят.
- Документы обновлены, focused commit создан. Физические macOS permission/CPU и
  two-device network acceptance отдельно отмечены, если недоступны локально.

### Exclusions

Production rollout, native package releases, ICE renegotiation/protocol changes,
программный сброс системных privacy settings.

### Verification

- Полный frontend suite: 75 files / 484 tests passed, включая 13 новых call
  regressions; focused call/UI suites: 45 passed.
- ESLint и Nuxt typecheck passed; production Nuxt/PWA build passed.
- `make docs-check compose-check` и `git diff --check` passed.
- Diff проверен: только call adapter, regression tests и документация; новых
  dependencies, секретов, API/crypto/persistence changes нет.
- Backend/Rust checks и полный `make ci` не запускались: изменён frontend call
  adapter, backend и crypto implementation не менялись.
- Физический Mac screen-permission denial/re-enable, CPU before/after и звонки
  между двумя реальными сетями здесь не проверены. Mock tests подтверждают
  перечисленные timing defects, но не гарантируют все network/OS combinations.
- Production rollout и native release не выполнялись.
