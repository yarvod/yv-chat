# Текущий workplan

## WP-136 — Асимметричный QR history sync и cross-origin QR

Статус: **completed locally; production rollout pending**
Backlog: `BL-FIX-065`

Цель: новый пустой device и давно используемый device должны завершать один
bounded двусторонний history transfer независимо от разницы объёма локальных
архивов. QR между обоими production web origins должен приниматься без ослабления
проверки произвольных origins.

### Production evidence и root cause

- две последние authorized попытки `dcb673d2…` и `2fc43658…` создали по `11`
  chunks только `Android → Firefox`, охватили пять direct conversations и получили
  `0 ACK`; пустой Firefox не загрузил даже completion marker;
- Firefox при этом имел immutable MLS identity, восемь доступных KeyPackages и
  ACK-нул Welcome пяти READY generations. QR/login/server relay поэтому исправны;
- обе UI-стороны запускали `prepareTarget=true`. Они одновременно invalidated/reconcile
  одни и те же rosters, а transfer classifier проверял только server READY и не
  подтверждал, что local MLS vault текущего peer уже применил exact generation;
- login candidate сохранял job до navigation, но его выполнение зависело от
  one-shot crypto lifecycle; transient failure мог оставить queued job без recurring
  runner;
- production prerendered shell сериализует `devicePairingOrigins:""`: runtime env
  контейнера не попадает в статический `/`. Поэтому `chat.yoowee.ru` и
  `chat.yoowee.com.de` доверяли только собственному origin и отклоняли QR друг друга.

### Scope

- зафиксировать оба production web origins и native origins в build-time public
  config, сохранив exact allowlist и rejection произвольного origin;
- только trusted/display peer выполняет target enrollment; candidate/scanner не
  запускает второй concurrent roster mutation;
- перед export/import каждый peer invalidates local cached READY и reconciles exact
  current generation; server roster и local generation должны совпасть;
- запуск persisted history jobs не должен навсегда зависеть от успешности одного
  foreground roster refresh;
- добавить asymmetric regression: много direct chats, source с большой историей,
  target с нулём records, symmetric completion markers и ACK всех chunks;
- проверить группы отдельно: retained group history приходит authoritative API sync;
  не выдавать non-E2EE group server fetch за MLS device-to-device relay.

### Tests

- QR parser/config: оба production domains принимают QR друг друга из prerendered
  shell; чужой origin отклоняется;
- component contracts: trusted side `prepareTarget=true`, new/existing candidate
  `prepareTarget=false`;
- history service: local generation barrier обязателен до protect/unprotect;
- large asymmetric union: не менее 20 direct conversations и 1 000 records только
  на source, empty target отправляет completion markers, обе стороны complete;
- Docker Browser QA: два отдельных origins/profiles, реальный QR, большой dataset,
  новый пустой device, финальные counters и cold reopen target;
- frontend full suite/lint/typecheck/build и Compose config.

### Exclusions

- не переносить plaintext или session credential через server;
- не ослаблять QR origin check до «любой https origin»;
- не обещать device relay для старых group records вне server retention до group E2EE;
- не добавлять Redis/queue service для 10–15 пользователей.

### Definition of Done

- production evidence объяснён точным client state transition;
- asymmetric tests красные до исправления и зелёные после;
- реальный empty-target Browser QR transfer завершает все ACK без ручного цикла;
- production rollout и runtime verification проходят.

### Result

- prerendered PWA shell теперь получает exact build-time allowlist для
  `chat.yoowee.ru`, `chat.yoowee.com.de` и native origins; local Compose передаёт
  deployment allowlist также как Docker build arg;
- trusted/display peer единолично enroll-ит target, а new/existing candidate
  запускает relay с `prepareTarget=false`;
- новый classifier invalidates cached READY, reconciles local MLS vault и разрешает
  relay только при exact совпадении server/local generation number, ID и epoch;
- persisted history runner стартует сразу после crypto ready и больше не теряется
  из-за transient ошибки best-effort foreground roster refresh;
- Docker regression перенёс `1 000` records через `20` direct chats и `2` groups:
  empty target импортировал `800` direct records, сохранил `200` authoritative group
  records и отправил `20` completion markers;
- настоящий Browser QR прошёл между `localhost`, `127.0.0.1` и чистым IPv6 origin:
  QR был снят как screenshot и декодирован в Docker; source с `100` реальными MLS
  messages отправил data + completion, empty target отправил completion, все `3/3`
  chunks ACK-нуты; target показал `100/100`, `0` corrupt до и после reload;
- frontend Docker checks: production/PWA build, typecheck, changed-file lint,
  targeted `37/37`, полный suite `428/428`; Compose config валиден. Общий lint
  продолжает видеть только ранее сгенерированные Android `build/intermediates`
  artifacts, изменённые файлы проходят без замечаний.
