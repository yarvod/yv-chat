# ADR-0006: Extend production server retention to one year

Status: accepted and production deployed (`WP-125`)

## Context

Messages currently persist an absolute `expires_at` at creation time. Committed
attachments inherit that timestamp, while pending uploads have an independent
bounded lifetime. Changing environment variables therefore affects new writes only;
it neither extends existing rows nor restores ciphertext/media already removed by
cleanup.

Production needs a switch from 30 days to 365 days without shortening any existing
expiry and without allowing pending uploads to become permanent. Tombstones must
remain available longer than both ciphertext and sync-event retention.

## Decision

Set production `MESSAGE_CIPHERTEXT_RETENTION_SECONDS` to `31536000` and
`MESSAGE_TOMBSTONE_RETENTION_SECONDS` to `63072000`. Keep sync events at 30 days and
pending uploads at 24 hours.

Add an extension-only data migration for the rollout:

- active messages move to `max(current expires_at, created_at + 365 days)`;
- committed attachments linked to those active messages move to the resulting
  message expiry;
- tombstones and pending attachments are unchanged.

Add an application reconciliation operation that performs the same extension using
the effective typed runtime policy. Deployment runs it after the new API and cleanup
containers are healthy. This closes the small interval in which the migration has
completed but an old API container can still create a 30-day row.

Reconciliation is monotonic: a later configuration decrease affects new messages
only and does not retroactively shorten stored rows. Retroactive shortening, if ever
required, needs a separate explicit operation and review because it is destructive.

## Consequences

- Existing active ciphertext and committed opaque media are retained for at least
  365 days from message creation; already deleted data cannot be recovered.
- Re-running migration/deployment is idempotent and emits only aggregate counts.
- A longer server window increases PostgreSQL/media disk usage. Existing per-file and
  per-user quotas remain, but global disk pressure controls stay tracked in `BL-019`.
- The Alembic downgrade is intentionally data-no-op: the original per-row expiry
  cannot be reconstructed safely, and shortening data during code rollback would be
  destructive.
- Forever and per-conversation/type policies remain future `BL-018` work.
