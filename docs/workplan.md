# Текущий workplan

## WP-107 — Symmetric callee video and orientation-aware fullscreen fit

Статус: **implemented and locally verified; physical two-device acceptance pending**
Backlog: `BL-036`, bug `BUG-095`

Цель: устранить случай, когда принимающий участник включает камеру и видит local
preview, но звонящий не получает его video track, а также не обрезать вертикальный
поток на горизонтальном экране до неудобного крупного crop.

### Подтверждённая причина

- caller заранее создаёт предложенный bidirectional video transceiver;
- callee до применения remote offer также создавал собственный transceiver;
- browser мог сопоставить remote offer с другим transceiver, пока service сохранял
  sender локально созданного и не участвующего в negotiated media section;
- `replaceTrack()` успешно включал локальную камеру, но track не доходил caller;
- fullscreen remote video всегда использовал `object-fit: cover`, поэтому сильно
  различающиеся media/viewport aspect ratios приводили к чрезмерному crop.

### Security invariants

- incoming SDP применяется только после прежней MLS device-binding verification;
- callee использует sender именно проверенного remote-offer transceiver и выставляет
  `sendrecv` до создания и MLS-подписи answer;
- новый signaling frame, renegotiation protocol или server-trusted camera flag не
  добавляются;
- camera capture остаётся explicit и local track освобождается на off/terminal state;
- orientation определяется только локально из размеров decoded video element.

### Scope

- caller продолжает создавать offer video transceiver заранее;
- callee после `setRemoteDescription(offer)` связывает camera sender с negotiated
  remote video transceiver до `createAnswer()`;
- legacy browser без `getTransceivers()` сохраняет прежний pre-created fallback;
- remote video использует `contain` при сильном несовпадении aspect ratio и `cover`
  при близком формате, пересчитывая fit на stream/viewport resize;
- unit/component regressions, lint, typecheck, frontend test suite и production build.

### Exclusions

- изменение MLS call binding, backend signaling state machine или coturn;
- server-side transcoding, forced orientation или фиксированное качество сети;
- production rollout до physical caller/callee acceptance.

### Definition of Done

- callee camera track устанавливается в sender transceiver из remote offer;
- caller path по-прежнему предлагает один `sendrecv` video transceiver;
- вертикальный remote stream целиком виден в горизонтальном viewport;
- совпадающий landscape stream продолжает заполнять экран;
- camera permission/cleanup и MLS tamper regressions остаются зелёными;
- frontend lint, typecheck, tests и production build проходят.

### Результат локальной проверки

- `voice-calls.test.ts`: callee не создаёт конкурирующий transceiver, выбирает
  negotiated remote video transceiver и устанавливает camera track в его sender;
- `voice-call-ui.test.ts`: portrait-in-landscape включает `contain`, matching
  landscape возвращает `cover`;
- in-app browser с настоящим synthetic `MediaStream`: desktop `1280×720` и mobile
  `390×844` корректно переключают fit для portrait/landscape без console errors;
- real browser offer/answer lifecycle подтверждает одинаковый video MID, `sendrecv`
  на обеих сторонах и late callee video track в negotiated sender; browser QA sandbox
  не поднимает ICE transport, поэтому packet delivery остаётся physical acceptance;
- frontend: `347 passed`, ESLint, Nuxt typecheck и production build зелёные.
