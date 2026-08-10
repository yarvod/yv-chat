"""Authentication session policy validation."""

from datetime import timedelta

import pytest

from messenger.application.session_policy import SessionPolicy


def policy(**overrides: timedelta) -> SessionPolicy:
    values = {
        "idle_timeout": timedelta(days=30),
        "absolute_lifetime": timedelta(days=90),
        "rotation_interval": timedelta(days=1),
        "previous_token_grace": timedelta(seconds=60),
        "touch_interval": timedelta(minutes=5),
    }
    values.update(overrides)
    return SessionPolicy(**values)


def test_default_shape_is_valid() -> None:
    configured = policy()

    assert configured.idle_timeout == timedelta(days=30)
    assert configured.absolute_lifetime == timedelta(days=90)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"idle_timeout": timedelta(0)}, "idle_timeout"),
        ({"idle_timeout": timedelta(days=91)}, "idle_timeout"),
        ({"rotation_interval": timedelta(days=90)}, "rotation_interval"),
        ({"previous_token_grace": timedelta(days=1)}, "previous_token_grace"),
        ({"touch_interval": timedelta(days=30)}, "touch_interval"),
    ],
)
def test_invalid_duration_relationships_are_rejected(
    overrides: dict[str, timedelta],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        policy(**overrides)
