"""User domain entity."""

import re
from dataclasses import dataclass, replace
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

    @classmethod
    def invite(
        cls,
        *,
        username: str,
        display_name: str,
        now: datetime,
        user_id: UUID | None = None,
    ) -> "User":
        """Create an inactive account awaiting one-time activation."""
        active_user = cls.create(
            username=username,
            display_name=display_name,
            now=now,
            user_id=user_id,
        )
        return replace(active_user, is_active=False)

    def activate(self, now: datetime) -> "User":
        """Transition an invited user to an active account."""
        if self.is_active:
            raise DomainValidationError("user is already active")
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("activation time must not be before created_at")
        return replace(self, is_active=True, updated_at=timestamp)

    def activate_with_identity(
        self,
        *,
        username: str,
        display_name: str,
        now: datetime,
    ) -> "User":
        """Let a legacy invited account claim its identity during activation."""
        if self.is_active:
            raise DomainValidationError("user is already active")
        claimed = User.create(
            user_id=self.id,
            username=username,
            display_name=display_name,
            now=self.created_at,
            is_admin=self.is_admin,
        )
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("activation time must not be before created_at")
        return replace(claimed, updated_at=timestamp)

    def rename(self, display_name: str, now: datetime) -> "User":
        """Change the user-visible name without changing identity or authorization."""
        normalized_name = normalize_bounded_text(
            display_name,
            field_name="display_name",
            maximum_length=80,
        )
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("updated_at cannot move backwards")
        return replace(self, display_name=normalized_name, updated_at=timestamp)

    def deactivate(self, now: datetime) -> "User":
        """Disable login while preserving the durable account identity."""
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("updated_at cannot move backwards")
        if not self.is_active:
            return self
        return replace(self, is_active=False, updated_at=timestamp)

    def reactivate(self, now: datetime) -> "User":
        """Re-enable a previously activated account after application policy checks."""
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("updated_at cannot move backwards")
        if self.is_active:
            return self
        return replace(self, is_active=True, updated_at=timestamp)

    def credentials_changed(self, now: datetime) -> "User":
        """Record a successful credential change without carrying password material."""
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("updated_at cannot move backwards")
        if not self.is_active:
            raise DomainValidationError("inactive user credentials cannot be changed")
        return replace(self, updated_at=timestamp)

    def credentials_reset(self, now: datetime) -> "User":
        """Record an authorized recovery while preserving blocked account state."""
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("updated_at cannot move backwards")
        return replace(self, updated_at=timestamp)
