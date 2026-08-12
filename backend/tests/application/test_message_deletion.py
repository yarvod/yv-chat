"""Delete-for-everyone authorization, tombstone and TTL specifications."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    MessageNotFoundError,
)
from messenger.application.messaging.cleanup_messages import CleanupExpiredMessages
from messenger.application.messaging.delete_message import (
    DeleteMessageForEveryone,
    DeleteMessageForEveryoneCommand,
)
from messenger.application.messaging.list_read_states import (
    ListConversationReadStates,
    ListConversationReadStatesQuery,
)
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.domain.entities import (
    Conversation,
    ConversationMemberRole,
    Message,
    MessageDeletionReason,
    User,
)
from tests.application.fakes import (
    FakeMessagingUnitOfWork,
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
RETENTION = MessageRetentionPolicy(
    ciphertext_retention=timedelta(days=30),
    tombstone_retention=timedelta(days=90),
    cleanup_batch_size=20,
)


def deletion_fixture() -> tuple[IdentityState, User, User, User, User, Conversation, Message]:
    owner = User.create(username="owner", display_name="Owner", now=NOW)
    sender = User.create(username="sender", display_name="Sender", now=NOW)
    member = User.create(username="member", display_name="Member", now=NOW)
    outsider = User.create(username="outsider", display_name="Outsider", now=NOW)
    conversation = Conversation.create_group(created_by=owner.id, title="Group", now=NOW)
    conversation = conversation.add_member(sender.id, NOW)
    conversation = conversation.add_member(member.id, NOW)
    message = Message.create(
        conversation_id=conversation.id,
        client_message_id=uuid4(),
        sender_user_id=sender.id,
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=1,
        ciphertext=b"opaque",
        now=NOW,
        retention=RETENTION.ciphertext_retention,
    )
    state = IdentityState(
        users={user.id: user for user in (owner, sender, member, outsider)},
        conversations={conversation.id: conversation},
        messages={message.id: message},
        message_sequences={conversation.id: 1},
    )
    return state, owner, sender, member, outsider, conversation, message


def delete_use_case(
    state: IdentityState, notifier: RecordingRealtimeNotifier | None = None
) -> DeleteMessageForEveryone:
    return DeleteMessageForEveryone(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=notifier or RecordingRealtimeNotifier(),
    )


async def test_sender_delete_scrubs_ciphertext_and_duplicate_is_noop() -> None:
    state, _, sender, _, _, conversation, message = deletion_fixture()
    notifier = RecordingRealtimeNotifier()
    use_case = delete_use_case(state, notifier)
    command = DeleteMessageForEveryoneCommand(sender.id, conversation.id, message.id)

    first = await use_case.execute(command)
    duplicate = await use_case.execute(command)

    stored = state.messages[message.id]
    assert first.advanced is True
    assert duplicate.advanced is False
    assert stored.ciphertext is None
    assert stored.ciphertext_digest == message.ciphertext_digest
    assert stored.deletion_reason is MessageDeletionReason.MANUAL
    assert stored.deleted_by_user_id == sender.id
    assert stored.tombstone_expires_at == first.deleted_at + timedelta(days=90)
    assert state.commits == 1
    assert len(state.sync_events) == 3
    assert all(event.event_type is SyncEventType.MESSAGE_DELETED for event in state.sync_events)
    assert {event.user_id for event in state.sync_events} == {
        item.user_id for item in conversation.members
    }
    assert len(notifier.notifications) == 3


async def test_group_owner_can_moderate_but_member_and_outsider_cannot() -> None:
    state, owner, _, member, outsider, conversation, message = deletion_fixture()

    with pytest.raises(AuthorizationDeniedError):
        await delete_use_case(state).execute(
            DeleteMessageForEveryoneCommand(member.id, conversation.id, message.id)
        )
    with pytest.raises(ConversationNotFoundError):
        await delete_use_case(state).execute(
            DeleteMessageForEveryoneCommand(outsider.id, conversation.id, message.id)
        )
    moderated = await delete_use_case(state).execute(
        DeleteMessageForEveryoneCommand(owner.id, conversation.id, message.id)
    )
    assert moderated.advanced is True
    assert state.messages[message.id].deleted_by_user_id == owner.id


async def test_group_admin_can_moderate_another_users_message() -> None:
    state, owner, _, member, _, conversation, message = deletion_fixture()
    promoted = conversation.change_member_role(
        member.id, ConversationMemberRole.ADMIN, NOW + timedelta(seconds=1)
    )
    state.conversations[conversation.id] = promoted

    result = await delete_use_case(state).execute(
        DeleteMessageForEveryoneCommand(member.id, conversation.id, message.id)
    )
    assert result.advanced is True
    assert state.messages[message.id].deleted_by_user_id == member.id
    assert owner.id in {event.user_id for event in state.sync_events}


async def test_message_from_another_conversation_is_hidden_as_not_found() -> None:
    state, owner, sender, _, _, conversation, _ = deletion_fixture()
    foreign_conversation = Conversation.create_group(
        created_by=owner.id,
        title="Foreign",
        now=NOW,
    ).add_member(sender.id, NOW)
    foreign_message = Message.create(
        conversation_id=foreign_conversation.id,
        client_message_id=uuid4(),
        sender_user_id=sender.id,
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=1,
        ciphertext=b"foreign-opaque",
        now=NOW,
        retention=RETENTION.ciphertext_retention,
    )
    state.conversations[foreign_conversation.id] = foreign_conversation
    state.messages[foreign_message.id] = foreign_message

    with pytest.raises(MessageNotFoundError):
        await delete_use_case(state).execute(
            DeleteMessageForEveryoneCommand(sender.id, conversation.id, foreign_message.id)
        )

    assert state.commits == 0
    assert state.sync_events == []
    assert state.messages[foreign_message.id].ciphertext == b"foreign-opaque"


async def test_cleanup_expires_ciphertext_purges_old_tombstone_and_preserves_sequence() -> None:
    state, _, sender, _, _, conversation, expired = deletion_fixture()
    future = Message.create(
        conversation_id=conversation.id,
        client_message_id=uuid4(),
        sender_user_id=sender.id,
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=2,
        ciphertext=b"future",
        now=NOW + timedelta(days=20),
        retention=timedelta(days=30),
    )
    old = Message.create(
        conversation_id=conversation.id,
        client_message_id=uuid4(),
        sender_user_id=sender.id,
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=3,
        ciphertext=b"old",
        now=NOW - timedelta(days=121),
        retention=timedelta(days=30),
    ).to_tombstone(
        now=NOW - timedelta(days=91),
        tombstone_retention=timedelta(days=90),
        reason=MessageDeletionReason.EXPIRED,
        deleted_by_user_id=None,
    )
    state.messages.update({future.id: future, old.id: old})
    state.message_sequences[conversation.id] = 3
    cleanup = CleanupExpiredMessages(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(days=31)),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
    )

    result = await cleanup.execute()
    duplicate = await cleanup.execute()

    assert result.expired_messages == 1
    assert result.purged_tombstones == 1
    assert duplicate == type(result)(0, 0)
    assert old.id not in state.messages
    assert state.messages[expired.id].deletion_reason is MessageDeletionReason.EXPIRED
    assert state.messages[expired.id].deleted_at == expired.expires_at
    assert state.messages[future.id].ciphertext == b"future"
    assert state.commits == 1
    assert len(state.sync_events) == 3

    summary = (
        await ListConversationReadStates(
            unit_of_work=FakeMessagingUnitOfWorkFactory(state)
        ).execute(ListConversationReadStatesQuery(sender.id))
    )[0]
    assert summary.latest_sequence == 3
    assert summary.unread_count == 1
    async with FakeMessagingUnitOfWork(state) as unit_of_work:
        assert (
            await unit_of_work.messages.next_sequence(
                conversation.id,
                activity_at=NOW,
            )
            == 4
        )
