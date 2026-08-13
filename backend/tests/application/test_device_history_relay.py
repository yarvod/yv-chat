"""Security and idempotency specifications for the opaque device-history relay."""

import base64
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.device_pairings.history import (
    AcknowledgeHistoryChunk,
    AcknowledgeHistoryChunkCommand,
    ListHistoryChunks,
    ListHistoryChunksQuery,
    UploadHistoryChunk,
    UploadHistoryChunkCommand,
)
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.errors import DevicePairingNotFoundError, DevicePairingStateError
from messenger.domain.entities import Conversation, Device, DevicePairing, Session, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FixedClock,
    FixedSessionCredentials,
    IdentityState,
)

NOW = datetime(2026, 8, 13, 12, tzinfo=UTC)
POLICY = DevicePairingPolicy(ttl=timedelta(minutes=10), retention=timedelta(days=1))


def relay_state() -> tuple[IdentityState, User, Device, Device, Session, Session]:
    credentials = FixedSessionCredentials()
    user = User.create(username="alice", display_name="Alice", now=NOW)
    peer = User.create(username="bob", display_name="Bob", now=NOW)
    trusted = Device.create(user_id=user.id, name="Phone", now=NOW)
    candidate = Device.create(user_id=user.id, name="Mac", now=NOW)
    trusted_session = Session.create(
        user_id=user.id,
        device_id=trusted.id,
        token_hash=credentials.digest("trusted-session-secret"),
        now=NOW,
        idle_timeout=timedelta(days=30),
        absolute_lifetime=timedelta(days=90),
    )
    candidate_session = Session.create(
        user_id=user.id,
        device_id=candidate.id,
        token_hash=credentials.digest("candidate-session-secret"),
        now=NOW,
        idle_timeout=timedelta(days=30),
        absolute_lifetime=timedelta(days=90),
    )
    pairing = (
        DevicePairing.create_request(
            scan_token_hash=credentials.digest("scan-token-secret"),
            candidate_proof_hash=credentials.digest("candidate-proof-secret"),
            candidate_device_name="Mac",
            now=NOW,
            expires_at=NOW + POLICY.ttl,
        )
        .scan_request(
            user_id=user.id,
            trusted_session_id=trusted_session.id,
            trusted_device_id=trusted.id,
            now=NOW,
        )
        .approve(
            trusted_session_id=trusted_session.id,
            now=NOW,
        )
        .authorize(
            device_id=candidate.id,
            session_id=candidate_session.id,
            now=NOW,
        )
    )
    conversation = Conversation.create_direct(
        created_by=user.id,
        other_user_id=peer.id,
        now=NOW,
    )
    state = IdentityState(
        users={user.id: user, peer.id: peer},
        devices={trusted.id: trusted, candidate.id: candidate},
        sessions={trusted_session.id: trusted_session, candidate_session.id: candidate_session},
        device_pairings={pairing.id: pairing},
        conversations={conversation.id: conversation},
    )
    return state, user, trusted, candidate, trusted_session, candidate_session


@pytest.mark.asyncio
async def test_relay_is_bidirectional_idempotent_and_target_acknowledged() -> None:
    state, user, trusted, candidate, trusted_session, candidate_session = relay_state()
    pairing = next(iter(state.device_pairings.values()))
    conversation = next(iter(state.conversations.values()))
    factory = FakeIdentityUnitOfWorkFactory(state)
    upload = UploadHistoryChunk(
        unit_of_work=factory,
        clock=FixedClock(NOW),
        pairing_policy=POLICY,
    )
    chunk_id = uuid4()
    ciphertext = base64.b64encode(b"opaque MLS private message").decode()
    command = UploadHistoryChunkCommand(
        pairing_id=pairing.id,
        user_id=user.id,
        session_id=trusted_session.id,
        device_id=trusted.id,
        target_device_id=candidate.id,
        conversation_id=conversation.id,
        client_chunk_id=chunk_id,
        ciphertext_base64=ciphertext,
    )
    stored = await upload.execute(command)
    assert await upload.execute(command) == stored

    with pytest.raises(DevicePairingStateError):
        await upload.execute(
            replace(command, ciphertext_base64=base64.b64encode(b"other").decode())
        )

    listing = ListHistoryChunks(
        unit_of_work=factory,
        clock=FixedClock(NOW),
        pairing_policy=POLICY,
    )
    incoming = await listing.execute(
        ListHistoryChunksQuery(
            pairing_id=pairing.id,
            user_id=user.id,
            session_id=candidate_session.id,
            device_id=candidate.id,
            after_sequence=0,
        )
    )
    assert incoming == [stored]
    assert (
        await listing.execute(
            ListHistoryChunksQuery(
                pairing_id=pairing.id,
                user_id=user.id,
                session_id=trusted_session.id,
                device_id=trusted.id,
                after_sequence=0,
            )
        )
        == []
    )

    reverse = await upload.execute(
        UploadHistoryChunkCommand(
            pairing_id=pairing.id,
            user_id=user.id,
            session_id=candidate_session.id,
            device_id=candidate.id,
            target_device_id=trusted.id,
            conversation_id=conversation.id,
            client_chunk_id=uuid4(),
            ciphertext_base64=base64.b64encode(b"reverse opaque MLS").decode(),
        )
    )
    trusted_incoming = await listing.execute(
        ListHistoryChunksQuery(
            pairing_id=pairing.id,
            user_id=user.id,
            session_id=trusted_session.id,
            device_id=trusted.id,
            after_sequence=0,
        )
    )
    assert trusted_incoming == [reverse]

    acknowledged = await AcknowledgeHistoryChunk(
        unit_of_work=factory,
        clock=FixedClock(NOW),
        pairing_policy=POLICY,
    ).execute(
        AcknowledgeHistoryChunkCommand(
            pairing_id=pairing.id,
            chunk_id=stored.id,
            user_id=user.id,
            session_id=candidate_session.id,
            device_id=candidate.id,
        )
    )
    assert acknowledged.acknowledged_at == NOW
    assert (
        await listing.execute(
            ListHistoryChunksQuery(
                pairing_id=pairing.id,
                user_id=user.id,
                session_id=candidate_session.id,
                device_id=candidate.id,
                after_sequence=0,
            )
        )
        == []
    )


@pytest.mark.asyncio
async def test_relay_rejects_wrong_target_and_non_direct_conversation() -> None:
    state, user, trusted, candidate, trusted_session, _ = relay_state()
    pairing = next(iter(state.device_pairings.values()))
    conversation = next(iter(state.conversations.values()))
    upload = UploadHistoryChunk(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        pairing_policy=POLICY,
    )
    with pytest.raises(DevicePairingNotFoundError):
        await upload.execute(
            UploadHistoryChunkCommand(
                pairing_id=pairing.id,
                user_id=user.id,
                session_id=trusted_session.id,
                device_id=trusted.id,
                target_device_id=uuid4(),
                conversation_id=conversation.id,
                client_chunk_id=uuid4(),
                ciphertext_base64=base64.b64encode(b"opaque").decode(),
            )
        )
