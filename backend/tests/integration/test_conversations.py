"""PostgreSQL-backed conversation aggregate and concurrency behavior."""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.errors import DuplicateDirectConversationError
from messenger.domain.entities import Conversation, User
from messenger.infrastructure.persistence.conversation_uow import (
    SqlAlchemyConversationUnitOfWorkFactory,
)
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    ConversationMemberModel,
    ConversationModel,
    DeviceModel,
    SecurityEventModel,
    SessionModel,
    UserModel,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_tables(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(ConversationMemberModel))
        await session.execute(delete(ConversationModel))
        await session.execute(delete(SecurityEventModel))
        await session.execute(delete(SessionModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(ActivationTokenModel))
        await session.execute(delete(UserModel))


async def create_users(
    session_factory: async_sessionmaker[AsyncSession],
) -> tuple[User, User, User]:
    users = (
        User.create(username="alice", display_name="Alice", now=NOW),
        User.create(username="bob", display_name="Bob", now=NOW),
        User.create(username="charlie", display_name="Charlie", now=NOW),
    )
    async with SqlAlchemyIdentityUnitOfWork(session_factory) as unit_of_work:
        for user in users:
            await unit_of_work.users.add_active(user, "test-password-hash")
        await unit_of_work.commit()
    return users


async def run_flow(database_url: str) -> None:
    engine = create_engine(database_url)
    session_factory = create_session_factory(engine)
    unit_of_work_factory = SqlAlchemyConversationUnitOfWorkFactory(session_factory)

    try:
        await reset_tables(session_factory)
        alice, bob, charlie = await create_users(session_factory)

        async def create_direct(created_by: User, other: User) -> Conversation | Exception:
            try:
                conversation = Conversation.create_direct(
                    created_by=created_by.id,
                    other_user_id=other.id,
                    now=NOW,
                )
                async with unit_of_work_factory() as unit_of_work:
                    await unit_of_work.conversations.add(conversation)
                    await unit_of_work.commit()
                return conversation
            except Exception as error:
                return error

        outcomes = await asyncio.gather(
            create_direct(alice, bob),
            create_direct(bob, alice),
        )
        assert sum(isinstance(item, Conversation) for item in outcomes) == 1
        assert sum(isinstance(item, DuplicateDirectConversationError) for item in outcomes) == 1

        async with unit_of_work_factory() as unit_of_work:
            direct = await unit_of_work.conversations.get_direct_by_users(bob.id, alice.id)
        assert direct is not None
        assert {member.user_id for member in direct.members} == {alice.id, bob.id}

        group = Conversation.create_group(
            created_by=alice.id,
            title="MVP team",
            now=NOW + timedelta(minutes=1),
        ).add_member(bob.id, NOW + timedelta(minutes=2))
        async with unit_of_work_factory() as unit_of_work:
            await unit_of_work.conversations.add(group)
            await unit_of_work.commit()

        async with unit_of_work_factory() as unit_of_work:
            bob_conversations = await unit_of_work.conversations.list_active_for_user(bob.id)
            charlie_conversations = await unit_of_work.conversations.list_active_for_user(
                charlie.id
            )
        assert {item.id for item in bob_conversations} == {direct.id, group.id}
        assert charlie_conversations == []

        async with unit_of_work_factory() as unit_of_work:
            locked_group = await unit_of_work.conversations.get_by_id(
                group.id,
                for_update=True,
            )
            assert locked_group is not None
            left_group = locked_group.remove_member(
                bob.id,
                NOW + timedelta(minutes=3),
            )
            await unit_of_work.conversations.update(left_group)
            await unit_of_work.commit()

        async with unit_of_work_factory() as unit_of_work:
            bob_conversations = await unit_of_work.conversations.list_active_for_user(bob.id)
            loaded_group = await unit_of_work.conversations.get_by_id(group.id)
        assert [item.id for item in bob_conversations] == [direct.id]
        assert loaded_group is not None
        assert loaded_group.member(bob.id).left_at == NOW + timedelta(minutes=3)
    finally:
        await reset_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
async def test_postgresql_conversations_and_direct_pair_concurrency() -> None:
    await run_flow(configured_database_url())
