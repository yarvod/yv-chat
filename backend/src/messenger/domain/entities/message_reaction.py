"""Bounded user reaction attached to an opaque message."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.domain.entities._validation import require_aware_datetime

ALLOWED_MESSAGE_REACTIONS = (
    "❤️",
    "👌",
    "🔥",
    "😁",
    "🤯",
    "💯",
    "👍",
    "😂",
    "😮",
    "😢",
    "👎",
    "🎉",
    "👏",
    "🤔",
    "🙏",
    "🥰",
    "😍",
    "🤩",
    "😎",
    "🤗",
    "🤭",
    "🤫",
    "🫡",
    "🤨",
    "😐",
    "😴",
    "🤢",
    "🤮",
    "🤡",
    "💩",
    "👻",
    "💀",
    "😈",
    "👀",
    "💪",
    "🤝",
    "✍️",
    "💋",
    "🌚",
    "⚡",
    "💔",
    "❤️‍🔥",
    "🕊️",
    "🐳",
    "🍌",
    "🏆",
    "🤷",
    "🫶",
)


@dataclass(frozen=True, slots=True)
class MessageReaction:
    message_id: UUID
    user_id: UUID
    reaction: str
    created_at: datetime

    def __post_init__(self) -> None:
        if self.reaction not in ALLOWED_MESSAGE_REACTIONS:
            raise ValueError("unsupported message reaction")
        require_aware_datetime(self.created_at, "created_at")
