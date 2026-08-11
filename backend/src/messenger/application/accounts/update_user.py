"""Update one managed account and enforce deactivation session revocation."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.errors import (
    AccountActivationRequiredError,
    ManagedUserNotFoundError,
    SelfDeactivationError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import (
    IdentityUnitOfWork,
    IdentityUnitOfWorkFactory,
    ManagedUserRecord,
)
from messenger.domain.entities import User


@dataclass(frozen=True, slots=True)
class UpdateManagedUserCommand:
    actor_user_id: UUID
    target_user_id: UUID
    display_name: str | None = None
    is_active: bool | None = None


@dataclass(frozen=True, slots=True)
class UpdateManagedUserResult:
    user_id: UUID
    display_name: str
    is_active: bool
    activation_pending: bool
    can_reactivate: bool
    revoked_sessions: int


class UpdateManagedUser:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: UpdateManagedUserCommand) -> UpdateManagedUserResult:
        if command.display_name is None and command.is_active is None:
            raise ValueError("at least one managed user field is required")
        now = self._clock.now()
        revoked_sessions = 0

        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, command.actor_user_id)
            record = await uow.users.get_managed_by_id(
                command.target_user_id,
                for_update=True,
            )
            if record is None:
                raise ManagedUserNotFoundError("managed user was not found")

            user = record.user
            if command.display_name is not None and command.display_name != user.display_name:
                user = user.rename(command.display_name, now)

            if command.is_active is False and user.is_active:
                if user.id == command.actor_user_id:
                    raise SelfDeactivationError("administrator cannot deactivate self")
                user = user.deactivate(now)
                revoked_sessions = await self._revoke_sessions(uow, user.id, now)
            elif command.is_active is True and not user.is_active:
                if not record.password_configured:
                    raise AccountActivationRequiredError("invited account must complete activation")
                user = user.reactivate(now)

            await uow.users.update(user)
            await uow.commit()

        return self._result(user_record=record, user=user, revoked_sessions=revoked_sessions)

    @staticmethod
    async def _revoke_sessions(
        uow: IdentityUnitOfWork,
        user_id: UUID,
        now: datetime,
    ) -> int:
        records = await uow.sessions.list_for_user_for_update(user_id)
        revoked = 0
        for item in records:
            if item.session.revoked_at is None:
                await uow.sessions.update(item.session.revoke(now))
                revoked += 1
            if item.device.revoked_at is None:
                await uow.devices.update(item.device.revoke(now))
        return revoked

    @staticmethod
    def _result(
        *,
        user_record: ManagedUserRecord,
        user: User,
        revoked_sessions: int,
    ) -> UpdateManagedUserResult:
        return UpdateManagedUserResult(
            user_id=user.id,
            display_name=user.display_name,
            is_active=user.is_active,
            activation_pending=(not user.is_active and not user_record.password_configured),
            can_reactivate=(not user.is_active and user_record.password_configured),
            revoked_sessions=revoked_sessions,
        )
