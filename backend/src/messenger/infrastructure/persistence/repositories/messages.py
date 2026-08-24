"""SQLAlchemy opaque message repository adapter."""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import Message, MessageDeletionReason
from messenger.infrastructure.persistence.models import ConversationModel, MessageModel


class SqlAlchemyMessageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, message: Message) -> None:
        self._session.add(
            MessageModel(
                id=message.id,
                client_message_id=message.client_message_id,
                conversation_id=message.conversation_id,
                sender_user_id=message.sender_user_id,
                sender_device_id=message.sender_device_id,
                protocol_version=message.protocol_version,
                crypto_generation_id=message.crypto_generation_id,
                crypto_epoch=message.crypto_epoch,
                sequence=message.sequence,
                ciphertext=message.ciphertext,
                ciphertext_digest=message.ciphertext_digest,
                created_at=message.created_at,
                expires_at=message.expires_at,
                deletion_reason=(
                    message.deletion_reason.value if message.deletion_reason is not None else None
                ),
                deleted_at=message.deleted_at,
                deleted_by_user_id=message.deleted_by_user_id,
                tombstone_expires_at=message.tombstone_expires_at,
            )
        )
        await self._session.flush()

    async def get_by_client_id(
        self,
        *,
        sender_device_id: UUID,
        client_message_id: UUID,
    ) -> Message | None:
        model = await self._session.scalar(
            select(MessageModel).where(
                MessageModel.sender_device_id == sender_device_id,
                MessageModel.client_message_id == client_message_id,
            )
        )
        return map_message(model) if model is not None else None

    async def get_by_id(
        self,
        message_id: UUID,
        *,
        for_update: bool = False,
    ) -> Message | None:
        statement = select(MessageModel).where(MessageModel.id == message_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_message(model) if model is not None else None

    async def next_sequence(self, conversation_id: UUID, *, activity_at: datetime) -> int:
        sequence = await self._session.scalar(
            update(ConversationModel)
            .where(ConversationModel.id == conversation_id)
            .values(
                last_message_sequence=ConversationModel.last_message_sequence + 1,
                updated_at=activity_at,
            )
            .returning(ConversationModel.last_message_sequence)
        )
        if sequence is None:
            raise RuntimeError("conversation disappeared during sequence allocation")
        return int(sequence)

    async def exists_at_sequence(
        self,
        *,
        conversation_id: UUID,
        sequence: int,
    ) -> bool:
        message_id = await self._session.scalar(
            select(MessageModel.id).where(
                MessageModel.conversation_id == conversation_id,
                MessageModel.sequence == sequence,
            )
        )
        return message_id is not None

    async def list_after(
        self,
        *,
        conversation_id: UUID,
        after_sequence: int,
        limit: int,
    ) -> list[Message]:
        models = (
            await self._session.scalars(
                select(MessageModel)
                .where(
                    MessageModel.conversation_id == conversation_id,
                    MessageModel.sequence > after_sequence,
                )
                .order_by(MessageModel.sequence, MessageModel.id)
                .limit(limit)
            )
        ).all()
        return [map_message(model) for model in models]

    async def list_before(
        self,
        *,
        conversation_id: UUID,
        before_sequence: int | None,
        limit: int,
    ) -> list[Message]:
        conditions = [MessageModel.conversation_id == conversation_id]
        if before_sequence is not None:
            conditions.append(MessageModel.sequence < before_sequence)
        models = (
            await self._session.scalars(
                select(MessageModel)
                .where(*conditions)
                .order_by(MessageModel.sequence.desc(), MessageModel.id.desc())
                .limit(limit)
            )
        ).all()
        return [map_message(model) for model in reversed(models)]

    async def update(self, message: Message) -> None:
        model = await self._session.get(MessageModel, message.id)
        if model is None:
            raise RuntimeError("locked message disappeared during update")
        model.ciphertext = message.ciphertext
        model.deletion_reason = (
            message.deletion_reason.value if message.deletion_reason is not None else None
        )
        model.deleted_at = message.deleted_at
        model.deleted_by_user_id = message.deleted_by_user_id
        model.tombstone_expires_at = message.tombstone_expires_at
        await self._session.flush()

    async def list_expired_active(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> list[Message]:
        models = (
            await self._session.scalars(
                select(MessageModel)
                .where(MessageModel.deleted_at.is_(None), MessageModel.expires_at <= now)
                .order_by(MessageModel.expires_at, MessageModel.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()
        return [map_message(model) for model in models]

    async def purge_expired_tombstones(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> int:
        message_ids = (
            select(MessageModel.id)
            .where(
                MessageModel.deleted_at.is_not(None),
                MessageModel.tombstone_expires_at <= now,
            )
            .order_by(MessageModel.tombstone_expires_at, MessageModel.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        deleted_ids = (
            await self._session.scalars(
                delete(MessageModel)
                .where(MessageModel.id.in_(message_ids))
                .returning(MessageModel.id)
            )
        ).all()
        return len(deleted_ids)

    async def extend_active_retention(self, retention: timedelta) -> int:
        target_expiry = MessageModel.created_at + retention
        extended_ids = (
            await self._session.scalars(
                update(MessageModel)
                .where(
                    MessageModel.deleted_at.is_(None),
                    MessageModel.expires_at < target_expiry,
                )
                .values(expires_at=target_expiry)
                .returning(MessageModel.id)
            )
        ).all()
        return len(extended_ids)


def map_message(model: MessageModel) -> Message:
    return Message(
        id=model.id,
        client_message_id=model.client_message_id,
        conversation_id=model.conversation_id,
        sender_user_id=model.sender_user_id,
        sender_device_id=model.sender_device_id,
        protocol_version=model.protocol_version,
        crypto_generation_id=model.crypto_generation_id,
        crypto_epoch=model.crypto_epoch,
        sequence=model.sequence,
        ciphertext=model.ciphertext,
        ciphertext_digest=model.ciphertext_digest,
        created_at=model.created_at,
        expires_at=model.expires_at,
        deletion_reason=(
            MessageDeletionReason(model.deletion_reason)
            if model.deletion_reason is not None
            else None
        ),
        deleted_at=model.deleted_at,
        deleted_by_user_id=model.deleted_by_user_id,
        tombstone_expires_at=model.tombstone_expires_at,
    )
