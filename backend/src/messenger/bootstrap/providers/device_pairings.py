"""QR device-pairing use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.device_pairings.approve import ApproveDevicePairing
from messenger.application.device_pairings.authorize import AuthorizeDevicePairing
from messenger.application.device_pairings.cancel import (
    CancelCandidatePairing,
    CancelExistingCandidatePairing,
    CancelTrustedPairing,
)
from messenger.application.device_pairings.create_offer import CreatePairingOffer
from messenger.application.device_pairings.create_request import CreatePairingRequest
from messenger.application.device_pairings.history import (
    AcknowledgeHistoryChunk,
    ListHistoryChunks,
    ListOutboundHistoryChunks,
    UploadHistoryChunk,
)
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.device_pairings.scan import (
    ScanExistingPairingOffer,
    ScanPairingOffer,
    ScanPairingRequest,
)
from messenger.application.device_pairings.status import (
    GetCandidatePairingStatus,
    GetExistingCandidatePairingStatus,
    GetTrustedPairingStatus,
)
from messenger.bootstrap.settings import AppSettings


class DevicePairingUseCaseProvider(Provider):
    @provide(scope=Scope.APP)
    def pairing_policy(self, settings: AppSettings) -> DevicePairingPolicy:
        return settings.device_pairing_policy

    create_pairing_request = provide(CreatePairingRequest, scope=Scope.REQUEST)
    create_pairing_offer = provide(CreatePairingOffer, scope=Scope.REQUEST)
    scan_pairing_request = provide(ScanPairingRequest, scope=Scope.REQUEST)
    scan_pairing_offer = provide(ScanPairingOffer, scope=Scope.REQUEST)
    scan_existing_pairing_offer = provide(ScanExistingPairingOffer, scope=Scope.REQUEST)
    get_candidate_pairing_status = provide(GetCandidatePairingStatus, scope=Scope.REQUEST)
    get_trusted_pairing_status = provide(GetTrustedPairingStatus, scope=Scope.REQUEST)
    get_existing_candidate_pairing_status = provide(
        GetExistingCandidatePairingStatus,
        scope=Scope.REQUEST,
    )
    approve_pairing = provide(ApproveDevicePairing, scope=Scope.REQUEST)
    authorize_pairing = provide(AuthorizeDevicePairing, scope=Scope.REQUEST)
    cancel_candidate_pairing = provide(CancelCandidatePairing, scope=Scope.REQUEST)
    cancel_existing_candidate_pairing = provide(
        CancelExistingCandidatePairing,
        scope=Scope.REQUEST,
    )
    cancel_trusted_pairing = provide(CancelTrustedPairing, scope=Scope.REQUEST)
    upload_history_chunk = provide(UploadHistoryChunk, scope=Scope.REQUEST)
    list_history_chunks = provide(ListHistoryChunks, scope=Scope.REQUEST)
    list_outbound_history_chunks = provide(ListOutboundHistoryChunks, scope=Scope.REQUEST)
    acknowledge_history_chunk = provide(AcknowledgeHistoryChunk, scope=Scope.REQUEST)
