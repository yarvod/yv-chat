"""Atomically revoke every session except the authenticated current one."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.devices.notify_roster_change import append_device_roster_events
from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sync import SyncPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class RevokeOtherSessionsCommand:
    user_id: UUID
    current_session_id: UUID


@dataclass(frozen=True, slots=True)
class RevokeOtherSessionsResult:
    revoked_count: int


class RevokeOtherSessions:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        event_policy: SecurityEventPolicy,
        sync_policy: SyncPolicy,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._event_policy = event_policy
        self._sync_policy = sync_policy
        self._realtime_notifier = realtime_notifier

    async def execute(self, command: RevokeOtherSessionsCommand) -> RevokeOtherSessionsResult:
        now = self._clock.now()
        revoked_count = 0
        async with self._unit_of_work() as uow:
            records = await uow.sessions.list_for_user_for_update(command.user_id)
            current = next(
                (record for record in records if record.session.id == command.current_session_id),
                None,
            )
            if (
                current is None
                or current.session.revoked_at is not None
                or current.device.revoked_at is not None
                or current.session.is_expired(now)
            ):
                raise SessionNotAuthenticatedError("current session is not authenticated")

            for record in records:
                if record.session.id == command.current_session_id:
                    continue
                session_was_active = record.session.revoked_at is None
                if record.session.revoked_at is None:
                    await uow.sessions.update(record.session.revoke(now))
                if record.device.revoked_at is None:
                    await uow.devices.update(record.device.revoke(now))
                if session_was_active:
                    revoked_count += 1

            await uow.security_events.prune_expired(now)
            await uow.security_events.add(
                SecurityEvent.create(
                    user_id=command.user_id,
                    event_type=SecurityEventType.OTHER_SESSIONS_REVOKED,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=command.current_session_id,
                )
            )
            sync_events = (
                await append_device_roster_events(
                    uow,
                    user_id=command.user_id,
                    now=now,
                    policy=self._sync_policy,
                )
                if revoked_count > 0
                else []
            )
            await uow.commit()
        await publish_best_effort(
            self._realtime_notifier,
            notifications_from_sync(sync_events),
        )
        return RevokeOtherSessionsResult(revoked_count=revoked_count)
