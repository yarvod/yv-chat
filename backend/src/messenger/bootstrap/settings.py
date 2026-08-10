"""Typed application configuration."""

from datetime import timedelta
from enum import StrEnum
from ipaddress import ip_network
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from messenger.application.security_event_policy import SecurityEventPolicy
from messenger.application.session_policy import SessionPolicy


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
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:8080"])
    trusted_proxy_cidrs: list[str] = Field(default_factory=list)
    session_cookie_name: str = Field(default="__Host-yv_session", pattern=r"^__Host-")
    csrf_cookie_name: str = Field(default="__Host-yv_csrf", pattern=r"^__Host-")
    csrf_header_name: str = Field(default="X-CSRF-Token", min_length=1)
    activation_token_ttl_seconds: int = Field(default=86_400, gt=0, le=604_800)
    session_idle_timeout_seconds: int = Field(default=2_592_000, gt=0)
    session_absolute_lifetime_seconds: int = Field(default=7_776_000, gt=0)
    session_rotation_interval_seconds: int = Field(default=86_400, gt=0)
    session_previous_token_grace_seconds: int = Field(default=60, gt=0)
    session_touch_interval_seconds: int = Field(default=300, gt=0)
    security_event_retention_seconds: int = Field(default=7_776_000, gt=0, le=31_536_000)

    @field_validator("allowed_origins")
    @classmethod
    def validate_allowed_origins(cls, origins: list[str]) -> list[str]:
        if not origins:
            raise ValueError("at least one allowed origin is required")
        normalized: list[str] = []
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                raise ValueError("allowed origins must be exact HTTP(S) origins")
            normalized.append(f"{parsed.scheme}://{parsed.netloc}")
        if len(set(normalized)) != len(normalized) or "*" in normalized:
            raise ValueError("allowed origins must be unique and cannot contain wildcard")
        return normalized

    @field_validator("trusted_proxy_cidrs")
    @classmethod
    def validate_proxy_cidrs(cls, cidrs: list[str]) -> list[str]:
        return [str(ip_network(cidr, strict=False)) for cidr in cidrs]

    @model_validator(mode="after")
    def require_https_origins_in_production(self) -> "AppSettings":
        if self.app_env is AppEnvironment.PRODUCTION and any(
            not origin.startswith("https://") for origin in self.allowed_origins
        ):
            raise ValueError("production allowed origins must use HTTPS")
        return self

    @property
    def expose_api_schema(self) -> bool:
        """Keep interactive API documentation out of production."""
        return self.app_env is not AppEnvironment.PRODUCTION

    @property
    def activation_token_ttl(self) -> timedelta:
        """Return the validated activation lifetime."""
        return timedelta(seconds=self.activation_token_ttl_seconds)

    @property
    def session_policy(self) -> SessionPolicy:
        """Build one validated timing policy from environment values."""
        return SessionPolicy(
            idle_timeout=timedelta(seconds=self.session_idle_timeout_seconds),
            absolute_lifetime=timedelta(seconds=self.session_absolute_lifetime_seconds),
            rotation_interval=timedelta(seconds=self.session_rotation_interval_seconds),
            previous_token_grace=timedelta(seconds=self.session_previous_token_grace_seconds),
            touch_interval=timedelta(seconds=self.session_touch_interval_seconds),
        )

    @property
    def security_event_policy(self) -> SecurityEventPolicy:
        """Build the bounded account security-event policy."""
        return SecurityEventPolicy(
            retention=timedelta(seconds=self.security_event_retention_seconds)
        )


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
