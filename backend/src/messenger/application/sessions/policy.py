"""Validated authentication-session timing policy."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True, slots=True)
class SessionPolicy:
    """Durations controlling a revocable opaque session."""

    idle_timeout: timedelta
    absolute_lifetime: timedelta
    rotation_interval: timedelta
    previous_token_grace: timedelta
    touch_interval: timedelta

    def __post_init__(self) -> None:
        durations = {
            "idle_timeout": self.idle_timeout,
            "absolute_lifetime": self.absolute_lifetime,
            "rotation_interval": self.rotation_interval,
            "previous_token_grace": self.previous_token_grace,
            "touch_interval": self.touch_interval,
        }
        for name, duration in durations.items():
            if duration <= timedelta(0):
                raise ValueError(f"{name} must be positive")
        if self.idle_timeout > self.absolute_lifetime:
            raise ValueError("idle_timeout must not exceed absolute_lifetime")
        if self.rotation_interval >= self.absolute_lifetime:
            raise ValueError("rotation_interval must be shorter than absolute_lifetime")
        if self.previous_token_grace >= self.rotation_interval:
            raise ValueError("previous_token_grace must be shorter than rotation_interval")
        if self.touch_interval >= self.idle_timeout:
            raise ValueError("touch_interval must be shorter than idle_timeout")
