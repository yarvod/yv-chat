# Текущий workplan

## WP-148 — Качество демонстрации и просмотр без перекрытий

Статус: **implemented locally; production and physical acceptance pending**
Backlog: `BL-FIX-075`; bug: `BUG-142`.

### Scope и шаги

1. Добавить typed screen quality: 720p/1080p/1440p × 15/30/60 fps; default 1080p/15.
2. Настраивать capture constraints и bounded sender bitrate по выбранному профилю;
   менять профиль активной демонстрации без нового picker/peer. Unsupported change
   сохраняет текущую демонстрацию и сообщает об ошибке; hangup отменяет completion.
3. Добавить панель настроек в fullscreen call с выбором разрешения и FPS; audio,
   camera и permission retry сохраняются. Качество — запрошенный предел, не гарантия.
4. Скрывать topbar/actions/scrim/cursor после 3 секунд покоя при active remote video;
   возвращать по mouse movement/touch/keyboard. Не скрывать открытые панели, ошибки,
   pending operations, keyboard-focused controls или incoming/reconnecting calls.
5. Regression tests, frontend checks/build, docs/Compose checks, browser visual QA.

### Security и архитектура

Сохраняются MLS-verified SDP, DTLS-SRTP, explicit display permission, media-only
WebRTC, anti-recursion и cancellation guards WP-147. Нет новых crypto/signaling/
persistence contracts или зависимостей. Настройки живут в RAM; server TURN quotas
не снимаются и могут ограничивать реальное качество relay.

### Tests и Definition of Done

- Все 9 профилей, capture/sender limits, live update, rejection/cancellation,
  camera restore и permission user activation проверены.
- Auto-hide/reveal и отсутствие затемнения проверены; audio-only, входящий,
  reconnect, меню и keyboard navigation не прячут нужные controls.
- Frontend lint/typecheck/tests/build, docs/Compose checks проходят.
- Документация обновлена, focused commit создан. Реальные 1440p/60fps на физических
  устройствах/сетях отдельно отмечаются, если не проверены.

### Exclusions

Production deploy, native release, TURN quota changes, automatic quality benchmark,
новый media/signaling/crypto protocol и обещание фиксированного FPS на любом устройстве.

### Verification

- Полный frontend suite: 75 files / 512 tests passed; call/UI suites: 71 passed.
- ESLint и Nuxt typecheck passed; production Nuxt/PWA build passed.
- `make docs-check compose-check` и `git diff --check` passed.
- Browser preview подтвердил auto-hide scrim/controls после idle, reveal по Tab и
  responsive quality panel на 390×844; real 1440p/60fps media, CPU и OS acceptance
  требуют физического устройства.
- Backend/Rust checks, production rollout и native release не выполнялись.
