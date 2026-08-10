"""Async SQLAlchemy engine and session construction."""

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def create_engine(database_url: str) -> AsyncEngine:
    """Create the shared process-level async database engine."""
    return create_async_engine(database_url, pool_pre_ping=True)


def create_session_factory(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    """Create sessions whose transaction boundary is owned by the caller."""
    return async_sessionmaker(engine, expire_on_commit=False)
