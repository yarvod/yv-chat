# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-046 — Управление группой и составом участников

Статус: **in progress**
Backlog: `BL-042`
Цель: дать владельцу и администраторам группы безопасный и удобный интерфейс
редактирования названия и состава, сохранив server-authoritative authorization,
multi-device sync и будущие MLS membership boundaries.

### Инварианты

1. Название и состав изменяются только отдельными typed use cases. Vue-компоненты
   не выполняют raw HTTP, не решают права доступа и не мутируют transport DTO.
2. Только активный owner/admin может переименовать группу и добавлять участников.
   Обычный member не получает эти операции даже при подмене HTTP-запроса.
3. Owner нельзя удалить или понизить без отдельного протокола передачи владения.
   Admin не может удалить другого admin; пользователь покидает группу через
   отдельную self-leave операцию.
4. Состав ограничен 50 активными участниками вместе с owner. Лимит проверяется
   domain/application слоем под row lock, а не только формой.
5. Ранее удалённого/вышедшего пользователя можно добавить повторно через
   реактивацию единственной membership-записи с новым `joined_at`; duplicate active
   membership остаётся конфликтом.
6. Каждая успешная mutation атомарно сохраняет aggregate и recipient-specific
   `conversation_updated`; удалённый участник также получает событие и теряет
   доступ при следующем authoritative fetch.
7. Текущий synthetic message codec не становится E2EE. Group mutation UI готовит
   явную границу для будущих MLS Commit/Welcome, но не имитирует key rotation.

### План

- [x] Зафиксировать domain-инварианты title/membership, total active-member limit
  и безопасную реактивацию inactive membership.
- [x] Добавить `RenameGroupConversation` use case, Dishka binding и versioned HTTP
  endpoint с CSRF/auth/error translation.
- [x] Укрепить add/remove persistence и покрыть concurrency/authorization/re-add
  backend тестами.
- [x] Расширить typed frontend gateway и application use cases rename/add/remove/
  leave без raw HTTP в компонентах.
- [x] Добавить responsive group-info panel: редактирование title, активный состав,
  добавление из directory, удаление с role-aware controls и явные busy/error states.
- [x] Обновлять in-memory conversation и encrypted snapshot сразу после mutation;
  сохранить catch-up через существующий `conversation_updated` для других devices.
- [x] Добавить Vitest UI/use-case/parser tests, keyboard/focus/mobile viewport QA.
- [x] Обновить architecture/backlog/bugs/README при изменении contracts.
- [ ] Прогнать полный CI, commit/push, production deploy и проверить chat/yoowee/S3.

### Definition of Done

- owner/admin может переименовать группу и добавить/удалить допустимого участника;
- обычный member, outsider и admin против owner/admin получают корректный отказ;
- removed member больше не читает conversation, а re-add восстанавливает ровно
  одну membership-запись и новый active lifecycle;
- 51-й активный участник отвергается независимо от клиента;
- UI не уезжает при длинном списке: panel имеет собственный scroll и safe-area;
- локальный encrypted snapshot и другой online/offline device сходятся через sync;
- backend pytest/ruff/mypy, frontend lint/typecheck/Vitest/build и deploy checks проходят.
