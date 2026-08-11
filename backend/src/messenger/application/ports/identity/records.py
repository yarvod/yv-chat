"""Typed records returned across identity repository ports."""

from dataclasses import dataclass

from messenger.domain.entities import Device, Session, User


@dataclass(frozen=True, slots=True)
class UserAuthenticationRecord:
    user: User
    password_hash: str | None


@dataclass(frozen=True, slots=True)
class ManagedUserRecord:
    """Account state needed by administrator operations without exposing a hash."""

    user: User
    password_configured: bool


@dataclass(frozen=True, slots=True)
class ManagedUserPageRecord:
    items: list[ManagedUserRecord]
    total: int


@dataclass(frozen=True, slots=True)
class SessionCredentialMatch:
    session: Session
    matched_previous: bool


@dataclass(frozen=True, slots=True)
class DeviceSessionRecord:
    device: Device
    session: Session
