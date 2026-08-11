"""Public device cryptography use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.device_crypto.get_current import GetCurrentDeviceCryptoIdentity
from messenger.application.device_crypto.register import RegisterDeviceCryptoIdentity


class DeviceCryptoUseCaseProvider(Provider):
    get_current_device_crypto_identity = provide(
        GetCurrentDeviceCryptoIdentity,
        scope=Scope.REQUEST,
    )
    register_device_crypto_identity = provide(
        RegisterDeviceCryptoIdentity,
        scope=Scope.REQUEST,
    )
