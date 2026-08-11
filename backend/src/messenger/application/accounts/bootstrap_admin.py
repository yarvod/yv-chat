"""One-time initial administrator bootstrap use case."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import BootstrapAlreadyCompletedError
from messenger.application.password_policy import validate_new_password
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.passwords import PasswordHasher
from messenger.domain.entities import User


@dataclass(frozen=True, slots=True)
class BootstrapAdminCommand:
    """Explicit initial administrator credentials."""

    username: str
    display_name: str
    password: str


@dataclass(frozen=True, slots=True)
class BootstrapAdminResult:
    """Non-sensitive bootstrap outcome."""

    user_id: UUID
    username: str


class BootstrapAdmin:
    """Create exactly one initial administrator while the database is empty."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        passwords: PasswordHasher,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._passwords = passwords

    async def execute(self, command: BootstrapAdminCommand) -> BootstrapAdminResult:
        """Atomically close bootstrap after creating the initial admin."""
        validate_new_password(command.password)
        user = User.create(
            username=command.username,
            display_name=command.display_name,
            now=self._clock.now(),
            is_admin=True,
        )

        async with self._unit_of_work() as uow:
            await uow.users.lock_initial_bootstrap()
            if await uow.users.has_any():
                raise BootstrapAlreadyCompletedError("initial admin already exists")

            password_hash = await self._passwords.hash(command.password)
            await uow.users.add_active(user, password_hash)
            await uow.commit()

        return BootstrapAdminResult(user_id=user.id, username=user.username)
