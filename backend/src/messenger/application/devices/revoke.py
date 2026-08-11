"""Revoke one non-current device/session owned by the authenticated user."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import (
    CurrentDeviceRevocationError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class RevokeMyDeviceCommand:
    user_id: UUID
    current_session_id: UUID
    device_id: UUID


class RevokeMyDevice:
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

    async def execute(self, command: RevokeMyDeviceCommand) -> None:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            record = await uow.sessions.get_by_device_for_user_for_update(
                user_id=command.user_id,
                device_id=command.device_id,
            )
            if record is None or record.device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("device was not found")
            if record.session.id == command.current_session_id:
                raise CurrentDeviceRevocationError("current device must use logout")
            await uow.sessions.update(record.session.revoke(now))
            await uow.devices.update(record.device.revoke(now))
            await uow.security_events.prune_expired(now)
            await uow.security_events.add(
                SecurityEvent.create(
                    user_id=command.user_id,
                    event_type=SecurityEventType.DEVICE_REVOKED,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=command.current_session_id,
                    target_device_id=record.device.id,
                )
            )
            await uow.commit()
