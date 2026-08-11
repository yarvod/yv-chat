# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-007 — Clean Architecture modularization

Статус: **completed**  
Backlog item: `BL-ARCH-001`  
Цель: привести backend к прозрачной Clean Architecture: feature-oriented application modules, узкие ports, отдельные infrastructure adapters, модульный Dishka composition root и idiomatic async pytest tests.

### Архитектурный результат

Dependency rule остаётся `presentation → application → domain`, infrastructure реализует application ports, а bootstrap — единственное место, которое знает все concrete types. Каталоги отражают account/session/device capabilities. Крупные файлы-комбайны исчезают; каждый provider/repository/use case имеет одну очевидную ответственность.

### Правила рефакторинга

1. Domain/application не импортируют FastAPI, Dishka, SQLAlchemy или concrete adapters.
2. Dishka используется только в composition root и presentation injection boundary.
3. Providers группируются по settings, adapters, persistence и application capability; единого god-provider нет.
4. APP scope содержит process resources/stateless adapters/policies, REQUEST scope — use cases; UoW создаётся на одну application operation.
5. Repository port и adapter разбиты по aggregate responsibility; generic CRUD не появляется.
6. Use cases разложены по `accounts`, `sessions`, `devices`, а не в плоский junk drawer.
7. Transport DTO и handlers разделяются по capability; HTTP не получает агрегат всех services.
8. Tests используют pytest async support/fixtures; ручной `asyncio.run()` в test functions запрещён.
9. Test doubles остаются typed implementations узких ports и разбиваются по ответственности.
10. Рефакторинг не меняет versioned HTTP behavior, schema, security/session semantics.

### План реализации

- [x] Инвентаризировать зависимости и крупные модули.
- [x] Разбить identity persistence ports на user/token/device/session/event/UoW modules.
- [x] Разбить SQLAlchemy repositories и pure mappers на отдельные adapters.
- [x] Разложить use cases по account/session/device feature packages.
- [x] Разбить Dishka root на settings/persistence/security/account/session/device providers.
- [x] Перевести bootstrap admin CLI на общий Dishka composition root.
- [x] Проверить, что HTTP handlers уже разделены по auth/device capability; дальнейшее дробление DTO не создаёт полезной границы на текущем размере.
- [x] Добавить pytest-asyncio и удалить ручной `asyncio.run()` из tests.
- [x] Добавить architecture/import-boundary tests и Dishka graph test.
- [x] Обновить architecture/README/backlog/bugs.
- [x] Прогнать full CI, PostgreSQL integration и Docker/OpenAPI smoke.
- [x] Зафиксировать refactor отдельным commit без feature behavior changes.

### Не входит в scope

- новые admin/messaging endpoints;
- изменение database schema;
- смена auth/session policy;
- новая framework abstraction поверх Dishka;
- объединение разных UoW операций в одну request transaction.

### Проверка готовности

- production Dishka graph строится и закрывается;
- ни один application/domain module не импортирует outer frameworks;
- нет god-provider/god-repository и плоской директории всех use cases;
- HTTP behavior и OpenAPI paths не изменились;
- tests не содержат `asyncio.run()`;
- Ruff, format, mypy, pytest, PostgreSQL integration, frontend/Compose CI и Docker smoke проходят;
- отдельный focused commit создан до возврата к `BL-003D`.
