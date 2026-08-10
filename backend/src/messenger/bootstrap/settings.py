"""Typed application configuration."""

from datetime import timedelta
from enum import StrEnum

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def missing_database_url() -> str:
    """Fail fast when persistence configuration is absent."""
    raise ValueError("DATABASE_URL is required")


def missing_bootstrap_text() -> str:
    """Fail fast when required bootstrap identity configuration is absent."""
    raise ValueError("bootstrap admin identity settings are required")


def missing_bootstrap_password() -> SecretStr:
    """Fail fast without exposing a missing or supplied password."""
    raise ValueError("bootstrap admin password is required")


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
    activation_token_ttl_seconds: int = Field(default=86_400, gt=0, le=604_800)

    @property
    def expose_api_schema(self) -> bool:
        """Keep interactive API documentation out of production."""
        return self.app_env is not AppEnvironment.PRODUCTION

    @property
    def activation_token_ttl(self) -> timedelta:
        """Return the validated activation lifetime."""
        return timedelta(seconds=self.activation_token_ttl_seconds)


class AdminBootstrapSettings(BaseSettings):
    """Explicit one-time credentials for the initial admin CLI."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="BOOTSTRAP_",
        extra="ignore",
    )

    admin_username: str = Field(default_factory=missing_bootstrap_text)
    admin_display_name: str = Field(default_factory=missing_bootstrap_text)
    admin_password: SecretStr = Field(default_factory=missing_bootstrap_password)
