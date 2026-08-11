"""Public device cryptography use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.device_crypto import (
    ClaimDeviceKeyPackage,
    GetCurrentDeviceCryptoIdentity,
    ListDeviceKeyPackageInventory,
    RegisterDeviceCryptoIdentity,
    ReplenishDeviceKeyPackages,
)


class DeviceCryptoUseCaseProvider(Provider):
    claim_device_key_package = provide(ClaimDeviceKeyPackage, scope=Scope.REQUEST)
    get_current_device_crypto_identity = provide(
        GetCurrentDeviceCryptoIdentity,
        scope=Scope.REQUEST,
    )
    register_device_crypto_identity = provide(
        RegisterDeviceCryptoIdentity,
        scope=Scope.REQUEST,
    )
    list_device_key_package_inventory = provide(
        ListDeviceKeyPackageInventory,
        scope=Scope.REQUEST,
    )
    replenish_device_key_packages = provide(
        ReplenishDeviceKeyPackages,
        scope=Scope.REQUEST,
    )
