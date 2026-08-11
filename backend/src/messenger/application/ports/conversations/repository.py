"""Conversation aggregate repository port."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import Conversation


class ConversationRepository(Protocol):
    async def add(self, conversation: Conversation) -> None: ...

    async def get_by_id(
        self,
        conversation_id: UUID,
        *,
        for_update: bool = False,
    ) -> Conversation | None: ...

    async def get_direct_by_users(
        self,
        first_user_id: UUID,
        second_user_id: UUID,
    ) -> Conversation | None: ...

    async def get_by_ids(self, conversation_ids: set[UUID]) -> list[Conversation]: ...

    async def list_active_for_user(self, user_id: UUID) -> list[Conversation]: ...

    async def update(self, conversation: Conversation) -> None: ...
