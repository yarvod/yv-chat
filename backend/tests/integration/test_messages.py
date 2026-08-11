"""PostgreSQL-backed opaque message persistence and authorization."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.errors import ConversationNotFoundError
from messenger.application.messaging.list_read_states import (
    ListConversationReadStates,
    ListConversationReadStatesQuery,
)
from messenger.application.messaging.mark_read import (
    MarkConversationRead,
    MarkConversationReadCommand,
)
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.login import Login, LoginCommand
from messenger.application.sessions.policy import SessionPolicy
from messenger.application.sync import SyncPolicy
from messenger.domain.entities import Conversation, User
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.persistence.conversation_uow import (
    SqlAlchemyConversationUnitOfWorkFactory,
)
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.messaging_uow import SqlAlchemyMessagingUnitOfWorkFactory
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    ConversationMemberModel,
    ConversationModel,
    ConversationReadStateModel,
    DeviceModel,
    MessageModel,
    SecurityEventModel,
    SessionModel,
    SyncEventModel,
    SyncStreamModel,
    UserModel,
)
from tests.application.fakes import FixedClock, RecordingRealtimeNotifier

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
SESSION_POLICY = SessionPolicy(
    idle_timeout=timedelta(days=30),
    absolute_lifetime=timedelta(days=90),
    rotation_interval=timedelta(days=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_tables(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(SyncEventModel))
        await session.execute(delete(SyncStreamModel))
        await session.execute(delete(MessageModel))
        await session.execute(delete(ConversationReadStateModel))
        await session.execute(delete(ConversationMemberModel))
        await session.execute(delete(ConversationModel))
        await session.execute(delete(SecurityEventModel))
        await session.execute(delete(SessionModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(ActivationTokenModel))
        await session.execute(delete(UserModel))


async def run_flow(database_url: str) -> None:
    engine = create_engine(database_url)
    session_factory = create_session_factory(engine)
    passwords = Argon2PasswordHasher()

    def identity_uow() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    try:
        await reset_tables(session_factory)
        alice = User.create(username="alice", display_name="Alice", now=NOW)
        bob = User.create(username="bob", display_name="Bob", now=NOW)
        charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
        password_hash = await passwords.hash(PASSWORD)
        async with identity_uow() as identity_transaction:
            for user in (alice, bob, charlie):
                await identity_transaction.users.add_active(user, password_hash)
            await identity_transaction.commit()

        login = Login(
            unit_of_work=identity_uow,
            clock=FixedClock(NOW),
            passwords=passwords,
            credentials=SecureSessionCredentialService(),
            policy=SESSION_POLICY,
            event_policy=EVENT_POLICY,
        )
        alice_session = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Alice device")
        )
        charlie_session = await login.execute(
            LoginCommand(username="charlie", password=PASSWORD, device_name="Charlie device")
        )
        conversation = Conversation.create_direct(
            created_by=alice.id,
            other_user_id=bob.id,
            now=NOW,
        )
        async with SqlAlchemyConversationUnitOfWorkFactory(
            session_factory
        )() as conversation_transaction:
            await conversation_transaction.conversations.add(conversation)
            await conversation_transaction.commit()

        send = SendOpaqueMessage(
            unit_of_work=SqlAlchemyMessagingUnitOfWorkFactory(session_factory),
            clock=FixedClock(NOW + timedelta(seconds=1)),
            message_policy=MessageEnvelopePolicy(),
            sync_policy=SyncPolicy(),
            realtime_notifier=RecordingRealtimeNotifier(),
        )
        ciphertext = b"\x00\xffopaque-postgresql-envelope"
        client_message_id = uuid4()
        command = SendOpaqueMessageCommand(
            alice.id,
            alice_session.device_id,
            conversation.id,
            client_message_id,
            1,
            ciphertext,
        )
        result = await send.execute(command)
        retried = await send.execute(command)
        assert retried == result
        concurrent = await asyncio.gather(
            send.execute(
                SendOpaqueMessageCommand(
                    alice.id,
                    alice_session.device_id,
                    conversation.id,
                    uuid4(),
                    1,
                    b"second",
                )
            ),
            send.execute(
                SendOpaqueMessageCommand(
                    alice.id,
                    alice_session.device_id,
                    conversation.id,
                    uuid4(),
                    1,
                    b"third",
                )
            ),
        )
        with pytest.raises(ConversationNotFoundError):
            await send.execute(
                SendOpaqueMessageCommand(
                    charlie.id,
                    charlie_session.device_id,
                    conversation.id,
                    uuid4(),
                    1,
                    b"forbidden",
                )
            )

        read_state_factory = SqlAlchemyMessagingUnitOfWorkFactory(session_factory)
        list_read_states = ListConversationReadStates(unit_of_work=read_state_factory)
        bob_before = await list_read_states.execute(ListConversationReadStatesQuery(bob.id))
        assert len(bob_before) == 1
        assert bob_before[0].last_read_sequence == 0
        assert bob_before[0].latest_sequence == 3
        assert bob_before[0].unread_count == 3

        mark_read = MarkConversationRead(
            unit_of_work=read_state_factory,
            clock=FixedClock(NOW + timedelta(seconds=2)),
            sync_policy=SyncPolicy(),
            realtime_notifier=RecordingRealtimeNotifier(),
        )
        first_read = await mark_read.execute(
            MarkConversationReadCommand(bob.id, conversation.id, 2)
        )
        duplicate_read = await mark_read.execute(
            MarkConversationReadCommand(bob.id, conversation.id, 2)
        )
        lower_read, highest_read = await asyncio.gather(
            mark_read.execute(MarkConversationReadCommand(bob.id, conversation.id, 1)),
            mark_read.execute(MarkConversationReadCommand(bob.id, conversation.id, 3)),
        )
        assert first_read.advanced is True
        assert duplicate_read.advanced is False
        assert lower_read.advanced is False
        assert highest_read.advanced is True
        bob_after = await list_read_states.execute(ListConversationReadStatesQuery(bob.id))
        assert bob_after[0].last_read_sequence == 3
        assert bob_after[0].unread_count == 0

        async with session_factory() as session:
            stored = await session.get(MessageModel, result.message_id)
            count = await session.scalar(select(func.count(MessageModel.id)))
            alice_event_count = await session.scalar(
                select(func.count(SyncEventModel.event_id)).where(
                    SyncEventModel.user_id == alice.id
                )
            )
            bob_event_count = await session.scalar(
                select(func.count(SyncEventModel.event_id)).where(SyncEventModel.user_id == bob.id)
            )
            charlie_event_count = await session.scalar(
                select(func.count(SyncEventModel.event_id)).where(
                    SyncEventModel.user_id == charlie.id
                )
            )
            alice_read_state = await session.get(
                ConversationReadStateModel,
                (alice.id, conversation.id),
            )
        assert stored is not None
        assert stored.ciphertext == ciphertext
        assert stored.sender_user_id == alice.id
        assert stored.sender_device_id == alice_session.device_id
        assert count == 3
        assert {item.sequence for item in concurrent} == {2, 3}
        assert alice_event_count == bob_event_count == 8
        assert charlie_event_count == 0
        assert alice_read_state is not None
        assert alice_read_state.last_read_sequence == 3
    finally:
        await reset_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
async def test_postgresql_opaque_message_envelope() -> None:
    await run_flow(configured_database_url())
