# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-078 — User-controlled PWA activation without surprise reloads

Статус: **implemented and full-CI verified; production rollout pending**
(`BL-025`, `BUG-074`)

Цель: installed macOS/iOS/Android PWA никогда не перезагружает active UI из-за
фоновой Service Worker update check. Новая версия скачивается в фоне, но
activation/reload происходит только по явному действию пользователя.

### Scope

- заменить Vite PWA `autoUpdate` на `prompt`, чтобы activated/update event не вызывал
  implicit `window.location.reload()`;
- сохранить bounded checks на startup, visibility resume и раз в минуту;
- показывать global non-modal update notice с явной кнопкой activation;
- на время activation блокировать double click и ясно показывать reload;
- running old executable остаётся active, если download/check/activation не удались;
- не менять IndexedDB, session, device identity, MLS state, archive и outbox schemas.

### Verification

- config regression запрещает `registerType: 'autoUpdate'`;
- component regression проверяет explicit activation и busy state;
- update coordinator по-прежнему coalesces startup/foreground/periodic checks;
- frontend lint/typecheck/tests/build и full repository CI проходят;
- production asset содержит prompt registration, а existing PWA после одного последнего
  automatic reload больше не activation-ит future releases без кнопки.

### Definition of Done

- background update check не reload-ит active app;
- пользователь видит доступное обновление и сам выбирает момент reload;
- failed update не выбрасывает из сессии и не сбрасывает crypto/local data;
- focused commit, CI/CD и macOS installed-PWA acceptance завершены.
