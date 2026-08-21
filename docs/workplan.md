# Текущий workplan

## WP-115 — Keep-alive chat workspace across application tabs

Статус: **completed locally**
Backlog: `BL-FIX-055`; bug `BUG-103`

Цель: при переходе из чатов в настройки и обратно немедленно показывать уже
загруженный локальный список без нового bootstrap и loading spinner.

### Подтверждённая причина

- `/chat` и `/settings` используют общий app layout, но route component `/chat`
  размонтируется при каждом переходе;
- `ChatWorkspace` создаёт новый `useMessenger`, начальная фаза которого — `loading`;
- encrypted IndexedDB snapshot загружается cache-first, однако это асинхронная
  recovery path, а не сохранение уже существующего reactive state в RAM;
- unmount также останавливает realtime и уничтожает текущий browser call owner.

### Scope

- сохранить единственный `/chat` route instance в bounded Vue/Nuxt keep-alive cache;
- повторный вход в чаты не должен повторно запускать `messenger.load()` или показывать
  initial spinner;
- сохранить текущий conversation state, realtime owner и активный звонок при
  переходе в Settings;
- оставить первый запуск, reload, logout/session-expiry и encrypted IndexedDB
  recovery без изменений;
- добавить regression test для route lifecycle contract.

### Invariants

- server cursor sync остаётся authoritative, realtime не становится единственным
  источником данных;
- cache содержит только один chat route instance и не создаёт второй call/media owner;
- plaintext message content не добавляется в persistent storage или logs;
- logout/full reload по-прежнему уничтожает in-memory state;
- web и installed PWA используют одинаковый Nuxt lifecycle.

### Exclusions

- Capacitor/native wrapper, push transport и native call UI — следующий отдельный
  workplan/commit после завершения этого fix;
- изменение API, persistence schema, E2EE или server retention;
- глобальный keep-alive всех страниц приложения.

### Definition of Done

- `/chat` объявляет scoped keep-alive route contract;
- Settings → Chats возвращает существующий `ChatWorkspace` без повторного mount/load;
- frontend regression, lint, typecheck, tests и production build проходят;
- docs/diff/secret review выполнены, fix сохранён отдельным commit.

### Проверка

- targeted mobile-layout regression: `16 passed`;
- полный frontend Vitest: `361 passed`;
- ESLint, Nuxt typecheck и production build: успешно;
- persistence, API, E2EE и service-worker configuration не изменялись.
