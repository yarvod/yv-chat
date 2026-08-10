# Private Messenger

Закрытый self-hosted мессенджер для небольшой доверенной группы пользователей (ориентир: 10–15 человек).

Основные цели проекта:

- PWA-клиент на Nuxt/Vue/TypeScript;
- backend на FastAPI;
- Clean Architecture;
- регистрация только через администратора;
- end-to-end encryption: сервер не должен иметь возможность читать содержимое сообщений и вложений;
- текст, изображения, видео и файлы;
- realtime-доставка через WebSocket;
- offline sync;
- ограниченное время хранения сообщений и особенно медиа;
- работа на дешёвом VPS: ориентир 2 GB RAM и 30–40 GB диска;
- Docker Compose;
- Nginx + HTTPS;
- GitHub Actions;
- в перспективе — голосовые и видеозвонки через WebRTC.

> **Статус:** проект проектируется с нуля. В первую очередь реализуется безопасный и надёжный messaging core. Звонки добавляются после стабилизации сообщений, синхронизации и E2EE.

---

## 1. Главные архитектурные решения

### 1.1. Не микросервисы

Для 10–15 пользователей проект намеренно остаётся компактным:

- один backend;
- один PostgreSQL;
- один Nginx;
- файловое хранилище на диске VPS;
- один cleanup-процесс/задача;
- без Kafka;
- без RabbitMQ;
- без Celery на старте;
- без Redis до появления реальной необходимости;
- без MinIO/S3 на старте.

Это уменьшает RAM, количество точек отказа и сложность эксплуатации.

### 1.2. PostgreSQL — source of truth для server sync window

WebSocket используется для realtime-событий, но не является единственным источником данных.

Клиент всегда должен уметь восстановить состояние после:

- разрыва WebSocket;
- сна телефона;
- потери сети;
- перезапуска PWA;
- временной недоступности backend.

Поэтому сообщения и события синхронизируются через устойчивый cursor/sequence API.

После успешной синхронизации устройство может хранить локальную encrypted history дольше server retention. PostgreSQL остаётся authoritative для server-side sync/events в пределах retention window, но не обязан быть вечным архивом всей переписки.

### 1.3. Сервер не владеет ключами сообщений

На сервер не отправляется plaintext сообщений или расшифрованных файлов.

Сервер хранит:

- ciphertext;
- публичные криптографические данные, необходимые протоколу;
- ID;
- timestamps;
- conversation membership;
- минимально необходимые служебные metadata;
- encrypted attachments.

Сервер **не должен** хранить:

- plaintext сообщения;
- plaintext вложения;
- message encryption keys;
- пароли пользователей;
- приватные identity keys устройств.

### 1.4. User и Device — разные сущности

Один пользователь может иметь несколько устройств:

```text
User
├── Device: phone
├── Device: laptop
└── Device: browser profile
```

Криптографическая идентичность привязана к устройству, а не только к аккаунту.

### 1.5. Криптографический протокол не изобретаем

Запрещено проектировать собственный messaging crypto protocol из комбинации AES/X25519/HKDF и считать его безопасным.

Для E2EE необходимо использовать зрелый, документированный протокол/реализацию.

Предпочтительное направление для исследования:

- MLS / OpenMLS + WASM для браузерного клиента;

допустимы другие решения, если они проходят отдельный security review.

Отдельное шифрование вложений выполняется на клиенте до upload.

---

# 2. Целевая схема

```text
┌───────────────────────────────┐
│ Nuxt PWA                      │
│                               │
│ Vue / TypeScript              │
│ IndexedDB                     │
│ Service Worker                │
│ E2EE                          │
│ WebSocket                     │
│ Web Push                      │
└───────────────┬───────────────┘
                │ HTTPS / WSS
                ▼
┌───────────────────────────────┐
│ Nginx                         │
│ TLS                           │
│ reverse proxy                 │
│ upload limits                 │
│ security headers              │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│ FastAPI                       │
│                               │
│ REST API                      │
│ WebSocket gateway             │
│ Auth / sessions               │
│ Message routing               │
│ Attachment metadata           │
│ Push notifications            │
└───────────┬───────────┬───────┘
            │           │
            ▼           ▼
┌────────────────┐   ┌──────────────────┐
│ PostgreSQL     │   │ encrypted media  │
│                │   │ /data/media      │
└────────────────┘   └──────────────────┘

┌───────────────────────────────┐
│ cleanup                       │
│ delete expired rows/files     │
└───────────────────────────────┘
```

В будущем:

```text
FastAPI WebSocket
      │
      │ signaling
      ▼
WebRTC peer <──────> WebRTC peer
      │
      └──── TURN fallback (coturn)
```

---

# 3. Рекомендуемый стек

## Backend

- Python 3.13+
- FastAPI
- Pydantic
- SQLAlchemy 2.x
- Alembic
- PostgreSQL
- asyncpg
- pytest
- pytest-asyncio
- Ruff
- mypy

## Frontend

- Nuxt
- Vue 3
- TypeScript
- Pinia
- IndexedDB
- Service Worker
- PWA
- Web Crypto / WASM crypto layer

## Infrastructure

- Docker
- Docker Compose
- Nginx
- Let's Encrypt
- GitHub Actions
- GHCR
- Linux VPS

## Позже

- coturn
- WebRTC
- native wrapper, если PWA-ограничения для звонков станут проблемой

---


## Python dependency management: только `uv`

Для Python в проекте используется **только `uv`** как основной dependency/environment manager.

Source of truth:

```text
backend/pyproject.toml
backend/uv.lock
```

Не использовать для обычного project workflow:

```text
pip install ...
pip freeze
requirements.txt как основной dependency source
Poetry
Pipenv
pip-tools
virtualenv вручную
```

Если какой-то внешний Docker/base-image сценарий технически требует `pip`, это должно быть локальным infrastructure detail и не заменять `uv` как project-level dependency manager.

### Основные команды

Установка/синхронизация окружения:

```bash
cd backend
uv sync
```

Запуск Python-команд:

```bash
uv run python -m messenger
uv run pytest
uv run mypy .
uv run ruff check .
uv run ruff format --check .
uv run alembic upgrade head
```

Добавить runtime dependency:

```bash
uv add <package>
```

Добавить dev dependency:

```bash
uv add --dev <package>
```

Удалить dependency:

```bash
uv remove <package>
```

Обновить lockfile:

```bash
uv lock
```

Обновить конкретную зависимость:

```bash
uv lock --upgrade-package <package>
```

### Lockfile

`uv.lock` коммитится в Git.

CI, локальная разработка и Docker build должны по возможности использовать один и тот же lockfile, чтобы окружение было воспроизводимым.

Не редактировать `uv.lock` вручную.

После изменения Python dependencies:

```text
pyproject.toml
    ↓
uv lock / uv add / uv remove
    ↓
uv.lock
```

оба релевантных файла должны попасть в commit.

### CI

Backend checks в CI запускаются через `uv run`:

```bash
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest
```

`--frozen` нужен, чтобы CI не молча пересоздавал lockfile.

### Docker

Production Dockerfile также должен использовать `uv` и `uv.lock`.

Общий принцип:

```text
copy pyproject.toml + uv.lock
        ↓
uv sync --frozen --no-dev
        ↓
copy application source
```

Конкретная оптимизация Docker layer/cache выбирается по актуальной структуре backend, но dependency resolution не должен внезапно переключаться на другой package manager.

### Makefile

Высокоуровневые команды могут скрывать `uv`, например:

```bash
make backend-install
make backend-test
make backend-lint
```

но внутри они должны вызывать `uv sync` / `uv run`, а не отдельный `pip` workflow.


# 4. Предлагаемая структура репозитория

```text
.
├── AGENTS.md
├── README.md
├── compose.yml
├── compose.dev.yml
├── .env.example
├── .gitignore
├── Makefile
│
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── migrations/
│   ├── tests/
│   └── src/
│       └── messenger/
│           ├── domain/
│           │   ├── entities/
│           │   ├── value_objects/
│           │   ├── events/
│           │   └── exceptions/
│           │
│           ├── application/
│           │   ├── commands/
│           │   ├── queries/
│           │   ├── use_cases/
│           │   └── ports/
│           │
│           ├── infrastructure/
│           │   ├── persistence/
│           │   ├── storage/
│           │   ├── auth/
│           │   ├── push/
│           │   └── crypto/
│           │
│           ├── presentation/
│           │   ├── http/
│           │   └── websocket/
│           │
│           └── bootstrap/
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── nuxt.config.ts
│   ├── app/
│   ├── components/
│   ├── composables/
│   ├── stores/
│   ├── services/
│   ├── crypto/
│   └── tests/
│
├── deploy/
│   ├── nginx/
│   └── scripts/
│
└── .github/
    └── workflows/
        ├── ci.yml
        └── deploy.yml
```

Если backend или frontend со временем потребуют собственных особых инструкций для coding-agent, можно добавить вложенные `AGENTS.md` в соответствующие директории.

---

# 5. Пошаговый план разработки

Ниже порядок, в котором рекомендуется строить проект. Не перескакивать сразу к звонкам и сложным UI-фичам.

---

## Этап 0. Создать репозиторий и базовую дисциплину

Создать:

```text
README.md
AGENTS.md
.gitignore
.env.example
compose.yml
compose.dev.yml
Makefile
backend/
frontend/
deploy/
.github/workflows/
```

Правила с первого коммита:

- никакие secrets не коммитятся;
- `.env` находится в `.gitignore`;
- публичные параметры документируются в `.env.example`;
- backend и frontend имеют lint/typecheck/test команды;
- CI запускается на каждом PR;
- main/master не должен становиться местом случайных экспериментов.

Пример `.env.example`:

```dotenv
APP_ENV=development
APP_DOMAIN=localhost

POSTGRES_DB=messenger
POSTGRES_USER=messenger
POSTGRES_PASSWORD=change-me

DATABASE_URL=postgresql+asyncpg://messenger:change-me@postgres:5432/messenger

ACCESS_TOKEN_TTL_MINUTES=10
REFRESH_TOKEN_TTL_DAYS=30

MEDIA_ROOT=/data/media
MEDIA_MAX_BYTES=157286400
```

Никаких реальных production secrets в этом файле.

---

## Этап 1. Поднять local development environment

Минимальные контейнеры:

```text
postgres
backend
frontend
nginx — можно добавить чуть позже
```

Для разработки допустимо запускать backend/frontend на host, а PostgreSQL — через Compose.

Цель этапа:

```bash
docker compose -f compose.dev.yml up -d postgres
```

после чего:

```bash
make backend-dev
make frontend-dev
```

должны запускать приложение.

Добавить healthcheck:

```http
GET /api/health
```

Ответ:

```json
{
  "status": "ok"
}
```

---

## Этап 2. Создать backend skeleton по Clean Architecture

Dependency direction:

```text
presentation
     ↓
application
     ↓
domain

infrastructure
     ↓
application ports
```

### Domain не знает про:

- FastAPI;
- SQLAlchemy;
- PostgreSQL;
- HTTP;
- WebSocket;
- Docker;
- конкретную crypto-библиотеку.

### Application содержит:

- use cases;
- ports/interfaces;
- команды;
- queries;
- orchestration.

### Infrastructure содержит:

- SQLAlchemy repositories;
- PostgreSQL;
- file storage;
- push provider;
- auth implementation;
- crypto adapters, если серверная криптография нужна для auth/infrastructure.

### Presentation содержит:

- HTTP routes;
- request/response schemas;
- WebSocket protocol mapping.

---

## Этап 3. Базовая модель данных

Начать минимум с:

```text
users
devices
sessions
refresh_tokens

conversations
conversation_members

messages
attachments

message_receipts
push_subscriptions
```

### users

Пример полей:

```text
id
username
display_name
password_hash
is_admin
is_active
created_at
updated_at
```

### devices

```text
id
user_id
name
created_at
last_seen_at
revoked_at
```

Crypto-specific columns добавляются после окончательного выбора E2EE protocol.

### conversations

```text
id
type
created_by
created_at
updated_at
```

Типы:

```text
direct
group
```

### conversation_members

```text
conversation_id
user_id
role
joined_at
left_at
```

### messages

```text
id
conversation_id
sender_user_id
sender_device_id

ciphertext
protocol_version

sequence
created_at
expires_at
deleted_at
```

В таблице **не должно быть**:

```text
text
plaintext
decrypted_body
message_key
```

### attachments

```text
id
message_id
storage_key
content_type
size_bytes
encrypted_size_bytes
created_at
expires_at
deleted_at
```

Не доверять filename клиента как пути на файловой системе.

---

## Этап 4. Миграции

Использовать Alembic.

Правила:

- изменение схемы = миграция;
- не редактировать уже применённую production migration;
- migration должна иметь понятный upgrade/downgrade, если downgrade возможен безопасно;
- миграции должны прогоняться в CI;
- приложение не должно само молча создавать таблицы через `metadata.create_all()` в production.

Команда:

```bash
alembic upgrade head
```

---

# 6. Аутентификация и закрытая регистрация

Свободной регистрации нет.

## Создание пользователя

Flow:

```text
Admin
  ↓
Create user
  ↓
one-time activation token/link
  ↓
User opens link
  ↓
sets password / enrolls credential
  ↓
activation token becomes invalid
```

Админ API не должен позволять пользователю самостоятельно назначить себя администратором.

---

## Пароли

Пароли:

- никогда не логируются;
- никогда не хранятся в plaintext;
- не отправляются в аналитические системы;
- хэшируются современным password hashing algorithm, например Argon2id.

---

## Сессии, cookies и JWT

Для этого проекта **JWT не является обязательным и не является предпочтительным способом browser session**.

PWA и FastAPI работают за одним Nginx/origin, поэтому базовый вариант:

```text
Browser
   │
   │  HttpOnly session cookie
   ▼
FastAPI
   │
   ▼
PostgreSQL sessions
```

### Предпочтительная схема: opaque server-side session

При login backend генерирует криптографически случайный session token.

В browser он хранится только как cookie:

```text
__Host-messenger_session=<opaque random token>
```

Cookie:

```text
Secure
HttpOnly
SameSite=Strict
Path=/
без Domain
```

JavaScript не должен иметь возможность прочитать session token.

На сервере исходное значение token не хранится. В PostgreSQL сохраняется только hash/derived lookup value:

```text
sessions
├── id
├── user_id
├── device_id
├── token_hash
├── created_at
├── last_seen_at
├── idle_expires_at
├── absolute_expires_at
├── revoked_at
└── revoke_reason
```

Преимущества для нашего масштаба:

- никакого bearer JWT в `localStorage`;
- никакого JWT в IndexedDB;
- мгновенный logout/revoke конкретного device;
- простая блокировка украденной/подозрительной session;
- сервер в любой момент знает, активна ли session;
- один indexed lookup PostgreSQL на request для 10–15 пользователей не является проблемой;
- WebSocket может аутентифицироваться той же same-origin cookie.

### CSRF

`HttpOnly` cookie защищает от прямого чтения session token JavaScript-кодом, но cookie автоматически отправляется браузером, поэтому state-changing HTTP endpoints должны иметь CSRF-защиту.

Минимальная политика:

- `SameSite=Strict`;
- проверка `Origin` для unsafe requests;
- строгий allowlist origin;
- custom CSRF/request header для state-changing API;
- CORS не должен разрешать произвольные origins;
- WebSocket handshake также проверяет `Origin`.

Если архитектура изменится и frontend/API окажутся на разных sites, CSRF/CORS policy нужно пересмотреть отдельно.

### WebSocket

Не передавать auth token так:

```text
wss://chat.example/ws?token=...
```

Query string может попасть в logs/history/diagnostics.

Для same-origin PWA browser отправит подходящую secure cookie во время WebSocket handshake.

Backend:

```text
validate Origin
↓
resolve session cookie
↓
verify session is active
↓
bind websocket to user_id + device_id
```

При revoke устройства связанные WebSocket connections должны закрываться либо перестать проходить последующую authorization/session validation.

### Session lifetime

Рекомендуемый старт:

```text
idle timeout:      30 days
absolute lifetime: 90 days
```

Значения конфигурируются.

Любое из событий:

```text
logout
device revoke
password/security reset
detected session compromise
admin revoke
```

может немедленно поставить `revoked_at`.

### Активные устройства и управление сессиями

Каждая browser session обязательно привязана к конкретному `device_id`.

Это позволяет сделать экран:

```text
Настройки
└── Устройства
    ├── Этот iPhone · Safari
    │   Amsterdam, NL
    │   203.0.113.x
    │   Сейчас онлайн
    │
    ├── MacBook · Chrome
    │   Amsterdam, NL
    │   203.0.113.x
    │   12 минут назад
    │
    └── Windows PC · Firefox
        Berlin, DE
        198.51.100.x
        3 дня назад
```

И действия:

```text
Завершить эту сессию
Завершить выбранную сессию
Завершить все остальные сессии
Переименовать устройство
```

#### Модель `devices`

Пример:

```text
devices
├── id
├── user_id
├── display_name
├── device_class
├── browser_family
├── browser_version
├── os_family
├── os_version
├── device_model
├── first_seen_at
├── last_seen_at
├── revoked_at
└── created_at
```

`display_name` — пользовательское/нормализованное имя вроде:

```text
My iPhone
MacBook
Work PC
```

Ему нужно доверять больше, чем попытке всегда угадать точную аппаратную модель из браузера.

#### Что можно определить автоматически

При login/device enrollment сохранять best-effort metadata:

```text
browser family/version
OS family/version
mobile/desktop/tablet class
device model — только если browser реально предоставляет
User-Agent / Client Hints-derived normalized fields
```

Точную модель устройства **нельзя считать гарантированно доступной**.

Современные браузеры намеренно ограничивают passive fingerprinting. Поэтому UI должен корректно работать даже если мы знаем только:

```text
Safari on iPhone
Chrome on Android
Chrome on macOS
Firefox on Windows
```

а не точный SKU телефона/ноутбука.

Не строить security decisions на распознанной строке browser/model.

#### IP-адрес

Для session/device можно хранить:

```text
login_ip
last_ip
```

В PostgreSQL предпочтительно использовать тип `inet`.

IP брать только из доверенной proxy chain.

Production traffic:

```text
Internet
   ↓
Nginx
   ↓
FastAPI
```

FastAPI не должен безусловно доверять произвольному `X-Forwarded-For`, пришедшему непосредственно от клиента.

Nginx формирует/нормализует forwarding headers, а приложение доверяет им только потому, что доступ к backend разрешён через наш reverse proxy.

В UI полный IP можно показывать владельцу аккаунта, либо маскировать:

```text
203.0.113.42
```

или:

```text
203.0.113.x
```

в зависимости от выбранной privacy policy.

#### Примерная геолокация по IP

Можно показывать:

```text
Amsterdam, Netherlands
Berlin, Germany
```

через отдельный `GeoIPResolver` infrastructure adapter.

```text
application
    ↓
GeoIPResolver

infrastructure
    ├── local GeoIP database
    └── external provider — only if explicitly chosen
```

Не делать внешний GeoIP API обязательным для каждого request.

GeoIP lookup лучше выполнять:

```text
login
new IP
significant session update
```

а не на каждом HTTP запросе.

Сохранять можно snapshot:

```text
last_country_code
last_region
last_city
geo_updated_at
```

IP-geolocation является приблизительной.

Она может показывать:

- ISP exit location;
- mobile carrier gateway;
- VPN;
- proxy;
- корпоративную сеть;

поэтому UI должен писать примерно:

```text
Amsterdam, Netherlands · приблизительно
```

Это **не GPS location** и не должно использоваться как доказательство физического местоположения пользователя.

Не запрашивать browser Geolocation API/GPS только ради списка сессий.

#### Last online

`last_seen_at` обновляется при подтверждённой активности authenticated device:

```text
authenticated HTTP activity
WebSocket connect
WebSocket heartbeat/activity
successful sync
```

Не делать `UPDATE sessions SET last_seen_at=...` на каждый запрос.

Использовать throttling, например обновлять persisted `last_seen_at` не чаще одного раза в 1–5 минут на session/device.

Realtime UI:

```text
active WebSocket
    -> online now

no active WebSocket
    -> last seen <timestamp>
```

Presence остаётся best-effort.

После crash/network loss сервер может некоторое время считать connection активным до heartbeat timeout.

#### Session audit metadata

Для security UI полезно хранить отдельно session-level metadata:

```text
sessions
├── id
├── user_id
├── device_id
├── token_hash
├── created_at
├── last_seen_at
├── login_ip
├── last_ip
├── login_country_code
├── login_city
├── last_country_code
├── last_city
├── user_agent_hash/raw_or_normalized_policy
├── idle_expires_at
├── absolute_expires_at
├── revoked_at
└── revoke_reason
```

Не обязательно бессрочно хранить полный raw User-Agent и историю каждого IP.

Для MVP достаточно:

- login metadata;
- last-seen metadata;
- текущая session state.

Если позже нужен security audit trail, делать отдельную bounded-retention таблицу `security_events`, например:

```text
new_device_login
session_revoked
session_ip_changed
session_location_changed
session_credential_replay
password_changed
device_added
suspicious_session_use
```

#### API

Добавить:

```text
GET    /api/v1/devices
PATCH  /api/v1/devices/{device_id}
DELETE /api/v1/devices/{device_id}

GET    /api/v1/sessions
DELETE /api/v1/sessions/{session_id}
POST   /api/v1/sessions/revoke-others
```

`GET /api/v1/sessions` возвращает только сессии текущего пользователя, если это не отдельный admin/security use case.

Ответ не содержит `token_hash` или session credential.

Пример:

```json
{
  "id": "019...",
  "device_id": "019...",
  "device_name": "My iPhone",
  "browser": "Safari",
  "os": "iOS",
  "model": null,
  "ip": "203.0.113.x",
  "location": {
    "city": "Amsterdam",
    "country_code": "NL",
    "approximate": true
  },
  "created_at": "2026-08-10T19:20:00Z",
  "last_seen_at": "2026-08-10T21:42:00Z",
  "is_current": true,
  "is_online": true
}
```

### Почему server-side session здесь лучше JWT

JWT — это прежде всего формат подписанного token, а не отдельный способ безопасно хранить browser session.

JWT тоже можно положить в `HttpOnly` cookie, поэтому сравнение:

```text
cookie vs JWT
```

не совсем корректно.

Для нашего проекта реальное сравнение:

```text
opaque server-side session
vs
self-contained signed access JWT
```

#### Opaque session

Browser:

```text
random opaque session id
```

Server:

```text
hash(session id)
    ↓
PostgreSQL
    ↓
current user/device/session state
```

Плюсы именно для этого мессенджера:

- мгновенный revoke конкретного device/session;
- экран активных сессий получается естественно;
- logout-all-other-devices прост;
- role/device/session state не остаётся устаревшим внутри уже выпущенного token;
- можно сразу блокировать revoked device;
- credential не нужно отдавать JavaScript;
- проще расследовать подозрительный login;
- меньше crypto/token protocol complexity;
- при 10–15 users DB lookup не создаёт масштабной проблемы.

Минус:

```text
каждый authenticated request
    -> server session lookup/cache
```

Для нашей нагрузки это нормальный trade-off.

#### Self-contained JWT

JWT позволяет resource server проверить подпись и claims без чтения server-side session row для каждого request.

Это полезнее при:

```text
many independent services
multiple resource servers
distributed API
external API consumers
```

Но появляются trade-offs:

- уже выпущенный JWT обычно живёт до `exp`;
- мгновенный revoke требует дополнительного denylist/session lookup либо очень короткого TTL;
- claims могут устареть;
- key rotation/signing policy сложнее;
- frontend всё равно должен безопасно хранить credential;
- для списка устройств всё равно обычно потребуется server-side session/device state.

То есть JWT не устраняет БД состояния, если нам нужны:

```text
device revoke
logout all
active device list
security events
refresh rotation
```

Поэтому для нашего single-backend messenger opaque server-side session является более простой моделью.

### Renewal, idle timeout и rotation session credential

У opaque server-side session нет отдельного `refresh token`, как в классической JWT-схеме.

Сессия живёт по двум независимым ограничениям:

```text
idle_expires_at
absolute_expires_at
```

Рекомендуемые стартовые значения:

```text
idle timeout:       30 days
absolute lifetime:  90 days
```

#### Sliding idle timeout

Пока пользователь действительно пользуется приложением, `idle_expires_at` можно продлевать:

```text
login
    ↓
idle_expires_at = now + 30 days
absolute_expires_at = now + 90 days
```

Позже:

```text
meaningful authenticated activity
    ↓
idle_expires_at = now + 30 days
```

Но:

```text
absolute_expires_at
```

не сдвигается.

Когда наступает absolute expiry, пользователь должен пройти полноценный login снова.

Это не позволяет однажды украденной session credential жить бесконечно только потому, что её продолжают использовать.

#### Что считать activity

Подходящие события:

```text
successful sync
send message
open/load conversation data
authenticated API interaction
explicit user activity
```

WebSocket heartbeat сам по себе не должен автоматически продлевать session бесконечно.

Heartbeat можно использовать для:

```text
connection liveness
online presence
best-effort last_seen
```

но не как единственную причину продления authentication lifetime.

#### Throttled touch

Не обновлять `last_seen_at` и `idle_expires_at` в PostgreSQL на каждом HTTP request.

Использовать throttling, например:

```text
persist last_seen/session touch
не чаще одного раза в 3 minutes
```

Пример:

```python
if session.last_persisted_activity_at < now - timedelta(minutes=3):
    await session_repository.touch(
        session_id=session.id,
        last_seen_at=now,
        idle_expires_at=now + SESSION_IDLE_TIMEOUT,
    )
```

Для realtime presence можно держать более свежую ephemeral информацию в памяти процесса, не записывая её постоянно в БД.

#### Rotation session credential

Сам opaque token тоже можно периодически заменять новым.

Логическая session остаётся той же:

```text
session_id
user_id
device_id
```

но browser credential меняется:

```text
old random token
        ↓
new random token
```

Стартовая политика:

```text
rotate after: 24 hours
```

Rotation не является обязательной для первого bootstrap-релиза, но архитектура должна её позволять.

Таблица session может содержать:

```text
sessions
├── id
├── user_id
├── device_id
│
├── current_token_hash
├── previous_token_hash
├── previous_token_valid_until
├── token_rotated_at
│
├── created_at
├── last_seen_at
├── last_persisted_activity_at
│
├── idle_expires_at
├── absolute_expires_at
│
├── login_ip
├── last_ip
│
├── revoked_at
└── revoke_reason
```

На сервере хранятся только hash/derived lookup values token.

#### Grace period при rotation

Нельзя при rotation мгновенно инвалидировать предыдущий token без учёта параллельных browser requests.

Пример:

```text
GET /me
GET /conversations
GET /sync
```

могут одновременно стартовать со старой cookie.

Если первый request успел сделать rotation, остальные не должны случайно получить `401`.

Поэтому после rotation:

```text
current_token_hash
    -> новый token

previous_token_hash
    -> старый token

previous_token_valid_until
    -> now + 60 seconds
```

Стартовый grace period:

```text
60 seconds
```

Предыдущий token в grace period:

- может завершить уже начавшиеся параллельные requests;
- не создаёт новую session;
- после grace period больше не принимается.

Rotation должна быть atomic/transaction-safe, чтобы два конкурентных request не создали несколько независимых новых credentials.

#### Проверка session на request

Логически:

```text
read HttpOnly cookie
        ↓
hash credential
        ↓
find active session by current hash
        │
        └── or previous hash inside grace period
        ↓
check revoked_at
        ↓
check idle_expires_at
        ↓
check absolute_expires_at
        ↓
authorize user/device
```

Если session expired/revoked:

```text
401 Unauthorized
+
clear session cookie where appropriate
```

PWA показывает повторный login.

#### Когда rotation делается

Не нужен отдельный frontend timer `refreshSession()` каждые N минут.

Rotation можно выполнять opportunistically на обычном authenticated request, если:

```text
now - token_rotated_at >= rotation interval
```

Backend возвращает новый `Set-Cookie`.

Для клиента это прозрачно.

### Смена IP, сети, города и browser metadata

IP и GeoIP являются **security metadata, а не authentication factor**.

Нормальные сценарии смены IP:

```text
Wi-Fi -> LTE/5G
home Wi-Fi -> office Wi-Fi
mobile carrier NAT changes
ISP reconnect
IPv4 <-> IPv6
VPN on/off
travel
```

Поэтому:

```text
IP changed
```

**не означает автоматически:**

```text
revoke session
force logout
block user
```

Аналогично небольшое изменение User-Agent/browser version после обновления браузера не должно ломать session.

#### Что делать при обычной смене IP

Если active session пришла с нового IP:

```text
validate session normally
        ↓
update last_ip
        ↓
refresh approximate GeoIP snapshot if needed
        ↓
optionally create bounded security event
```

Например:

```text
session_ip_changed
```

Security event может содержать:

```text
session_id
device_id
old coarse network/location metadata
new coarse network/location metadata
occurred_at
risk_level
```

Не сохранять бесконечную детальную историю IP без необходимости.

#### Risk signals

Можно повышать risk score при комбинации признаков:

```text
new IP
+
country changes unexpectedly
+
browser/OS fingerprint changes strongly
+
unusual login/session behavior
```

Но это должно приводить сначала к:

```text
security event
user-visible warning
optional re-authentication for sensitive operation
```

а не к автоматической блокировке по одному признаку.

Например:

```text
New activity detected
Safari on iPhone
Amsterdam, Netherlands
```

или:

```text
Session network changed
Berlin -> Amsterdam
```

Текст должен подчёркивать приблизительность GeoIP.

#### Когда можно потребовать re-authentication

Для особо чувствительных операций можно потребовать password/passkey re-auth:

```text
disable/remove all devices
change password
create/recover security credential
promote admin
export keys/history
change critical security settings
```

Резкая смена network/browser metadata может быть дополнительным сигналом для такого step-up auth, но не единственной причиной.

#### Когда session нужно revoke немедленно

Явные события:

```text
user presses "Terminate session"
user presses "Terminate all other sessions"
device is revoked
password/security reset policy requires revoke
credential replay/confirmed compromise
admin security action
session reaches idle expiry
session reaches absolute expiry
```

#### Cookie theft/replay suspicion

Если реализована credential rotation и уже истёкший `previous_token` неожиданно появляется снова после grace period, это можно считать сильным сигналом replay/кражи credential.

Политика:

```text
detected replay
    ↓
revoke affected session
    ↓
close its WebSockets
    ↓
create security event
    ↓
notify user on other active devices
```

Не путать этот случай с обычной сменой IP.

### Если всё-таки понадобится JWT

JWT имеет смысл, если позднее появятся отдельные resource servers/services или API действительно выиграет от signed self-contained access token.

Тогда:

```text
access JWT
    lifetime: 5–10 min
    storage: RAM only

refresh credential
    type: opaque random token
    storage: HttpOnly + Secure + SameSite cookie
    server: hash in PostgreSQL
    rotation: every refresh
```

**Не хранить access JWT в `localStorage` или IndexedDB.**

После reload PWA получает новый short-lived access JWT через refresh/session endpoint.

Refresh credential лучше оставить opaque random token, а не делать его JWT: refresh всё равно требует server-side rotation/revocation state.

Если используется JWT access token, обязательные claims/validation:

```text
iss
sub
aud
exp
iat
jti
```

и при необходимости:

```text
sid
device_id
```

JWT payload не является секретным хранилищем. Не помещать туда:

- message plaintext;
- passwords;
- private keys;
- refresh tokens;
- чувствительные profile/security данные.

Backend обязан проверять:

```text
signature
allowed algorithm
issuer
audience
expiration
session/device state where required
```

Короткий access-token lifetime ограничивает окно replay, но не заменяет XSS protection.

### Почему не `localStorage`

Любой JavaScript, выполняющийся в origin приложения при XSS/supply-chain compromise, может читать `localStorage`.

Поэтому auth credentials не должны проектироваться вокруг:

```javascript
localStorage.setItem("access_token", token)
```

Для нашей PWA предпочтение:

```text
auth/session credential
    -> HttpOnly cookie

encrypted conversation cache
    -> IndexedDB

encrypted media cache
    -> OPFS

plaintext/decrypted UI state
    -> RAM
```

---

# 7. E2EE

Это security-critical подсистема.

До её реализации создать небольшой design document/ADR, который отвечает на вопросы:

1. какой протокол используется;
2. как создаётся identity устройства;
3. как добавляется второе устройство;
4. как создаётся direct conversation;
5. как создаётся group conversation;
6. как выполняется key rotation;
7. что происходит при удалении участника группы;
8. как осуществляется recovery;
9. какие metadata видит сервер;
10. как обновляется crypto protocol version.

### Обязательный invariant

```text
plaintext exists only on authorized client devices
```

FastAPI не должен иметь API типа:

```python
decrypt_message(...)
```

для пользовательских сообщений.

---

# 8. Формат сообщения

Не привязывать wire-format к UI.

Пример server envelope:

```json
{
  "id": "019...",
  "conversation_id": "019...",
  "sender_user_id": "019...",
  "sender_device_id": "019...",
  "protocol_version": 1,
  "sequence": 1234,
  "ciphertext": "...",
  "created_at": "2026-08-10T20:00:00Z",
  "expires_at": "2026-09-09T20:00:00Z"
}
```

Содержимое plaintext payload перед шифрованием может иметь собственную versioned schema:

```json
{
  "v": 1,
  "type": "text",
  "body": "hello",
  "reply_to": null,
  "attachments": []
}
```

Backend эту структуру не должен анализировать после включения настоящего E2EE.

---

# 9. API v1

Пример минимального HTTP API:

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/me
GET    /api/v1/devices
PATCH  /api/v1/devices/{id}
DELETE /api/v1/devices/{id}

GET    /api/v1/sessions
DELETE /api/v1/sessions/{id}
POST   /api/v1/sessions/revoke-others

GET    /api/v1/conversations
POST   /api/v1/conversations
GET    /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages
POST   /api/v1/conversations/{id}/messages

POST   /api/v1/attachments
GET    /api/v1/attachments/{id}

GET    /api/v1/sync
WS     /api/v1/ws
```

Admin:

```text
GET    /api/v1/admin/users
POST   /api/v1/admin/users
PATCH  /api/v1/admin/users/{id}
POST   /api/v1/admin/users/{id}/activation
```

---

# 10. WebSocket protocol

WebSocket не заменяет sync API.

Он сообщает клиенту, что появилось новое состояние.

События первой версии:

```text
hello
new_message
message_deleted
typing
presence
read_receipt
conversation_updated
device_revoked
```

Пример:

```json
{
  "type": "new_message",
  "conversation_id": "019...",
  "message_id": "019...",
  "sequence": 1234
}
```

После reconnect клиент обязан выполнить catch-up sync.

---

# 11. Sync

У каждого сообщения/события должен быть стабильный порядок.

Предпочтительно:

- server-side monotonically increasing sequence;
- либо устойчивый sync cursor.

Пример:

```http
GET /api/v1/sync?after=1230
```

Ответ:

```json
{
  "next_cursor": "1242",
  "has_more": false,
  "events": []
}
```

Главный тест:

1. отключить WebSocket;
2. отправить несколько сообщений;
3. подключить клиент;
4. убедиться, что все сообщения восстановились через sync;
5. убедиться в отсутствии дублей.

---

# 12. Local-first: IndexedDB, OPFS и локальная история

PWA должна быть **local-first**.

Открытие приложения не должно ждать полной загрузки диалогов и истории с API.

Startup flow:

```text
PWA start
   ↓
read local IndexedDB
   ↓
render conversations/messages immediately
   ↓
in parallel:
GET /api/v1/sync?after=<cursor>
   ↓
apply only delta
   ↓
update IndexedDB + UI
```

## IndexedDB

На клиенте использовать IndexedDB для:

```text
conversation index
encrypted local message archive
sync cursor
read/unread state
crypto protocol state
attachment metadata
outbox
local cache metadata
```

Не использовать `localStorage` для auth tokens, crypto secrets или message history.

### Локальный message archive

После получения и E2EE-decrypt сообщение может быть сохранено на устройстве долговременно, но persistent cache не должен хранить удобный plaintext archive.

Предпочтительно:

```text
E2EE ciphertext received
        ↓
decrypt for authorized device
        ↓
plaintext exists in RAM
        ↓
encrypt with device-local storage key
        ↓
IndexedDB local archive
```

Таким образом серверный ciphertext и локальный archive имеют разные задачи:

```text
server ciphertext
    -> delivery/sync during server retention window

local encrypted archive
    -> long-term history on this device
```

Device-local storage key создаётся через Web Crypto и по возможности является non-extractable.

Это дополнительная защита data-at-rest, но не абсолютная защита от XSS, скомпрометированного браузера или разблокированного устройства.

## OPFS / local media cache

Крупные encrypted media-файлы не обязательно хранить как большие records IndexedDB.

Предпочтительно использовать origin-private filesystem/storage mechanism для media cache, когда browser support и реализация проекта это позволяют:

```text
IndexedDB
    -> attachment metadata

OPFS/local origin storage
    -> encrypted image/video/voice blobs
```

На локальный диск сохраняются encrypted bytes.

Полностью расшифрованное медиа не должно становиться постоянным cache-файлом без отдельного решения.

## Persistent storage request

После установки/первичной настройки PWA можно запросить persistent browser storage и отслеживать quota/storage pressure.

Потеря browser cache всё равно должна считаться возможной: пользователь может очистить site data или удалить PWA.

Поэтому UX не должен обещать, что local browser storage является единственным безусловным backup.

## Outbox

Нужен local outbox:

```text
pending
sending
sent
failed
```

Повторная отправка должна быть idempotent.

---

# 12.1. Server retention и local retention — разные вещи

Сервер **не обязан хранить всю историю бесконечно**.

Модель проекта:

```text
SERVER
    transient encrypted sync/mailbox layer

DEVICE
    primary long-term conversation archive
```

Пример:

```text
server text retention: 30 days
server images:         14 days
server video:           7 days

local text history:    forever by default
local media:           bounded cache / user pin
```

После истечения server TTL:

```text
server deletes ciphertext
```

но уже синхронизированная локальная encrypted copy на устройстве может остаться.

Это означает:

> старое сообщение может существовать на Alice iPhone, хотя сервер его уже физически не хранит.

## Следствие: новое устройство не получает бесконечную историю с сервера

Если сервер хранит сообщения 30 дней, новый телефон сможет самостоятельно синхронизировать только доступное server retention window.

Для более старой истории нужен отдельный механизм:

```text
old authorized device
        ↓
secure device-to-device transfer
        ↓
new authorized device
```

Планируемая будущая функция:

```text
New device
    ↓
shows pairing QR / transfer request
    ↓
Old authorized device confirms
    ↓
authenticated encrypted transfer session
    ↓
local conversation archive copied
    ↓
new device re-encrypts archive under its own local storage key
```

Не загружать всю бессрочную локальную историю обратно на VPS только ради device migration.

## Local retention settings

Политику можно разделить:

```text
Server retention
    system/admin policy

Local message retention
    Forever
    1 year
    90 days

Local media cache
    bounded by bytes
    LRU cleanup

Pinned media
    keep on this device
```

Текст имеет небольшой размер, поэтому default может быть `Forever`.

Для images/video/voice использовать bounded cache и LRU cleanup.

Если оригинальное вложение уже удалено и с сервера, и из локального cache:

```text
[Вложение больше недоступно]
```

само текстовое сообщение при этом может оставаться.

## Delete for everyone

Server TTL и пользовательское удаление — разные операции.

Если пользователь выполняет `Delete for everyone`, сервер создаёт deletion/tombstone event:

```text
message_deleted
message_id=...
```

Все подключённые и позднее синхронизирующиеся устройства должны применить tombstone к локальному archive.

Tombstone должен жить достаточно долго, чтобы offline devices успели узнать об удалении.

Невозможно криптографически гарантировать уничтожение уже увиденного сообщения на чужом контролируемом устройстве: получатель мог сделать screenshot, export или использовать модифицированный клиент.

Поэтому UI/документация не должны обещать невозможную гарантию.

## Retention source of truth

Уточнение прежнего принципа:

```text
PostgreSQL
    source of truth for server-side sync state
    during configured retention window

Device local archive
    source of long-term local history
    after successful sync
```

WebSocket по-прежнему является notification channel, а sync API восстанавливает пропущенные server events в пределах их retention/tombstone policy.

---

# 13. Idempotency

При плохой сети пользователь может нажать Send один раз, а HTTP request реально уйдёт несколько раз.

Поэтому сообщение должно иметь client-generated ID/idempotency key.

Backend не должен создать 3 одинаковых сообщения из-за retry.

---

# 14. Вложения

Flow:

```text
select file
   ↓
validate size/type on client
   ↓
generate random file key
   ↓
encrypt locally
   ↓
upload encrypted bytes
   ↓
send encrypted message containing attachment metadata/key material
```

Backend никогда не получает plaintext файла.

### Ограничения первой версии

Пример:

```text
image:  15 MB
file:   50 MB
video: 150 MB
voice:  30 MB
```

Точные значения конфигурируются.

### Хранение медиа: local first, S3 later

Для первой production-версии **не нужен S3 и не нужен MinIO**.

При масштабе около 10–15 пользователей encrypted media хранится на локальном диске VPS:

```text
/data/media/<prefix>/<opaque-storage-key>
```

Например:

```text
/data/media/
├── 01/
│   └── 0198f3...blob
└── 02/
    └── 0198f4...blob
```

В PostgreSQL хранится только metadata и логический `storage_key`.

Не сохранять абсолютный filesystem path как часть бизнес-модели.

Пример:

```text
attachments
├── id
├── message_id
├── storage_key
├── content_type
├── size_bytes
├── encrypted_size_bytes
├── created_at
├── expires_at
└── deleted_at
```

`storage_key`:

```text
01/0198f3...blob
```

а не:

```text
/data/media/01/0198f3...blob
```

### Storage abstraction

Application layer не должен напрямую вызывать `Path.open()`, `unlink()` или зависеть от S3 SDK.

Сразу создать порт:

```python
from collections.abc import AsyncIterator
from typing import Protocol


class MediaStorage(Protocol):
    async def save(
        self,
        key: str,
        content: AsyncIterator[bytes],
    ) -> None: ...

    async def open(
        self,
        key: str,
    ) -> AsyncIterator[bytes]: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...
```

Infrastructure adapters:

```text
application
    ↓
MediaStorage

infrastructure/storage/
├── local.py       -> LocalMediaStorage
└── s3.py          -> S3MediaStorage, только когда реально понадобится
```

MVP configuration:

```dotenv
MEDIA_STORAGE=local
MEDIA_ROOT=/data/media
```

Если позже понадобится external object storage:

```dotenv
MEDIA_STORAGE=s3
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

S3-specific настройки не должны протекать в domain/application layer.

### Когда действительно переходить на S3-compatible storage

Переход имеет смысл, если возникает хотя бы одна реальная причина:

- media уже нельзя считать восстанавливаемой/временной;
- локального диска VPS не хватает;
- backend начинает работать на нескольких хостах;
- нужно вынести большой media traffic с VPS;
- нужен независимый storage failure domain;
- нужны lifecycle/replication/versioning возможности object storage.

До этого локальный filesystem проще и дешевле.

### MinIO

**Не поднимать MinIO на том же единственном VPS просто ради API, похожего на S3.**

Это добавит:

- дополнительный контейнер;
- RAM usage;
- конфигурацию;
- ещё одну точку сопровождения;

но не решит главный риск: при потере VPS локальный MinIO потеряется вместе с локальным media volume.

Если понадобится S3, предпочтение отдаётся отдельному внешнему S3-compatible object storage.

### Security storage rules

Никакого прямого использования пользовательского filename как storage path.

Запрещено получать путь вроде:

```text
/data/media/../../etc/passwd
```

Storage key генерирует сервер и считает его opaque.

Файл к этому моменту уже должен быть зашифрован на клиенте.

---

# 15. Не делать server-side transcoding в MVP

Не добавлять FFmpeg processing pipeline на VPS 1–2 GB RAM без реальной необходимости.

Для первого релиза:

- картинки можно оптимизировать на клиенте;
- видео загружается как encrypted blob;
- сервер не видит его содержимое и не делает preview/transcoding.

---

# 16. TTL и auto-delete

TTL является частью модели с первой версии.

Этот TTL описывает **server retention**, а не обязательное удаление уже синхронизированной локальной истории на пользовательском устройстве.

Пример defaults:

```text
text:        30 days
image:       14 days
video:        7 days
voice:        7 days
```

Могут поддерживаться:

```text
1 day
7 days
30 days
forever
```

Cleanup удаляет:

1. expired attachments с диска;
2. их metadata;
3. expired message ciphertext;
4. безопасно обрабатывает уже отсутствующие файлы;
5. пишет metrics/log summary без plaintext.

Cleanup должен быть idempotent.

---

# 17. Ограничение диска

Для VPS около 40 GB:

```text
OS / Docker / reserve       ~8–10 GB
PostgreSQL / backups         ~3–5 GB
encrypted media             ~25–30 GB
```

Ввести:

- upload quota;
- per-file limit;
- media usage metric;
- disk usage alert;
- cleanup expired media.

При нехватке диска лучше временно запретить новые большие uploads, чем молча удалять ещё не истёкшие пользовательские данные.

---

# 18. PWA

Первая версия PWA должна поддерживать:

- installability;
- app manifest;
- service worker;
- offline shell;
- IndexedDB;
- background-safe reconnect;
- update notification;
- Web Push.

Важно не допустить ситуацию, когда новый Service Worker ломает совместимость со старой схемой IndexedDB.

Все IndexedDB migrations должны быть versioned.

---

# 19. Push notifications

Для системных уведомлений использовать стандартный **Web Push**:

```text
Push API
+
Service Worker
+
Notifications API
+
VAPID
```

Не делать Firebase обязательной частью архитектуры.

Браузер сам выдаёт `PushSubscription` с endpoint и ключами, а backend отправляет Web Push на этот endpoint.

На iOS/iPadOS Web Push предназначен для web app, добавленного на Home Screen. Запрос permission должен происходить после явного действия пользователя, например нажатия кнопки «Включить уведомления».

Полезные спецификации/источники:

- W3C Push API: https://www.w3.org/TR/push-api/
- VAPID, RFC 8292: https://www.rfc-editor.org/rfc/rfc8292
- WebKit: Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## Notification architecture

```text
Alice sends message
        ↓
FastAPI stores ciphertext
        ↓
FastAPI emits realtime event
        ├──────── WebSocket ────────> online Bob client
        │
        └──────── Web Push ─────────> Bob push subscription
                                         ↓
                                   Service Worker
                                         ↓
                                  system notification
```

WebSocket и Web Push решают разные задачи:

- WebSocket — realtime, когда приложение активно;
- Web Push — wake-up/system notification, когда приложение закрыто или находится в background;
- sync API — источник восстановления состояния после пропущенных событий.

Нельзя рассчитывать на Web Push как на гарантированную очередь сообщений.

## Push subscription — на устройство/установку

Не хранить один push endpoint на `User`.

У пользователя может быть:

```text
User Bob
├── iPhone PWA subscription
├── Mac browser subscription
└── Windows PWA subscription
```

Таблица:

```text
push_subscriptions
├── id
├── user_id
├── device_id
├── endpoint
├── p256dh
├── auth
├── created_at
├── updated_at
├── last_success_at
├── disabled_at
└── expires_at
```

Конкретные поля корректируются под выбранную Web Push library и формат `PushSubscription`.

Push endpoint и subscription key material считать чувствительными operational credentials:

- не писать их полностью в logs;
- не показывать другим пользователям;
- не использовать как публичный ID;
- удалять/отключать недействительные subscriptions.

## VAPID

Backend имеет одну application-server VAPID key pair.

Например:

```dotenv
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_CONTACT=mailto:admin@example.com
```

Private key:

- является secret;
- не коммитится;
- не попадает в Docker image;
- хранится через production secrets/env mechanism.

Frontend получает только public VAPID key для создания subscription.

## Privacy rule: никакого plaintext сообщения в push payload

Push notification не должна обходить E2EE.

Плохо:

```json
{
  "title": "Вася",
  "body": "Вот секретный текст сообщения"
}
```

Потому что backend тогда должен знать plaintext либо отдельный plaintext preview.

MVP payload:

```json
{
  "v": 1,
  "type": "new_message",
  "event_id": "019...",
  "conversation_id": "019...",
  "message_id": "019..."
}
```

Допустимо вообще отправлять ещё меньше:

```json
{
  "v": 1,
  "type": "sync_required"
}
```

После wake-up:

```text
Service Worker / PWA
        ↓
sync API
        ↓
download ciphertext
        ↓
decrypt locally
```

Системное уведомление первой версии может быть:

```text
Private Messenger
Новое сообщение
```

Это намеренно менее информативно, зато не ломает security model.

В будущем можно исследовать encrypted notification previews, но это отдельная security-задача. Не добавлять plaintext preview как «временное удобство».

## Foreground vs background

Чтобы не получать двойные уведомления:

### PWA открыта и conversation активна

```text
WebSocket event
↓
update message list
↓
no system notification
```

Можно показать только небольшой in-app indicator.

### PWA открыта, но пользователь в другом чате

```text
WebSocket event
↓
update unread counter
↓
optional in-app notification
```

System notification обычно не нужна, если приложение уже находится foreground.

### PWA закрыта/background

```text
Web Push
↓
Service Worker
↓
showNotification()
```

## Notification click

При клике:

```text
notification
    ↓
focus existing PWA window
OR
open PWA
    ↓
navigate to conversation
    ↓
sync
    ↓
decrypt locally
```

Не считать содержимое push payload источником сообщения.

`conversation_id` используется только как navigation hint; реальный доступ всё равно проверяется backend.

## Unread badge

Где поддерживается Badging API:

```text
setAppBadge(unread_count)
clearAppBadge()
```

Badge является удобством, а не source of truth.

Authoritative unread/read state остаётся в приложении/server model.

## Notification preferences

Заложить возможность настроек:

```text
global notifications on/off
conversation mute
mention-only for groups — later
sound/vibration behavior — where platform permits
privacy mode: generic notification
```

Для MVP достаточно:

```text
notifications_enabled
conversation muted_until
```

Mute должен проверяться backend перед отправкой push, чтобы не будить устройство бесполезно.

## Read state и несколько устройств

Push отправляется на все активные subscriptions пользователя, кроме устройства-отправителя, если это событие не нужно этому устройству.

Если Bob прочитал conversation на одном устройстве:

```text
Bob iPhone
   ↓
read receipt/state
   ↓
server
   ↓
Bob laptop gets update
```

Клиенты обновляют unread counters.

Не пытаться «отозвать» уже показанное OS notification как обязательную гарантию: платформы отличаются. При следующем открытии приложение должно привести локальный UI/badge к актуальному server state.

## Deduplication

WebSocket и push могут сообщить об одном событии почти одновременно.

Использовать стабильный:

```text
event_id
```

или `message_id`, чтобы client-side обработка была idempotent.

Один message не должен увеличивать unread counter дважды.

## Invalid subscriptions

Push endpoints могут перестать существовать.

Если push provider отвечает permanent invalid/gone status, backend должен:

```text
mark subscription disabled
or
delete subscription
```

Не делать бесконечные retry в мёртвый endpoint.

Также клиент должен уметь пересоздать subscription при её изменении/исчезновении.

## Delivery failures

Ошибка Web Push не должна откатывать сохранённое сообщение.

Правильный порядок:

```text
store message transaction
↓
commit
↓
publish realtime notification
↓
best-effort push
```

Message delivery correctness обеспечивается sync API, а не успешностью push provider.

Для 10–15 пользователей отдельная очередь сообщений ради push на старте не нужна.

Можно выполнять push через простой bounded background dispatcher внутри приложения или лёгкий worker, если сетевой вызов не должен задерживать HTTP response.

Если процесс умер после commit, сообщение всё равно будет найдено через sync. Позже, если потребуется более надёжная delivery semantics для push, можно добавить outbox pattern.

## Notification events

MVP:

```text
new_message
```

Позже можно добавить:

```text
incoming_call
missed_call
mention
conversation_invite
security/device_added
```

Security notifications вроде добавления нового устройства стоит считать отдельным типом и проектировать так, чтобы они не терялись только из-за push failure.

## Incoming calls

Для будущих WebRTC calls push используется как wake-up hint:

```text
incoming_call
↓
system notification
↓
user opens PWA
↓
client fetches current call state
↓
WebRTC signaling starts/continues
```

Не помещать SDP, media keys или чувствительный signaling state в обычный notification preview.

PWA не должна обещать полностью идентичную native VoIP behavior на всех мобильных платформах.

---

# 20. Security headers и Nginx

Production работает только через HTTPS.

Nginx должен:

- redirect HTTP → HTTPS;
- проксировать WebSocket;
- иметь upload limit;
- задавать security headers;
- не раскрывать лишнюю информацию о backend;
- корректно передавать client/proxy headers;
- иметь разумные timeout для WebSocket.

Отдельно настроить:

- CSP;
- HSTS после проверки HTTPS;
- `X-Content-Type-Options`;
- `Referrer-Policy`;
- secure cookies.

CSP особенно важен для web-клиента с E2EE.

---

# 21. Логи

Запрещено логировать:

- plaintext messages;
- passwords;
- refresh tokens;
- activation tokens;
- crypto private keys;
- decrypted attachments;
- полные Authorization headers.

Хороший structured log:

```json
{
  "event": "message_stored",
  "message_id": "019...",
  "conversation_id": "019...",
  "sender_device_id": "019...",
  "size_bytes": 1832
}
```

Без текста сообщения.

---

# 22. Tests

## Backend unit tests

Тестировать:

- domain invariants;
- use cases;
- authorization;
- TTL calculation;
- membership;
- refresh rotation;
- idempotency;
- sync cursor logic.

## Backend integration tests

С реальным PostgreSQL:

- repositories;
- migrations;
- transactions;
- concurrent message create;
- unique constraints;
- cleanup.

## API tests

- auth;
- authorization boundaries;
- admin-only routes;
- message access;
- attachment access;
- revoked device;
- expired session.

## Frontend

Минимум:

- TypeScript typecheck;
- component/unit tests для критичной логики;
- crypto adapter tests;
- IndexedDB migration tests;
- sync/outbox tests.

## E2E

Ключевой сценарий:

```text
Admin creates Alice
Admin creates Bob
Alice activates
Bob activates
Alice creates conversation
Bob joins/receives it
Alice sends encrypted message
Bob receives and decrypts it
Bob goes offline
Alice sends more messages
Bob returns
sync restores missing messages
no duplicates
```

---

# 23. Code quality contract

Код должен быть не просто рабочим, а **коротким, строго типизированным, предсказуемым и легко читаемым**.

Главный критерий: use case должен читаться сверху вниз и быстро отвечать на вопросы:

```text
что приходит
что проверяется
какие зависимости используются
что изменяется
что возвращается
какие ошибки возможны
```

## 23.1. Strict typing

Все публичные границы должны быть типизированы:

```text
use cases
commands / queries
result DTO
repository ports
service ports
domain methods
storage / crypto / push adapters
background jobs
```

Не передавать между слоями бесформенные `dict`, `Any` и случайные kwargs.

Плохо:

```python
async def execute(self, data: dict[str, object]) -> dict[str, object]:
    ...
```

Хорошо:

```python
@dataclass(frozen=True, slots=True)
class SendMessageCommand:
    conversation_id: ConversationId
    sender_user_id: UserId
    sender_device_id: DeviceId
    client_message_id: ClientMessageId
    ciphertext: bytes


@dataclass(frozen=True, slots=True)
class SendMessageResult:
    message_id: MessageId
    sequence: int
    created_at: datetime
```

`Any`, `cast`, `# type: ignore`, `@ts-ignore` и unsafe casts допустимы только на реально динамической внешней границе и не должны использоваться просто для того, чтобы успокоить type checker.

## 23.2. DTO должны быть явными

Не смешивать автоматически:

```text
FastAPI request model
application command/query
domain entity
SQLAlchemy model
HTTP response model
```

Нормальный flow:

```text
HTTP JSON
    ↓
presentation DTO
    ↓
application Command / Query
    ↓
Use Case
    ↓
application Result DTO
    ↓
presentation response DTO
```

Pydantic-модель FastAPI не становится domain entity просто ради удобства.

Domain ничего не знает про HTTP/Pydantic.

## 23.3. Один Use Case — одна операция

Имена должны описывать пользовательское действие:

```text
SendMessage
CreateConversation
RevokeSession
ListActiveSessions
DeleteMessageForEveryone
SyncEvents
UploadAttachment
```

Не создавать giant-классы:

```text
MessengerService
UserService
CommonService
Manager
Helper
```

с десятками несвязанных методов.

Use case:

- получает dependencies через constructor;
- не знает про FastAPI;
- не выполняет SQL напрямую;
- не возвращает ORM object;
- не использует global singleton;
- не делает побочную несвязанную работу.

Пример:

```python
class SendMessage:
    def __init__(
        self,
        messages: MessageRepository,
        conversations: ConversationRepository,
        clock: Clock,
    ) -> None:
        self._messages = messages
        self._conversations = conversations
        self._clock = clock

    async def execute(
        self,
        command: SendMessageCommand,
    ) -> SendMessageResult:
        ...
```

## 23.4. Dependency Injection — явный

Предпочитать constructor injection.

Плохо:

```python
repo = get_global_repository()
settings = global_settings
```

Хорошо:

```python
class RevokeSession:
    def __init__(
        self,
        sessions: SessionRepository,
        clock: Clock,
    ) -> None:
        ...
```

Concrete wiring находится в bootstrap/presentation composition root.

## 23.5. Repository — не generic CRUD

Repository port описывает операции, нужные приложению.

Не делать универсальный:

```text
get
get_all
filter
execute
raw_query
```

на все сущности.

Предпочитать предметные операции:

```python
class MessageRepository(Protocol):
    async def get_by_id(
        self,
        message_id: MessageId,
    ) -> Message | None: ...

    async def add(
        self,
        message: Message,
    ) -> None: ...

    async def list_after_sequence(
        self,
        conversation_id: ConversationId,
        after: int,
        limit: int,
    ) -> list[Message]: ...
```

Generic Repository не добавлять только потому, что это «паттерн».

## 23.6. ORM не течёт наружу

SQLAlchemy models — infrastructure detail.

Не возвращать ORM objects:

```text
из use case
из domain API
напрямую из FastAPI route
```

Mapping должен быть явным.

Для read-heavy query допустим explicit read model, если это упрощает код и не ломает границы.

## 23.7. Command / Query разделение без тяжёлого CQRS

Framework CQRS не нужен.

Но логически различать:

```text
Command -> изменяет состояние
Query   -> читает состояние
```

Например:

```text
SendMessageCommand
RevokeSessionCommand

ListConversationsQuery
ListActiveSessionsQuery
SyncEventsQuery
```

## 23.8. Value Objects там, где они реально защищают код

Различать:

```text
UserId
DeviceId
ConversationId
MessageId
ClientMessageId
StorageKey
```

если это помогает не смешивать идентификаторы и обеспечивает invariants.

Не превращать каждую строку в отдельный класс без пользы.

## 23.9. Типизированные ошибки

Не использовать:

```python
raise Exception("not allowed")
```

для ожидаемой application/domain логики.

Предпочитать:

```python
class ConversationNotFound(ApplicationError):
    ...

class NotConversationMember(ApplicationError):
    ...

class SessionRevoked(ApplicationError):
    ...
```

Presentation переводит известные ошибки в HTTP/WebSocket protocol response.

Не ловить broad `Exception` глубоко и не превращать ошибки в `None`.

## 23.10. Маленькие, cohesive модули

Нет искусственного лимита строк, но красные флаги:

```text
use case на 400 строк
route на 150 строк
service с 20+ dependencies
utils.py на 1500 строк
функция с десятком boolean flags
```

При этом не дробить код на бессмысленные wrappers только ради маленьких файлов.

Цель:

```text
high cohesion
low coupling
clear naming
explicit control flow
```

## 23.11. Не делать `utils.py` мусорной корзиной

Предпочитать конкретную ответственность:

```text
security/password_hasher.py
storage/storage_key.py
time/clock.py
http/client_ip.py
```

вместо гигантских:

```text
utils.py
helpers.py
common.py
misc.py
```

## 23.12. Async только для настоящего async I/O

Async нужен для:

```text
database I/O
network I/O
streaming/file boundary
push
external services
```

Чистая domain logic остаётся sync.

Не блокировать event loop тяжёлым CPU/synchronous I/O.

## 23.13. Transaction boundary соответствует use case

Пример:

```text
SendMessage
    check membership
    assign sequence
    save message
    save sync event
    commit
```

Не прятать случайные `commit()` внутри repository methods без общей transaction policy.

Best-effort side effects вроде push/WebSocket выполняются после durable commit либо через outbox, если он позже действительно понадобится.

## 23.14. Configuration — одна типизированная граница

Не делать:

```python
os.getenv("SESSION_TIMEOUT")
```

по всему приложению.

Environment читается в bootstrap/config layer и превращается в validated typed settings.

Например:

```python
@dataclass(frozen=True, slots=True)
class SessionSettings:
    idle_timeout: timedelta
    absolute_lifetime: timedelta
    rotation_interval: timedelta
```

## 23.15. Время — через Clock там, где оно влияет на бизнес-логику

Не разбрасывать `datetime.now()` по use cases.

Для:

```text
session expiry
message TTL
tombstone retention
cleanup
```

использовать:

```python
class Clock(Protocol):
    def now(self) -> datetime: ...
```

Всегда timezone-aware UTC.

## 23.16. API handlers должны быть скучными

FastAPI route:

1. валидирует transport input;
2. получает authenticated principal;
3. строит Command/Query;
4. вызывает use case;
5. переводит result/error в transport response.

Route не должен:

- писать SQL;
- рассчитывать TTL;
- проверять membership вручную;
- реализовывать crypto;
- отправлять push напрямую;
- содержать основную бизнес-логику.

## 23.17. Frontend тоже разделён по ответственности

Не делать Vue component, который одновременно:

```text
рендерит UI
fetch API
decrypt
пишет IndexedDB
работает с OPFS
отправляет notification
реализует sync
```

Ориентир:

```text
pages/components
      ↓
composables / stores
      ↓
client application services
      ↓
api / crypto / storage / push adapters
```

Например:

```text
useConversation()
      ↓
MessageService
      ├── MessengerApi
      ├── CryptoClient
      └── LocalMessageRepository
```

## 23.18. TypeScript strict

Избегать:

```text
any
@ts-ignore
as unknown as X
необоснованный !
```

API response считается untrusted input до parsing/validation на boundary.

Crypto/storage API не принимают бесформенный `Record<string, any>`.

## 23.19. Имена лучше комментариев

Хорошо:

```python
await sessions.revoke_other_sessions(
    user_id=user_id,
    except_session_id=current_session_id,
)
```

Комментарии объясняют **почему**, security invariant, trade-off или workaround, а не пересказывают очевидную строку кода.

## 23.20. Не абстрагировать ради Clean Architecture

Clean Architecture не означает создавать:

```text
Interface
AbstractInterface
BaseInterface
DefaultInterfaceImpl
Factory
Provider
Manager
Facade
```

для каждой мелочи.

Абстракции особенно полезны на реальных boundaries:

```text
database
filesystem/S3
clock
password hashing
push
GeoIP
crypto implementation
```

Простой pure function не требует interface.

## 23.21. Happy path читается сверху вниз

Основной flow use case не должен быть спрятан за десятком фабрик/decorators/callbacks.

Желательно:

```python
async def execute(self, command: SendMessageCommand) -> SendMessageResult:
    conversation = await self._get_conversation(command.conversation_id)
    self._ensure_member(conversation, command.sender_user_id)

    message = Message.create(...)
    await self._messages.add(message)

    return SendMessageResult.from_message(message)
```

## 23.22. Никаких скрытых side effects

Метод с названием `get()` не должен внезапно:

```text
update last_seen
commit transaction
create audit event
send push
```

Side effects должны быть очевидны из application flow.

## 23.23. Tests проверяют публичное поведение

Use-case test должен читаться как specification:

```text
given conversation member
when encrypted message is sent
then exactly one message is persisted
and sequence is assigned
and returned id is correct
```

Не привязывать tests к private implementation details без необходимости.

## 23.24. Rule of change

Перед созданием нового layer/class/interface спросить:

```text
какую конкретную проблему он решает сейчас?
```

Если ответ:

```text
"может понадобиться потом"
"так enterprise"
"для красоты"
```

— не добавлять.

---

# 24. Code quality checks

Перед merge должны проходить:

Backend:

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest
```

Frontend:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Compose:

```bash
docker compose config
```

Если проект выберет `pnpm`, использовать `pnpm` последовательно во всём репозитории и CI.

---

# 25. Makefile

Рекомендуемые команды:

```bash
make dev
make down
make logs

make backend-lint
make backend-format
make backend-typecheck
make backend-test

make frontend-lint
make frontend-typecheck
make frontend-test
make frontend-build

make test
make ci

make migrate
make migration name="add attachments"
```

`make ci` должен максимально повторять GitHub Actions.

---

# 26. GitHub Actions

## CI workflow

На PR:

```text
backend lint
backend typecheck
backend tests
frontend lint
frontend typecheck
frontend tests
frontend build
docker compose config
```

Можно запускать backend integration tests с PostgreSQL service container.

## Build

После merge:

```text
build backend image
build frontend/static artifact or nginx image
push image to GHCR
```

Не билдить тяжёлые Docker images на слабом VPS.

---

# 27. Production Docker Compose

Целевая production-схема:

```text
nginx
api
postgres
cleanup
```

Позже:

```text
coturn
```

Не публиковать PostgreSQL наружу.

Внешне нужны только необходимые порты, например:

```text
80
443
```

и позже TURN ports.

---

# 28. Deployment

Первый простой deployment:

```text
GitHub Actions
      ↓
GHCR
      ↓
VPS
      ↓
docker compose pull
      ↓
alembic upgrade head
      ↓
docker compose up -d
      ↓
healthcheck
```

Нужен rollback plan.

Перед необратимой migration обязательно продумать совместимость old/new application version.

---

# 29. Backups

Наличие auto-delete не отменяет backup БД.

Нужно определить политику:

- PostgreSQL backup;
- retention;
- encrypted offsite backup storage;
- restore test.

### PostgreSQL

БД необходимо бэкапить offsite: потеря VPS не должна автоматически означать потерю аккаунтов, membership, encrypted message metadata и остального durable state.

### Media

Для MVP encrypted media с коротким TTL можно **осознанно не бэкапить**, если продуктовая семантика допускает:

> потерян VPS/диск — временные media-файлы могут быть потеряны.

Это должно быть явным решением, а не случайностью.

Если позже media становится durable и должна переживать потерю VPS — это один из главных сигналов перейти на external S3-compatible storage или добавить отдельный offsite media backup.

### TTL и backups

Очень важно понимать семантику TTL:

если пользовательское сообщение удалилось по TTL, оно не должно бесконечно жить в backup.

Поэтому backup retention должна быть ограниченной и документированной.

---

# 30. Observability

Для небольшого проекта не нужен тяжёлый observability stack.

Минимум:

- structured logs;
- Docker healthchecks;
- disk usage;
- DB size;
- media storage size;
- HTTP 5xx count;
- failed login count;
- active WebSocket count;
- cleanup summary.

---

# 31. Порядок реализации MVP

Рекомендуемый порядок:

### Milestone 1 — Bootstrap

- repo skeleton;
- Compose;
- PostgreSQL;
- FastAPI healthcheck;
- Nuxt shell;
- lint/typecheck/tests;
- CI.

### Milestone 2 — Users/Auth

- User;
- Device;
- admin user creation;
- activation;
- password hashing;
- login;
- refresh rotation;
- logout;
- revoke device.

### Milestone 3 — Conversations

- direct conversation;
- group conversation;
- membership;
- authorization;
- conversation list.

### Milestone 4 — Reliable messaging without final E2EE

Перед настоящей криптографией можно временно реализовать transport model с synthetic ciphertext bytes, **но не выпускать это как secure messenger**.

Цель этапа:

- message persistence;
- idempotency;
- pagination;
- sequence/cursor;
- reconnect;
- WebSocket events;
- offline catch-up.

### Milestone 5 — E2EE

После отдельного design review:

- device crypto identity;
- session/group establishment;
- encrypt/decrypt;
- key rotation;
- membership changes;
- protocol versioning;
- test vectors;
- negative tests.

Удалить любые временные plaintext transport shortcuts.

### Milestone 6 — Attachments

- encrypted upload;
- download;
- client-side decrypt;
- quotas;
- size validation;
- TTL;
- cleanup.

### Milestone 7 — PWA

- manifest;
- install;
- IndexedDB;
- offline cache;
- outbox;
- update handling.

### Milestone 8 — Push

- subscribe;
- store endpoint;
- new-message wakeup;
- no plaintext push payload.

### Milestone 9 — Production

- Nginx;
- TLS;
- domain;
- Docker production build;
- GHCR;
- deploy workflow;
- backups;
- monitoring;
- restore test.

### Milestone 10 — Calls

Только после стабильного messaging core:

- signaling events;
- WebRTC audio;
- STUN;
- TURN/coturn;
- call state machine;
- reconnect/failure UX;
- video calls.

---

# 32. Voice/video calls — будущая архитектура

Backend занимается signaling:

```text
call_offer
call_answer
ice_candidate
call_rejected
call_ended
```

Media plane:

```text
peer ← WebRTC → peer
```

При невозможности прямого P2P:

```text
peer ← TURN → peer
```

Не проксировать аудио/видео через FastAPI.

---

# 33. Что не делать

Не добавлять без причины:

- Kafka;
- RabbitMQ;
- Redis;
- Celery;
- Kubernetes;
- MinIO;
- Elasticsearch;
- отдельный API gateway;
- несколько backend microservices;
- server-side video transcoding.

Не делать:

- plaintext message column;
- secrets в Git;
- user-controlled filesystem paths;
- crypto protocol «на глаз»;
- sync только через WebSocket;
- unrestricted public registration;
- хранение refresh token plaintext;
- production `metadata.create_all()`;
- автоматическое удаление permanent data при нехватке места;
- логирование decrypted content.

---

# 34. Definition of Done

Фича считается готовой, если:

- реализованы happy path и важные failure paths;
- соблюдены архитектурные границы;
- добавлены тесты;
- migration добавлена, если менялась schema;
- auth/authz проверены;
- logs не содержат sensitive data;
- API schema/documentation обновлены;
- lint/typecheck/test проходят;
- frontend build проходит;
- feature работает после reconnect, если это realtime-фича;
- нет нового способа получить plaintext на сервере;
- обновлён README/docs, если изменилось поведение или архитектура.

---

# 35. Первый рабочий backlog

Если репозиторий пока пустой, первые задачи можно делать буквально в таком порядке:

1. Создать backend package и `pyproject.toml`.
2. Настроить Ruff, mypy, pytest.
3. Добавить FastAPI `GET /api/health`.
4. Создать PostgreSQL в `compose.dev.yml`.
5. Подключить SQLAlchemy async.
6. Подключить Alembic.
7. Создать Nuxt PWA skeleton.
8. Настроить frontend lint/typecheck/test.
9. Добавить `Makefile`.
10. Добавить GitHub Actions CI.
11. Создать `User` domain model.
12. Создать `Device` domain model.
13. Реализовать repositories.
14. Создать первую migration.
15. Реализовать admin bootstrap.
16. Реализовать activation flow.
17. Реализовать login/refresh/logout.
18. Реализовать conversation domain.
19. Реализовать membership authorization.
20. Реализовать synthetic ciphertext message transport.
21. Реализовать cursor sync.
22. Реализовать WebSocket notifications.
23. Реализовать offline catch-up tests.
24. Зафиксировать E2EE design.
25. Реализовать выбранный E2EE protocol.
26. Реализовать encrypted attachments.
27. Реализовать TTL cleanup.
28. Добавить IndexedDB/outbox.
29. Добавить Web Push.
30. Настроить Nginx/TLS/deployment.
31. Провести backup/restore test.
32. Только потом начинать WebRTC calls.

---

# 36. Локальный запуск — целевой UX

Когда bootstrap будет закончен, новый разработчик должен иметь возможность сделать:

```bash
git clone <repository>
cd <repository>

cp .env.example .env

docker compose -f compose.dev.yml up -d postgres

make backend-install   # internally: uv sync
make frontend-install

make migrate

make dev
```

И открыть:

```text
http://localhost:3000
```

Backend:

```text
http://localhost:8000
```

OpenAPI development-only:

```text
http://localhost:8000/docs
```

---

# 37. Production checklist

Перед первым реальным использованием:

- [ ] HTTPS включён.
- [ ] HTTP перенаправляется на HTTPS.
- [ ] Production secrets не находятся в Git.
- [ ] PostgreSQL не опубликован в интернет.
- [ ] Admin bootstrap больше не использует default password.
- [ ] Public registration отсутствует.
- [ ] Refresh rotation работает.
- [ ] Device revoke работает.
- [ ] Экран active sessions показывает current device, last seen и revoke action.
- [ ] IP берётся только из trusted reverse-proxy chain.
- [ ] GeoIP помечается как приблизительный и не используется как GPS/security proof.
- [ ] Browser/model detection имеет fallback и не является security boundary.
- [ ] `last_seen_at` обновляется с throttling, а не записью в БД на каждый request.
- [ ] E2EE test vectors проходят.
- [ ] Backend не видит plaintext сообщений.
- [ ] Attachments шифруются до upload.
- [ ] Push payload не содержит plaintext.
- [ ] VAPID private key хранится как production secret.
- [ ] Push subscription привязана к device/install, а не глобально к user.
- [ ] Invalid push subscriptions отключаются/удаляются.
- [ ] WebSocket + Push duplicate event не удваивает unread count.
- [ ] `LocalMediaStorage` находится за `MediaStorage` port.
- [ ] Application layer не зависит от filesystem/S3 SDK.
- [ ] MinIO не добавлен на тот же VPS без отдельной обоснованной причины.
- [ ] TTL cleanup проверен.
- [ ] Disk limits настроены.
- [ ] Backup работает.
- [ ] Restore проверен.
- [ ] CSP настроен.
- [ ] Sensitive data не попадает в logs.
- [ ] CI зелёный.
- [ ] Production migration проверена.
- [ ] WebSocket reconnect проверен.
- [ ] Offline sync проверен.
- [ ] Local archive остаётся доступным после удаления старого ciphertext по server TTL.
- [ ] Новый device получает только server retention window без специального transfer.
- [ ] Delete tombstone синхронизируется на offline devices.
- [ ] Auth credential не хранится в `localStorage`/IndexedDB.
- [ ] Session cookie имеет `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` и не имеет `Domain`.
- [ ] Session имеет idle timeout и absolute lifetime.
- [ ] Session touch/`last_seen_at` обновляется с throttling.
- [ ] Credential rotation учитывает concurrent requests через ограниченный grace period.
- [ ] Смена IP/GeoIP сама по себе не revoke'ит session.
- [ ] Replay старой credential после grace period создаёт security event и revoke affected session.
- [ ] Unsafe cookie-authenticated endpoints имеют CSRF/Origin protection.
- [ ] WebSocket handshake проверяет `Origin` и active session.
- [ ] Дубли при retry отсутствуют.

---

# 38. Принципы проекта

Короткая версия:

```text
secure by design
boring infrastructure
client-side E2EE
server stores ciphertext
device != user
PostgreSQL is server-sync truth within retention; device archive is long-term local history
WebSocket is a notification channel
REST/sync repairs lost realtime events
TTL from day one
media encrypted before upload
local media storage behind a port; S3 only when needed
generic Web Push payload; no plaintext notification preview
WebSocket for foreground, Push for background, sync for correctness
no unnecessary distributed systems
opaque HttpOnly server session by default; no persistent browser JWT
local encrypted history may outlive server TTL
tests before cleverness
migration for every schema change
no custom cryptographic protocol
```

Если приходится выбирать между «очень умной» архитектурой и простой архитектурой, которую можно проверить и поддерживать на одном небольшом VPS — выбираем вторую.
