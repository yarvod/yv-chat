"""Typed application configuration."""

from enum import StrEnum

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def missing_database_url() -> str:
    """Fail fast when persistence configuration is absent."""
    raise ValueError("DATABASE_URL is required")


class AppEnvironment(StrEnum):
    """Supported runtime environments."""

    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class AppSettings(BaseSettings):
    """Validate environment variables at the bootstrap boundary."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: AppEnvironment = AppEnvironment.DEVELOPMENT
    database_url: str = Field(default_factory=missing_database_url)

    @property
    def expose_api_schema(self) -> bool:
        """Keep interactive API documentation out of production."""
        return self.app_env is not AppEnvironment.PRODUCTION
