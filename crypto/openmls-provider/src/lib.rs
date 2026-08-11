//! Narrow OpenMLS device-bootstrap core for yv-chat.
//!
//! This crate is not the production E2EE adapter yet. It proves that the exact
//! provider and ciphersuite can create a canonical per-device credential and a
//! valid KeyPackage on native and wasm32 targets. Private state stays inside the
//! opaque [`DeviceBootstrap`] value and is intentionally not serializable.

use openmls::{
    credentials::{BasicCredential, CredentialWithKey},
    key_packages::{KeyPackage, KeyPackageIn},
    prelude::{ProtocolVersion, SignatureScheme},
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{crypto::OpenMlsCrypto, types::Ciphersuite, OpenMlsProvider};
use thiserror::Error;
use tls_codec::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

mod snapshot;

#[cfg(any(test, target_arch = "wasm32"))]
mod sealing;

pub const CREDENTIAL_SCHEMA_VERSION: u8 = 1;
pub const CREDENTIAL_IDENTITY_LENGTH: usize = 33;
pub const DEVICE_FINGERPRINT_LABEL: &[u8] = b"yv-chat-device-fingerprint-v1\0";
pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BootstrapError {
    #[error("invalid user identifier")]
    InvalidUserId,
    #[error("invalid device identifier")]
    InvalidDeviceId,
    #[error("device cryptography is unavailable")]
    CryptoUnavailable,
    #[error("device key storage is unavailable")]
    StorageUnavailable,
    #[error("key package generation failed")]
    KeyPackageUnavailable,
    #[error("key package serialization failed")]
    SerializationFailed,
    #[error("generated key package validation failed")]
    ValidationFailed,
    #[error("private state snapshot is too large")]
    SnapshotTooLarge,
    #[error("private state snapshot is corrupt")]
    SnapshotCorrupt,
    #[error("private state snapshot version is unsupported")]
    SnapshotVersionUnsupported,
    #[error("private state snapshot identity does not match this device")]
    SnapshotIdentityMismatch,
    #[error("crypto wrapping key is invalid")]
    InvalidWrappingKey,
    #[error("private state sealing failed")]
    SealingFailed,
    #[error("sealed private state is invalid")]
    SealedStateInvalid,
    #[error("private state revision rolled back")]
    SnapshotRollback,
}

/// Opaque in-memory owner of private signature and KeyPackage state.
///
/// No plaintext serialization, private-key getter, `Debug`, `Clone`, or serde
/// implementation is provided. Browser persistence is available only through the
/// WebCrypto sealed-state methods compiled for WASM.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub struct DeviceBootstrap {
    _provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    key_package: Vec<u8>,
    fingerprint: String,
}

fn parse_canonical_uuid(value: &str, error: BootstrapError) -> Result<Uuid, BootstrapError> {
    let parsed = Uuid::parse_str(value).map_err(|_| error)?;
    if parsed.hyphenated().to_string() != value {
        return Err(error);
    }
    Ok(parsed)
}

pub fn encode_credential_identity(
    user_id: &str,
    device_id: &str,
) -> Result<[u8; CREDENTIAL_IDENTITY_LENGTH], BootstrapError> {
    let user_id = parse_canonical_uuid(user_id, BootstrapError::InvalidUserId)?;
    let device_id = parse_canonical_uuid(device_id, BootstrapError::InvalidDeviceId)?;
    let mut identity = [0_u8; CREDENTIAL_IDENTITY_LENGTH];
    identity[0] = CREDENTIAL_SCHEMA_VERSION;
    identity[1..17].copy_from_slice(user_id.as_bytes());
    identity[17..33].copy_from_slice(device_id.as_bytes());
    Ok(identity)
}

impl DeviceBootstrap {
    pub fn generate(user_id: &str, device_id: &str) -> Result<Self, BootstrapError> {
        let identity = encode_credential_identity(user_id, device_id)?;
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|_| BootstrapError::CryptoUnavailable)?;
        signer
            .store(provider.storage())
            .map_err(|_| BootstrapError::StorageUnavailable)?;

        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        let key_package = KeyPackage::builder()
            .build(CIPHERSUITE, &provider, &signer, credential.clone())
            .map_err(|_| BootstrapError::KeyPackageUnavailable)?
            .key_package()
            .tls_serialize_detached()
            .map_err(|_| BootstrapError::SerializationFailed)?;

        validate_public_key_package(&key_package, &identity, signer.public())?;
        let fingerprint = public_fingerprint(&provider, &identity, signer.public())?;

        Ok(Self {
            _provider: provider,
            signer,
            credential,
            key_package,
            fingerprint,
        })
    }

    pub fn credential_identity(&self) -> &[u8] {
        self.credential.credential.serialized_content()
    }

    pub fn signature_public_key(&self) -> &[u8] {
        self.signer.public()
    }

    pub fn key_package(&self) -> &[u8] {
        &self.key_package
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub fn validate(&self) -> Result<(), BootstrapError> {
        validate_public_key_package(
            &self.key_package,
            self.credential_identity(),
            self.signature_public_key(),
        )
    }

    #[allow(
        dead_code,
        reason = "consumed by the encrypted sealing adapter in the next slice"
    )]
    pub(crate) fn snapshot_for_sealing(&self, revision: u64) -> Result<Vec<u8>, BootstrapError> {
        snapshot::encode(self, revision)
    }

    #[allow(
        dead_code,
        reason = "consumed by the encrypted sealing adapter in the next slice"
    )]
    pub(crate) fn restore_from_unsealed_snapshot(
        bytes: &[u8],
        expected_user_id: &str,
        expected_device_id: &str,
    ) -> Result<(Self, u64), BootstrapError> {
        snapshot::restore(bytes, expected_user_id, expected_device_id)
    }
}

fn validate_public_key_package(
    serialized: &[u8],
    expected_identity: &[u8],
    expected_signature_key: &[u8],
) -> Result<(), BootstrapError> {
    let mut input = serialized;
    let key_package = KeyPackageIn::tls_deserialize(&mut input)
        .map_err(|_| BootstrapError::ValidationFailed)?
        .validate(
            OpenMlsRustCrypto::default().crypto(),
            ProtocolVersion::Mls10,
        )
        .map_err(|_| BootstrapError::ValidationFailed)?;
    if !input.is_empty()
        || key_package.ciphersuite() != CIPHERSUITE
        || key_package.leaf_node().credential().serialized_content() != expected_identity
        || key_package.leaf_node().signature_key().as_slice() != expected_signature_key
    {
        return Err(BootstrapError::ValidationFailed);
    }
    Ok(())
}

/// Validate a server-delivered KeyPackage against the canonical yv-chat device
/// identity and both public comparison anchors. This is deliberately performed by
/// OpenMLS rather than by a TypeScript wire-format parser.
pub fn validate_external_key_package(
    user_id: &str,
    device_id: &str,
    expected_credential_identity: &[u8],
    expected_signature_key: &[u8],
    expected_fingerprint: &str,
    expected_package_ref: &str,
    serialized: &[u8],
) -> Result<(), BootstrapError> {
    let expected_identity = encode_credential_identity(user_id, device_id)?;
    if expected_credential_identity != expected_identity {
        return Err(BootstrapError::ValidationFailed);
    }
    let provider = OpenMlsRustCrypto::default();
    let fingerprint = public_fingerprint(&provider, &expected_identity, expected_signature_key)?;
    let package_ref = provider
        .crypto()
        .hash(CIPHERSUITE.hash_algorithm(), serialized)
        .map(hex::encode)
        .map_err(|_| BootstrapError::CryptoUnavailable)?;
    if fingerprint != expected_fingerprint || package_ref != expected_package_ref {
        return Err(BootstrapError::ValidationFailed);
    }
    validate_public_key_package(serialized, &expected_identity, expected_signature_key)
}

fn public_fingerprint(
    provider: &OpenMlsRustCrypto,
    identity: &[u8],
    signature_public_key: &[u8],
) -> Result<String, BootstrapError> {
    let mut input = Vec::with_capacity(
        DEVICE_FINGERPRINT_LABEL.len() + identity.len() + signature_public_key.len(),
    );
    input.extend_from_slice(DEVICE_FINGERPRINT_LABEL);
    input.extend_from_slice(identity);
    input.extend_from_slice(signature_public_key);
    provider
        .crypto()
        .hash(CIPHERSUITE.hash_algorithm(), &input)
        .map(hex::encode)
        .map_err(|_| BootstrapError::CryptoUnavailable)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl DeviceBootstrap {
    #[wasm_bindgen(constructor)]
    pub fn new(user_id: &str, device_id: &str) -> Result<DeviceBootstrap, JsError> {
        Self::generate(user_id, device_id).map_err(|error| JsError::new(error.to_string().as_str()))
    }

    #[wasm_bindgen(js_name = credentialIdentity)]
    pub fn wasm_credential_identity(&self) -> Vec<u8> {
        self.credential_identity().to_vec()
    }

    #[wasm_bindgen(js_name = signaturePublicKey)]
    pub fn wasm_signature_public_key(&self) -> Vec<u8> {
        self.signature_public_key().to_vec()
    }

    #[wasm_bindgen(js_name = keyPackage)]
    pub fn wasm_key_package(&self) -> Vec<u8> {
        self.key_package().to_vec()
    }

    #[wasm_bindgen(js_name = fingerprint)]
    pub fn wasm_fingerprint(&self) -> String {
        self.fingerprint().to_owned()
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = validatePublicKeyPackage)]
pub fn wasm_validate_public_key_package(
    user_id: &str,
    device_id: &str,
    expected_credential_identity: &[u8],
    expected_signature_key: &[u8],
    expected_fingerprint: &str,
    expected_package_ref: &str,
    serialized: &[u8],
) -> Result<(), JsError> {
    validate_external_key_package(
        user_id,
        device_id,
        expected_credential_identity,
        expected_signature_key,
        expected_fingerprint,
        expected_package_ref,
        serialized,
    )
    .map_err(|error| JsError::new(error.to_string().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER_ID: &str = "1b0a32e8-144f-4f60-bcb6-112f71bd5316";
    const DEVICE_ID: &str = "50d6b08a-84ae-4bd7-829a-f40f38e9a2c1";

    #[test]
    fn credential_identity_has_fixed_canonical_layout() {
        let identity = encode_credential_identity(USER_ID, DEVICE_ID).unwrap();
        assert_eq!(identity.len(), CREDENTIAL_IDENTITY_LENGTH);
        assert_eq!(identity[0], CREDENTIAL_SCHEMA_VERSION);
        assert_eq!(
            &identity[1..17],
            Uuid::parse_str(USER_ID).unwrap().as_bytes()
        );
        assert_eq!(
            &identity[17..33],
            Uuid::parse_str(DEVICE_ID).unwrap().as_bytes()
        );
    }

    #[test]
    fn rejects_non_canonical_or_malformed_identifiers() {
        assert_eq!(
            encode_credential_identity("1B0A32E8-144F-4F60-BCB6-112F71BD5316", DEVICE_ID),
            Err(BootstrapError::InvalidUserId),
        );
        assert_eq!(
            encode_credential_identity(USER_ID, "not-a-uuid"),
            Err(BootstrapError::InvalidDeviceId),
        );
    }

    #[test]
    fn generates_a_valid_exact_suite_key_package() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        bootstrap.validate().unwrap();
        assert_eq!(bootstrap.credential_identity().len(), 33);
        assert_eq!(bootstrap.signature_public_key().len(), 32);
        assert_eq!(bootstrap.fingerprint().len(), 64);
        assert!(!bootstrap.key_package().is_empty());
    }

    #[test]
    fn independent_bootstraps_do_not_share_device_keys() {
        let first = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let second = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        assert_ne!(first.signature_public_key(), second.signature_public_key());
        assert_ne!(first.key_package(), second.key_package());
        assert_ne!(first.fingerprint(), second.fingerprint());
    }

    #[test]
    fn corrupt_or_trailing_key_package_bytes_fail_closed() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let mut trailing = bootstrap.key_package().to_vec();
        trailing.push(0);
        assert_eq!(
            validate_public_key_package(
                &trailing,
                bootstrap.credential_identity(),
                bootstrap.signature_public_key(),
            ),
            Err(BootstrapError::ValidationFailed),
        );
        let mut corrupt = bootstrap.key_package().to_vec();
        let corrupt_index = corrupt.len() / 2;
        corrupt[corrupt_index] ^= 0x80;
        assert_eq!(
            validate_public_key_package(
                &corrupt,
                bootstrap.credential_identity(),
                bootstrap.signature_public_key(),
            ),
            Err(BootstrapError::ValidationFailed),
        );
    }

    #[test]
    fn validates_external_package_and_all_public_bindings() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let package_ref = hex::encode(
            OpenMlsRustCrypto::default()
                .crypto()
                .hash(CIPHERSUITE.hash_algorithm(), bootstrap.key_package())
                .unwrap(),
        );
        validate_external_key_package(
            USER_ID,
            DEVICE_ID,
            bootstrap.credential_identity(),
            bootstrap.signature_public_key(),
            bootstrap.fingerprint(),
            &package_ref,
            bootstrap.key_package(),
        )
        .unwrap();

        for result in [
            validate_external_key_package(
                USER_ID,
                "d44483ee-2c69-4eef-aeba-5ce92bc9181d",
                bootstrap.credential_identity(),
                bootstrap.signature_public_key(),
                bootstrap.fingerprint(),
                &package_ref,
                bootstrap.key_package(),
            ),
            validate_external_key_package(
                USER_ID,
                DEVICE_ID,
                bootstrap.credential_identity(),
                &[0_u8; 32],
                bootstrap.fingerprint(),
                &package_ref,
                bootstrap.key_package(),
            ),
            validate_external_key_package(
                USER_ID,
                DEVICE_ID,
                bootstrap.credential_identity(),
                bootstrap.signature_public_key(),
                &"00".repeat(32),
                &package_ref,
                bootstrap.key_package(),
            ),
            validate_external_key_package(
                USER_ID,
                DEVICE_ID,
                bootstrap.credential_identity(),
                bootstrap.signature_public_key(),
                bootstrap.fingerprint(),
                &"00".repeat(32),
                bootstrap.key_package(),
            ),
        ] {
            assert_eq!(result, Err(BootstrapError::ValidationFailed));
        }
    }
}
