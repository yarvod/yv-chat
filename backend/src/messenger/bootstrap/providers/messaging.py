"""Opaque messaging use-case and policy bindings."""

from dishka import Provider, Scope, provide

from messenger.application.messaging.list_messages import ListMessages
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.send_message import SendOpaqueMessage
from messenger.application.sync.list_events import ListSyncEvents
from messenger.application.sync.policy import SyncPolicy


class MessagingUseCaseProvider(Provider):
    @provide(scope=Scope.APP)
    def message_policy(self) -> MessageEnvelopePolicy:
        return MessageEnvelopePolicy()

    @provide(scope=Scope.APP)
    def sync_policy(self) -> SyncPolicy:
        return SyncPolicy()

    send_opaque_message = provide(SendOpaqueMessage, scope=Scope.REQUEST)
    list_messages = provide(ListMessages, scope=Scope.REQUEST)
    list_sync_events = provide(ListSyncEvents, scope=Scope.REQUEST)
