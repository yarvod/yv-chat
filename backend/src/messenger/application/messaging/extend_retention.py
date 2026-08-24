"""Monotonically reconcile stored active data with a longer retention policy."""

from dataclasses import dataclass

from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.ports.messages import MessagingUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ExtendExistingRetentionResult:
    extended_messages: int
    extended_attachments: int


class ExtendExistingRetention:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        retention_policy: MessageRetentionPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._retention_policy = retention_policy

    async def execute(self) -> ExtendExistingRetentionResult:
        async with self._unit_of_work() as unit_of_work:
            messages = await unit_of_work.messages.extend_active_retention(
                self._retention_policy.ciphertext_retention
            )
            attachments = (
                await unit_of_work.attachments.align_committed_expiry_with_active_messages()
            )
            if messages or attachments:
                await unit_of_work.commit()
        return ExtendExistingRetentionResult(
            extended_messages=messages,
            extended_attachments=attachments,
        )
