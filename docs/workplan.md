# Текущий workplan

## WP-150 — Обновление зависимостей для прохождения production audit

Статус: **проверено локально**.
Backlog: `BL-FIX-077`. Дефект: `BUG-145`.

1. Воспроизвести отказ аудита для lockfile из `4aaf2f1`.
2. Обновить пакеты с исправлениями и проверить совместимость обновлённого
   тестового окружения. Сохранить полную проверку production и dev зависимостей.
3. Проверить чистый `npm ci`, `npm audit --audit-level=high`, lint, typecheck,
   frontend tests и production build, включая Service Worker и crypto assets.

Готовность: проверки проходят и изменения собраны в отдельный commit.
Production rollout и исправление восстановления MLS snapshot (`BUG-146`) вне
scope обновления зависимостей.

Проверка 2026-11-12: чистый `npm ci`, аудит с 0 high и 0 critical, lint,
typecheck, 531 frontend test и production build с Service Worker прошли на
подготовленном дереве релиза.
