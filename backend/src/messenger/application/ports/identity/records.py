"""Typed records returned across identity repository ports."""

from dataclasses import dataclass

from messenger.domain.entities import Device, Session, User


@dataclass(frozen=True, slots=True)
class UserAuthenticationRecord:
    user: User
    password_hash: str | None


@dataclass(frozen=True, slots=True)
class SessionCredentialMatch:
    session: Session
    matched_previous: bool


@dataclass(frozen=True, slots=True)
class DeviceSessionRecord:
    device: Device
    session: Session
