"""Track explicit activation-token revocation during reissue.

Revision ID: 0005_activation_token_revocation
Revises: 0004_security_events
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_activation_token_revocation"
down_revision: str | None = "0004_security_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add mutually exclusive revocation state to activation credentials."""
    op.add_column(
        "activation_tokens",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_activation_tokens_revoked_after_created"),
        "activation_tokens",
        "revoked_at IS NULL OR revoked_at >= created_at",
    )
    op.create_check_constraint(
        op.f("ck_activation_tokens_not_used_and_revoked"),
        "activation_tokens",
        "NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)",
    )


def downgrade() -> None:
    """Remove explicit activation-token revocation state."""
    op.drop_constraint(
        op.f("ck_activation_tokens_not_used_and_revoked"),
        "activation_tokens",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_activation_tokens_revoked_after_created"),
        "activation_tokens",
        type_="check",
    )
    op.drop_column("activation_tokens", "revoked_at")
