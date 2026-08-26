# Текущий workplan

## WP-133 — Bounded QR history crypto pipeline

Статус: **implemented locally; production rollout pending**
Backlog: `BL-FIX-062`

Цель: реальный QR sync двух уже авторизованных devices должен завершать
двусторонний history union под общей production Nginx NAT-квотой, не создавать
request burst и не выполнять десятки полных OpenMLS/vault checkpoints для небольшого
архива.

### Production root cause

- pairing `539d9afc…` принял все `38` opaque chunks (`19 + 19`, около `695 KiB`),
  поэтому сервер и upload не были заблокированы;
- оба направления ACK-нули ровно первые четыре chunks первой беседы и остановились
  перед одинаковым пятым, самым крупным chunk; до пользовательского cancel ingress
  вернул `150 × 200`, `1 × 204`, `0 × 429`, затем ожидаемый `410`;
- v1 exporter дробил `230` доступных records на `19` MLS application messages в
  каждом направлении и отдельный completion marker на чат; каждый protect/unprotect
  выполнял encrypted crypto checkpoint;
- activity guard дополнительно вызывал relay GET почти на каждом внутреннем шаге
  подготовки каждого разговора, а uploads/ACKs не pace-ились вообще.

### Scope

- backward-compatible encrypted history payload `v4` пакует до `100` records в
  byte-bounded page (`190 KiB` records JSON), не меняя server plaintext boundary;
- stable отдельный `v3` completion marker сохраняет retry/resume semantics даже если
  peer import расширил локальный union между проходами;
- каждый relay upload/list/ACK получает `1250 ms` pacing; два peers за одним NAT
  остаются ниже `120r/m`, а server cancellation проверяется один раз до MLS prepare и
  затем обычными relay operations;
- local integrated Nginx зеркалит production `120r/m`, `burst=40`, чтобы regression
  ловил unpaced history traffic до deploy.

### Tests and result

- production-shaped unit: `230` records / `5` direct chats / два symmetric peers;
  полный union и ACK, `22` вместо `38` chunks, ни одного unpaced gateway call;
- прежний `1000` mixed stress: `600` direct records через relay + `400` group records
  через authoritative history, полный union, `16` вместо `40` chunks;
- legacy v1–v3 parsing, cancellation, retry, partial start и stable completion tests
  сохранены;
- изолированный Docker Compose + настоящий Browser QR offer → manual scanner fallback
  → SAS confirmation завершился `Готово` на двух независимых origins при включённом
  production-shaped Nginx limit; `429 = 0`, browser errors отсутствуют кроме
  ожидаемого camera-over-HTTP warning до manual fallback;
- временное QA-поле с QR payload удалено и не входит в production diff.

### Definition of Done

- full frontend tests, lint, typecheck, production/PWA build проходят в Docker;
- Compose config и local Nginx config валидны;
- production rollout exact immutable SHA успешен;
- новая physical попытка создаёт меньше chunks, ACK-ит оба направления и не повторяет
  export loop.
