# AGENTS.md

This file contains repository-wide instructions for coding agents, including OpenAI Codex.

Its scope is the whole repository unless a more deeply nested `AGENTS.md` provides stricter or more specific instructions for a subdirectory.

## Mission

Build and maintain a small, secure, self-hosted private messenger for roughly 10–15 trusted users.

Primary stack:

- Backend: Python, FastAPI, SQLAlchemy 2.x, Alembic, PostgreSQL.
- Frontend: Nuxt, Vue, TypeScript, PWA.
- Runtime: Docker Compose, Nginx.
- CI/CD: GitHub Actions.
- Future calls: WebRTC + coturn.

Optimize for:

1. correctness;
2. security;
3. maintainability;
4. simplicity;
5. low VPS resource usage.

Do not optimize for hypothetical scale that the project does not need.

---

## Read before changing code

Before making changes:

1. Read `README.md`.
2. Inspect the relevant package/module and its tests.
3. Look for nested `AGENTS.md` files in the directory tree you will modify.
4. Inspect existing patterns before introducing a new abstraction.
5. If changing persistence, inspect Alembic migrations.
6. If changing HTTP or WebSocket behavior, inspect tests and existing protocol schemas.
7. If changing security-sensitive behavior, identify the security invariants affected before editing code.

Do not assume a library, directory, command, endpoint, table, environment variable, or architectural abstraction exists. Verify it in the repository first.

---

## Core architecture

Use Clean Architecture dependency direction:

```text
presentation -> application -> domain
infrastructure -> application ports
```

### Domain

The domain layer must not depend on:

- FastAPI;
- SQLAlchemy;
- PostgreSQL;
- HTTP;
- WebSocket;
- Docker;
- filesystem implementations;
- framework-specific request/response models.

Domain objects should model business rules and invariants.

### Application

The application layer contains:

- use cases;
- commands;
- queries;
- ports/interfaces/protocols;
- orchestration.

It may depend on domain.

It must not depend directly on concrete infrastructure implementations.

### Infrastructure

Infrastructure contains concrete adapters:

- SQLAlchemy repositories;
- PostgreSQL integration;
- storage;
- authentication implementation;
- push providers;
- external services.

Infrastructure implements application ports.

### Presentation

Presentation contains:

- FastAPI routes;
- request/response DTOs;
- dependency wiring related to transport;
- WebSocket transport mapping.

Do not put core business rules in route handlers.

---

## Simplicity rules

Do not introduce the following unless there is a demonstrated requirement and the task explicitly justifies it:

- microservices;
- Kafka;
- RabbitMQ;
- Redis;
- Celery;
- Kubernetes;
- MinIO;
- Elasticsearch;
- service mesh;
- separate API gateway;
- server-side video transcoding.

For the expected load, prefer a single FastAPI application + PostgreSQL + filesystem media storage + cleanup process.

Do not create generic abstractions before there are at least two real consumers or a clear boundary that needs an interface.

Avoid "enterprise" patterns that make a 10-user system harder to understand.

---

## Security invariants

These rules are mandatory.

### Message confidentiality

The server must not require plaintext user messages for normal messaging operation.

Never add database fields such as:

```text
plaintext
message_text
decrypted_body
message_key
```

for E2EE messages.

Never add debug logging that prints decrypted content.

### Attachments

Attachments must be encrypted on the client before upload once E2EE is active.

The server stores opaque encrypted bytes.

Never use a user-provided filename directly as a filesystem path.

Generate an opaque storage key on the server.

Validate:

- maximum size;
- authorization;
- ownership/conversation access;
- storage quota.

### Cryptography

Do not invent a custom cryptographic protocol.

Do not implement a home-grown secure messenger by simply combining crypto primitives.

Prefer the protocol selected and documented by the project.

If the selected E2EE protocol is not yet finalized, do not silently choose one inside an unrelated feature PR.

Any change to:

- key establishment;
- identity keys;
- group membership crypto;
- key rotation;
- file encryption;
- protocol framing;
- crypto persistence;

requires explicit tests and documentation.

Do not downgrade cryptographic behavior to make a test pass.

### Secrets

Never commit:

- passwords;
- JWT signing secrets;
- production `.env`;
- private keys;
- database production credentials;
- activation tokens;
- refresh tokens;
- Web Push private keys.

Use `.env.example` only for non-secret example values.

### Logging

Never log:

- passwords;
- plaintext messages;
- decrypted attachments;
- refresh tokens;
- activation tokens;
- Authorization headers;
- private crypto keys.

Prefer structured logs with opaque IDs.

---

## Authentication rules

Public self-registration is not part of the product.

Users are created through an admin-controlled flow.

Do not accidentally expose a public "register anyone" endpoint.

Password storage must use a modern password-hashing function configured by the project.

### Browser session policy

For the same-origin PWA + FastAPI deployment, prefer an opaque server-side session over a browser-persisted JWT.

The browser session credential should be an opaque cryptographically random cookie with:

```text
Secure
HttpOnly
SameSite=Strict
Path=/
no Domain attribute
```

Store only a hash/derived lookup value for the session credential in PostgreSQL.

Sessions must be:

- revocable;
- scoped to a user + device;
- subject to idle and absolute expiry;
- invalidated on logout/device revoke/security reset as appropriate.

Do not store access JWTs, refresh tokens, or session bearer credentials in `localStorage`.

Do not store browser auth bearer credentials in IndexedDB merely for convenience.

Cookie-authenticated state-changing HTTP endpoints require CSRF defenses and strict Origin/CORS handling.

Same-origin WebSocket authentication should use the session cookie during the handshake and must validate `Origin`. Do not put auth bearer tokens into WebSocket query strings.

### Session renewal and credential rotation

Opaque server-side sessions do not require a separate refresh token.

Each session must support:

```text
idle expiry
absolute expiry
revocation
```

Use a sliding idle timeout for meaningful authenticated activity, but never extend `absolute_expires_at`.

Do not let WebSocket heartbeat alone keep an authentication session alive indefinitely.

Persist `last_seen_at` / session touch with throttling rather than a database write per request.

Credential rotation may be performed opportunistically during normal authenticated requests.

If rotating the opaque session credential:

- generate a new cryptographically random token;
- store only its hash/derived lookup value;
- keep the logical `session_id` and `device_id`;
- use a short previous-token grace period for concurrent requests;
- make rotation concurrency-safe/atomic;
- never expose current or previous token hashes through APIs/logs.

A default design may use approximately:

```text
idle timeout: 30 days
absolute lifetime: 90 days
rotation interval: 24 hours
previous-token grace: 60 seconds
```

Treat these as configuration, not hard-coded domain constants.

A frontend should not need a periodic JWT-style `refresh()` timer for the opaque-session design. `Set-Cookie` rotation can happen transparently on ordinary authenticated responses.

If an expired previous credential is replayed after its grace period, treat it as a strong compromise signal and revoke the affected session according to the security policy.

### IP/network/browser changes

IP, GeoIP, User-Agent, Client Hints, browser version, OS version, and device model are metadata/risk signals only.

Do not automatically revoke a valid session solely because:

```text
IP changed
network changed
city/country estimate changed
browser version changed
device model metadata changed/disappeared
```

Legitimate users frequently change networks because of mobile carriers, Wi-Fi/LTE transitions, VPNs, ISP changes, travel, IPv4/IPv6, and browser updates.

On normal IP change:

1. validate the existing session normally;
2. update `last_ip` with throttling/policy;
3. optionally refresh approximate GeoIP metadata;
4. optionally create a bounded-retention security event.

Use combinations of signals for risk evaluation, not one metadata field.

Sensitive operations may require step-up authentication, but approximate network/device metadata must not be the sole authorization factor.

Immediate session revocation is appropriate for explicit or strong events such as:

```text
user-requested termination
device revoke
security/password reset policy
confirmed credential replay/compromise
idle expiry
absolute expiry
admin security action
```

### Active device/session management

Every authenticated session must be associated with a `device_id`.

The account security UI should be able to list current and other active sessions and revoke them individually.

Session/device metadata may include:

```text
normalized browser family/version
OS family/version
device class
device model when actually available
login IP
last IP
approximate GeoIP snapshot
created_at
last_seen_at
revoked_at
```

Browser/device-model detection is best-effort metadata only.

Never use parsed User-Agent, Client Hints, device model, city, or IP geolocation as a strong authentication factor or authorization boundary.

Allow a user-editable device display name because exact hardware model is not guaranteed to be available in browsers.

Obtain client IP only from a correctly configured trusted reverse-proxy chain. Never trust arbitrary client-supplied `X-Forwarded-For`.

Treat GeoIP as approximate. VPNs, mobile gateways, proxies, and ISP routing can make it inaccurate. Do not request GPS/browser geolocation merely to populate active-session UI.

Persist `last_seen_at` with write throttling. Do not write a database row on every authenticated request solely to update presence.

Realtime `is_online` may be derived from active WebSocket connection state, but it is best-effort and must have heartbeat timeout semantics.

Session-list API responses must never expose:

```text
session token
token_hash
refresh credential
private crypto key material
```

Provide explicit use cases/endpoints for:

```text
list my devices
rename my device
revoke one session/device
revoke all other sessions
```

### Opaque sessions vs JWT

For this single-backend, small-scale browser application, opaque server-side sessions are the default.

JWT is a token format and can itself be carried in a cookie; do not conflate "cookie" with "opaque session".

The relevant architectural choice is:

```text
opaque random credential + server-side state
vs
self-contained signed JWT access token
```

Prefer the opaque session because this product explicitly needs:

```text
instant device/session revocation
active-device listing
logout-all-others
device-bound session state
security-event visibility
```

Do not introduce JWT merely because it is common.

If JWT is later introduced, document the actual distributed/resource-server requirement that justifies it.

### Optional JWT mode

If the architecture later genuinely requires JWT access tokens:

- access JWTs must be short-lived;
- keep the access JWT in memory rather than persistent browser storage;
- use an opaque refresh credential in an HttpOnly/Secure/SameSite cookie;
- rotate refresh credentials;
- store only refresh/session hashes server-side;
- validate signature, allowed algorithm, issuer, audience, and expiration;
- do not put secrets or message content in JWT claims.

Refresh credentials must be revocable and scoped to a session/device.

Authorization must be checked server-side for every protected resource.

Never trust a `user_id`, `device_id`, `conversation_id`, or role supplied by the client without verifying access.

---

## User and device model

A user and a device are different concepts.

Do not collapse device identity into user identity.

Assume a user may have multiple devices.

Security-sensitive state such as crypto identity, session revocation, and last-seen information may be device-specific.

---

## Messaging rules

PostgreSQL is the authoritative source for server-side sync state within the configured retention window.

It is not required to retain the complete lifetime history forever.

A successfully synchronized device may keep an encrypted local conversation archive longer than server retention.

WebSocket is a realtime notification channel, not the sole data source.

Every realtime feature must remain correct when:

- the socket disconnects;
- events are missed;
- the device sleeps;
- the client reconnects later.

Implement or preserve a cursor/sequence-based catch-up sync mechanism.

Message creation must be idempotent against client retries.

Avoid generating duplicate messages when the same request is retried.

---

## Message ordering

Do not rely only on client timestamps for authoritative message order.

Use the repository's server-side sequence/cursor strategy.

If changing ordering semantics, add tests for:

- concurrent messages;
- reconnect;
- pagination;
- duplicate retries;
- stable ordering.

---

## TTL and deletion

TTL is a first-class feature.

Expired message/media cleanup must be:

- idempotent;
- safe to retry;
- authorized by server-side timestamps/policy;
- tolerant of already-missing files.

Do not silently delete unexpired permanent user data merely because disk space is low.

Do not create a backup strategy that makes "deleted after TTL" effectively mean "stored forever".

Server retention and local device retention are distinct policies.

Deleting expired ciphertext from the server does not automatically require deleting an already synchronized encrypted local archive.

A new device must not assume the server contains history older than the retention window.

Historical device migration should use an explicit secure device-to-device transfer design rather than silently extending server retention.

`Delete for everyone` must be represented by a deletion/tombstone event that can reach offline devices; tombstones need their own retention policy sufficient for catch-up.

Do not claim that remote deletion can guarantee destruction of content already viewed or copied on another user's controlled device.

---

## Database rules

Use PostgreSQL.

Schema changes require Alembic migrations.

Do not rely on `metadata.create_all()` as a production migration strategy.

Never rewrite an already-applied production migration just to make a new schema work. Add a new migration.

When changing persistence:

1. update the domain/application model if needed;
2. update SQLAlchemy mapping;
3. create/update repository behavior;
4. add migration;
5. add tests.

Use database constraints for invariants that must remain true under concurrency where appropriate.

Be explicit about transaction boundaries.

Avoid N+1 queries in hot list endpoints.

---

## API rules

Keep externally observable API behavior versioned.

Current API prefix should follow:

```text
/api/v1
```

Do not leak ORM models directly as API responses.

Validate all external input.

Use appropriate HTTP status codes.

Do not expose stack traces, internal paths, SQL errors, or secret configuration to clients.

Admin endpoints must enforce admin authorization in application/server logic.

---

## WebSocket rules

Use explicit event types.

Prefer small notification events over duplicating entire server state.

Clients must be able to recover from missed events through sync.

Do not use in-process WebSocket presence state as durable truth.

If the backend remains a single process, in-memory connection tracking is acceptable. Do not add Redis solely for future hypothetical horizontal scaling.

---

## Frontend rules

Use TypeScript strictly.

Do not bypass type errors with unnecessary `any`, `@ts-ignore`, or broad unsafe casts.

Keep network access behind a small API/service layer instead of scattering raw fetch calls throughout components.

Keep crypto code isolated from visual components.

Keep IndexedDB access behind explicit repositories/services.

Do not store sensitive cryptographic material in `localStorage` when a safer project-supported storage mechanism exists.

Treat IndexedDB as the local structured store for conversation indexes, encrypted local message history, sync state, outbox, and protocol state.

Prefer OPFS/origin-private storage for large encrypted media cache where supported by the chosen frontend design.

Persistent local message history should be encrypted under a device-local storage key instead of keeping a convenient plaintext archive at rest.

Plaintext/decrypted message content should normally exist only in application memory while needed for rendering or processing.

Local media cache must be bounded and evictable; pinned media may use an explicit keep-on-device policy.

PWA update handling must account for IndexedDB schema compatibility.

---

## Client crypto boundary

UI components should not directly implement cryptographic primitives.

Use a crypto adapter/service boundary.

The rest of the frontend should work with intent-level operations such as:

```text
encryptMessage(...)
decryptMessage(...)
encryptAttachment(...)
decryptAttachment(...)
createOrJoinConversationCryptoState(...)
```

The actual protocol implementation remains behind that boundary.

Never expose private key material to logs or UI state inspectors intentionally.

---

## Files and media

Large uploads must be streamed/chunked where the chosen design supports it.

Do not load arbitrarily large files fully into backend RAM.

Respect configured upload limits.

Do not add server-side thumbnailing or transcoding that requires decrypting E2EE media.

If previews are required, generate them client-side or use a design compatible with E2EE.

### Media storage policy

For the initial single-VPS deployment, use `LocalMediaStorage` backed by `/data/media`.

Application code must depend on a `MediaStorage` port/interface rather than filesystem APIs or an S3 SDK directly.

Expected adapter shape:

```text
MediaStorage
├── LocalMediaStorage   # default / MVP
└── S3MediaStorage      # only when external object storage is actually needed
```

Do not add MinIO on the same single VPS merely to emulate S3. It increases operational and memory cost without creating an independent failure domain.

Do not persist absolute filesystem paths as business data. Persist opaque storage keys.

If S3-compatible storage is added later, keep vendor-specific configuration and SDK calls inside the infrastructure adapter.

---

## Web Push notifications

Use standards-based Web Push through Push API + Service Worker + VAPID unless the repository explicitly adopts another mechanism.

Push subscriptions are per device/install, not one global endpoint per user.

Never include plaintext message content or decrypted attachment information in push payloads.

Preferred MVP push payload contains only opaque routing/sync hints such as:

```text
event type
event_id
conversation_id
message_id
```

The client must fetch/sync ciphertext and decrypt locally.

WebSocket is for active realtime delivery. Web Push is for background wake-up/system notification. Sync remains the correctness mechanism.

Push delivery failure must not roll back an already committed message.

Treat push endpoint/key material as sensitive operational data and do not log it in full.

VAPID private keys are production secrets and must never be committed.

Disable/delete permanently invalid push subscriptions instead of retrying them forever.

WebSocket and push handling must be idempotent so one message cannot increment unread state twice.

Do not add plaintext notification previews as a temporary shortcut around E2EE.

---

## Calls

Voice/video calls are not part of the first messaging MVP.

When implementing calls:

- FastAPI handles signaling;
- WebRTC handles media;
- TURN is used as fallback;
- do not stream call media through normal FastAPI endpoints.

Do not prematurely add call complexity to unrelated messaging work.

---


## Python package/environment manager: `uv` only

The Python project uses **`uv` as the single project-level dependency and environment manager**.

The dependency source of truth is:

```text
backend/pyproject.toml
backend/uv.lock
```

Agents must not introduce or switch the normal workflow to:

```text
pip install
pip freeze
requirements.txt as the primary dependency manifest
Poetry
Pipenv
pip-tools
manual virtualenv management
```

Use:

```bash
uv sync
uv run <command>
uv add <package>
uv add --dev <package>
uv remove <package>
uv lock
```

Examples:

```bash
cd backend

uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest
uv run alembic upgrade head
```

When changing dependencies:

1. update them through `uv add`, `uv remove`, or an intentional `pyproject.toml` edit;
2. regenerate/update `uv.lock` with `uv`;
3. commit both relevant files;
4. do not edit `uv.lock` manually.

CI should prefer:

```bash
uv sync --frozen
```

so CI fails if the lockfile is inconsistent instead of silently changing it.

Docker builds should consume `pyproject.toml` and `uv.lock` and install with `uv`, preferably using a frozen lockfile.

If a low-level external bootstrap step technically uses `pip` to install `uv`, that does not make `pip` the project dependency manager.

Do not add a second Python package manager without an explicit repository-level architectural decision.


## Code design contract

Keep code explicit, strongly typed, cohesive, and boring.

- Use explicit Command/Query/Result DTOs instead of unstructured dictionaries across layers.
- Transport DTOs, application DTOs, domain entities, and ORM models are separate concepts.
- One use case models one application operation.
- Dependencies are constructor-injected; no hidden globals.
- Repository ports expose domain/application-relevant operations, not generic CRUD escape hatches.
- ORM objects do not escape infrastructure.
- Transaction boundaries follow application operations.
- Use typed application/domain errors rather than stringly `Exception`.
- Use a `Clock` for time-sensitive business logic and timezone-aware UTC.
- Read environment variables at bootstrap/config boundaries into typed validated settings.
- Do not create junk-drawer `utils.py`/`helpers.py` modules.
- Do not introduce factories/interfaces/managers merely because Clean Architecture exists.
- Keep the happy path readable top-to-bottom and avoid hidden side effects.
- Vue components remain UI-focused; API, crypto, IndexedDB/OPFS, push, and sync belong behind client services/adapters.
- Strict TypeScript: avoid `any`, `@ts-ignore`, and unsafe casts unless isolated at a justified external boundary.
- Do not silence static analysis instead of fixing the contract.

Before adding a class/interface/layer, identify the concrete problem it solves now. "Might be useful later" is not sufficient.

---

## Python style

Prefer modern Python.

General expectations:

- type annotate public functions and boundaries;
- use `async` only for actual async I/O paths;
- do not block the event loop with synchronous heavy I/O;
- use small focused functions;
- use domain-specific names;
- avoid giant service classes;
- avoid hidden global mutable state;
- prefer explicit dependency injection at application boundaries.

Do not catch broad `Exception` unless re-raising, translating at a boundary, or handling it intentionally with tests/logging.

Do not swallow exceptions silently.

Use timezone-aware UTC datetimes.

---

## FastAPI style

Keep routes thin.

A route should generally:

1. parse/validate transport input;
2. resolve authenticated principal;
3. call an application use case;
4. translate known application/domain errors;
5. serialize response.

Routes should not contain SQL queries directly.

Routes should not contain crypto protocol implementation.

---

## SQLAlchemy style

Use SQLAlchemy 2.x patterns consistently.

Keep ORM mapping concerns out of domain entities when practical.

Repository interfaces belong in application/domain boundaries according to the established project structure; concrete SQLAlchemy implementations belong in infrastructure.

Avoid lazy-loading surprises in async code.

Add explicit tests for query behavior that depends on relationships.

---

## TypeScript / Vue / Nuxt style

Prefer Composition API and the existing project conventions.

Keep components focused on presentation and interaction.

Move reusable state and business logic into composables/stores/services.

Do not put security-sensitive logic in a component just because it is convenient.

Avoid duplicating API schemas manually when the project has a generated/shared schema mechanism.

Do not introduce a second state-management library without a strong reason.

---

## Testing requirements

Every behavior change should have tests unless testing it is genuinely impractical. If so, explain why.

Before finishing a task, run the relevant checks defined by the repository.

Expected backend checks when available:

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest
```

Expected frontend checks when available:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected repository/config checks when available:

```bash
docker compose config
```

Prefer the repository's `make ci` command once it exists.

If a check fails because of your change, fix it.

Do not delete or weaken a test merely to make CI green unless the behavior was intentionally changed and the new expectation is correct.

---

## Security tests

Add negative authorization/security tests for security-sensitive changes.

Examples:

- non-member cannot read conversation messages;
- non-member cannot download attachment;
- normal user cannot call admin endpoint;
- revoked device cannot use its session;
- idle-expired session is rejected;
- absolute-expired session is rejected even after recent activity;
- session touch is throttled rather than written on every request;
- concurrent requests during credential rotation remain valid through the configured grace period;
- previous credential is rejected after grace period;
- replay of an expired previous credential triggers the defined compromise handling;
- changing IP alone does not revoke an otherwise valid session;
- current user cannot revoke another user's session by guessing an ID;
- session-list response never exposes token hashes/credentials;
- spoofed `X-Forwarded-For` cannot bypass trusted proxy IP handling;
- expired activation token cannot be reused;
- duplicate message request does not create duplicate rows;
- malformed ciphertext does not crash unrelated server state;
- path traversal filename does not escape storage root.

---

## Migration tests

If migrations are changed, validate at minimum:

```text
fresh database -> upgrade head
```

When practical, also validate upgrade from the previous schema version.

Do not assume a migration is correct because model tests pass.

---

## Git and change discipline

Keep changes focused on the user's task.

Do not refactor unrelated areas "while here" unless required for correctness.

Do not rename public APIs casually.

Do not silently change environment variable names.

Do not commit generated secrets or machine-local files.

Do not amend unrelated existing commits.

Before finishing:

1. inspect the diff;
2. ensure no secrets were added;
3. run relevant checks;
4. confirm new files are intentional;
5. summarize what changed;
6. report tests run and any checks not run.

---

## Documentation

Update documentation when changing:

- setup commands;
- environment variables;
- architecture boundaries;
- API behavior;
- crypto protocol;
- deployment;
- migrations;
- backup/restore;
- TTL semantics.

Do not let README commands drift from CI/Makefile commands.

When adding a new environment variable, update `.env.example`.

---

## Dependency policy

Prefer standard library or existing project dependencies when they are sufficient.

Before adding a dependency:

1. verify the repository does not already solve the problem;
2. explain what the dependency provides;
3. prefer actively maintained libraries;
4. avoid adding large frameworks for tiny tasks;
5. consider container/image/RAM cost.

Security-critical dependencies should be pinned/managed according to the repository's dependency policy.

Do not implement cryptographic primitives yourself to avoid adding a crypto dependency.

---

## Performance/resource budget

Target deployment is a small VPS.

Avoid designs that require high idle memory.

Do not assume unlimited storage.

Prefer:

- streaming I/O;
- bounded queues;
- database pagination;
- bounded upload sizes;
- TTL cleanup;
- simple background processes.

Do not cache unbounded message history in backend memory.

---

## Observability

Prefer structured logs and useful counters.

Do not add a heavyweight observability platform without need.

Useful operational signals include:

- HTTP 5xx count;
- WebSocket connections;
- failed logins;
- PostgreSQL size;
- media storage usage;
- cleanup deleted counts;
- disk free space.

Metrics/logs must not contain decrypted content or secrets.

---

## Docker rules

Production images should be reproducible and minimal.

Do not run development servers in production.

Do not expose PostgreSQL publicly.

Use healthchecks where useful.

Prefer building images in CI rather than on a 1–2 GB VPS.

Do not bake secrets into images.

---

## Nginx rules

Production ingress must use HTTPS.

WebSocket proxying must preserve upgrade headers.

Set explicit upload/body limits compatible with application limits.

Security headers must be reviewed rather than copied blindly.

Do not enable HSTS on an unverified domain/TLS setup during local development.

---

## CI/CD rules

CI must fail on real lint, typecheck, test, migration, or build failures.

Do not mark critical jobs `continue-on-error` to hide failures.

Production deployment should happen only from the designated protected branch/workflow.

Run database migrations intentionally as part of deployment.

Do not perform heavy Docker builds on the production VPS if GitHub Actions/GHCR can do them.

---

## Temporary implementations

A temporary transport implementation may use opaque/synthetic ciphertext while reliable messaging is being built before E2EE integration.

If so:

- clearly label it non-secure;
- never describe it as E2EE;
- do not ship it as production secure messaging;
- keep the API compatible with opaque ciphertext;
- remove plaintext shortcuts before the security milestone is considered complete.

Temporary code must have a clear removal path.

---

## Definition of Done for agent tasks

An agent task is not complete merely because code compiles.

Before declaring completion, check:

- architecture boundaries remain valid;
- authorization is correct;
- no sensitive data is logged;
- schema changes have migrations;
- tests cover changed behavior;
- realtime behavior recovers after reconnect where relevant;
- retry/idempotency remains correct where relevant;
- no server-side plaintext dependency was introduced;
- docs/config examples are updated;
- relevant lint/typecheck/tests/build pass.

Report exactly what you verified.

If something could not be verified, say so explicitly instead of guessing.

---

## When uncertain

For ordinary implementation details, inspect existing repository conventions and choose the simplest consistent solution.

For security-sensitive uncertainty, do not improvise.

Stop the risky design change, document the uncertainty, and prefer a conservative implementation that does not weaken security.

In particular, never invent cryptographic protocol behavior as a guess.
