"""Dishka provider composition grouped by architectural responsibility."""

from dishka import Provider

from messenger.bootstrap.providers.accounts import AccountUseCaseProvider
from messenger.bootstrap.providers.adapters import SecurityAdapterProvider
from messenger.bootstrap.providers.attachments import AttachmentProvider
from messenger.bootstrap.providers.conversation_crypto import ConversationCryptoUseCaseProvider
from messenger.bootstrap.providers.conversations import ConversationUseCaseProvider
from messenger.bootstrap.providers.current_account import CurrentAccountUseCaseProvider
from messenger.bootstrap.providers.device_crypto import DeviceCryptoUseCaseProvider
from messenger.bootstrap.providers.devices import DeviceUseCaseProvider
from messenger.bootstrap.providers.messaging import MessagingUseCaseProvider
from messenger.bootstrap.providers.persistence import PersistenceProvider
from messenger.bootstrap.providers.realtime import RealtimeProvider
from messenger.bootstrap.providers.sessions import SessionUseCaseProvider
from messenger.bootstrap.providers.settings import SettingsProvider
from messenger.bootstrap.settings import AppSettings


def application_providers(settings: AppSettings) -> tuple[Provider, ...]:
    """Return explicit providers in dependency order for production runtime."""
    return (
        SettingsProvider(settings),
        PersistenceProvider(),
        SecurityAdapterProvider(),
        AttachmentProvider(),
        RealtimeProvider(),
        AccountUseCaseProvider(),
        CurrentAccountUseCaseProvider(),
        ConversationUseCaseProvider(),
        ConversationCryptoUseCaseProvider(),
        MessagingUseCaseProvider(),
        SessionUseCaseProvider(),
        DeviceUseCaseProvider(),
        DeviceCryptoUseCaseProvider(),
    )


__all__ = ["application_providers"]
