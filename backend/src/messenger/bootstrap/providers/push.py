"""Web Push adapter and use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.ports.push import (
    PushDeliveryConfiguration,
    PushNotifier,
    PushUnitOfWorkFactory,
)
from messenger.application.push.manage_subscription import (
    GetCurrentPushSubscription,
    RegisterPushSubscription,
    RemovePushSubscription,
)
from messenger.bootstrap.settings import AppSettings
from messenger.infrastructure.push import WebPushNotifier


class PushProvider(Provider):
    @provide(scope=Scope.APP)
    def push_delivery_configuration(self, settings: AppSettings) -> PushDeliveryConfiguration:
        return PushDeliveryConfiguration(
            enabled=settings.push_enabled,
            private_key=(settings.vapid_private_key_value if settings.push_enabled else None),
            contact=(settings.vapid_contact_value if settings.push_enabled else None),
            ttl_seconds=settings.push_ttl_seconds,
            timeout_seconds=settings.push_timeout_seconds,
        )

    @provide(scope=Scope.APP)
    def web_push_notifier(
        self,
        unit_of_work: PushUnitOfWorkFactory,
        configuration: PushDeliveryConfiguration,
    ) -> WebPushNotifier:
        return WebPushNotifier(unit_of_work=unit_of_work, configuration=configuration)

    @provide(scope=Scope.APP)
    def push_notifier(self, adapter: WebPushNotifier) -> PushNotifier:
        return adapter

    get_current_subscription = provide(GetCurrentPushSubscription, scope=Scope.REQUEST)
    register_subscription = provide(RegisterPushSubscription, scope=Scope.REQUEST)
    remove_subscription = provide(RemovePushSubscription, scope=Scope.REQUEST)
