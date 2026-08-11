"""Shared administrator authorization policy for account operations."""

from uuid import UUID

from messenger.application.errors import AuthorizationDeniedError
from messenger.application.ports.identity import UserRepository


async def require_active_admin(users: UserRepository, actor_user_id: UUID) -> None:
    """Reject missing, inactive and non-admin principals identically."""
    actor = await users.get_by_id(actor_user_id)
    if actor is None or not actor.is_active or not actor.is_admin:
        raise AuthorizationDeniedError("active administrator required")
