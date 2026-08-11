"""Update safe current-account profile fields."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import User


@dataclass(frozen=True, slots=True)
class UpdateCurrentProfileCommand:
    user_id: UUID
    display_name: str


class UpdateCurrentProfile:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: UpdateCurrentProfileCommand) -> User:
        async with self._unit_of_work() as unit_of_work:
            user = await unit_of_work.users.get_by_id(command.user_id, for_update=True)
            if user is None or not user.is_active:
                raise SessionNotAuthenticatedError("current account is unavailable")
            updated = user.rename(command.display_name, self._clock.now())
            await unit_of_work.users.update(updated)
            await unit_of_work.commit()
        return updated
