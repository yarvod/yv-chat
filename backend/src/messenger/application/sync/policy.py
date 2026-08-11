"""Bounded durable sync retention and page policy."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True, slots=True)
class SyncPolicy:
    retention: timedelta = timedelta(days=30)
    default_page_size: int = 100
    max_page_size: int = 200

    def __post_init__(self) -> None:
        if self.retention <= timedelta(0):
            raise ValueError("sync retention must be positive")
        if not 1 <= self.default_page_size <= self.max_page_size:
            raise ValueError("sync page sizes are invalid")
        if self.max_page_size > 1000:
            raise ValueError("sync max page size is too large")
