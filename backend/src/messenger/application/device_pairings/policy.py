"""Timing policy for short-lived device pairing."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True, slots=True)
class DevicePairingPolicy:
    ttl: timedelta
    retention: timedelta

    def __post_init__(self) -> None:
        if not timedelta(minutes=1) <= self.ttl <= timedelta(minutes=30):
            raise ValueError("device pairing TTL must be between one and thirty minutes")
        if not self.ttl < self.retention <= timedelta(days=7):
            raise ValueError("device pairing retention must exceed TTL and be at most seven days")
