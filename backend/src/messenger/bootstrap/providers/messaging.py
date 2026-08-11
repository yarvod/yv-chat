"""Opaque messaging use-case and policy bindings."""

from dishka import Provider, Scope, provide

from messenger.application.messaging.list_messages import ListMessages
from messenger.application.messaging.list_read_states import ListConversationReadStates
from messenger.application.messaging.mark_read import MarkConversationRead
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.send_message import SendOpaqueMessage
from messenger.application.realtime.presence import ListPresenceSnapshot, PublishPresence
from messenger.application.realtime.typing import PublishTyping, TypingPolicy
from messenger.application.sync.list_events import ListSyncEvents
from messenger.application.sync.policy import SyncPolicy


class MessagingUseCaseProvider(Provider):
    @provide(scope=Scope.APP)
    def message_policy(self) -> MessageEnvelopePolicy:
        return MessageEnvelopePolicy()

    @provide(scope=Scope.APP)
    def sync_policy(self) -> SyncPolicy:
        return SyncPolicy()

    @provide(scope=Scope.APP)
    def typing_policy(self) -> TypingPolicy:
        return TypingPolicy()

    send_opaque_message = provide(SendOpaqueMessage, scope=Scope.REQUEST)
    list_messages = provide(ListMessages, scope=Scope.REQUEST)
    list_sync_events = provide(ListSyncEvents, scope=Scope.REQUEST)
    list_conversation_read_states = provide(ListConversationReadStates, scope=Scope.REQUEST)
    mark_conversation_read = provide(MarkConversationRead, scope=Scope.REQUEST)
    publish_typing = provide(PublishTyping, scope=Scope.REQUEST)
    list_presence_snapshot = provide(ListPresenceSnapshot, scope=Scope.REQUEST)
    publish_presence = provide(PublishPresence, scope=Scope.REQUEST)
