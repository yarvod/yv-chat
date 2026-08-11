"""Add current-account credential security event types.

Revision ID: 0007_account_security_events
Revises: 0006_conversations
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007_account_security_events"
down_revision: str | None = "0006_conversations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ALLOWED = (
    "event_type IN ('login', 'logout', 'credential_replay', "
    "'device_renamed', 'device_revoked', 'other_sessions_revoked')"
)
NEW_ALLOWED = (
    "event_type IN ('login', 'logout', 'credential_replay', "
    "'device_renamed', 'device_revoked', 'other_sessions_revoked', "
    "'password_changed', 'security_reset')"
)


def upgrade() -> None:
    """Permit typed password-change and security-reset audit events."""
    op.drop_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        NEW_ALLOWED,
    )


def downgrade() -> None:
    """Restore the prior event-type set after removing unsupported rows."""
    op.execute(
        "DELETE FROM security_events WHERE event_type IN ('password_changed', 'security_reset')"
    )
    op.drop_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        OLD_ALLOWED,
    )
