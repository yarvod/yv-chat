"""Bounded server-side ciphertext and tombstone retention policy."""

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True, slots=True)
class MessageRetentionPolicy:
    ciphertext_retention: timedelta
    tombstone_retention: timedelta
    cleanup_batch_size: int = 200

    def __post_init__(self) -> None:
        if self.ciphertext_retention <= timedelta(0):
            raise ValueError("ciphertext retention must be positive")
        if self.tombstone_retention <= self.ciphertext_retention:
            raise ValueError("tombstone retention must exceed ciphertext retention")
        if not 1 <= self.cleanup_batch_size <= 1_000:
            raise ValueError("cleanup batch size must be between 1 and 1000")
