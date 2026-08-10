"""System clock adapter."""

from datetime import UTC, datetime


class SystemClock:
    """Return timezone-aware UTC timestamps."""

    def now(self) -> datetime:
        return datetime.now(UTC)
