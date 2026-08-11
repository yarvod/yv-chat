"""SQLAlchemy password-reset token repository adapter."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import PasswordResetToken
from messenger.infrastructure.persistence.models import PasswordResetTokenModel
from messenger.infrastructure.persistence.repositories.mappers import map_password_reset_token


class SqlAlchemyPasswordResetTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, token: PasswordResetToken) -> None:
        self._session.add(
            PasswordResetTokenModel(
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

    async def get_by_hash_for_update(self, token_hash: str) -> PasswordResetToken | None:
        model = await self._session.scalar(
            select(PasswordResetTokenModel)
            .where(PasswordResetTokenModel.token_hash == token_hash)
            .with_for_update()
        )
        return map_password_reset_token(model) if model is not None else None

    async def list_unconsumed_for_user_for_update(
        self,
        user_id: UUID,
    ) -> list[PasswordResetToken]:
        models = (
            await self._session.scalars(
                select(PasswordResetTokenModel)
                .where(
                    PasswordResetTokenModel.user_id == user_id,
                    PasswordResetTokenModel.used_at.is_(None),
                    PasswordResetTokenModel.revoked_at.is_(None),
                )
                .order_by(PasswordResetTokenModel.id)
                .with_for_update()
            )
        ).all()
        return [map_password_reset_token(model) for model in models]

    async def update_lifecycle(self, token: PasswordResetToken) -> None:
        model = await self._session.get(PasswordResetTokenModel, token.id)
        if model is None:
            raise RuntimeError("locked password reset token disappeared")
        model.used_at = token.used_at
        model.revoked_at = token.revoked_at
        await self._session.flush()
