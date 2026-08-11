"""MLS conversation coordination use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.conversation_crypto import (
    AcknowledgeConversationCryptoWelcome,
    BeginConversationCrypto,
    FinalizeConversationCrypto,
    GetCurrentConversationCrypto,
)


class ConversationCryptoUseCaseProvider(Provider):
    begin = provide(BeginConversationCrypto, scope=Scope.REQUEST)
    finalize = provide(FinalizeConversationCrypto, scope=Scope.REQUEST)
    get_current = provide(GetCurrentConversationCrypto, scope=Scope.REQUEST)
    acknowledge_welcome = provide(
        AcknowledgeConversationCryptoWelcome,
        scope=Scope.REQUEST,
    )
