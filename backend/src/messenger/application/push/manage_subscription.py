"""Register, inspect and remove the current device push destination."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import (
    AuthorizationDeniedError,
    PushSubscriptionConflictError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.push import PushUnitOfWork, PushUnitOfWorkFactory
from messenger.domain.entities import PushProvider, PushSubscription
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class CurrentPushSubscriptionQuery:
    user_id: UUID
    device_id: UUID


@dataclass(frozen=True, slots=True)
class CurrentPushSubscriptionResult:
    registered: bool
    provider: PushProvider | None


@dataclass(frozen=True, slots=True)
class RegisterPushSubscriptionCommand:
    user_id: UUID
    device_id: UUID
    provider: PushProvider = PushProvider.WEB
    endpoint: str | None = None
    p256dh: str | None = None
    auth: str | None = None
    token: str | None = None

    @property
    def destination(self) -> str:
        destination = self.endpoint if self.provider is PushProvider.WEB else self.token
        if destination is None:
            raise DomainValidationError("push destination is incomplete")
        return destination


@dataclass(frozen=True, slots=True)
class RemovePushSubscriptionCommand:
    user_id: UUID
    device_id: UUID


async def _require_active_owned_device(
    unit_of_work: PushUnitOfWork,
    *,
    user_id: UUID,
    device_id: UUID,
) -> None:
    device = await unit_of_work.devices.get_owned_by_id(user_id=user_id, device_id=device_id)
    if device is None or device.revoked_at is not None:
        raise AuthorizationDeniedError("active owned device required")


class GetCurrentPushSubscription:
    def __init__(self, *, unit_of_work: PushUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: CurrentPushSubscriptionQuery) -> CurrentPushSubscriptionResult:
        async with self._unit_of_work() as unit_of_work:
            await _require_active_owned_device(
                unit_of_work,
                user_id=query.user_id,
                device_id=query.device_id,
            )
            subscription = await unit_of_work.subscriptions.get_by_device(query.device_id)
        return CurrentPushSubscriptionResult(
            registered=subscription is not None,
            provider=subscription.provider if subscription is not None else None,
        )


class RegisterPushSubscription:
    def __init__(self, *, unit_of_work: PushUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: RegisterPushSubscriptionCommand) -> None:
        now = self._clock.now()
        async with self._unit_of_work() as unit_of_work:
            await _require_active_owned_device(
                unit_of_work,
                user_id=command.user_id,
                device_id=command.device_id,
            )
            destination_owner = await unit_of_work.subscriptions.get_by_destination(
                command.provider, command.destination
            )
            if destination_owner is not None and destination_owner.device_id != command.device_id:
                owner_device = await unit_of_work.devices.get_by_id(destination_owner.device_id)
                if owner_device is not None and owner_device.revoked_at is None:
                    raise PushSubscriptionConflictError(
                        "push destination belongs to another device"
                    )
                await unit_of_work.subscriptions.delete_by_ids({destination_owner.id})
            current = await unit_of_work.subscriptions.get_by_device(command.device_id)
            if command.provider is PushProvider.WEB:
                if command.endpoint is None or command.p256dh is None or command.auth is None:
                    raise DomainValidationError("web push material is incomplete")
                subscription = (
                    PushSubscription.create_web(
                        user_id=command.user_id,
                        device_id=command.device_id,
                        endpoint=command.endpoint,
                        p256dh=command.p256dh,
                        auth=command.auth,
                        now=now,
                    )
                    if current is None
                    else current.refresh_web(
                        endpoint=command.endpoint,
                        p256dh=command.p256dh,
                        auth=command.auth,
                        now=now,
                    )
                )
            else:
                if command.token is None:
                    raise DomainValidationError("native push token is incomplete")
                subscription = (
                    PushSubscription.create_native(
                        user_id=command.user_id,
                        device_id=command.device_id,
                        provider=command.provider,
                        token=command.token,
                        now=now,
                    )
                    if current is None
                    else current.refresh_native(
                        provider=command.provider,
                        token=command.token,
                        now=now,
                    )
                )
            await unit_of_work.subscriptions.upsert(subscription)
            await unit_of_work.commit()


class RemovePushSubscription:
    def __init__(self, *, unit_of_work: PushUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, command: RemovePushSubscriptionCommand) -> None:
        async with self._unit_of_work() as unit_of_work:
            await _require_active_owned_device(
                unit_of_work,
                user_id=command.user_id,
                device_id=command.device_id,
            )
            await unit_of_work.subscriptions.delete_by_device(command.device_id)
            await unit_of_work.commit()
