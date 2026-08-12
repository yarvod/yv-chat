"""Shared MLS-capable active-device roster projection."""

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from messenger.domain.entities import Device, DeviceCryptoIdentity


@dataclass(frozen=True, slots=True)
class ActiveCryptoRoster:
    device_ids: frozenset[UUID]
    users_without_capable_device: frozenset[UUID]

    @property
    def is_complete(self) -> bool:
        return not self.users_without_capable_device


def active_crypto_roster(
    *,
    active_user_ids: set[UUID],
    active_devices: Iterable[Device],
    identities: Iterable[DeviceCryptoIdentity],
) -> ActiveCryptoRoster:
    identity_device_ids = {identity.device_id for identity in identities}
    capable_devices = tuple(device for device in active_devices if device.id in identity_device_ids)
    capable_user_ids = {device.user_id for device in capable_devices}
    return ActiveCryptoRoster(
        device_ids=frozenset(device.id for device in capable_devices),
        users_without_capable_device=frozenset(active_user_ids - capable_user_ids),
    )
