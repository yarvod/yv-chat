"""SQLAlchemy Web Push subscription repository."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.errors import PushSubscriptionConflictError
from messenger.domain.entities import PushSubscription
from messenger.infrastructure.persistence.models import DeviceModel, PushSubscriptionModel


def _map(model: PushSubscriptionModel) -> PushSubscription:
    return PushSubscription(
        id=model.id,
        user_id=model.user_id,
        device_id=model.device_id,
        endpoint=model.endpoint,
        p256dh=model.p256dh,
        auth=model.auth,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class SqlAlchemyPushSubscriptionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_device(self, device_id: UUID) -> PushSubscription | None:
        model = await self._session.scalar(
            select(PushSubscriptionModel).where(PushSubscriptionModel.device_id == device_id)
        )
        return _map(model) if model is not None else None

    async def get_by_endpoint(self, endpoint: str) -> PushSubscription | None:
        model = await self._session.scalar(
            select(PushSubscriptionModel).where(PushSubscriptionModel.endpoint == endpoint)
        )
        return _map(model) if model is not None else None

    async def list_for_users(self, user_ids: set[UUID]) -> list[PushSubscription]:
        if not user_ids:
            return []
        models = await self._session.scalars(
            select(PushSubscriptionModel)
            .join(DeviceModel, DeviceModel.id == PushSubscriptionModel.device_id)
            .where(PushSubscriptionModel.user_id.in_(user_ids))
            .where(DeviceModel.revoked_at.is_(None))
            .order_by(PushSubscriptionModel.user_id, PushSubscriptionModel.created_at)
        )
        return [_map(model) for model in models]

    async def upsert(self, subscription: PushSubscription) -> None:
        model = await self._session.scalar(
            select(PushSubscriptionModel)
            .where(PushSubscriptionModel.device_id == subscription.device_id)
            .with_for_update()
        )
        if model is None:
            self._session.add(
                PushSubscriptionModel(
                    id=subscription.id,
                    user_id=subscription.user_id,
                    device_id=subscription.device_id,
                    endpoint=subscription.endpoint,
                    p256dh=subscription.p256dh,
                    auth=subscription.auth,
                    created_at=subscription.created_at,
                    updated_at=subscription.updated_at,
                )
            )
        else:
            model.endpoint = subscription.endpoint
            model.p256dh = subscription.p256dh
            model.auth = subscription.auth
            model.updated_at = subscription.updated_at
        try:
            await self._session.flush()
        except IntegrityError as error:
            raise PushSubscriptionConflictError(
                "push subscription conflicts with existing row"
            ) from error

    async def delete_by_device(self, device_id: UUID) -> None:
        await self._session.execute(
            delete(PushSubscriptionModel).where(PushSubscriptionModel.device_id == device_id)
        )

    async def delete_by_ids(self, subscription_ids: set[UUID]) -> None:
        if subscription_ids:
            await self._session.execute(
                delete(PushSubscriptionModel).where(PushSubscriptionModel.id.in_(subscription_ids))
            )
