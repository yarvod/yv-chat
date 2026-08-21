"""Add provider-aware native push destinations.

Revision ID: 0029_native_push
Revises: 0028_message_pins
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_native_push"
down_revision: str | None = "0028_message_pins"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "push_subscriptions",
        sa.Column("provider", sa.String(length=8), server_default="web", nullable=False),
    )
    op.add_column(
        "push_subscriptions",
        sa.Column("native_token", sa.String(length=4096), nullable=True),
    )
    op.alter_column("push_subscriptions", "endpoint", existing_type=sa.String(2048), nullable=True)
    op.alter_column("push_subscriptions", "p256dh", existing_type=sa.String(256), nullable=True)
    op.alter_column("push_subscriptions", "auth", existing_type=sa.String(128), nullable=True)
    op.drop_constraint(
        op.f("ck_push_subscriptions_endpoint_length"), "push_subscriptions", type_="check"
    )
    op.drop_constraint(
        op.f("ck_push_subscriptions_p256dh_length"), "push_subscriptions", type_="check"
    )
    op.drop_constraint(
        op.f("ck_push_subscriptions_auth_length"), "push_subscriptions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_endpoint_length"),
        "push_subscriptions",
        "endpoint IS NULL OR char_length(endpoint) BETWEEN 1 AND 2048",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_p256dh_length"),
        "push_subscriptions",
        "p256dh IS NULL OR char_length(p256dh) BETWEEN 1 AND 256",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_auth_length"),
        "push_subscriptions",
        "auth IS NULL OR char_length(auth) BETWEEN 1 AND 128",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_native_token_length"),
        "push_subscriptions",
        "native_token IS NULL OR char_length(native_token) BETWEEN 1 AND 4096",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_provider_value"),
        "push_subscriptions",
        "provider IN ('web', 'apns', 'fcm')",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_provider_material"),
        "push_subscriptions",
        "(provider = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL "
        "AND auth IS NOT NULL AND native_token IS NULL) OR "
        "(provider IN ('apns', 'fcm') AND endpoint IS NULL AND p256dh IS NULL "
        "AND auth IS NULL AND native_token IS NOT NULL)",
    )
    op.create_unique_constraint(
        "uq_push_subscriptions_native_token", "push_subscriptions", ["native_token"]
    )
    op.alter_column("push_subscriptions", "provider", server_default=None)


def downgrade() -> None:
    op.execute("DELETE FROM push_subscriptions WHERE provider != 'web'")
    op.drop_constraint(
        "uq_push_subscriptions_native_token", "push_subscriptions", type_="unique"
    )
    op.drop_constraint(
        op.f("ck_push_subscriptions_provider_material"), "push_subscriptions", type_="check"
    )
    op.drop_constraint(
        op.f("ck_push_subscriptions_provider_value"), "push_subscriptions", type_="check"
    )
    op.drop_constraint(
        op.f("ck_push_subscriptions_native_token_length"), "push_subscriptions", type_="check"
    )
    for name in ("endpoint_length", "p256dh_length", "auth_length"):
        op.drop_constraint(op.f(f"ck_push_subscriptions_{name}"), "push_subscriptions", type_="check")
    op.create_check_constraint(
        op.f("ck_push_subscriptions_endpoint_length"),
        "push_subscriptions",
        "char_length(endpoint) BETWEEN 1 AND 2048",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_p256dh_length"),
        "push_subscriptions",
        "char_length(p256dh) BETWEEN 1 AND 256",
    )
    op.create_check_constraint(
        op.f("ck_push_subscriptions_auth_length"),
        "push_subscriptions",
        "char_length(auth) BETWEEN 1 AND 128",
    )
    op.alter_column("push_subscriptions", "auth", existing_type=sa.String(128), nullable=False)
    op.alter_column("push_subscriptions", "p256dh", existing_type=sa.String(256), nullable=False)
    op.alter_column("push_subscriptions", "endpoint", existing_type=sa.String(2048), nullable=False)
    op.drop_column("push_subscriptions", "native_token")
    op.drop_column("push_subscriptions", "provider")
