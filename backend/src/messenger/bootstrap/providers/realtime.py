"""Single-process realtime hub bindings."""

from dishka import Provider, Scope, provide

from messenger.application.ports.realtime import RealtimeHub, RealtimeNotifier
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
