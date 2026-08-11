"""Bounded transport envelope policy; not a cryptographic protocol definition."""

from dataclasses import dataclass, field

from messenger.application.errors import InvalidMessageEnvelopeError


@dataclass(frozen=True, slots=True)
class MessageEnvelopePolicy:
    max_ciphertext_bytes: int = 65_536
    supported_protocol_versions: frozenset[int] = field(default_factory=lambda: frozenset({1}))

    def __post_init__(self) -> None:
        if self.max_ciphertext_bytes <= 0 or self.max_ciphertext_bytes > 1_048_576:
            raise ValueError("max_ciphertext_bytes must be between 1 and 1048576")
        if not self.supported_protocol_versions or any(
            version <= 0 or version > 32_767 for version in self.supported_protocol_versions
        ):
            raise ValueError("supported protocol versions must be positive small integers")

    def validate(self, protocol_version: int, ciphertext: bytes) -> None:
        if protocol_version not in self.supported_protocol_versions:
            raise InvalidMessageEnvelopeError("unsupported protocol version")
        if not ciphertext or len(ciphertext) > self.max_ciphertext_bytes:
            raise InvalidMessageEnvelopeError("ciphertext size is invalid")
