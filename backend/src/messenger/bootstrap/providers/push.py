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
            apns_key_id=settings.apns_key_id,
            apns_team_id=settings.apns_team_id,
            apns_bundle_id=settings.apns_bundle_id,
            apns_private_key=(settings.apns_private_key_value if settings.apns_enabled else None),
            apns_use_sandbox=settings.apns_use_sandbox,
            fcm_project_id=settings.fcm_project_id,
            fcm_client_email=settings.fcm_client_email,
            fcm_private_key=(settings.fcm_private_key_value if settings.fcm_enabled else None),
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
