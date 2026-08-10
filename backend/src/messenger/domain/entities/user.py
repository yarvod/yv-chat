"""User domain entity."""

import re
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import (
    normalize_bounded_text,
    require_aware_datetime,
)
from messenger.domain.exceptions import DomainValidationError

USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]{3,32}$")


@dataclass(frozen=True, slots=True)
class User:
    """An administrator-created messenger account."""

    id: UUID
    username: str
    display_name: str
    is_admin: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        """Keep loaded and newly created entities equally valid."""
        if self.username != self.username.strip().lower():
            raise DomainValidationError("username must be normalized")
        if USERNAME_PATTERN.fullmatch(self.username) is None:
            raise DomainValidationError("username has an invalid format")

        normalized_display_name = normalize_bounded_text(
            self.display_name,
            field_name="display_name",
            maximum_length=80,
        )
        if self.display_name != normalized_display_name:
            raise DomainValidationError("display_name must be trimmed")

        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.updated_at, "updated_at")
        if self.updated_at < self.created_at:
            raise DomainValidationError("updated_at must not be before created_at")

    @classmethod
    def create(
        cls,
        *,
        username: str,
        display_name: str,
        now: datetime,
        is_admin: bool = False,
        user_id: UUID | None = None,
    ) -> "User":
        """Create a user while enforcing normalized identity fields."""
        normalized_username = username.strip().lower()
        normalized_display_name = normalize_bounded_text(
            display_name,
            field_name="display_name",
            maximum_length=80,
        )
        timestamp = require_aware_datetime(now, "now")

        return cls(
            id=user_id or uuid4(),
            username=normalized_username,
            display_name=normalized_display_name,
            is_admin=is_admin,
            is_active=True,
            created_at=timestamp,
            updated_at=timestamp,
        )
