"""Typed application configuration."""

from base64 import urlsafe_b64decode
from datetime import timedelta
from enum import StrEnum
from ipaddress import ip_network
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from messenger.application.accounts.password_reset_policy import PasswordResetPolicy
from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.application.sync.policy import SyncPolicy


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
    password_reset_token_ttl_seconds: int = Field(default=3_600, gt=0, le=86_400)
    session_idle_timeout_seconds: int = Field(default=2_592_000, gt=0)
    session_absolute_lifetime_seconds: int = Field(default=7_776_000, gt=0)
    session_rotation_interval_seconds: int = Field(default=86_400, gt=0)
    session_previous_token_grace_seconds: int = Field(default=60, gt=0)
    session_touch_interval_seconds: int = Field(default=300, gt=0)
    security_event_retention_seconds: int = Field(default=7_776_000, gt=0, le=31_536_000)
    sync_event_retention_seconds: int = Field(default=2_592_000, gt=0, le=31_536_000)
    message_ciphertext_retention_seconds: int = Field(default=2_592_000, gt=0, le=31_536_000)
    message_tombstone_retention_seconds: int = Field(default=7_776_000, gt=0, le=63_072_000)
    message_cleanup_batch_size: int = Field(default=200, ge=1, le=1_000)
    message_cleanup_interval_seconds: int = Field(default=300, ge=10, le=86_400)
    media_root: Path = Path("/data/media")
    media_image_max_bytes: int = Field(default=12 * 1024 * 1024, gt=0, le=209_715_200)
    media_video_max_bytes: int = Field(default=100 * 1024 * 1024, gt=0, le=209_715_200)
    media_file_max_bytes: int = Field(default=25 * 1024 * 1024, gt=0, le=209_715_200)
    media_user_quota_bytes: int = Field(
        default=5 * 1024 * 1024 * 1024,
        gt=0,
        le=10_737_418_240,
    )
    media_pending_retention_seconds: int = Field(default=86_400, ge=600, le=604_800)
    media_cleanup_batch_size: int = Field(default=100, ge=1, le=1_000)
    realtime_queue_size: int = Field(default=64, ge=1, le=1_024)
    realtime_heartbeat_seconds: int = Field(default=25, ge=5, le=120)
    realtime_revalidation_seconds: int = Field(default=30, ge=5, le=300)
    vapid_public_key: str | None = None
    vapid_private_key: SecretStr | None = None
    vapid_contact: str | None = None
    push_ttl_seconds: int = Field(default=300, ge=0, le=86_400)
    push_timeout_seconds: float = Field(default=5.0, gt=0, le=30)

    @field_validator("vapid_public_key", "vapid_private_key", "vapid_contact", mode="before")
    @classmethod
    def normalize_optional_vapid_value(cls, value: object) -> object:
        return None if value == "" else value

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
        if self.message_tombstone_retention_seconds <= max(
            self.message_ciphertext_retention_seconds,
            self.sync_event_retention_seconds,
        ):
            raise ValueError(
                "message tombstone retention must exceed ciphertext and sync retention"
            )
        if self.media_user_quota_bytes < max(
            self.media_image_max_bytes,
            self.media_video_max_bytes,
            self.media_file_max_bytes,
        ):
            raise ValueError("media user quota must fit one maximum attachment")
        vapid_values = (self.vapid_public_key, self.vapid_private_key, self.vapid_contact)
        if any(value is not None for value in vapid_values) and not all(
            value is not None for value in vapid_values
        ):
            raise ValueError(
                "VAPID public key, private key and contact must be configured together"
            )
        if self.vapid_public_key is not None:
            private_setting = self.vapid_private_key
            if private_setting is None:
                raise ValueError("VAPID private key is required")
            try:
                public_key = urlsafe_b64decode(
                    self.vapid_public_key + "=" * (-len(self.vapid_public_key) % 4)
                )
                private_value = private_setting.get_secret_value()
                private_key = urlsafe_b64decode(private_value + "=" * (-len(private_value) % 4))
            except ValueError as error:
                raise ValueError("VAPID keys must use base64url encoding") from error
            if (
                len(public_key) != 65
                or public_key[0] != 4
                or not (len(private_key) == 32 or 64 <= len(private_key) <= 256)
            ):
                raise ValueError("VAPID keys have invalid P-256 lengths")
            contact = self.vapid_contact or ""
            if not (contact.startswith("mailto:") or contact.startswith("https://")):
                raise ValueError("VAPID contact must use mailto: or https://")
        return self

    @property
    def push_enabled(self) -> bool:
        return self.vapid_public_key is not None

    @property
    def vapid_private_key_value(self) -> str:
        if self.vapid_private_key is None:
            raise RuntimeError("Web Push is disabled")
        return self.vapid_private_key.get_secret_value()

    @property
    def vapid_contact_value(self) -> str:
        if self.vapid_contact is None:
            raise RuntimeError("Web Push is disabled")
        return self.vapid_contact

    @property
    def expose_api_schema(self) -> bool:
        """Keep interactive API documentation out of production."""
        return self.app_env is not AppEnvironment.PRODUCTION

    @property
    def activation_token_ttl(self) -> timedelta:
        """Return the validated activation lifetime."""
        return timedelta(seconds=self.activation_token_ttl_seconds)

    @property
    def password_reset_policy(self) -> PasswordResetPolicy:
        """Build the bounded password-reset credential policy."""
        return PasswordResetPolicy(ttl=timedelta(seconds=self.password_reset_token_ttl_seconds))

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

    @property
    def sync_policy(self) -> SyncPolicy:
        return SyncPolicy(retention=timedelta(seconds=self.sync_event_retention_seconds))

    @property
    def message_retention_policy(self) -> MessageRetentionPolicy:
        return MessageRetentionPolicy(
            ciphertext_retention=timedelta(seconds=self.message_ciphertext_retention_seconds),
            tombstone_retention=timedelta(seconds=self.message_tombstone_retention_seconds),
            cleanup_batch_size=self.message_cleanup_batch_size,
        )

    @property
    def attachment_policy(self) -> AttachmentPolicy:
        return AttachmentPolicy(
            image_max_bytes=self.media_image_max_bytes,
            video_max_bytes=self.media_video_max_bytes,
            file_max_bytes=self.media_file_max_bytes,
            user_quota_bytes=self.media_user_quota_bytes,
            pending_retention=timedelta(seconds=self.media_pending_retention_seconds),
            cleanup_batch_size=self.media_cleanup_batch_size,
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
