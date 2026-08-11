"""SQLAlchemy activation-token repository adapter."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import ActivationToken
from messenger.infrastructure.persistence.models import ActivationTokenModel
from messenger.infrastructure.persistence.repositories.mappers import map_activation_token


class SqlAlchemyActivationTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, token: ActivationToken) -> None:
        self._session.add(
            ActivationTokenModel(
                id=token.id,
                user_id=token.user_id,
                token_hash=token.token_hash,
                expires_at=token.expires_at,
                created_at=token.created_at,
                used_at=token.used_at,
                revoked_at=token.revoked_at,
            )
        )
        await self._session.flush()

    async def get_by_hash_for_update(self, token_hash: str) -> ActivationToken | None:
        model = await self._session.scalar(
            select(ActivationTokenModel)
            .where(ActivationTokenModel.token_hash == token_hash)
            .with_for_update()
        )
        return map_activation_token(model) if model is not None else None

    async def list_unconsumed_for_user_for_update(
        self,
        user_id: UUID,
    ) -> list[ActivationToken]:
        models = (
            await self._session.scalars(
                select(ActivationTokenModel)
                .where(
                    ActivationTokenModel.user_id == user_id,
                    ActivationTokenModel.used_at.is_(None),
                    ActivationTokenModel.revoked_at.is_(None),
                )
                .order_by(ActivationTokenModel.id)
                .with_for_update()
            )
        ).all()
        return [map_activation_token(model) for model in models]

    async def update_lifecycle(self, token: ActivationToken) -> None:
        model = await self._session.get(ActivationTokenModel, token.id)
        if model is None:
            raise RuntimeError("locked activation token disappeared")
        model.used_at = token.used_at
        model.revoked_at = token.revoked_at
        await self._session.flush()
