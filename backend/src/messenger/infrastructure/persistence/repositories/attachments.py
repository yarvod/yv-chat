"""SQLAlchemy group attachment metadata adapter."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import Attachment, AttachmentMediaKind
from messenger.infrastructure.persistence.models import AttachmentModel, MessageModel


class SqlAlchemyAttachmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, attachment: Attachment) -> None:
        self._session.add(
            AttachmentModel(
                id=attachment.id,
                client_attachment_id=attachment.client_attachment_id,
                conversation_id=attachment.conversation_id,
                uploader_user_id=attachment.uploader_user_id,
                uploader_device_id=attachment.uploader_device_id,
                storage_key=attachment.storage_key,
                media_kind=attachment.media_kind.value,
                byte_size=attachment.byte_size,
                sha256_digest=attachment.sha256_digest,
                content_type=attachment.content_type,
                created_at=attachment.created_at,
                expires_at=attachment.expires_at,
                committed_message_id=attachment.committed_message_id,
            )
        )
        await self._session.flush()

    async def get_by_id(
        self,
        attachment_id: UUID,
        *,
        for_update: bool = False,
    ) -> Attachment | None:
        statement = select(AttachmentModel).where(AttachmentModel.id == attachment_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_attachment(model) if model is not None else None

    async def get_by_client_id(
        self,
        *,
        uploader_device_id: UUID,
        client_attachment_id: UUID,
        for_update: bool = False,
    ) -> Attachment | None:
        statement = select(AttachmentModel).where(
            AttachmentModel.uploader_device_id == uploader_device_id,
            AttachmentModel.client_attachment_id == client_attachment_id,
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_attachment(model) if model is not None else None

    async def get_many_for_update(self, attachment_ids: tuple[UUID, ...]) -> list[Attachment]:
        if not attachment_ids:
            return []
        models = (
            await self._session.scalars(
                select(AttachmentModel)
                .where(AttachmentModel.id.in_(attachment_ids))
                .order_by(AttachmentModel.id)
                .with_for_update()
            )
        ).all()
        return [map_attachment(model) for model in models]

    async def list_for_message(self, message_id: UUID) -> list[Attachment]:
        models = (
            await self._session.scalars(
                select(AttachmentModel)
                .where(AttachmentModel.committed_message_id == message_id)
                .order_by(AttachmentModel.id)
            )
        ).all()
        return [map_attachment(model) for model in models]

    async def active_bytes_for_user(self, *, user_id: UUID, now: datetime) -> int:
        total = await self._session.scalar(
            select(func.coalesce(func.sum(AttachmentModel.byte_size), 0)).where(
                AttachmentModel.uploader_user_id == user_id,
                AttachmentModel.expires_at > now,
            )
        )
        return int(total or 0)

    async def update(self, attachment: Attachment) -> None:
        model = await self._session.get(AttachmentModel, attachment.id)
        if model is None:
            raise RuntimeError("attachment disappeared during update")
        model.expires_at = attachment.expires_at
        model.committed_message_id = attachment.committed_message_id
        await self._session.flush()

    async def list_expired(self, *, now: datetime, limit: int) -> list[Attachment]:
        models = (
            await self._session.scalars(
                select(AttachmentModel)
                .where(AttachmentModel.expires_at <= now)
                .order_by(AttachmentModel.expires_at, AttachmentModel.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()
        return [map_attachment(model) for model in models]

    async def delete(self, attachment_id: UUID) -> None:
        await self._session.execute(
            delete(AttachmentModel).where(AttachmentModel.id == attachment_id)
        )

    async def align_committed_expiry_with_active_messages(self) -> int:
        message_expiry = (
            select(MessageModel.expires_at)
            .where(
                MessageModel.id == AttachmentModel.committed_message_id,
                MessageModel.deleted_at.is_(None),
            )
            .scalar_subquery()
        )
        extended_ids = (
            await self._session.scalars(
                update(AttachmentModel)
                .where(
                    AttachmentModel.committed_message_id.is_not(None),
                    AttachmentModel.expires_at < message_expiry,
                )
                .values(expires_at=message_expiry)
                .returning(AttachmentModel.id)
            )
        ).all()
        return len(extended_ids)


def map_attachment(model: AttachmentModel) -> Attachment:
    return Attachment(
        id=model.id,
        client_attachment_id=model.client_attachment_id,
        conversation_id=model.conversation_id,
        uploader_user_id=model.uploader_user_id,
        uploader_device_id=model.uploader_device_id,
        storage_key=model.storage_key,
        media_kind=AttachmentMediaKind(model.media_kind),
        byte_size=model.byte_size,
        sha256_digest=model.sha256_digest,
        content_type=model.content_type,
        created_at=model.created_at,
        expires_at=model.expires_at,
        committed_message_id=model.committed_message_id,
    )
