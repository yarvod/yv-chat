"""QR device-pairing use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.device_pairings.approve import ApproveDevicePairing
from messenger.application.device_pairings.authorize import AuthorizeDevicePairing
from messenger.application.device_pairings.cancel import (
    CancelCandidatePairing,
    CancelTrustedPairing,
)
from messenger.application.device_pairings.create_offer import CreatePairingOffer
from messenger.application.device_pairings.create_request import CreatePairingRequest
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.device_pairings.scan import ScanPairingOffer, ScanPairingRequest
from messenger.application.device_pairings.status import (
    GetCandidatePairingStatus,
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
    get_candidate_pairing_status = provide(GetCandidatePairingStatus, scope=Scope.REQUEST)
    get_trusted_pairing_status = provide(GetTrustedPairingStatus, scope=Scope.REQUEST)
    approve_pairing = provide(ApproveDevicePairing, scope=Scope.REQUEST)
    authorize_pairing = provide(AuthorizeDevicePairing, scope=Scope.REQUEST)
    cancel_candidate_pairing = provide(CancelCandidatePairing, scope=Scope.REQUEST)
    cancel_trusted_pairing = provide(CancelTrustedPairing, scope=Scope.REQUEST)
