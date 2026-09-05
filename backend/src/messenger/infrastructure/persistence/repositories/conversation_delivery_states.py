"""SQLAlchemy per-device delivery-state adapter."""

from uuid import UUID

from sqlalchemy import func, literal, select, union_all
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.ports.messages import ParticipantDeliverySummary
from messenger.domain.entities import ConversationDeliveryState
from messenger.infrastructure.persistence.models import (
    ConversationDeliveryStateModel,
    ConversationMemberModel,
    ConversationReadStateModel,
    DeviceModel,
)


class SqlAlchemyConversationDeliveryStateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(
        self, *, device_id: UUID, conversation_id: UUID
    ) -> ConversationDeliveryState | None:
        model = await self._session.get(
            ConversationDeliveryStateModel, (device_id, conversation_id)
        )
        if model is None:
            return None
        return ConversationDeliveryState(
            device_id=model.device_id,
            conversation_id=model.conversation_id,
            last_delivered_sequence=model.last_delivered_sequence,
            updated_at=model.updated_at,
        )

    async def upsert(self, state: ConversationDeliveryState) -> None:
        await self._session.execute(
            insert(ConversationDeliveryStateModel)
            .values(
                device_id=state.device_id,
                conversation_id=state.conversation_id,
                last_delivered_sequence=state.last_delivered_sequence,
                updated_at=state.updated_at,
            )
            .on_conflict_do_update(
                index_elements=[
                    ConversationDeliveryStateModel.device_id,
                    ConversationDeliveryStateModel.conversation_id,
                ],
                set_={
                    "last_delivered_sequence": state.last_delivered_sequence,
                    "updated_at": state.updated_at,
                },
                where=(
                    ConversationDeliveryStateModel.last_delivered_sequence
                    < state.last_delivered_sequence
                ),
            )
        )
        await self._session.flush()

    async def list_participant_summaries(
        self, *, conversation_ids: set[UUID]
    ) -> list[ParticipantDeliverySummary]:
        if not conversation_ids:
            return []
        # Read cursors are user-scoped and survive device revocation. Include
        # read-only rows (e.g. an anchored history window) independently of delivery.
        # Reading proves receipt; retain the positive delivery cursor API contract
        # for older PWA clients during a rolling update.
        receipts = union_all(
            select(
                ConversationDeliveryStateModel.conversation_id.label("conversation_id"),
                DeviceModel.user_id.label("user_id"),
                ConversationDeliveryStateModel.last_delivered_sequence.label("delivered"),
                literal(0).label("read"),
            )
            .join(DeviceModel, DeviceModel.id == ConversationDeliveryStateModel.device_id)
            .where(
                ConversationDeliveryStateModel.conversation_id.in_(conversation_ids),
                DeviceModel.revoked_at.is_(None),
            ),
            select(
                ConversationReadStateModel.conversation_id,
                ConversationReadStateModel.user_id,
                literal(0),
                ConversationReadStateModel.last_read_sequence,
            ).where(ConversationReadStateModel.conversation_id.in_(conversation_ids)),
        ).subquery()
        rows = (
            await self._session.execute(
                select(
                    receipts.c.conversation_id,
                    receipts.c.user_id,
                    func.max(receipts.c.delivered),
                    func.max(receipts.c.read),
                )
                .join(
                    ConversationMemberModel,
                    (ConversationMemberModel.conversation_id == receipts.c.conversation_id)
                    & (ConversationMemberModel.user_id == receipts.c.user_id),
                )
                .where(ConversationMemberModel.left_at.is_(None))
                .group_by(receipts.c.conversation_id, receipts.c.user_id)
                .order_by(receipts.c.conversation_id, receipts.c.user_id)
            )
        ).all()
        return [
            ParticipantDeliverySummary(
                conversation_id, user_id, max(int(delivered), int(read)), int(read)
            )
            for conversation_id, user_id, delivered, read in rows
        ]
