"""Time boundary for business logic."""

from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    """Provide timezone-aware current time."""

    def now(self) -> datetime:
        """Return the current instant."""
        ...
