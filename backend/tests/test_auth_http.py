"""Browser authentication transport security tests."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from dishka import Provider, Scope, make_async_container, provide
from dishka.integrations.fastapi import FastapiProvider
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from messenger.application.accounts.activate import ActivateAccount
from messenger.application.accounts.change_password import ChangeCurrentPassword
from messenger.application.accounts.create_registration_invitation import (
    CreateRegistrationInvitation,
)
from messenger.application.accounts.get_current import GetCurrentAccount
from messenger.application.accounts.invite import CreateUserInvitation
from messenger.application.accounts.issue_password_reset import IssuePasswordReset
from messenger.application.accounts.list_directory import ListUserDirectory
from messenger.application.accounts.list_registration_invitations import (
    ListRegistrationInvitations,
)
from messenger.application.accounts.list_users import ListManagedUsers
from messenger.application.accounts.password_reset_policy import PasswordResetPolicy
from messenger.application.accounts.register_with_invitation import RegisterWithInvitation
from messenger.application.accounts.reissue_activation import ReissueActivation
from messenger.application.accounts.reset_password import ResetPasswordWithToken
from messenger.application.accounts.revoke_registration_invitation import (
    RevokeRegistrationInvitation,
)
from messenger.application.accounts.security_reset import SecurityReset
from messenger.application.accounts.update_profile import UpdateCurrentProfile
from messenger.application.accounts.update_user import UpdateManagedUser
from messenger.application.attachments.cleanup import CleanupExpiredAttachments
from messenger.application.attachments.download import DownloadGroupAttachment
from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.attachments.upload import UploadGroupAttachment
from messenger.application.conversation_crypto import (
    AcknowledgeConversationCryptoWelcome,
    BeginConversationCrypto,
    FinalizeConversationCrypto,
    GetCurrentConversationCrypto,
    ListConversationCryptoUpdates,
)
from messenger.application.conversations.add_member import AddConversationMember
from messenger.application.conversations.change_member_role import (
    ChangeConversationMemberRole,
)
from messenger.application.conversations.create_direct import CreateDirectConversation
from messenger.application.conversations.create_group import CreateGroupConversation
from messenger.application.conversations.get_conversation import GetConversation
from messenger.application.conversations.leave_conversation import LeaveConversation
from messenger.application.conversations.list_conversations import ListConversations
from messenger.application.conversations.remove_member import RemoveConversationMember
from messenger.application.conversations.rename_group import RenameGroupConversation
from messenger.application.device_crypto.claim_key_package import ClaimDeviceKeyPackage
from messenger.application.device_crypto.get_current import GetCurrentDeviceCryptoIdentity
from messenger.application.device_crypto.list_key_packages import (
    ListDeviceKeyPackageInventory,
)
from messenger.application.device_crypto.register import RegisterDeviceCryptoIdentity
from messenger.application.device_crypto.replenish_key_packages import (
    ReplenishDeviceKeyPackages,
)
from messenger.application.device_pairings.approve import ApproveDevicePairing
from messenger.application.device_pairings.authorize import AuthorizeDevicePairing
from messenger.application.device_pairings.cancel import (
    CancelCandidatePairing,
    CancelDeviceHistorySync,
    CancelExistingCandidatePairing,
    CancelTrustedPairing,
)
from messenger.application.device_pairings.create_offer import CreatePairingOffer
from messenger.application.device_pairings.create_request import CreatePairingRequest
from messenger.application.device_pairings.history import (
    AcknowledgeHistoryChunk,
    ListHistoryChunks,
    ListOutboundHistoryChunks,
    UploadHistoryChunk,
)
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.device_pairings.scan import (
    ScanExistingPairingOffer,
    ScanPairingOffer,
    ScanPairingRequest,
)
from messenger.application.device_pairings.status import (
    GetCandidatePairingStatus,
    GetExistingCandidatePairingStatus,
    GetTrustedPairingStatus,
)
from messenger.application.devices.list_security_events import ListSecurityEvents
from messenger.application.devices.list_sessions import ListMySessions
from messenger.application.devices.rename import RenameMyDevice
from messenger.application.devices.revoke import RevokeMyDevice
from messenger.application.devices.revoke_others import RevokeOtherSessions
from messenger.application.messaging.cleanup_messages import CleanupExpiredMessages
from messenger.application.messaging.delete_message import DeleteMessageForEveryone
from messenger.application.messaging.get_message import GetMessage
from messenger.application.messaging.list_delivery_states import ListParticipantDeliveryStates
from messenger.application.messaging.list_message_history import ListMessageHistory
from messenger.application.messaging.list_messages import ListMessages
from messenger.application.messaging.list_read_states import ListConversationReadStates
from messenger.application.messaging.mark_delivered import MarkConversationDelivered
from messenger.application.messaging.mark_read import MarkConversationRead
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.messaging.send_message import SendOpaqueMessage
from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.attachments import AttachmentUnitOfWorkFactory
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWorkFactory
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.media_storage import MediaStorage
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.password_reset_secrets import PasswordResetSecretService
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.ports.push import PushNotifier
from messenger.application.ports.realtime import RealtimeHub, RealtimeNotifier
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.ports.sync import SyncUnitOfWorkFactory
from messenger.application.realtime.presence import ListPresenceSnapshot, PublishPresence
from messenger.application.realtime.typing import PublishTyping, TypingPolicy
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.application.sessions.login import Login
from messenger.application.sessions.logout import Logout
from messenger.application.sessions.policy import SessionPolicy
from messenger.application.sessions.validate_active import ValidateActiveSession
from messenger.application.sync import SyncPolicy
from messenger.application.sync.list_events import ListSyncEvents
from messenger.bootstrap.app import create_app
from messenger.bootstrap.settings import AppEnvironment, AppSettings
from messenger.domain.entities import Conversation, Device, Message, Session, User
from messenger.infrastructure.auth.password_reset_secrets import (
    SecurePasswordResetSecretService,
)
from messenger.infrastructure.realtime import InMemoryRealtimeHub
from tests.application.fakes import (
    FakeAttachmentUnitOfWorkFactory,
    FakeConversationCryptoUnitOfWorkFactory,
    FakeConversationUnitOfWorkFactory,
    FakeDeviceCryptoUnitOfWorkFactory,
    FakeIdentityUnitOfWorkFactory,
    FakeMediaStorage,
    FakeMessagingUnitOfWorkFactory,
    FakePasswordHasher,
    FakeSyncUnitOfWorkFactory,
    FixedSessionCredentials,
    IdentityState,
    RecordingPushNotifier,
    SequentialActivationSecrets,
)

# Keep cookie expiry in the future for the real httpx cookie jar while every
# application decision still goes through the injected deterministic clock.
NOW = datetime.now(UTC).replace(microsecond=0)
PASSWORD = "correct horse battery staple"
POLICY = SessionPolicy(
    idle_timeout=timedelta(hours=2),
    absolute_lifetime=timedelta(hours=3),
    rotation_interval=timedelta(hours=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))
DATABASE_URL = "postgresql+asyncpg://test:test@127.0.0.1:5432/test"


@dataclass(slots=True)
class MutableClock:
    instant: datetime

    def now(self) -> datetime:
        return self.instant


class HttpTestProvider(Provider):
    """Inject deterministic adapters while preserving production scope rules."""

    def __init__(
        self,
        *,
        settings: AppSettings,
        unit_of_work: IdentityUnitOfWorkFactory,
        conversation_unit_of_work: ConversationUnitOfWorkFactory,
        conversation_crypto_unit_of_work: ConversationCryptoUnitOfWorkFactory,
        device_crypto_unit_of_work: DeviceCryptoUnitOfWorkFactory,
        messaging_unit_of_work: MessagingUnitOfWorkFactory,
        attachment_unit_of_work: AttachmentUnitOfWorkFactory,
        sync_unit_of_work: SyncUnitOfWorkFactory,
        clock: Clock,
        passwords: PasswordHasher,
        credentials: SessionCredentialService,
        activation_secrets: ActivationSecretService,
    ) -> None:
        super().__init__()
        self._settings = settings
        self._unit_of_work = unit_of_work
        self._conversation_unit_of_work = conversation_unit_of_work
        self._conversation_crypto_unit_of_work = conversation_crypto_unit_of_work
        self._device_crypto_unit_of_work = device_crypto_unit_of_work
        self._messaging_unit_of_work = messaging_unit_of_work
        self._attachment_unit_of_work = attachment_unit_of_work
        self._media_storage = FakeMediaStorage()
        self._sync_unit_of_work = sync_unit_of_work
        self._clock = clock
        self._passwords = passwords
        self._credentials = credentials
        self._activation_secrets = activation_secrets
        self._realtime_hub = InMemoryRealtimeHub()

    @provide(scope=Scope.APP)
    def settings(self) -> AppSettings:
        return self._settings

    @provide(scope=Scope.APP)
    def unit_of_work(self) -> IdentityUnitOfWorkFactory:
        return self._unit_of_work

    @provide(scope=Scope.APP)
    def conversation_unit_of_work(self) -> ConversationUnitOfWorkFactory:
        return self._conversation_unit_of_work

    @provide(scope=Scope.APP)
    def conversation_crypto_unit_of_work(self) -> ConversationCryptoUnitOfWorkFactory:
        return self._conversation_crypto_unit_of_work

    @provide(scope=Scope.APP)
    def device_crypto_unit_of_work(self) -> DeviceCryptoUnitOfWorkFactory:
        return self._device_crypto_unit_of_work

    @provide(scope=Scope.APP)
    def messaging_unit_of_work(self) -> MessagingUnitOfWorkFactory:
        return self._messaging_unit_of_work

    @provide(scope=Scope.APP)
    def attachment_unit_of_work(self) -> AttachmentUnitOfWorkFactory:
        return self._attachment_unit_of_work

    @provide(scope=Scope.APP)
    def media_storage(self) -> MediaStorage:
        return self._media_storage

    @provide(scope=Scope.APP)
    def sync_unit_of_work(self) -> SyncUnitOfWorkFactory:
        return self._sync_unit_of_work

    @provide(scope=Scope.APP)
    def message_policy(self) -> MessageEnvelopePolicy:
        return MessageEnvelopePolicy()

    @provide(scope=Scope.APP)
    def attachment_policy(self) -> AttachmentPolicy:
        return AttachmentPolicy()

    @provide(scope=Scope.APP)
    def sync_policy(self) -> SyncPolicy:
        return SyncPolicy()

    @provide(scope=Scope.APP)
    def message_retention_policy(self) -> MessageRetentionPolicy:
        return MessageRetentionPolicy(timedelta(days=30), timedelta(days=90))

    @provide(scope=Scope.APP)
    def clock(self) -> Clock:
        return self._clock

    @provide(scope=Scope.APP)
    def passwords(self) -> PasswordHasher:
        return self._passwords

    @provide(scope=Scope.APP)
    def credentials(self) -> SessionCredentialService:
        return self._credentials

    @provide(scope=Scope.APP)
    def activation_secrets(self) -> ActivationSecretService:
        return self._activation_secrets

    @provide(scope=Scope.APP)
    def password_reset_secrets(self) -> PasswordResetSecretService:
        return SecurePasswordResetSecretService()

    @provide(scope=Scope.APP)
    def activation_ttl(self) -> timedelta:
        return timedelta(hours=24)

    @provide(scope=Scope.APP)
    def session_policy(self) -> SessionPolicy:
        return POLICY

    @provide(scope=Scope.APP)
    def device_pairing_policy(self) -> DevicePairingPolicy:
        return DevicePairingPolicy(
            ttl=timedelta(minutes=10),
            retention=timedelta(days=1),
        )

    @provide(scope=Scope.APP)
    def password_reset_policy(self) -> PasswordResetPolicy:
        return PasswordResetPolicy(ttl=timedelta(hours=1))

    @provide(scope=Scope.APP)
    def event_policy(self) -> SecurityEventPolicy:
        return EVENT_POLICY

    @provide(scope=Scope.APP)
    def typing_policy(self) -> TypingPolicy:
        return TypingPolicy()

    @provide(scope=Scope.APP)
    def realtime_hub(self) -> RealtimeHub:
        return self._realtime_hub

    @provide(scope=Scope.APP)
    def realtime_notifier(self) -> RealtimeNotifier:
        return self._realtime_hub

    @provide(scope=Scope.APP)
    def push_notifier(self) -> PushNotifier:
        return RecordingPushNotifier()

    login = provide(Login, scope=Scope.REQUEST)
    authenticate_session = provide(AuthenticateSession, scope=Scope.REQUEST)
    validate_active_session = provide(ValidateActiveSession, scope=Scope.REQUEST)
    logout = provide(Logout, scope=Scope.REQUEST)
    list_my_sessions = provide(ListMySessions, scope=Scope.REQUEST)
    list_security_events = provide(ListSecurityEvents, scope=Scope.REQUEST)
    rename_my_device = provide(RenameMyDevice, scope=Scope.REQUEST)
    revoke_my_device = provide(RevokeMyDevice, scope=Scope.REQUEST)
    revoke_other_sessions = provide(RevokeOtherSessions, scope=Scope.REQUEST)
    create_pairing_request = provide(CreatePairingRequest, scope=Scope.REQUEST)
    create_pairing_offer = provide(CreatePairingOffer, scope=Scope.REQUEST)
    scan_pairing_request = provide(ScanPairingRequest, scope=Scope.REQUEST)
    scan_pairing_offer = provide(ScanPairingOffer, scope=Scope.REQUEST)
    scan_existing_pairing_offer = provide(ScanExistingPairingOffer, scope=Scope.REQUEST)
    get_candidate_pairing_status = provide(GetCandidatePairingStatus, scope=Scope.REQUEST)
    get_trusted_pairing_status = provide(GetTrustedPairingStatus, scope=Scope.REQUEST)
    get_existing_candidate_pairing_status = provide(
        GetExistingCandidatePairingStatus,
        scope=Scope.REQUEST,
    )
    approve_pairing = provide(ApproveDevicePairing, scope=Scope.REQUEST)
    authorize_pairing = provide(AuthorizeDevicePairing, scope=Scope.REQUEST)
    cancel_candidate_pairing = provide(CancelCandidatePairing, scope=Scope.REQUEST)
    cancel_existing_candidate_pairing = provide(
        CancelExistingCandidatePairing,
        scope=Scope.REQUEST,
    )
    cancel_trusted_pairing = provide(CancelTrustedPairing, scope=Scope.REQUEST)
    cancel_device_history_sync = provide(CancelDeviceHistorySync, scope=Scope.REQUEST)
    upload_history_chunk = provide(UploadHistoryChunk, scope=Scope.REQUEST)
    list_history_chunks = provide(ListHistoryChunks, scope=Scope.REQUEST)
    list_outbound_history_chunks = provide(ListOutboundHistoryChunks, scope=Scope.REQUEST)
    acknowledge_history_chunk = provide(AcknowledgeHistoryChunk, scope=Scope.REQUEST)
    get_current_device_crypto_identity = provide(
        GetCurrentDeviceCryptoIdentity,
        scope=Scope.REQUEST,
    )
    register_device_crypto_identity = provide(
        RegisterDeviceCryptoIdentity,
        scope=Scope.REQUEST,
    )
    claim_device_key_package = provide(ClaimDeviceKeyPackage, scope=Scope.REQUEST)
    list_device_key_package_inventory = provide(
        ListDeviceKeyPackageInventory,
        scope=Scope.REQUEST,
    )
    replenish_device_key_packages = provide(
        ReplenishDeviceKeyPackages,
        scope=Scope.REQUEST,
    )
    activate_account = provide(ActivateAccount, scope=Scope.REQUEST)
    create_user_invitation = provide(CreateUserInvitation, scope=Scope.REQUEST)
    create_registration_invitation = provide(CreateRegistrationInvitation, scope=Scope.REQUEST)
    list_user_directory = provide(ListUserDirectory, scope=Scope.REQUEST)
    list_managed_users = provide(ListManagedUsers, scope=Scope.REQUEST)
    list_registration_invitations = provide(ListRegistrationInvitations, scope=Scope.REQUEST)
    register_with_invitation = provide(RegisterWithInvitation, scope=Scope.REQUEST)
    revoke_registration_invitation = provide(RevokeRegistrationInvitation, scope=Scope.REQUEST)
    issue_password_reset = provide(IssuePasswordReset, scope=Scope.REQUEST)
    reset_password_with_token = provide(ResetPasswordWithToken, scope=Scope.REQUEST)
    reissue_activation = provide(ReissueActivation, scope=Scope.REQUEST)
    update_managed_user = provide(UpdateManagedUser, scope=Scope.REQUEST)
    get_current_account = provide(GetCurrentAccount, scope=Scope.REQUEST)
    update_current_profile = provide(UpdateCurrentProfile, scope=Scope.REQUEST)
    change_current_password = provide(ChangeCurrentPassword, scope=Scope.REQUEST)
    security_reset = provide(SecurityReset, scope=Scope.REQUEST)
    create_direct_conversation = provide(CreateDirectConversation, scope=Scope.REQUEST)
    create_group_conversation = provide(CreateGroupConversation, scope=Scope.REQUEST)
    list_conversations = provide(ListConversations, scope=Scope.REQUEST)
    get_conversation = provide(GetConversation, scope=Scope.REQUEST)
    add_conversation_member = provide(AddConversationMember, scope=Scope.REQUEST)
    remove_conversation_member = provide(RemoveConversationMember, scope=Scope.REQUEST)
    rename_group_conversation = provide(RenameGroupConversation, scope=Scope.REQUEST)
    leave_conversation = provide(LeaveConversation, scope=Scope.REQUEST)
    change_conversation_member_role = provide(
        ChangeConversationMemberRole,
        scope=Scope.REQUEST,
    )
    begin_conversation_crypto = provide(BeginConversationCrypto, scope=Scope.REQUEST)
    finalize_conversation_crypto = provide(FinalizeConversationCrypto, scope=Scope.REQUEST)
    get_current_conversation_crypto = provide(
        GetCurrentConversationCrypto,
        scope=Scope.REQUEST,
    )
    list_conversation_crypto_updates = provide(
        ListConversationCryptoUpdates,
        scope=Scope.REQUEST,
    )
    acknowledge_conversation_crypto_welcome = provide(
        AcknowledgeConversationCryptoWelcome,
        scope=Scope.REQUEST,
    )
    send_opaque_message = provide(SendOpaqueMessage, scope=Scope.REQUEST)
    delete_message_for_everyone = provide(DeleteMessageForEveryone, scope=Scope.REQUEST)
    get_message = provide(GetMessage, scope=Scope.REQUEST)
    cleanup_expired_messages = provide(CleanupExpiredMessages, scope=Scope.REQUEST)
    upload_group_attachment = provide(UploadGroupAttachment, scope=Scope.REQUEST)
    download_group_attachment = provide(DownloadGroupAttachment, scope=Scope.REQUEST)
    cleanup_expired_attachments = provide(CleanupExpiredAttachments, scope=Scope.REQUEST)
    list_messages = provide(ListMessages, scope=Scope.REQUEST)
    list_message_history = provide(ListMessageHistory, scope=Scope.REQUEST)
    list_conversation_read_states = provide(
        ListConversationReadStates,
        scope=Scope.REQUEST,
    )
    mark_conversation_read = provide(MarkConversationRead, scope=Scope.REQUEST)
    list_participant_delivery_states = provide(
        ListParticipantDeliveryStates,
        scope=Scope.REQUEST,
    )
    mark_conversation_delivered = provide(MarkConversationDelivered, scope=Scope.REQUEST)
    list_sync_events = provide(ListSyncEvents, scope=Scope.REQUEST)
    publish_typing = provide(PublishTyping, scope=Scope.REQUEST)
    list_presence_snapshot = provide(ListPresenceSnapshot, scope=Scope.REQUEST)
    publish_presence = provide(PublishPresence, scope=Scope.REQUEST)


def build_test_application(
    *,
    trusted_proxy_cidrs: list[str] | None = None,
    is_admin: bool = False,
) -> tuple[FastAPI, IdentityState, MutableClock]:
    user = User.create(
        username="alice",
        display_name="Alice",
        now=NOW,
        is_admin=is_admin,
    )
    state = IdentityState(
        users={user.id: user},
        password_hashes={user.id: "$argon2id$fake-hash"},
    )
    passwords = FakePasswordHasher()
    passwords.hashed_passwords.append(PASSWORD)
    credentials = FixedSessionCredentials()
    clock = MutableClock(NOW)
    factory = FakeIdentityUnitOfWorkFactory(state)
    settings = AppSettings(
        app_env=AppEnvironment.TEST,
        database_url=DATABASE_URL,
        allowed_origins=["https://test"],
        trusted_proxy_cidrs=trusted_proxy_cidrs or [],
        session_idle_timeout_seconds=7200,
        session_absolute_lifetime_seconds=10800,
        session_rotation_interval_seconds=3600,
        session_previous_token_grace_seconds=60,
        session_touch_interval_seconds=300,
    )
    container = make_async_container(
        HttpTestProvider(
            settings=settings,
            unit_of_work=factory,
            conversation_unit_of_work=FakeConversationUnitOfWorkFactory(state),
            conversation_crypto_unit_of_work=FakeConversationCryptoUnitOfWorkFactory(state),
            device_crypto_unit_of_work=FakeDeviceCryptoUnitOfWorkFactory(state),
            messaging_unit_of_work=FakeMessagingUnitOfWorkFactory(state),
            attachment_unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
            sync_unit_of_work=FakeSyncUnitOfWorkFactory(state),
            clock=clock,
            passwords=passwords,
            credentials=credentials,
            activation_secrets=SequentialActivationSecrets(),
        ),
        FastapiProvider(),
    )
    return create_app(settings, container=container), state, clock


async def login(client: AsyncClient) -> Response:
    return await client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://test"},
        json={
            "username": "alice",
            "password": PASSWORD,
            "device_name": "Browser",
        },
    )


async def run_cookie_flow() -> None:
    application, state, clock = build_test_application()
    transport = ASGITransport(app=application, client=("203.0.113.7", 443))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        login_response = await login(client)
        assert login_response.status_code == 200
        first_session_id = UUID(login_response.json()["session_id"])
        first_device_id = UUID(login_response.json()["device_id"])
        assert "session_credential" not in login_response.json()
        cookie_headers = login_response.headers.get_list("set-cookie")
        session_header = next(header for header in cookie_headers if "__Host-yv_session=" in header)
        csrf_header = next(header for header in cookie_headers if "__Host-yv_csrf=" in header)
        assert "Secure" in session_header
        assert "HttpOnly" in session_header
        assert "SameSite=strict" in session_header
        assert "Path=/" in session_header
        assert "Domain=" not in session_header
        assert "Secure" in csrf_header
        assert "HttpOnly" not in csrf_header

        current = await client.get("/api/v1/auth/session")
        assert current.status_code == 200
        assert "set-cookie" not in current.headers

        second_login = await login(client)
        assert second_login.status_code == 200
        current_session_id = UUID(second_login.json()["session_id"])
        current_device_id = UUID(second_login.json()["device_id"])
        assert current_session_id != first_session_id
        assert current_device_id != first_device_id
        assert state.sessions[first_session_id].revoked_at is None
        assert state.devices[first_device_id].revoked_at is None
        current_csrf = client.cookies["__Host-yv_csrf"]

        devices = await client.get("/api/v1/devices")
        assert devices.status_code == 200
        assert len(devices.json()) == 2
        current_items = [item for item in devices.json() if item["is_current"]]
        assert [UUID(item["session_id"]) for item in current_items] == [current_session_id]
        forbidden_response_fields = {
            "current_token_hash",
            "previous_token_hash",
            "session_credential",
            "password_hash",
        }
        assert all(forbidden_response_fields.isdisjoint(item) for item in devices.json())

        bob = User.create(username="bob", display_name="Bob", now=NOW)
        foreign_device = Device.create(user_id=bob.id, name="Bob phone", now=NOW)
        foreign_session = Session.create(
            user_id=bob.id,
            device_id=foreign_device.id,
            token_hash="f" * 64,
            now=NOW,
            idle_timeout=timedelta(hours=2),
            absolute_lifetime=timedelta(hours=3),
        )
        state.users[bob.id] = bob
        state.devices[foreign_device.id] = foreign_device
        state.sessions[foreign_session.id] = foreign_session

        missing_device_csrf = await client.patch(
            f"/api/v1/devices/{current_device_id}",
            headers={"Origin": "https://test"},
            json={"name": "No CSRF"},
        )
        assert missing_device_csrf.status_code == 403

        foreign_rename = await client.patch(
            f"/api/v1/devices/{foreign_device.id}",
            headers={"Origin": "https://test", "X-CSRF-Token": current_csrf},
            json={"name": "Stolen"},
        )
        assert foreign_rename.status_code == 404

        other_device_id = next(
            UUID(item["device_id"]) for item in devices.json() if not item["is_current"]
        )
        renamed = await client.patch(
            f"/api/v1/devices/{other_device_id}",
            headers={"Origin": "https://test", "X-CSRF-Token": current_csrf},
            json={"name": "Old laptop"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Old laptop"

        current_revoke = await client.delete(
            f"/api/v1/devices/{current_device_id}",
            headers={"Origin": "https://test", "X-CSRF-Token": current_csrf},
        )
        assert current_revoke.status_code == 409

        revoked_other = await client.delete(
            f"/api/v1/devices/{other_device_id}",
            headers={"Origin": "https://test", "X-CSRF-Token": current_csrf},
        )
        assert revoked_other.status_code == 204

        revoked_others = await client.post(
            "/api/v1/sessions/revoke-others",
            headers={"Origin": "https://test", "X-CSRF-Token": current_csrf},
        )
        assert revoked_others.status_code == 200
        assert revoked_others.json() == {"revoked_count": 0}

        events = await client.get("/api/v1/security-events")
        assert events.status_code == 200
        assert {event["event_type"] for event in events.json()} >= {
            "login",
            "device_renamed",
            "device_revoked",
            "other_sessions_revoked",
        }
        assert all(forbidden_response_fields.isdisjoint(event) for event in events.json())

        original_credential = client.cookies["__Host-yv_session"]
        clock.instant = NOW + timedelta(hours=1)
        rotated = await client.get("/api/v1/auth/session")
        assert rotated.status_code == 200
        assert "__Host-yv_session=" in rotated.headers["set-cookie"]
        assert client.cookies["__Host-yv_session"] != original_credential

        csrf_value = client.cookies["__Host-yv_csrf"]
        forbidden = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://evil.example", "X-CSRF-Token": csrf_value},
        )
        assert forbidden.status_code == 403
        assert state.sessions[current_session_id].revoked_at is None

        missing_csrf = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://test"},
        )
        assert missing_csrf.status_code == 403

        logged_out = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://test", "X-CSRF-Token": csrf_value},
        )
        assert logged_out.status_code == 204
        assert state.sessions[current_session_id].revoked_at == clock.instant
        assert state.devices[current_device_id].revoked_at == clock.instant


async def test_login_session_rotation_and_csrf_logout_cookie_flow() -> None:
    await run_cookie_flow()


async def run_cookie_only_auth() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.get(
            "/api/v1/auth/session?session_credential=opaque-session-00000000000000000001",
            headers={"Authorization": "Bearer opaque-session-00000000000000000001"},
        )
        assert response.status_code == 401

        missing_origin = await client.post(
            "/api/v1/auth/login",
            json={
                "username": "alice",
                "password": PASSWORD,
                "device_name": "Browser",
            },
        )
        assert missing_origin.status_code == 403

        invalid_login = await client.post(
            "/api/v1/auth/login",
            headers={"Origin": "https://test"},
            json={
                "username": "unknown",
                "password": "incorrect password",
                "device_name": "Browser",
            },
        )
        assert invalid_login.status_code == 401
        assert invalid_login.json() == {"detail": "invalid username or password"}

        openapi = (await client.get("/openapi.json")).json()
        response_properties = openapi["components"]["schemas"]["SessionResponse"]["properties"]
        assert "session_credential" not in response_properties
        assert "password" not in response_properties


async def test_session_does_not_accept_bearer_or_query_credentials() -> None:
    await run_cookie_only_auth()


async def test_read_state_transport_requires_csrf_and_returns_actual_unread_count() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        login_response = await login(client)
        assert login_response.status_code == 200
        alice = next(iter(state.users.values()))
        device_id = UUID(login_response.json()["device_id"])
        bob = User.create(username="bob", display_name="Bob", now=NOW)
        conversation = Conversation.create_direct(
            created_by=alice.id,
            other_user_id=bob.id,
            now=NOW,
        )
        message = Message.create(
            conversation_id=conversation.id,
            client_message_id=uuid4(),
            sender_user_id=alice.id,
            sender_device_id=device_id,
            protocol_version=1,
            sequence=1,
            ciphertext=b"opaque",
            now=NOW,
            retention=timedelta(days=30),
        )
        state.users[bob.id] = bob
        state.conversations[conversation.id] = conversation
        state.messages[message.id] = message

        listed = await client.get("/api/v1/conversation-read-states")
        assert listed.status_code == 200
        assert listed.json() == [
            {
                "conversation_id": str(conversation.id),
                "last_read_sequence": 0,
                "latest_sequence": 1,
                "unread_count": 1,
            }
        ]
        no_csrf = await client.put(
            f"/api/v1/conversation-read-states/{conversation.id}",
            headers={"Origin": "https://test"},
            json={"sequence": 1},
        )
        assert no_csrf.status_code == 403
        marked = await client.put(
            f"/api/v1/conversation-read-states/{conversation.id}",
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
            },
            json={"sequence": 1},
        )
        assert marked.status_code == 200
        assert marked.json()["last_read_sequence"] == 1
        assert marked.json()["advanced"] is True


async def test_delivery_state_transport_is_device_scoped_and_requires_csrf() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        login_response = await login(client)
        assert login_response.status_code == 200
        alice = next(iter(state.users.values()))
        device_id = UUID(login_response.json()["device_id"])
        bob = User.create(username="bob", display_name="Bob", now=NOW)
        conversation = Conversation.create_direct(
            created_by=alice.id, other_user_id=bob.id, now=NOW
        )
        message = Message.create(
            conversation_id=conversation.id,
            client_message_id=uuid4(),
            sender_user_id=bob.id,
            sender_device_id=uuid4(),
            protocol_version=1,
            sequence=1,
            ciphertext=b"opaque",
            now=NOW,
            retention=timedelta(days=30),
        )
        state.users[bob.id] = bob
        state.conversations[conversation.id] = conversation
        state.messages[message.id] = message

        preflight = await client.options(
            f"/api/v1/conversation-delivery-states/{conversation.id}",
            headers={
                "Origin": "https://test",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "X-CSRF-Token, Content-Type",
            },
        )
        assert preflight.status_code == 200
        assert "PUT" in preflight.headers["access-control-allow-methods"]

        no_csrf = await client.put(
            f"/api/v1/conversation-delivery-states/{conversation.id}",
            headers={"Origin": "https://test"},
            json={"sequence": 1},
        )
        assert no_csrf.status_code == 403
        marked = await client.put(
            f"/api/v1/conversation-delivery-states/{conversation.id}",
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
            },
            json={"sequence": 1},
        )
        assert marked.status_code == 200
        assert marked.json()["advanced"] is True
        assert (device_id, conversation.id) in state.delivery_states
        listed = await client.get("/api/v1/conversation-delivery-states")
        assert listed.json() == [
            {
                "conversation_id": str(conversation.id),
                "user_id": str(alice.id),
                "delivered_sequence": 1,
            }
        ]


async def run_client_ip_flow(trusted: bool) -> str | None:
    cidrs = ["10.0.0.0/8"] if trusted else []
    application, state, _ = build_test_application(trusted_proxy_cidrs=cidrs)
    transport = ASGITransport(app=application, client=("10.0.0.5", 443))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            headers={
                "Origin": "https://test",
                "X-Forwarded-For": "198.51.100.9",
            },
            json={
                "username": "alice",
                "password": PASSWORD,
                "device_name": "Browser",
            },
        )
        assert response.status_code == 200
    return next(iter(state.devices.values())).login_ip


async def test_forwarded_ip_is_ignored_unless_socket_peer_is_trusted() -> None:
    assert await run_client_ip_flow(trusted=False) == "10.0.0.5"
    assert await run_client_ip_flow(trusted=True) == "198.51.100.9"


async def test_production_rejects_insecure_origin() -> None:
    try:
        AppSettings(
            app_env=AppEnvironment.PRODUCTION,
            database_url=DATABASE_URL,
            allowed_origins=["http://chat.example"],
        )
    except ValueError as error:
        assert "HTTPS" in str(error)
    else:
        raise AssertionError("insecure production origin was accepted")


def test_settings_require_tombstones_to_outlive_ciphertext_and_sync_events() -> None:
    try:
        AppSettings(
            database_url=DATABASE_URL,
            sync_event_retention_seconds=200,
            message_ciphertext_retention_seconds=100,
            message_tombstone_retention_seconds=200,
        )
    except ValueError as error:
        assert "tombstone retention" in str(error)
    else:
        raise AssertionError("short tombstone retention was accepted")
