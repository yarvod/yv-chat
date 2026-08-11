"""Opaque messaging use-case and policy bindings."""

from dishka import Provider, Scope, provide

from messenger.application.messaging.cleanup_messages import CleanupExpiredMessages
from messenger.application.messaging.delete_message import DeleteMessageForEveryone
from messenger.application.messaging.list_delivery_states import ListParticipantDeliveryStates
from messenger.application.messaging.list_messages import ListMessages
from messenger.application.messaging.list_read_states import ListConversationReadStates
from messenger.application.messaging.mark_delivered import MarkConversationDelivered
from messenger.application.messaging.mark_read import MarkConversationRead
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.messaging.send_message import SendOpaqueMessage
from messenger.application.realtime.presence import ListPresenceSnapshot, PublishPresence
from messenger.application.realtime.typing import PublishTyping, TypingPolicy
from messenger.application.sync.list_events import ListSyncEvents
from messenger.application.sync.policy import SyncPolicy
from messenger.bootstrap.settings import AppSettings


class MessagingUseCaseProvider(Provider):
    @provide(scope=Scope.APP)
    def message_policy(self) -> MessageEnvelopePolicy:
        return MessageEnvelopePolicy()

    @provide(scope=Scope.APP)
    def sync_policy(self, settings: AppSettings) -> SyncPolicy:
        return settings.sync_policy

    @provide(scope=Scope.APP)
    def message_retention_policy(self, settings: AppSettings) -> MessageRetentionPolicy:
        return settings.message_retention_policy

    @provide(scope=Scope.APP)
    def typing_policy(self) -> TypingPolicy:
        return TypingPolicy()

    send_opaque_message = provide(SendOpaqueMessage, scope=Scope.REQUEST)
    delete_message_for_everyone = provide(DeleteMessageForEveryone, scope=Scope.REQUEST)
    cleanup_expired_messages = provide(CleanupExpiredMessages, scope=Scope.REQUEST)
    list_messages = provide(ListMessages, scope=Scope.REQUEST)
    list_sync_events = provide(ListSyncEvents, scope=Scope.REQUEST)
    list_conversation_read_states = provide(ListConversationReadStates, scope=Scope.REQUEST)
    mark_conversation_read = provide(MarkConversationRead, scope=Scope.REQUEST)
    list_participant_delivery_states = provide(ListParticipantDeliveryStates, scope=Scope.REQUEST)
    mark_conversation_delivered = provide(MarkConversationDelivered, scope=Scope.REQUEST)
    publish_typing = provide(PublishTyping, scope=Scope.REQUEST)
    list_presence_snapshot = provide(ListPresenceSnapshot, scope=Scope.REQUEST)
    publish_presence = provide(PublishPresence, scope=Scope.REQUEST)
