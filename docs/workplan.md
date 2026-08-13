# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-077 — Retention-aligned MLS epoch continuity and device-logout isolation

Статус: **implemented and full-CI verified; production rollout pending**
(`BL-064`, `BUG-073`)

Цель: logout/relogin/revoke одного device не ломает чтение уже доступной E2EE-
истории на другом авторизованном device, а долго offline device догоняет
ещё хранящиеся server messages до необратимого MLS epoch advance.

### Scope

- direct-message decrypt не запускает скрытый roster reconciliation;
- перед каждым explicit reconciliation client постранично получает всю ещё
  retained server history, decrypts доступные current/old-epoch messages и сохраняет
  content только в device-local AES-GCM vault;
- новые OpenMLS group/join config используют bounded `max_past_epochs = 128`;
  это safety window, а не unlimited key archive, и он не отменяет pre-advance drain;
- existing groups с историческим `max_past_epochs = 0` защищаются pre-advance drain;
  уже выброшенные secrets без другой локальной копии не восстанавливаются;
- active/inactive conversation, startup, cursor reset и durable `conversation_updated` идут через
  один и тот же drain-before-advance flow;
- QR linking/history union остаются следующим отдельным slice `BL-015`: эта
  работа делает передаваемое состояние устойчивым.

### Security invariants

- server не получает plaintext, message key, past epoch secret или device-local storage key;
- removed device не decrypt-ит messages из epochs после Remove Commit;
- позднее добавленный device не получает pre-membership MLS secrets;
- повреждённый ciphertext не блокирует drain остальной retained history и не
  приводит к plaintext fallback;
- pagination обязана monotonic progress; malformed/non-progressing response fail closed;
- count-bounded past-epoch window дополняет, а не заменяет 30-day server TTL.

### Verification

- Rust regression: unread epoch-N ciphertext decrypts after a roster Commit and sealed-state reload;
- Rust security regression: removed leaf cannot decrypt future ciphertext;
- frontend protocol regression: decrypt never triggers reconciliation, send still requires READY;
- frontend orchestration regression: retained-history pages finish before active and inactive conversation
  reconciliation, including durable roster-change event;
- frontend lint/typecheck/tests/build, Rust fmt/clippy/tests and repository checks pass.

### Definition of Done

- reproduced logout/relogin sequence remains readable on the unaffected device without opening the chat first;
- subsequent deploy/service restart does not alter device-local MLS state or require peer presence;
- legacy groups survive future rotations once the fixed client has completed at least one pre-advance drain;
- limits and unrecoverable already-lost-history case are documented honestly;
- focused commit, CI and production acceptance complete before `BL-015` begins.
