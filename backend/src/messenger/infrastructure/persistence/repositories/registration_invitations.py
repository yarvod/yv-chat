"""SQLAlchemy registration invitation repository."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import RegistrationInvitation
from messenger.infrastructure.persistence.models import RegistrationInvitationModel
from messenger.infrastructure.persistence.repositories.mappers import map_registration_invitation


class SqlAlchemyRegistrationInvitationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, invitation: RegistrationInvitation) -> None:
        self._session.add(
            RegistrationInvitationModel(
                id=invitation.id,
                token_hash=invitation.token_hash,
                label=invitation.label,
                created_by_user_id=invitation.created_by_user_id,
                registered_user_id=invitation.registered_user_id,
                created_at=invitation.created_at,
                expires_at=invitation.expires_at,
                used_at=invitation.used_at,
                revoked_at=invitation.revoked_at,
            )
        )
        await self._session.flush()

    async def get_by_hash_for_update(
        self,
        token_hash: str,
    ) -> RegistrationInvitation | None:
        model = await self._session.scalar(
            select(RegistrationInvitationModel)
            .where(RegistrationInvitationModel.token_hash == token_hash)
            .with_for_update()
        )
        return map_registration_invitation(model) if model is not None else None

    async def get_by_id_for_update(
        self,
        invitation_id: UUID,
    ) -> RegistrationInvitation | None:
        model = await self._session.scalar(
            select(RegistrationInvitationModel)
            .where(RegistrationInvitationModel.id == invitation_id)
            .with_for_update()
        )
        return map_registration_invitation(model) if model is not None else None

    async def list_recent(
        self,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[RegistrationInvitation], int]:
        count = await self._session.scalar(select(func.count(RegistrationInvitationModel.id)))
        total = int(count or 0)
        models = (
            await self._session.scalars(
                select(RegistrationInvitationModel)
                .order_by(
                    RegistrationInvitationModel.created_at.desc(),
                    RegistrationInvitationModel.id,
                )
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return [map_registration_invitation(model) for model in models], total

    async def update_lifecycle(self, invitation: RegistrationInvitation) -> None:
        model = await self._session.get(RegistrationInvitationModel, invitation.id)
        if model is None:
            raise RuntimeError("locked registration invitation disappeared")
        model.used_at = invitation.used_at
        model.revoked_at = invitation.revoked_at
        model.registered_user_id = invitation.registered_user_id
        await self._session.flush()
