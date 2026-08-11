"""SQLAlchemy conversation aggregate repository adapter."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from messenger.application.errors import DuplicateDirectConversationError
from messenger.domain.entities import (
    Conversation,
    ConversationMember,
    ConversationMemberRole,
    ConversationType,
)
from messenger.infrastructure.persistence.models import (
    ConversationMemberModel,
    ConversationModel,
)


def direct_pair(first_user_id: UUID, second_user_id: UUID) -> tuple[UUID, UUID]:
    if first_user_id.int < second_user_id.int:
        return first_user_id, second_user_id
    return second_user_id, first_user_id


def map_conversation(model: ConversationModel) -> Conversation:
    members = tuple(
        ConversationMember(
            conversation_id=member.conversation_id,
            user_id=member.user_id,
            role=ConversationMemberRole(member.role),
            joined_at=member.joined_at,
            left_at=member.left_at,
        )
        for member in sorted(model.members, key=lambda item: (item.joined_at, item.user_id.int))
    )
    return Conversation(
        id=model.id,
        conversation_type=ConversationType(model.conversation_type),
        title=model.title,
        created_by=model.created_by,
        created_at=model.created_at,
        updated_at=model.updated_at,
        members=members,
    )


class SqlAlchemyConversationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, conversation: Conversation) -> None:
        low_id: UUID | None = None
        high_id: UUID | None = None
        if conversation.conversation_type is ConversationType.DIRECT:
            low_id, high_id = direct_pair(
                conversation.members[0].user_id,
                conversation.members[1].user_id,
            )
        model = ConversationModel(
            id=conversation.id,
            conversation_type=conversation.conversation_type.value,
            title=conversation.title,
            created_by=conversation.created_by,
            direct_user_low_id=low_id,
            direct_user_high_id=high_id,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            members=[
                ConversationMemberModel(
                    conversation_id=member.conversation_id,
                    user_id=member.user_id,
                    role=member.role.value,
                    joined_at=member.joined_at,
                    left_at=member.left_at,
                )
                for member in conversation.members
            ],
        )
        self._session.add(model)
        try:
            await self._session.flush()
        except IntegrityError as error:
            constraint = getattr(getattr(error.orig, "__cause__", None), "constraint_name", None)
            if constraint == "uq_conversations_direct_pair":
                raise DuplicateDirectConversationError(
                    "direct conversation already exists"
                ) from error
            raise

    async def get_by_id(
        self,
        conversation_id: UUID,
        *,
        for_update: bool = False,
    ) -> Conversation | None:
        statement = (
            select(ConversationModel)
            .where(ConversationModel.id == conversation_id)
            .options(selectinload(ConversationModel.members))
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_conversation(model) if model is not None else None

    async def get_direct_by_users(
        self,
        first_user_id: UUID,
        second_user_id: UUID,
    ) -> Conversation | None:
        low_id, high_id = direct_pair(first_user_id, second_user_id)
        model = await self._session.scalar(
            select(ConversationModel)
            .where(
                ConversationModel.direct_user_low_id == low_id,
                ConversationModel.direct_user_high_id == high_id,
            )
            .options(selectinload(ConversationModel.members))
        )
        return map_conversation(model) if model is not None else None

    async def list_active_for_user(self, user_id: UUID) -> list[Conversation]:
        models = (
            await self._session.scalars(
                select(ConversationModel)
                .join(ConversationMemberModel)
                .where(
                    ConversationMemberModel.user_id == user_id,
                    ConversationMemberModel.left_at.is_(None),
                )
                .options(selectinload(ConversationModel.members))
                .order_by(ConversationModel.updated_at.desc(), ConversationModel.id)
            )
        ).all()
        return [map_conversation(model) for model in models]

    async def update(self, conversation: Conversation) -> None:
        model = await self._session.scalar(
            select(ConversationModel)
            .where(ConversationModel.id == conversation.id)
            .options(selectinload(ConversationModel.members))
            .with_for_update()
        )
        if model is None:
            raise RuntimeError("locked conversation disappeared during update")
        model.title = conversation.title
        model.updated_at = conversation.updated_at
        existing = {member.user_id: member for member in model.members}
        for member in conversation.members:
            stored = existing.get(member.user_id)
            if stored is None:
                model.members.append(
                    ConversationMemberModel(
                        conversation_id=member.conversation_id,
                        user_id=member.user_id,
                        role=member.role.value,
                        joined_at=member.joined_at,
                        left_at=member.left_at,
                    )
                )
            else:
                stored.role = member.role.value
                stored.left_at = member.left_at
        await self._session.flush()
