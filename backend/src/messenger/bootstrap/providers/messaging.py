"""Opaque messaging use-case and policy bindings."""

from dishka import Provider, Scope, provide

from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.send_message import SendOpaqueMessage


class MessagingUseCaseProvider(Provider):
    @provide(scope=Scope.APP)
    def message_policy(self) -> MessageEnvelopePolicy:
        return MessageEnvelopePolicy()

    send_opaque_message = provide(SendOpaqueMessage, scope=Scope.REQUEST)
