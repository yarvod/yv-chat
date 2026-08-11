"""Async database construction tests."""

from messenger.infrastructure.persistence.database import (
    create_engine,
    create_session_factory,
)

TEST_DATABASE_URL = "postgresql+asyncpg://test:test@127.0.0.1:5432/test"


async def test_create_async_engine_and_session_factory_without_connecting() -> None:
    engine = create_engine(TEST_DATABASE_URL)
    session_factory = create_session_factory(engine)

    assert engine.url.drivername == "postgresql+asyncpg"
    assert session_factory.kw["expire_on_commit"] is False

    await engine.dispose()
