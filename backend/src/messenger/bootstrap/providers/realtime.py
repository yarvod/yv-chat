"""Single-process realtime hub bindings."""

from dishka import Provider, Scope, provide

from messenger.application.calls import VoiceCallCoordinator
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.push import PushNotifier
from messenger.application.ports.realtime import (
    CallSignalNotifier,
    RealtimeHub,
    RealtimeNotifier,
)
from messenger.bootstrap.settings import AppSettings
from messenger.infrastructure.realtime import InMemoryRealtimeHub


class RealtimeProvider(Provider):
    @provide(scope=Scope.APP)
    def in_memory_hub(self, settings: AppSettings) -> InMemoryRealtimeHub:
        return InMemoryRealtimeHub(queue_size=settings.realtime_queue_size)

    @provide(scope=Scope.APP)
    def hub(self, adapter: InMemoryRealtimeHub) -> RealtimeHub:
        return adapter

    @provide(scope=Scope.APP)
    def notifier(self, adapter: InMemoryRealtimeHub) -> RealtimeNotifier:
        return adapter

    @provide(scope=Scope.APP)
    def call_notifier(self, adapter: InMemoryRealtimeHub) -> CallSignalNotifier:
        return adapter

    @provide(scope=Scope.APP)
    def calls(
        self,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        realtime_notifier: CallSignalNotifier,
        push_notifier: PushNotifier,
    ) -> VoiceCallCoordinator:
        return VoiceCallCoordinator(
            unit_of_work=unit_of_work,
            clock=clock,
            realtime_notifier=realtime_notifier,
            push_notifier=push_notifier,
        )
