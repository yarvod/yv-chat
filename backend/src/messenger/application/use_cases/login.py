"""Password login and device-bound opaque session issuance."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.errors import InvalidCredentialsError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.session_policy import SessionPolicy
from messenger.domain.entities import Device, Session


@dataclass(frozen=True, slots=True)
class LoginCommand:
    """Credentials plus transport-supplied device metadata."""

    username: str
    password: str
    device_name: str
    client_ip: str | None = None


@dataclass(frozen=True, slots=True)
class LoginResult:
    """Issued plaintext credential must be placed in a protected cookie later."""

    user_id: UUID
    session_id: UUID
    device_id: UUID
    session_credential: str
    idle_expires_at: datetime
    absolute_expires_at: datetime


class Login:
    """Verify a password, enroll a device and issue one opaque session."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        passwords: PasswordHasher,
        credentials: SessionCredentialService,
        policy: SessionPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._passwords = passwords
        self._credentials = credentials
        self._policy = policy

    async def execute(self, command: LoginCommand) -> LoginResult:
        """Return the same failure for unknown, inactive and wrong-password users."""
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            authentication = await uow.users.get_authentication_by_username(command.username)
            password_hash = None
            if authentication is not None and authentication.user.is_active:
                password_hash = authentication.password_hash
            password_is_valid = await self._passwords.verify(password_hash, command.password)
            if authentication is None or not authentication.user.is_active or not password_is_valid:
                raise InvalidCredentialsError("invalid username or password")

            device = Device.create(
                user_id=authentication.user.id,
                name=command.device_name,
                now=now,
                client_ip=command.client_ip,
            )
            generated = self._credentials.generate()
            session = Session.create(
                user_id=authentication.user.id,
                device_id=device.id,
                token_hash=generated.digest,
                now=now,
                idle_timeout=self._policy.idle_timeout,
                absolute_lifetime=self._policy.absolute_lifetime,
            )
            await uow.devices.add(device)
            await uow.sessions.add(session)
            await uow.commit()

        return LoginResult(
            user_id=session.user_id,
            session_id=session.id,
            device_id=device.id,
            session_credential=generated.plaintext,
            idle_expires_at=session.idle_expires_at,
            absolute_expires_at=session.absolute_expires_at,
        )
