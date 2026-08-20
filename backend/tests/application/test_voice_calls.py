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
OFFER_SIGNATURE = "a" * 128
ANSWER_SIGNATURE = "b" * 128


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
            identity_signature=OFFER_SIGNATURE,
        )
    )
    offer = realtime.notifications.pop()
    assert offer.user_id == bob.id
    assert offer.target_device_id is None
    assert offer.sdp == "offer-sdp"
    assert offer.identity_signature == OFFER_SIGNATURE
    snapshot = await coordinator.snapshot(user_id=bob.id, device_id=bob_device.id)
    assert snapshot[0].identity_signature == OFFER_SIGNATURE
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
            identity_signature=ANSWER_SIGNATURE,
        )
    )
    answer, answered_elsewhere = realtime.notifications
    assert answer.user_id == alice.id
    assert answer.target_device_id == alice_device.id
    assert answer.identity_signature == ANSWER_SIGNATURE
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


async def test_callee_candidate_is_rejected_until_authenticated_answer_is_bound() -> None:
    coordinator, _, _, alice, alice_device, bob, bob_device, _, _, conversation = fixture()
    call_id = uuid4()
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.OFFER,
            alice.id,
            alice_device.id,
            conversation.id,
            call_id,
            sdp="offer-sdp",
            identity_signature=OFFER_SIGNATURE,
        )
    )

    with pytest.raises(CallStateConflictError, match="callee must answer"):
        await coordinator.execute(
            CallSignalCommand(
                CallSignalType.ICE_CANDIDATE,
                bob.id,
                bob_device.id,
                conversation.id,
                call_id,
                candidate='{"candidate":"candidate:early"}',
            )
        )


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
                identity_signature=OFFER_SIGNATURE,
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
                identity_signature=OFFER_SIGNATURE,
            )
        )


async def test_first_answer_device_wins_and_later_device_is_ended_without_conflict() -> None:
    coordinator, realtime, _, alice, alice_device, bob, bob_device, _, state, conversation = (
        fixture()
    )
    bob_tablet = Device.create(user_id=bob.id, name="Bob tablet", now=NOW)
    state.devices[bob_tablet.id] = bob_tablet
    call_id = uuid4()
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.OFFER,
            alice.id,
            alice_device.id,
            conversation.id,
            call_id,
            sdp="offer-sdp",
            identity_signature=OFFER_SIGNATURE,
        )
    )
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.ANSWER,
            bob.id,
            bob_device.id,
            conversation.id,
            call_id,
            sdp="phone-answer",
            identity_signature=ANSWER_SIGNATURE,
        )
    )
    realtime.notifications.clear()

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.ANSWER,
            bob.id,
            bob_tablet.id,
            conversation.id,
            call_id,
            sdp="tablet-answer",
            identity_signature="c" * 128,
        )
    )

    assert len(realtime.notifications) == 1
    answered_elsewhere = realtime.notifications[0]
    assert answered_elsewhere.signal_type is CallSignalType.ENDED
    assert answered_elsewhere.target_device_id == bob_tablet.id
    assert answered_elsewhere.reason == "answered_elsewhere"

    realtime.notifications.clear()
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.REJECTED,
            bob.id,
            bob_tablet.id,
            conversation.id,
            call_id,
            reason="busy",
        )
    )
    assert realtime.notifications == []


async def test_busy_device_does_not_end_ringing_call_for_another_device() -> None:
    coordinator, realtime, _, alice, alice_device, bob, bob_device, _, state, conversation = (
        fixture()
    )
    bob_tablet = Device.create(user_id=bob.id, name="Bob tablet", now=NOW)
    state.devices[bob_tablet.id] = bob_tablet
    call_id = uuid4()
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.OFFER,
            alice.id,
            alice_device.id,
            conversation.id,
            call_id,
            sdp="offer-sdp",
            identity_signature=OFFER_SIGNATURE,
        )
    )
    realtime.notifications.clear()

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.REJECTED,
            bob.id,
            bob_device.id,
            conversation.id,
            call_id,
            reason="busy",
        )
    )

    assert realtime.notifications == []
    snapshot = await coordinator.snapshot(user_id=bob.id, device_id=bob_tablet.id)
    assert [item.signal_type for item in snapshot] == [CallSignalType.OFFER]

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.ANSWER,
            bob.id,
            bob_tablet.id,
            conversation.id,
            call_id,
            sdp="tablet-answer",
            identity_signature=ANSWER_SIGNATURE,
        )
    )
    assert realtime.notifications[0].signal_type is CallSignalType.ANSWER
    assert realtime.notifications[0].target_device_id == alice_device.id


async def test_explicit_decline_stops_ringing_on_other_callee_devices() -> None:
    coordinator, realtime, _, alice, alice_device, bob, bob_device, _, state, conversation = (
        fixture()
    )
    bob_tablet = Device.create(user_id=bob.id, name="Bob tablet", now=NOW)
    state.devices[bob_tablet.id] = bob_tablet
    call_id = uuid4()
    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.OFFER,
            alice.id,
            alice_device.id,
            conversation.id,
            call_id,
            sdp="offer-sdp",
            identity_signature=OFFER_SIGNATURE,
        )
    )
    realtime.notifications.clear()

    await coordinator.execute(
        CallSignalCommand(
            CallSignalType.REJECTED,
            bob.id,
            bob_device.id,
            conversation.id,
            call_id,
            reason="declined",
        )
    )

    rejected, declined_elsewhere = realtime.notifications
    assert rejected.user_id == alice.id
    assert rejected.target_device_id == alice_device.id
    assert declined_elsewhere.user_id == bob.id
    assert declined_elsewhere.excluded_device_id == bob_device.id
    assert declined_elsewhere.reason == "declined_elsewhere"
    assert await coordinator.snapshot(user_id=bob.id, device_id=bob_tablet.id) == ()
