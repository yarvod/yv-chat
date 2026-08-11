"""SQLAlchemy adapters for opaque MLS generation coordination."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import (
    ConversationCryptoBlockReason,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoStatus,
    ConversationCryptoWelcome,
)
from messenger.infrastructure.persistence.models import (
    ConversationCryptoGenerationModel,
    ConversationCryptoRequiredDeviceModel,
    ConversationCryptoWelcomeModel,
)


def _map_generation(model: ConversationCryptoGenerationModel) -> ConversationCryptoGeneration:
    return ConversationCryptoGeneration(
        id=model.id,
        conversation_id=model.conversation_id,
        generation_number=model.generation_number,
        is_current=model.is_current,
        coordinator_user_id=model.coordinator_user_id,
        coordinator_device_id=model.coordinator_device_id,
        bootstrap_request_id=model.bootstrap_request_id,
        protocol_version=model.protocol_version,
        status=ConversationCryptoStatus(model.status),
        epoch=model.epoch,
        commit_message=model.commit_message,
        ratchet_tree=model.ratchet_tree,
        block_reason=(
            ConversationCryptoBlockReason(model.block_reason)
            if model.block_reason is not None
            else None
        ),
        created_at=model.created_at,
        updated_at=model.updated_at,
        ready_at=model.ready_at,
    )


def _map_required_device(
    model: ConversationCryptoRequiredDeviceModel,
) -> ConversationCryptoRequiredDevice:
    return ConversationCryptoRequiredDevice(
        generation_id=model.generation_id,
        user_id=model.user_id,
        device_id=model.device_id,
        is_coordinator=model.is_coordinator,
        key_package_id=model.key_package_id,
        snapshot_at=model.snapshot_at,
    )


def _map_welcome(model: ConversationCryptoWelcomeModel) -> ConversationCryptoWelcome:
    return ConversationCryptoWelcome(
        generation_id=model.generation_id,
        target_device_id=model.target_device_id,
        welcome_message=model.welcome_message,
        created_at=model.created_at,
        expires_at=model.expires_at,
        acknowledged_at=model.acknowledged_at,
    )


class SqlAlchemyConversationCryptoGenerationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_current(
        self,
        conversation_id: UUID,
        *,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None:
        statement = select(ConversationCryptoGenerationModel).where(
            ConversationCryptoGenerationModel.conversation_id == conversation_id,
            ConversationCryptoGenerationModel.is_current.is_(True),
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return _map_generation(model) if model is not None else None

    async def get_by_id(
        self,
        generation_id: UUID,
        *,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None:
        statement = select(ConversationCryptoGenerationModel).where(
            ConversationCryptoGenerationModel.id == generation_id
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return _map_generation(model) if model is not None else None

    async def get_latest_ready(
        self,
        conversation_id: UUID,
    ) -> ConversationCryptoGeneration | None:
        model = await self._session.scalar(
            select(ConversationCryptoGenerationModel)
            .where(
                ConversationCryptoGenerationModel.conversation_id == conversation_id,
                ConversationCryptoGenerationModel.status == ConversationCryptoStatus.READY.value,
            )
            .order_by(ConversationCryptoGenerationModel.generation_number.desc())
            .limit(1)
        )
        return _map_generation(model) if model is not None else None

    async def list_ready_for_device_after(
        self,
        *,
        conversation_id: UUID,
        device_id: UUID,
        after_generation_number: int,
        limit: int,
    ) -> list[ConversationCryptoGeneration]:
        models = await self._session.scalars(
            select(ConversationCryptoGenerationModel)
            .join(
                ConversationCryptoRequiredDeviceModel,
                ConversationCryptoRequiredDeviceModel.generation_id
                == ConversationCryptoGenerationModel.id,
            )
            .where(
                ConversationCryptoGenerationModel.conversation_id == conversation_id,
                ConversationCryptoGenerationModel.status == ConversationCryptoStatus.READY.value,
                ConversationCryptoGenerationModel.generation_number > after_generation_number,
                ConversationCryptoRequiredDeviceModel.device_id == device_id,
            )
            .order_by(ConversationCryptoGenerationModel.generation_number)
            .limit(limit)
        )
        return [_map_generation(model) for model in models]

    async def get_by_bootstrap_request(
        self,
        *,
        coordinator_device_id: UUID,
        bootstrap_request_id: UUID,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None:
        statement = select(ConversationCryptoGenerationModel).where(
            ConversationCryptoGenerationModel.coordinator_device_id == coordinator_device_id,
            ConversationCryptoGenerationModel.bootstrap_request_id == bootstrap_request_id,
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return _map_generation(model) if model is not None else None

    async def latest_generation_number(self, conversation_id: UUID) -> int:
        value = await self._session.scalar(
            select(func.max(ConversationCryptoGenerationModel.generation_number)).where(
                ConversationCryptoGenerationModel.conversation_id == conversation_id
            )
        )
        return int(value or 0)

    async def add(self, generation: ConversationCryptoGeneration) -> None:
        self._session.add(
            ConversationCryptoGenerationModel(
                id=generation.id,
                conversation_id=generation.conversation_id,
                generation_number=generation.generation_number,
                is_current=generation.is_current,
                coordinator_user_id=generation.coordinator_user_id,
                coordinator_device_id=generation.coordinator_device_id,
                bootstrap_request_id=generation.bootstrap_request_id,
                protocol_version=generation.protocol_version,
                status=generation.status.value,
                epoch=generation.epoch,
                commit_message=generation.commit_message,
                ratchet_tree=generation.ratchet_tree,
                block_reason=(generation.block_reason.value if generation.block_reason else None),
                created_at=generation.created_at,
                updated_at=generation.updated_at,
                ready_at=generation.ready_at,
            )
        )
        await self._session.flush()

    async def update(self, generation: ConversationCryptoGeneration) -> None:
        model = await self._session.get(ConversationCryptoGenerationModel, generation.id)
        if model is None:
            raise RuntimeError("conversation crypto generation disappeared during transaction")
        model.is_current = generation.is_current
        model.status = generation.status.value
        model.epoch = generation.epoch
        model.commit_message = generation.commit_message
        model.ratchet_tree = generation.ratchet_tree
        model.block_reason = generation.block_reason.value if generation.block_reason else None
        model.updated_at = generation.updated_at
        model.ready_at = generation.ready_at
        await self._session.flush()


class SqlAlchemyConversationCryptoRequiredDeviceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_by_generation(
        self,
        generation_id: UUID,
    ) -> list[ConversationCryptoRequiredDevice]:
        models = await self._session.scalars(
            select(ConversationCryptoRequiredDeviceModel)
            .where(ConversationCryptoRequiredDeviceModel.generation_id == generation_id)
            .order_by(
                ConversationCryptoRequiredDeviceModel.user_id,
                ConversationCryptoRequiredDeviceModel.device_id,
            )
        )
        return [_map_required_device(model) for model in models]

    async def add_many(
        self,
        required_devices: tuple[ConversationCryptoRequiredDevice, ...],
    ) -> None:
        self._session.add_all(
            [
                ConversationCryptoRequiredDeviceModel(
                    generation_id=item.generation_id,
                    user_id=item.user_id,
                    device_id=item.device_id,
                    is_coordinator=item.is_coordinator,
                    key_package_id=item.key_package_id,
                    snapshot_at=item.snapshot_at,
                )
                for item in required_devices
            ]
        )
        await self._session.flush()


class SqlAlchemyConversationCryptoWelcomeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_device(
        self,
        *,
        generation_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> ConversationCryptoWelcome | None:
        statement = select(ConversationCryptoWelcomeModel).where(
            ConversationCryptoWelcomeModel.generation_id == generation_id,
            ConversationCryptoWelcomeModel.target_device_id == device_id,
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return _map_welcome(model) if model is not None else None

    async def add_many(self, welcomes: tuple[ConversationCryptoWelcome, ...]) -> None:
        self._session.add_all(
            [
                ConversationCryptoWelcomeModel(
                    generation_id=item.generation_id,
                    target_device_id=item.target_device_id,
                    welcome_message=item.welcome_message,
                    created_at=item.created_at,
                    expires_at=item.expires_at,
                    acknowledged_at=item.acknowledged_at,
                )
                for item in welcomes
            ]
        )
        await self._session.flush()

    async def update(self, welcome: ConversationCryptoWelcome) -> None:
        model = await self._session.get(
            ConversationCryptoWelcomeModel,
            (welcome.generation_id, welcome.target_device_id),
        )
        if model is None:
            raise RuntimeError("conversation crypto Welcome disappeared during transaction")
        model.acknowledged_at = welcome.acknowledged_at
        await self._session.flush()
