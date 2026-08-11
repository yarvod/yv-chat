"""Validated retention policy for account security events."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True, slots=True)
class SecurityEventPolicy:
    retention: timedelta

    def __post_init__(self) -> None:
        if self.retention <= timedelta(0):
            raise ValueError("security event retention must be positive")
