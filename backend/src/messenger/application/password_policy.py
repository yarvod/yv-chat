"""Bounded password policy shared by enrollment operations."""

from messenger.application.errors import WeakPasswordError


def validate_new_password(password: str) -> None:
    """Enforce length bounds without composition rules."""
    if len(password) < 12:
        raise WeakPasswordError("password must contain at least 12 characters")
    if len(password) > 128:
        raise WeakPasswordError("password must contain at most 128 characters")
