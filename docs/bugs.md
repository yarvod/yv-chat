# Bugs

Здесь фиксируются воспроизводимые дефекты, найденные во время разработки или проверки. Новые фичи и архитектурные идеи относятся в `backlog.md`, а не сюда.

## Active

Активных известных дефектов нет.

Последняя сверка: `WP-002` — новых воспроизводимых дефектов нет.

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
