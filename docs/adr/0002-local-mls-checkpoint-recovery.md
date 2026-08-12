# ADR-0002: Восстановление локального MLS checkpoint без primary device

- Статус: **accepted**
- Дата решения: 2026-08-12
- Связанные задачи: `BL-054`, `WP-054`, `BUG-053`
- Базовый протокол: [ADR-0001](0001-e2ee-mls.md)

## Контекст

Один browser device хранит два разных вида локального состояния:

1. sealed OpenMLS provider snapshot в `yv-chat-crypto-v1`; внутри находятся private
   MLS group state, ratchets и signer;
2. application control checkpoint в `yv-chat-conversation-crypto-v1`; он связывает
   conversation с server generation/epoch и обеспечивает crash resume.

Если второй record был очищен или потерян, а первый сохранился, server корректно
возвращал READY generation без нового Welcome для уже существующего leaf. Client не
мог доказать, какой generation соответствует sealed group, начинал catch-up с нуля и
fail-closed завершался конфликтом. Logout/login маскировал дефект: создавал новую
device identity, KeyPackage и Welcome, но не восстанавливал исходное устройство.

`coordinator_device_id` в server generation является автором конкретного MLS Commit,
а не постоянным primary/master device пользователя. Private state разных devices не
должен копироваться через server только ради выбора primary.

## Решение

Rust/OpenMLS boundary получает read-only `inspectConversation(conversation_id)` и
возвращает только:

```text
epoch
canonical sorted device_id roster
```

Он не возвращает private keys, ratchets, tree secrets, serialized group state,
wrapping key или sealed snapshot. Inspection не мутирует group и не увеличивает
local vault revision.

Когда application control checkpoint отсутствует:

1. client получает authoritative current generation и ordered READY history;
2. isolated Worker инспектирует sealed local group;
3. reconciliation ищет ровно одну server generation с теми же conversation, epoch
   и полным device roster;
4. только exact unique match создаёт локальный `ready` checkpoint;
5. все более новые Commit/Welcome применяются обычным ordered catch-up.

Если local group отсутствует, roster/epoch не совпадает или совпадение неоднозначно,
client возвращает typed `local-state-lost`. Direct send остаётся заблокированным:
synthetic-v1 fallback и silent identity regeneration запрещены.

Permanent primary device не вводится. При logout/revoke текущего coordinator server
фиксирует roster drift, а любой другой active leaf предыдущей READY generation может
стать coordinator следующего Commit. Если ни одного здорового старого leaf не осталось,
нужен явный re-enrollment flow новой device identity; password/server не могут
восстановить утраченные MLS secrets.

## Рассмотренные варианты

### Считать server READY достаточным

Отклонено: server не владеет private leaf state и не может доказать, что browser
способен шифровать/расшифровывать соответствующий epoch.

### Автоматически создавать новые keys под тем же device_id

Отклонено: public device identity immutable; silent replacement допускает identity
substitution и ломает ранее выданные KeyPackages/Welcome.

### Копировать один account master key/primary device state через server

Отклонено: это новая key-distribution architecture, расширяет последствия компрометации
server/account и не требуется для ремонта сохранившегося local group.

### Всегда требовать logout/login

Отклонено для partial loss: создаёт лишний device, меняет roster и теряет доступную
локальную continuity, хотя необходимые MLS secrets уже безопасно сохранены.

## Последствия и ограничения

- deploy/reload или очистка только control DB восстанавливаются без нового login;
- exact public epoch+roster comparison не ослабляет MLS authentication;
- metadata inspection остаётся внутри Worker protocol с закрытой схемой;
- полная очистка browser site data по-прежнему необратимо удаляет device-local keys;
- pre-enrollment history на новом device требует отдельного encrypted device-to-device
  archive transfer и этим решением не восстанавливается;
- explicit secure re-enrollment UX для полной потери vault остаётся отдельным slice.

## Проверки

- native Rust: missing/existing group, canonical roster и epoch;
- real WASM runtime: inspect после create/join без revision advance;
- Worker parser: exact public result и отказ при лишнем/private поле;
- application regression: потерянный control checkpoint восстанавливается, затем
  применяет следующий Commit;
- negative regressions: missing group и roster mismatch не создают READY state.
