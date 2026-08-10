"""Rename one device owned by the authenticated user."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import OwnedDeviceNotFoundError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.security_event_policy import SecurityEventPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class RenameMyDeviceCommand:
    user_id: UUID
    current_session_id: UUID
    device_id: UUID
    name: str


@dataclass(frozen=True, slots=True)
class RenameMyDeviceResult:
    device_id: UUID
    name: str


class RenameMyDevice:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._event_policy = event_policy

    async def execute(self, command: RenameMyDeviceCommand) -> RenameMyDeviceResult:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_owned_by_id(
                user_id=command.user_id,
                device_id=command.device_id,
                for_update=True,
            )
            if device is None or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("device was not found")
            renamed = device.rename(command.name)
            await uow.devices.update(renamed)
            await uow.security_events.prune_expired(now)
            await uow.security_events.add(
                SecurityEvent.create(
                    user_id=command.user_id,
                    event_type=SecurityEventType.DEVICE_RENAMED,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=command.current_session_id,
                    target_device_id=device.id,
                )
            )
            await uow.commit()
        return RenameMyDeviceResult(device_id=renamed.id, name=renamed.name)
