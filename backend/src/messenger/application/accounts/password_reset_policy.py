"""Validated password-reset lifetime policy."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True, slots=True)
class PasswordResetPolicy:
    ttl: timedelta

    def __post_init__(self) -> None:
        if self.ttl <= timedelta(0):
            raise ValueError("password reset TTL must be positive")
