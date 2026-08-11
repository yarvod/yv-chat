"""Application specifications for immutable device crypto registration."""

from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID

import pytest

from messenger.application.device_crypto.get_current import (
    GetCurrentDeviceCryptoIdentity,
    GetCurrentDeviceCryptoIdentityQuery,
)
from messenger.application.device_crypto.register import (
    RegisterDeviceCryptoIdentity,
    RegisterDeviceCryptoIdentityCommand,
)
from messenger.application.errors import (
    DeviceCryptoIdentityConflictError,
    DeviceCryptoIdentityNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.domain.entities import Device
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from tests.application.fakes import (
    FakeDeviceCryptoUnitOfWorkFactory,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("1b0a32e8-144f-4f60-bcb6-112f71bd5316")
DEVICE_ID = UUID("50d6b08a-84ae-4bd7-829a-f40f38e9a2c1")


def command(*, signature_key: bytes = bytes(range(32))) -> RegisterDeviceCryptoIdentityCommand:
    return RegisterDeviceCryptoIdentityCommand(
        user_id=USER_ID,
        device_id=DEVICE_ID,
        credential_identity=expected_credential_identity(USER_ID, DEVICE_ID),
        signature_public_key=signature_key,
        key_package=b"opaque-public-key-package",
    )


def active_state() -> IdentityState:
    device = Device.create(
        user_id=USER_ID,
        name="Browser",
        now=NOW,
        device_id=DEVICE_ID,
    )
    return IdentityState(devices={DEVICE_ID: device})


async def test_register_is_atomic_and_exact_retry_is_idempotent() -> None:
    state = active_state()
    factory = FakeDeviceCryptoUnitOfWorkFactory(state)
    use_case = RegisterDeviceCryptoIdentity(unit_of_work=factory, clock=FixedClock(NOW))

    created = await use_case.execute(command())
    retried = await use_case.execute(command())

    assert retried == created
    assert state.commits == 1
    assert len(state.device_crypto_identities) == 1
    assert len(state.device_key_packages) == 1
    assert (
        created.initial_key_package_ref
        == next(iter(state.device_key_packages.values())).package_ref
    )


async def test_registration_rejects_identity_replacement_and_wrong_owner() -> None:
    state = active_state()
    factory = FakeDeviceCryptoUnitOfWorkFactory(state)
    use_case = RegisterDeviceCryptoIdentity(unit_of_work=factory, clock=FixedClock(NOW))
    await use_case.execute(command())

    with pytest.raises(DeviceCryptoIdentityConflictError):
        await use_case.execute(command(signature_key=b"x" * 32))

    state.devices[DEVICE_ID] = replace(state.devices[DEVICE_ID], user_id=UUID(int=0))
    with pytest.raises(OwnedDeviceNotFoundError):
        await use_case.execute(command())


async def test_get_current_requires_active_owned_device_and_complete_registry() -> None:
    state = active_state()
    factory = FakeDeviceCryptoUnitOfWorkFactory(state)
    query = GetCurrentDeviceCryptoIdentityQuery(user_id=USER_ID, device_id=DEVICE_ID)
    get_current = GetCurrentDeviceCryptoIdentity(unit_of_work=factory)

    with pytest.raises(DeviceCryptoIdentityNotFoundError):
        await get_current.execute(query)

    register = RegisterDeviceCryptoIdentity(unit_of_work=factory, clock=FixedClock(NOW))
    registered = await register.execute(command())
    assert await get_current.execute(query) == registered

    state.device_key_packages.clear()
    with pytest.raises(DeviceCryptoIdentityConflictError):
        await get_current.execute(query)
