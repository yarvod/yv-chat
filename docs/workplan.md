# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-041 — Native messenger viewport and conversation experience

Статус: **completed**
Backlog: `BL-041`
Цель: PWA ведёт себя как привычный нативный messenger на desktop/mobile: внешний
document не растёт от timeline, список/шапка/composer остаются на месте, работа с
длинной перепиской, клавиатурой и новыми сообщениями не ломает позицию пользователя.

### Инварианты

1. Authenticated shell занимает ровно visual viewport. На chat page скроллятся
   только conversation list и timeline; rail/header/composer не уезжают при любом
   количестве сообщений.
2. На desktop одновременно видны bounded sidebar и conversation pane. На mobile
   работает master/detail flow с URL-backed выбранным conversation и системным Back.
3. Global mobile tabs закреплены снизу только на top-level pages/list; в открытом
   разговоре они скрываются, освобождая место keyboard-safe composer.
4. Timeline автоматически держится снизу только если пользователь уже находился
   рядом с концом или сам отправил сообщение. Чтение истории не сбрасывается новым
   входящим событием; появляется явная кнопка возврата вниз.
5. Composer поддерживает bounded multiline auto-grow, Enter=send, Shift+Enter=newline,
   IME composition и safe-area/software-keyboard viewport без manual resize.
6. Conversation rows и message groups дают привычную hierarchy: поиск, avatar,
   timestamp, presence/unread, day separators, compact sender/time/delivery metadata.
7. Vue components остаются presentation-only; timeline grouping/formatting вынесены
   в typed presentation model, network/domain/crypto границы не смешиваются с UI.
8. Focus-visible, ARIA/live semantics, 44px touch targets, light/dark tokens и
   reduced-motion сохраняются. Telegram/WhatsApp служат interaction reference, но
   branding и точные visual assets не копируются.
9. Install metadata содержит стабильный app id/scope/start URL, отдельные `any` и
   `maskable` PNG 192/512, Apple touch icons и matching portrait launch screens.
   Критический знак maskable asset остаётся внутри W3C safe-zone, фон непрозрачен.
10. Большие Apple launch PNG выбираются media query и не входят все разом в
    Workbox precache; app shell/icon/WASM продолжают обновляться согласованно.

### План

- [x] Зафиксировать viewport/navigation/timeline/composer acceptance contract.
- [x] Перевести app/chat shell на bounded height + internal overflow containers.
- [x] Добавить URL-backed mobile master/detail и скрытие global tabs в conversation.
- [x] Улучшить conversation list search/metadata и reusable typed icons.
- [x] Добавить grouped timeline, non-jumping scroll и scroll-to-latest affordance.
- [x] Добавить bounded auto-growing keyboard/IME-aware composer.
- [x] Покрыть pure presentation model, Vue interactions и CSS layout contracts.
- [x] Выполнить physical browser QA mobile/desktop short+long states и полный CI.
- [x] Сверить install assets с W3C/Chromium/Apple requirements и создать brand masters.
- [x] Добавить exact-size standard/maskable/touch icons и portrait Apple launch screens.
- [x] Добавить manifest identity, standalone theme/head metadata и bounded precache.
- [x] Проверить размеры PNG, generated manifest/head и production PWA build.
- [x] Обновить architecture/backlog/bugs при необходимости; commit/push — финал.

### Definition of Done

- document height равен viewport на chat при 0 и при множестве сообщений;
- sidebar и timeline имеют независимый overflow, header/composer не меняют координаты;
- mobile list/conversation восстанавливаются из URL и browser Back;
- входящее сообщение не прыгает вниз во время чтения истории;
- textarea растёт только до заданного max и корректно отправляет с hardware keyboard;
- mobile 390×844, keyboard-sized viewport и desktop split layout проверены физически;
- generated manifest содержит отдельные `any`/`maskable` 192/512 icons, а каждый
  touch/splash asset существует с заявленным размером;
- Apple launch screens не раздувают offline precache, install shell совпадает с
  brand background/theme и сохраняет safe-area viewport;
- frontend tests/lint/typecheck/build и полный repository CI зелёные.
