# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-006 — Active device/session management

Статус: **completed**  
Backlog item: `BL-003C`  
Цель: дать пользователю безопасное управление собственными устройствами и сессиями, не раскрывая credentials и не используя browser metadata как фактор авторизации.

### Пользовательский результат

Пользователь видит текущую и остальные активные сессии с понятным device name и bounded metadata, может переименовать своё устройство, отозвать одну сессию или все остальные. Security events показывают важные действия и replay-сигналы с ограниченным retention.

### Security invariants

1. Все операции используют `user_id` из аутентифицированной сессии; client-supplied owner ID отсутствует.
2. Угадывание чужого `session_id`/`device_id` не позволяет читать или изменять чужие записи.
3. API никогда не возвращает current/previous token hash, credential, password hash или private metadata вне явного DTO.
4. Current session/device определяется серверным `session_id`, а не флагом клиента.
5. Rename меняет только display name и не влияет на authentication validity.
6. Revoke одной device-bound session атомарно отзывает session и device.
7. Revoke-all-others сохраняет текущую сессию даже при конкурентном запросе.
8. IP, User-Agent и device model остаются информационными metadata, не authorization factors.
9. State-changing endpoints проходят существующие exact Origin + CSRF checks.
10. Security events не содержат credentials, plaintext messages или полные чувствительные заголовки.

### План реализации

- [x] Добавить typed list/rename/revoke/revoke-all commands, results и ownership errors.
- [x] Расширить repository ports узкими user-scoped session/device queries.
- [x] Реализовать list-my-sessions с current marker и стабильной сортировкой.
- [x] Реализовать rename-my-device с bounded domain validation.
- [x] Реализовать atomic revoke-one и revoke-all-others.
- [x] Добавить bounded `security_events` model/migration для login, logout, replay и revoke actions.
- [x] Связать существующие login/logout/replay transitions с event repository без secret payload.
- [x] Добавить `/api/v1/devices` list/rename/revoke/revoke-others endpoints.
- [x] Добавить response DTO, исключающие credential/hash fields.
- [x] Добавить unit tests всех use cases и negative ownership cases.
- [x] Добавить PostgreSQL tests для concurrent revoke-all/current preservation.
- [x] Добавить HTTP Origin/CSRF и response-schema tests.
- [x] Проверить migration fresh/roundtrip, `make ci` и Docker smoke test.
- [x] Обновить README/docs и зафиксировать фичу отдельным коммитом.

### Не входит в scope

- GeoIP database/provider;
- automatic revoke только из-за смены IP/браузера;
- password reset/security reset;
- admin management чужих сессий;
- WebSocket presence;
- frontend devices UI.

### Проверка готовности

- list показывает только сессии текущего пользователя;
- response отмечает current session и не содержит hashes/credentials;
- пользователь не может rename/revoke чужой device по guessed UUID;
- revoke-one блокирует последующую auth этой сессией;
- revoke-all-others не отзывает current session при concurrency;
- rename/IP metadata change не влияет на auth;
- security events bounded и не содержат secret values;
- все write endpoints требуют Origin + CSRF;
- PostgreSQL integration, migration roundtrip и `make ci` проходят;
- изменения зафиксированы отдельным коммитом.
