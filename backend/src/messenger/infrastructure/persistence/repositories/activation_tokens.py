"""SQLAlchemy activation-token repository adapter."""

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

    async def mark_used(self, token: ActivationToken) -> None:
        model = await self._session.get(ActivationTokenModel, token.id)
        if model is None:
            raise RuntimeError("locked activation token disappeared")
        model.used_at = token.used_at
        await self._session.flush()
