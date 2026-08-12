"""Create or retrieve the current atomic MLS bootstrap snapshot."""

from dataclasses import dataclass
from uuid import UUID, uuid5

from messenger.application.conversation_crypto.dto import ConversationCryptoResult
from messenger.application.conversation_crypto.materialize import materialize_generation
from messenger.application.errors import (
    ConversationCryptoConflictError,
    ConversationNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import (
    ConversationCryptoBlockReason,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoStatus,
)


@dataclass(frozen=True, slots=True)
class BeginConversationCryptoCommand:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID
    bootstrap_request_id: UUID


class BeginConversationCrypto:
    def __init__(
        self,
        *,
        unit_of_work: ConversationCryptoUnitOfWorkFactory,
        clock: Clock,
        sync_policy: SyncPolicy,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._sync_policy = sync_policy
        self._realtime_notifier = realtime_notifier

    async def execute(self, command: BeginConversationCryptoCommand) -> ConversationCryptoResult:
        async with self._unit_of_work() as uow:
            # Serialize every roster mutation on the conversation before locking a
            # device row. Required-device FK checks touch several device rows; the
            # opposite order lets concurrent leaves deadlock (A owns device A and
            # conversation, B owns device B and waits for conversation, while A's
            # FK insert waits for device B).
            conversation = await uow.conversations.get_by_id(
                command.conversation_id,
                for_update=True,
            )
            if conversation is None or conversation.active_member(command.user_id) is None:
                raise ConversationNotFoundError("conversation not found")
            device = await uow.devices.get_owned_by_id(
                user_id=command.user_id,
                device_id=command.device_id,
                for_update=True,
            )
            if device is None or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")

            retry = await uow.generations.get_by_bootstrap_request(
                coordinator_device_id=command.device_id,
                bootstrap_request_id=command.bootstrap_request_id,
                for_update=True,
            )
            if retry is not None and retry.conversation_id != command.conversation_id:
                raise ConversationCryptoConflictError(
                    "bootstrap request is bound to another conversation"
                )
            if retry is not None:
                return await materialize_generation(uow, retry)

            current = await uow.generations.get_current(
                command.conversation_id,
                for_update=True,
            )

            active_user_ids = {
                member.user_id for member in conversation.members if member.is_active
            }
            active_devices = sorted(
                await uow.devices.list_active_for_users(active_user_ids),
                key=lambda item: item.id.int,
            )
            identity_ids = {
                identity.device_id
                for identity in await uow.identities.get_by_device_ids(
                    {item.id for item in active_devices}
                )
            }
            current_device_has_identity = command.device_id in identity_ids
            capable_user_ids = {item.user_id for item in active_devices if item.id in identity_ids}
            member_without_capable_device = bool(active_user_ids - capable_user_ids)
            required_devices = (
                [item for item in active_devices if item.id in identity_ids]
                if current_device_has_identity
                else active_devices
            )
            active_device_ids = {item.id for item in required_devices}
            current_required = (
                await uow.required_devices.list_by_generation(current.id)
                if current is not None
                else []
            )
            current_roster_matches = (
                not member_without_capable_device
                and {item.device_id for item in current_required} == active_device_ids
            )
            if (
                current is not None
                and current.status is not ConversationCryptoStatus.BLOCKED
                and current_roster_matches
            ):
                return await materialize_generation(uow, current)

            previous_ready = (
                current
                if current is not None and current.status is ConversationCryptoStatus.READY
                else await uow.generations.get_latest_ready(command.conversation_id)
            )
            previous_device_ids = (
                {
                    item.device_id
                    for item in await uow.required_devices.list_by_generation(previous_ready.id)
                }
                if previous_ready is not None
                else set()
            )
            existing_leaves = [item for item in active_devices if item.id in previous_device_ids]
            requesting_leaf = next(
                (item for item in existing_leaves if item.id == command.device_id),
                None,
            )
            if (
                current is not None
                and current.status is ConversationCryptoStatus.BLOCKED
                and current.block_reason is ConversationCryptoBlockReason.DEVICE_ROSTER_CHANGED
                and current_roster_matches
                and requesting_leaf is None
            ):
                # Every newly enrolled device observes the same immutable blocked
                # roster snapshot. Only a leaf from the latest READY generation may
                # supersede it and author the add-leaf Commit. Without this
                # cross-device idempotency two replacement devices can alternate
                # BLOCKED generations through their conversation_updated wake-ups.
                return await materialize_generation(uow, current)
            requires_existing_leaf = (
                previous_ready is not None and bool(existing_leaves) and requesting_leaf is None
            )
            coordinator = requesting_leaf or device

            now = self._clock.now()
            if current is not None:
                await uow.generations.update(current.supersede(now))
            generation = ConversationCryptoGeneration.create(
                conversation_id=command.conversation_id,
                generation_number=(
                    await uow.generations.latest_generation_number(command.conversation_id)
                )
                + 1,
                coordinator_user_id=coordinator.user_id,
                coordinator_device_id=coordinator.id,
                bootstrap_request_id=command.bootstrap_request_id,
                now=now,
            )
            required = tuple(
                ConversationCryptoRequiredDevice(
                    generation_id=generation.id,
                    user_id=item.user_id,
                    device_id=item.id,
                    is_coordinator=item.id == coordinator.id,
                    key_package_id=None,
                    snapshot_at=now,
                )
                for item in required_devices
            )
            if not any(item.is_coordinator for item in required):
                raise OwnedDeviceNotFoundError("current device is unavailable")
            if not current_device_has_identity or member_without_capable_device:
                generation = generation.block(ConversationCryptoBlockReason.MISSING_IDENTITY, now)
            elif requires_existing_leaf:
                # A newly enrolled device has no state for the previous READY
                # generation and therefore cannot author its own add-leaf Commit.
                # Keep packages untouched and wake every participant: the first
                # previous leaf that reconciles will create the next pending
                # generation as its actual coordinator.
                generation = generation.block(
                    ConversationCryptoBlockReason.DEVICE_ROSTER_CHANGED,
                    now,
                )
            else:
                # The coordinator already owns the local MLS state that will create
                # this generation. It never consumes a Welcome/KeyPackage for
                # itself, including full-roster recovery where every leaf from the
                # previous READY generation has been revoked.
                added_device_ids = (
                    active_device_ids - previous_device_ids - {coordinator.id}
                    if previous_ready is not None
                    else active_device_ids - {coordinator.id}
                )
                targets = tuple(item for item in required if item.device_id in added_device_ids)
                availability = {
                    item.device_id: await uow.key_packages.count_available(item.device_id)
                    for item in targets
                }
                if any(count <= 0 for count in availability.values()):
                    generation = generation.block(
                        ConversationCryptoBlockReason.MISSING_KEY_PACKAGE,
                        now,
                    )
                else:
                    claimed_required: list[ConversationCryptoRequiredDevice] = []
                    for item in required:
                        if item.device_id not in added_device_ids:
                            claimed_required.append(item)
                            continue
                        key_package = await uow.key_packages.get_next_available_for_update(
                            item.device_id
                        )
                        if key_package is None:
                            raise ConversationCryptoConflictError(
                                "KeyPackage availability changed during bootstrap"
                            )
                        claimed = key_package.claim(
                            claimed_by_user_id=coordinator.user_id,
                            claimed_by_device_id=coordinator.id,
                            conversation_id=command.conversation_id,
                            request_id=uuid5(generation.id, str(item.device_id)),
                            now=now,
                        )
                        await uow.key_packages.update(claimed)
                        claimed_required.append(item.bind_key_package(claimed.id))
                    required = tuple(claimed_required)

            await uow.generations.add(generation)
            await uow.required_devices.add_many(required)
            notification_user_ids = (
                {coordinator.user_id}
                if generation.status is ConversationCryptoStatus.PENDING
                else (
                    active_user_ids
                    if generation.block_reason
                    is ConversationCryptoBlockReason.DEVICE_ROSTER_CHANGED
                    else set()
                )
            )
            sync_events = (
                events_for_users(
                    notification_user_ids,
                    event_type=SyncEventType.CONVERSATION_UPDATED,
                    conversation_id=command.conversation_id,
                    message_id=None,
                    now=now,
                    policy=self._sync_policy,
                )
                if notification_user_ids
                else []
            )
            await uow.sync_events.append(sync_events)
            await uow.commit()
            result = await materialize_generation(uow, generation)
        await publish_best_effort(
            self._realtime_notifier,
            notifications_from_sync(sync_events),
        )
        return result
