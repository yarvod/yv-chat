"""PostgreSQL-backed device pairing survives process-local state loss."""

import base64
import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.accounts.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from messenger.application.device_pairings.approve import (
    ApproveDevicePairing,
    ApproveDevicePairingCommand,
)
from messenger.application.device_pairings.authorize import (
    AuthorizeDevicePairing,
    AuthorizeDevicePairingCommand,
)
from messenger.application.device_pairings.create_offer import (
    CreatePairingOffer,
    CreatePairingOfferCommand,
)
from messenger.application.device_pairings.create_request import (
    CreatePairingRequest,
    CreatePairingRequestCommand,
)
from messenger.application.device_pairings.history import (
    ListHistoryChunks,
    ListHistoryChunksQuery,
    UploadHistoryChunk,
    UploadHistoryChunkCommand,
)
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.device_pairings.scan import (
    ScanExistingPairingOffer,
    ScanExistingPairingOfferCommand,
    ScanPairingRequest,
    ScanPairingRequestCommand,
)
from messenger.application.device_pairings.status import (
    GetCandidatePairingStatus,
    GetCandidatePairingStatusQuery,
    GetExistingCandidatePairingStatus,
    GetExistingCandidatePairingStatusQuery,
)
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.login import Login, LoginCommand
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import Conversation, User
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    ConversationMemberModel,
    ConversationModel,
    DeviceHistoryChunkModel,
    DeviceModel,
    DevicePairingModel,
    SecurityEventModel,
    SessionModel,
    UserModel,
)
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 13, 18, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
SESSION_POLICY = SessionPolicy(
    idle_timeout=timedelta(days=30),
    absolute_lifetime=timedelta(days=90),
    rotation_interval=timedelta(days=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))
PAIRING_POLICY = DevicePairingPolicy(ttl=timedelta(minutes=10), retention=timedelta(days=1))


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_tables(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(DeviceHistoryChunkModel))
        await session.execute(delete(DevicePairingModel))
        await session.execute(delete(ConversationMemberModel))
        await session.execute(delete(ConversationModel))
        await session.execute(delete(SecurityEventModel))
        await session.execute(delete(SessionModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(ActivationTokenModel))
        await session.execute(delete(UserModel))


def unit_of_work_factory(
    session_factory: async_sessionmaker[AsyncSession],
) -> Callable[[], IdentityUnitOfWork]:
    def unit_of_work() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    return unit_of_work


async def run_flow(database_url: str) -> None:
    credentials = SecureSessionCredentialService()
    passwords = Argon2PasswordHasher()
    first_engine = create_engine(database_url)
    first_sessions = create_session_factory(first_engine)
    try:
        await reset_tables(first_sessions)
        first_uow = unit_of_work_factory(first_sessions)
        await BootstrapAdmin(
            unit_of_work=first_uow,
            clock=FixedClock(NOW),
            passwords=passwords,
        ).execute(
            BootstrapAdminCommand(
                username="alice",
                display_name="Alice",
                password=PASSWORD,
            )
        )
        trusted = await Login(
            unit_of_work=first_uow,
            clock=FixedClock(NOW + timedelta(seconds=1)),
            passwords=passwords,
            credentials=credentials,
            policy=SESSION_POLICY,
            event_policy=EVENT_POLICY,
        ).execute(LoginCommand(username="alice", password=PASSWORD, device_name="Trusted phone"))
        candidate_proof = credentials.generate()
        created = await CreatePairingRequest(
            unit_of_work=first_uow,
            clock=FixedClock(NOW + timedelta(seconds=2)),
            credentials=credentials,
            pairing_policy=PAIRING_POLICY,
        ).execute(
            CreatePairingRequestCommand(
                candidate_proof_hash=candidate_proof.digest,
                candidate_device_name="New computer",
            )
        )
    finally:
        await first_engine.dispose()

    second_engine = create_engine(database_url)
    second_sessions = create_session_factory(second_engine)
    try:
        second_uow = unit_of_work_factory(second_sessions)
        scanned = await ScanPairingRequest(
            unit_of_work=second_uow,
            clock=FixedClock(NOW + timedelta(seconds=3)),
            credentials=SecureSessionCredentialService(),
        ).execute(
            ScanPairingRequestCommand(
                pairing_id=created.pairing_id,
                scan_token=created.scan_token,
                user_id=trusted.user_id,
                session_id=trusted.session_id,
                device_id=trusted.device_id,
            )
        )
        assert scanned.status == "confirmation_pending"
        await ApproveDevicePairing(
            unit_of_work=second_uow,
            clock=FixedClock(NOW + timedelta(seconds=4)),
        ).execute(
            ApproveDevicePairingCommand(
                pairing_id=created.pairing_id,
                user_id=trusted.user_id,
                session_id=trusted.session_id,
                device_id=trusted.device_id,
            )
        )
    finally:
        await second_engine.dispose()

    third_engine = create_engine(database_url)
    third_sessions = create_session_factory(third_engine)
    try:
        third_uow = unit_of_work_factory(third_sessions)
        candidate_status = await GetCandidatePairingStatus(
            unit_of_work=third_uow,
            clock=FixedClock(NOW + timedelta(seconds=5)),
            credentials=SecureSessionCredentialService(),
        ).execute(
            GetCandidatePairingStatusQuery(
                pairing_id=created.pairing_id,
                candidate_proof=candidate_proof.plaintext,
            )
        )
        assert candidate_status.status == "approved"
        authorize = AuthorizeDevicePairing(
            unit_of_work=third_uow,
            clock=FixedClock(NOW + timedelta(seconds=6)),
            credentials=SecureSessionCredentialService(),
            policy=SESSION_POLICY,
            event_policy=EVENT_POLICY,
        )
        issued = await authorize.execute(
            AuthorizeDevicePairingCommand(
                pairing_id=created.pairing_id,
                candidate_proof=candidate_proof.plaintext,
            )
        )
        retried = await authorize.execute(
            AuthorizeDevicePairingCommand(
                pairing_id=created.pairing_id,
                candidate_proof=candidate_proof.plaintext,
            )
        )
        assert retried.session_id == issued.session_id
        assert retried.device_id == issued.device_id

        async with third_sessions() as session:
            session_count = await session.scalar(select(func.count()).select_from(SessionModel))
            device_count = await session.scalar(select(func.count()).select_from(DeviceModel))
            pairing = await session.get(DevicePairingModel, created.pairing_id)
        assert session_count == 2
        assert device_count == 2
        assert pairing is not None and pairing.status == "authorized"

        async with third_uow() as uow:
            peer = User.create(username="bob", display_name="Bob", now=NOW)
            await uow.users.add_active(peer, await passwords.hash(PASSWORD))
            conversation = Conversation.create_direct(
                created_by=trusted.user_id,
                other_user_id=peer.id,
                now=NOW,
            )
            await uow.conversations.add(conversation)
            await uow.commit()
        uploaded = await UploadHistoryChunk(
            unit_of_work=third_uow,
            clock=FixedClock(NOW + timedelta(seconds=7)),
            pairing_policy=PAIRING_POLICY,
        ).execute(
            UploadHistoryChunkCommand(
                pairing_id=created.pairing_id,
                user_id=trusted.user_id,
                session_id=trusted.session_id,
                device_id=trusted.device_id,
                target_device_id=issued.device_id,
                conversation_id=conversation.id,
                client_chunk_id=uuid4(),
                ciphertext_base64=base64.b64encode(b"opaque MLS relay").decode(),
            )
        )
    finally:
        await third_engine.dispose()

    fourth_engine = create_engine(database_url)
    fourth_sessions = create_session_factory(fourth_engine)
    try:
        incoming = await ListHistoryChunks(
            unit_of_work=unit_of_work_factory(fourth_sessions),
            clock=FixedClock(NOW + timedelta(seconds=8)),
            pairing_policy=PAIRING_POLICY,
        ).execute(
            ListHistoryChunksQuery(
                pairing_id=created.pairing_id,
                user_id=trusted.user_id,
                session_id=issued.session_id,
                device_id=issued.device_id,
                after_sequence=0,
            )
        )
        assert [chunk.id for chunk in incoming] == [uploaded.id]
    finally:
        await fourth_engine.dispose()

    fifth_engine = create_engine(database_url)
    fifth_sessions = create_session_factory(fifth_engine)
    try:
        existing_created = await CreatePairingOffer(
            unit_of_work=unit_of_work_factory(fifth_sessions),
            clock=FixedClock(NOW + timedelta(seconds=9)),
            credentials=SecureSessionCredentialService(),
            pairing_policy=PAIRING_POLICY,
        ).execute(
            CreatePairingOfferCommand(
                user_id=trusted.user_id,
                session_id=trusted.session_id,
                device_id=trusted.device_id,
            )
        )
    finally:
        await fifth_engine.dispose()

    sixth_engine = create_engine(database_url)
    sixth_sessions = create_session_factory(sixth_engine)
    try:
        existing_scanned = await ScanExistingPairingOffer(
            unit_of_work=unit_of_work_factory(sixth_sessions),
            clock=FixedClock(NOW + timedelta(seconds=10)),
            credentials=SecureSessionCredentialService(),
        ).execute(
            ScanExistingPairingOfferCommand(
                pairing_id=existing_created.pairing_id,
                scan_token=existing_created.scan_token,
                user_id=trusted.user_id,
                session_id=issued.session_id,
                device_id=issued.device_id,
            )
        )
        assert existing_scanned.candidate_device_id == issued.device_id
    finally:
        await sixth_engine.dispose()

    seventh_engine = create_engine(database_url)
    seventh_sessions = create_session_factory(seventh_engine)
    try:
        seventh_uow = unit_of_work_factory(seventh_sessions)
        existing_authorized = await ApproveDevicePairing(
            unit_of_work=seventh_uow,
            clock=FixedClock(NOW + timedelta(seconds=11)),
        ).execute(
            ApproveDevicePairingCommand(
                pairing_id=existing_created.pairing_id,
                user_id=trusted.user_id,
                session_id=trusted.session_id,
                device_id=trusted.device_id,
            )
        )
        assert existing_authorized.status == "authorized"
        existing_status = await GetExistingCandidatePairingStatus(
            unit_of_work=seventh_uow,
            clock=FixedClock(NOW + timedelta(seconds=12)),
        ).execute(
            GetExistingCandidatePairingStatusQuery(
                pairing_id=existing_created.pairing_id,
                user_id=trusted.user_id,
                session_id=issued.session_id,
                device_id=issued.device_id,
            )
        )
        assert existing_status.authorized_device_id == issued.device_id
        async with seventh_sessions() as session:
            session_count = await session.scalar(select(func.count()).select_from(SessionModel))
            device_count = await session.scalar(select(func.count()).select_from(DeviceModel))
        assert session_count == 2
        assert device_count == 2
    finally:
        await seventh_engine.dispose()


@pytest.mark.integration
async def test_postgresql_pairing_survives_backend_restarts() -> None:
    database_url = configured_database_url()
    try:
        await run_flow(database_url)
    finally:
        cleanup_engine = create_engine(database_url)
        cleanup_sessions = create_session_factory(cleanup_engine)
        try:
            await reset_tables(cleanup_sessions)
        finally:
            await cleanup_engine.dispose()
