"""Small validation functions shared by identity entities."""

from datetime import datetime

from messenger.domain.exceptions import DomainValidationError


def require_aware_datetime(value: datetime, field_name: str) -> datetime:
    """Reject ambiguous naive timestamps at the domain boundary."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise DomainValidationError(f"{field_name} must be timezone-aware")
    return value


def normalize_bounded_text(
    value: str,
    *,
    field_name: str,
    maximum_length: int,
) -> str:
    """Strip display text and enforce its storage bounds."""
    normalized = value.strip()
    if not normalized:
        raise DomainValidationError(f"{field_name} must not be empty")
    if len(normalized) > maximum_length:
        raise DomainValidationError(
            f"{field_name} must contain at most {maximum_length} characters"
        )
    return normalized
