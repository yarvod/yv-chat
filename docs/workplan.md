# Текущий workplan

## WP-141 — Музыкальный плеер и плейлист аудио в PWA

Статус: **production deployed**
Backlog: `BL-085`

Цель: аудиофайлы в сообщениях должны воспроизводиться внутри PWA как музыка, а не
только скачиваться. Пользователь получает один аккуратный плеер текущего чата,
последовательный плейлист, компактную панель и полноэкранный мобильный режим.

### Scope

- распознавать поддерживаемые audio MIME types и безопасный bounded набор audio
  extensions среди существующих `file` attachments;
- показывать аудиофайл в timeline отдельной музыкальной карточкой с play action;
- собирать плейлист из локально расшифрованного media index текущего conversation;
- держать один устойчивый HTML audio element при переключении compact/fullscreen UI;
- добавить play/pause, previous/next, seek, repeat, playback-rate и track queue;
- дать полноэкранный responsive player с safe-area и сворачиванием обратно в chat;
- интегрировать Media Session metadata/actions там, где browser/PWA это поддерживает;
- добавить audio в intentional system media picker composer-а.

### Security и privacy

- server media kind, upload/download, authorization, TTL и quota contracts не
  меняются: audio остаётся существующим opaque `file` attachment;
- direct filename/MIME/body получают только после MLS decrypt на client;
- playlist строится только из уже authorized/decrypted conversation history;
- object URLs создаются локально, отзываются при смене track/chat и не логируются;
- unsupported/expired audio имеет recoverable state и не обходит download gateway.

### Tests

- audio MIME/extension detection не принимает похожие произвольные документы;
- playlist сохраняет server sequence order и sender/chat metadata;
- timeline audio card запускает внешний chat player вместо download;
- player загружает exact attachment, переключает tracks, seek/repeat/rate и cleanup;
- compact/fullscreen/minimize/close UI и mobile-safe controls;
- Media Session capability fallback не ломает browser без API;
- frontend tests, lint, typecheck и production/PWA build.

### Exclusions

- streaming server endpoint, transcoding, waveform generation или server metadata
  extraction;
- отдельный глобальный музыкальный каталог между всеми chats;
- server-side album art/ID3 parsing и изменение E2EE content schema;
- обещание background playback там, где iOS/Android/browser прекращает PWA runtime;
- увеличение действующего 25 MiB generic-file limit.

### Definition of Done

- аудио запускается одним нажатием внутри timeline без скачивания;
- compact player продолжает тот же track после fullscreen/minimize;
- next/previous работают по audio playlist exact current conversation;
- смена conversation или close останавливает playback и освобождает object URL;
- desktop/mobile layout и automated frontend checks проходят.

### Result

- `audio/*`, `application/ogg` и bounded extension fallback получают отдельную
  timeline card, а composer media picker принимает audio без нового server kind;
- playlist собирается oldest-to-newest из authorized media index exact current
  conversation и использует только локально расшифрованные display metadata;
- один HTML audio element переживает compact/fullscreen/minimize, поддерживает
  seek, previous/next, repeat-one/all, playback rate и recoverable load/play errors;
- fullscreen queue адаптирована для desktop и 390×844 mobile viewport, включая
  safe-area header, touch controls и swipe-down minimize;
- Media Session изолирован application port + browser adapter; metadata, position,
  системные controls и unsupported fallback покрыты тестами;
- close, смена conversation, active call и component unmount останавливают playback,
  отменяют pending load и отзывают object URL;
- `73/73` frontend test files и `447/447` tests, ESLint, Nuxt typecheck и
  production/PWA build проходят; desktop/mobile browser QA не показала console errors.

### Production rollout

- feature commit `460e4702cf6166006c66be44dfbef1bcb86f6c77`;
- production workflow `33437977509` и CI workflow `33437977497` завершились
  успешно;
- immutable image tag `sha-460e4702cf6166006c66be44dfbef1bcb86f6c77`;
- обе production PWA и оба `/api/v1/health` отвечают `200`, TLS verification
  проходит.
