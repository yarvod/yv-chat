"""Redeem a standalone invitation into an account and browser session."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.errors import (
    DuplicateUsernameError,
    InvalidRegistrationInvitationError,
)
from messenger.application.password_policy import validate_new_password
from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import Device, SecurityEvent, SecurityEventType, Session, User


@dataclass(frozen=True, slots=True)
class RegisterWithInvitationCommand:
    activation_secret: str
    username: str
    display_name: str
    password: str
    device_name: str
    client_ip: str | None = None


@dataclass(frozen=True, slots=True)
class RegisterWithInvitationResult:
    user_id: UUID
    session_id: UUID
    device_id: UUID
    session_credential: str
    registered_at: datetime
    absolute_expires_at: datetime


class RegisterWithInvitation:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        secrets: ActivationSecretService,
        passwords: PasswordHasher,
        credentials: SessionCredentialService,
        policy: SessionPolicy,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._secrets = secrets
        self._passwords = passwords
        self._credentials = credentials
        self._policy = policy
        self._event_policy = event_policy

    async def execute(
        self,
        command: RegisterWithInvitationCommand,
    ) -> RegisterWithInvitationResult:
        """Validate the invitation before username disclosure or Argon2 work."""
        token_hash = self._secrets.digest(command.activation_secret)
        now = self._clock.now()

        async with self._unit_of_work() as uow:
            invitation = await uow.registration_invitations.get_by_hash_for_update(token_hash)
            legacy_token = None
            legacy_user = None
            if invitation is not None:
                if (
                    invitation.used_at is not None
                    or invitation.revoked_at is not None
                    or invitation.is_expired(now)
                ):
                    raise InvalidRegistrationInvitationError("registration invitation is invalid")
                user = User.create(
                    username=command.username,
                    display_name=command.display_name,
                    now=now,
                )
            else:
                legacy_token = await uow.activation_tokens.get_by_hash_for_update(token_hash)
                if (
                    legacy_token is None
                    or legacy_token.used_at is not None
                    or legacy_token.revoked_at is not None
                    or legacy_token.is_expired(now)
                ):
                    raise InvalidRegistrationInvitationError("registration invitation is invalid")
                legacy_user = await uow.users.get_by_id(legacy_token.user_id, for_update=True)
                if legacy_user is None or legacy_user.is_active:
                    raise InvalidRegistrationInvitationError("registration invitation is invalid")
                user = legacy_user.activate_with_identity(
                    username=command.username,
                    display_name=command.display_name,
                    now=now,
                )

            existing = await uow.users.get_by_username(user.username)
            if existing is not None and existing.id != user.id:
                raise DuplicateUsernameError("username is already in use")
            validate_new_password(command.password)

            password_hash = await self._passwords.hash(command.password)
            device = Device.create(
                user_id=user.id,
                name=command.device_name,
                now=now,
                client_ip=command.client_ip,
            )
            generated = self._credentials.generate()
            session = Session.create(
                user_id=user.id,
                device_id=device.id,
                token_hash=generated.digest,
                now=now,
                idle_timeout=self._policy.idle_timeout,
                absolute_lifetime=self._policy.absolute_lifetime,
            )
            redeemed = invitation.redeem(user_id=user.id, now=now) if invitation else None
            consumed_legacy = legacy_token.mark_used(now) if legacy_token else None

            if legacy_user is None:
                await uow.users.add_active(user, password_hash)
            else:
                await uow.users.activate(user, password_hash)
            await uow.devices.add(device)
            await uow.sessions.add(session)
            if redeemed is not None:
                await uow.registration_invitations.update_lifecycle(redeemed)
            if consumed_legacy is not None:
                await uow.activation_tokens.update_lifecycle(consumed_legacy)
            await uow.security_events.prune_expired(now)
            await uow.security_events.add(
                SecurityEvent.create(
                    user_id=user.id,
                    event_type=SecurityEventType.LOGIN,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=session.id,
                    target_device_id=device.id,
                )
            )
            await uow.commit()

        return RegisterWithInvitationResult(
            user_id=user.id,
            session_id=session.id,
            device_id=device.id,
            session_credential=generated.plaintext,
            registered_at=now,
            absolute_expires_at=session.absolute_expires_at,
        )
