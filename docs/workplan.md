# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-052 — Existing-account second-device MLS enrollment hotfix

Статус: **in progress**
Bug: `BUG-053`

Цель: восстановить fail-closed добавление второго устройства в уже существующий
direct MLS conversation без потери истории, повторного использования KeyPackage
или необходимости пересоздавать диалог.

### Scope и security contract

- [ ] `BeginConversationCrypto` claim-ит KeyPackage нового leaf от имени реально
  выбранного старого coordinator, а не от имени request device.
- [ ] Новый device никогда не claim-ит собственный KeyPackage и не получает право
  создавать update Commit без состояния предыдущей READY generation.
- [ ] Новый device без previous-generation state создаёт fail-closed roster-change
  wake-up без claim; первое доступное старое leaf любого участника становится
  coordinator следующей pending generation.
- [ ] Создание pending generation публикует durable recipient-specific
  `conversation_updated`, чтобы coordinator увидел roster drift и завершил Commit.
- [ ] READY generation остаётся единственной разрешённой для direct send; pending,
  blocked и unavailable состояния не получают synthetic/plaintext fallback.
- [ ] Существующие v1/v2 message rows и локальные MLS states не мигрируются и не
  перезаписываются этим hotfix.
- [ ] UI отличает ожидающее добавление устройства от terminal local crypto failure и
  не создаёт ложного впечатления, что сообщение можно безопасно отправить.

### Tests и acceptance

- [ ] Backend regression: новый device участника при существующем READY roster не
  даёт 422, его package claim привязан к старому coordinator и generation pending.
- [ ] Coordinator election regression покрывает offline designated-device case:
  package остаётся unclaimed до запроса любого старого leaf.
- [ ] Durable sync/realtime notification будит coordinator и не содержит crypto bytes.
- [ ] Frontend regression сохраняет fail-closed composer/send и корректный pending label.
- [ ] Полный `make ci`, diff/secret review и production deploy зелёные.
- [ ] Реальный flow: второй телефон регистрирует identity, старый leaf завершает
  generation, телефон применяет Welcome и читает новое сообщение после enrollment.
- [ ] Старые pre-enrollment MLS v2 сообщения остаются честно недоступны новому device;
  старые v1 rows продолжают читаться exact-version decoder.

### Definition of Done

- второй device того же аккаунта входит в существующий direct chat без HTTP 422;
- после участия хотя бы одного старого leaf новый device получает READY и может
  безопасно отправлять/читать будущие v2 сообщения;
- сервер не раскрывает plaintext/private keys и не ослабляет MLS/send policy;
- исправление задеплоено и проверено на production metadata/logs и реальном device.
