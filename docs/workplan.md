# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-063 — MLS-capable send roster consistency

Статус: **completed locally; production rollout pending**

Цель: direct MLS v2 send остаётся доступным, когда у каждого участника есть хотя
бы один active crypto-capable device, а дополнительный legacy device ещё не
зарегистрировал MLS identity и поэтому намеренно не входит в READY roster.

### Production reproduction

- production direct conversation имеет current generation `READY`, epoch и четыре
  required MLS leaves;
- три active devices одного участника и один crypto-capable device второго входят
  в roster;
- второй active Safari device второго участника никогда не зарегистрировал crypto identity,
  не имеет KeyPackage и не входит в roster;
- bootstrap считает current READY roster корректным, но message gate сравнивает его
  со всеми active devices и возвращает `409 MLS roster does not match active
  conversation devices`;
- online/offline presence участника не участвует в причине отказа.

### Scope

- [x] добавить regression, где READY roster содержит все active MLS-capable leaves,
  а active legacy device без identity не блокирует v2 send;
- [x] использовать один и тот же crypto-capable roster contract в bootstrap и
  send-time drift validation;
- [x] сохранить отказ после provisioning нового device, пока новый leaf не включён
  следующей READY generation;
- [x] сохранить отказ для revoked/missing sender leaf, stale generation/epoch и
  participant без единого active capable device;
- [x] добавить PostgreSQL-backed verification существующего repository wiring;
- [x] прогнать полный CI и PostgreSQL acceptance без чтения plaintext/keys.

### Local acceptance evidence

- точный production topology сначала упал с `ConversationCryptoNotReadyError` в
  прежнем all-active-devices message gate;
- после shared capable-roster fix `21` targeted application tests green;
- PostgreSQL `test_messages.py`: `2 passed`, включая legacy→provisioned transition;
- targeted Ruff и mypy по application/ports/infrastructure/tests green;
- полный `make ci`: backend `238 passed, 9 skipped`, Rust `21 passed`, frontend
  `214 passed`; lint, mypy, WASM/PWA build, Compose/deploy/docs contracts green;
- production данные, messages, ciphertext и private key material не изменялись.

### Security invariants

- backend принимает только exact current READY generation/epoch;
- sender обязан быть active required leaf;
- новый active device с зарегистрированной identity требует MLS rotation до send;
- legacy device без identity не получает ciphertext/Welcome и не считается leaf;
- у каждого active participant остаётся минимум один active crypto-capable leaf;
- никакого v2→v1 downgrade, server plaintext или изменения crypto primitives.

### Exclusions

- автоматическое provisioning чужого offline device;
- secure history transfer на новое устройство;
- удаление production devices или ручное изменение crypto rows;
- изменение group v1 policy.

### Definition of Done

- точный production topology воспроизводится красным regression до исправления;
- legacy non-capable device больше не вызывает ложный message `409`;
- новый capable leaf вне roster по-прежнему блокирует send до rotation;
- backend/full repository checks зелёные;
- исправление задокументировано и оформлено отдельным focused commit.
