"""Authorized one-to-one call signaling state-machine specifications."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from messenger.application.calls import (
    CallSignalCommand,
    CallSignalNotification,
    CallSignalType,
    VoiceCallCoordinator,
)
from messenger.application.errors import CallStateConflictError, ConversationNotFoundError
from messenger.domain.entities import Conversation, Device, User
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingPushNotifier,
)

NOW = datetime(2026, 8, 19, 12, 0, tzinfo=UTC)


@dataclass(slots=True)
class RecordingCallNotifier:
    notifications: list[CallSignalNotification] = field(default_factory=list)

    async def publish(self, notifications: tuple[CallSignalNotification, ...]) -> None:
        self.notifications.extend(notifications)


def fixture() -> tuple[
    VoiceCallCoordinator,
    RecordingCallNotifier,
    RecordingPushNotifier,
    User,
    Device,
    User,
    Device,
    User,
    IdentityState,
    Conversation,
]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    mallory = User.create(username="mallory", display_name="Mallory", now=NOW)
    alice_device = Device.create(user_id=alice.id, name="Alice phone", now=NOW)
    bob_device = Device.create(user_id=bob.id, name="Bob phone", now=NOW)
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    state = IdentityState(
        users={item.id: item for item in (alice, bob, mallory)},
        devices={item.id: item for item in (alice_device, bob_device)},
        conversations={conversation.id: conversation},
    )
    realtime = RecordingCallNotifier()
    push = RecordingPushNotifier()
    coordinator = VoiceCallCoordinator(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        realtime_notifier=realtime,
        push_notifier=push,
    )
    return (
        coordinator,
        realtime,
        push,
        alice,
        alice_device,
        bob,
        bob_device,
        mallory,
        state,
        conversation,
    )


async def test_offer_answer_candidate_and_end_are_device_scoped() -> None:
    coordinator, realtime, push, alice, alice_device, bob, bob_device, _, _, conversation = (
        fixture()
    )
    call_id = uuid4()

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.OFFER,
            alice.id,
            alice_device.id,
            conversation.id,
            call_id,
            sdp="offer-sdp",
        )
    )
    offer = realtime.notifications.pop()
    assert offer.user_id == bob.id
    assert offer.target_device_id is None
    assert offer.sdp == "offer-sdp"
    assert push.notifications[0].event_type == "incoming_call"
    assert push.notifications[0].message_id is None
    assert push.notifications[0].call_id == call_id

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.ANSWER,
            bob.id,
            bob_device.id,
            conversation.id,
            call_id,
            sdp="answer-sdp",
        )
    )
    answer, answered_elsewhere = realtime.notifications
    assert answer.user_id == alice.id
    assert answer.target_device_id == alice_device.id
    assert answered_elsewhere.excluded_device_id == bob_device.id

    realtime.notifications.clear()
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.ICE_CANDIDATE,
            bob.id,
            bob_device.id,
            conversation.id,
            call_id,
            candidate='{"candidate":"candidate:1"}',
        )
    )
    assert realtime.notifications[0].target_device_id == alice_device.id

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.ENDED,
            alice.id,
            alice_device.id,
            conversation.id,
            call_id,
            reason="hangup",
        )
    )
    assert realtime.notifications[-1].user_id == bob.id
    assert realtime.notifications[-1].target_device_id == bob_device.id
    assert await coordinator.snapshot(user_id=bob.id, device_id=bob_device.id) == ()


async def test_outsider_and_group_calls_are_rejected() -> None:
    coordinator, _, _, alice, alice_device, bob, _, mallory, state, conversation = fixture()
    mallory_device = Device.create(user_id=mallory.id, name="Mallory phone", now=NOW)
    state.devices[mallory_device.id] = mallory_device
    with pytest.raises(ConversationNotFoundError):
        await coordinator.execute(
            CallSignalCommand(
                CallSignalType.OFFER,
                mallory.id,
                mallory_device.id,
                conversation.id,
                uuid4(),
                sdp="offer",
            )
        )

    group = Conversation.create_group(
        created_by=alice.id,
        title="Group",
        now=NOW,
    ).add_member(bob.id, NOW)
    state.conversations[group.id] = group
    with pytest.raises(CallStateConflictError):
        await coordinator.execute(
            CallSignalCommand(
                CallSignalType.OFFER,
                alice.id,
                alice_device.id,
                group.id,
                uuid4(),
                sdp="offer",
            )
        )
