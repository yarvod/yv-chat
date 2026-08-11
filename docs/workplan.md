# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-045 — OpenMLS KeyPackage validation and authenticated device provisioning

Статус: **completed**
Backlog: `BL-013`
Цель: каждый server-delivered KeyPackage до MLS group operation проверяется pinned
OpenMLS runtime внутри Worker, а current device identity автоматически и fail-closed
restore/provision/register-ится после authenticated startup.

### Инварианты

1. TypeScript не разбирает и не имитирует TLS serialization/подпись KeyPackage.
   Exact bytes передаются isolated Worker, где pinned OpenMLS 0.8.1 выполняет
   deserialize, signature validation и проверку MLS 1.0 + выбранного ciphersuite.
2. Validation связывает одновременно canonical target user/device credential,
   Ed25519 public key, device fingerprint, SHA-256 package reference и exact package
   bytes; trailing/corrupt/substituted data отвергаются fail closed.
3. Worker protocol — closed, versioned и bounded. Main thread получает только
   `{validated: true}` или bounded error code; private signer/provider/vault state
   не сериализуются и не возвращаются.
4. Authenticated startup сначала читает immutable server registration. Если она
   существует, разрешён только restore exact local identity — silent generation
   replacement запрещена. Если registration отсутствует, local identity сначала
   durable provisioned, затем public fields регистрируются idempotently.
5. Server response после register/get exact сравнивается с local public identity,
   а initial KeyPackage заново проверяется OpenMLS вместе с server package ref до
   состояния `ready`.
6. Missing/corrupt local state при существующей server identity, substitution,
   malformed package или Worker/storage failure оставляют crypto lifecycle в
   `unavailable`. UI показывает честное предупреждение; secure MLS operations не
   получают fallback.
7. Текущий synthetic message codec остаётся явно insecure и не становится E2EE от
   одной регистрации identity. MLS group/Welcome/Commit/message protection входят
   в `BL-014` и остаются release gate.

### План

- [x] Аудировать Rust/WASM Worker, server registry и KeyPackage claim contracts.
- [x] Добавить OpenMLS consumer validation с canonical identity/public anchors.
- [x] Расширить exact Worker protocol и typed application gateway/use cases.
- [x] Подключить restore/provision/register/compare/validate к authenticated layout.
- [x] Добавить visible fail-closed lifecycle state без synthetic downgrade.
- [x] Покрыть valid/corrupt/trailing/substitution, missing-state и registration races.
- [x] Обновить architecture/backlog/bugs/README и WASM build gates.
- [x] Прогнать полный CI, commit/push, production deploy и external smoke-test.

### Definition of Done

- claimed package нельзя передать будущему MLS group use case без OpenMLS validation;
- local/server user, device, credential, key, fingerprint, ref и bytes образуют одну
  проверяемую binding;
- reload восстанавливает прежнюю identity, а потеря local state не создаёт тихую
  replacement identity под зарегистрированным device;
- malformed Worker input/output и любой validation failure закрываются bounded error;
- authenticated PWA запускает lifecycle автоматически и не заявляет E2EE раньше
  реализации MLS group/message path;
- Rust/clippy/WASM, frontend lint/typecheck/Vitest/build и полный CI проходят.
