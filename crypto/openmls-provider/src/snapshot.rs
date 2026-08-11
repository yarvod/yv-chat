//! Internal unsealed snapshot format.
//!
//! These bytes contain private keys. This module is intentionally private and no
//! function here is exported through `wasm_bindgen`. A caller may only persist the
//! bytes after the encrypted sealing slice authenticates them with a non-extractable
//! browser key.

use std::collections::{BTreeMap, HashMap};

use openmls::{
    credentials::{BasicCredential, CredentialWithKey},
    prelude::SignatureScheme,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use tls_codec::Deserialize;

use super::{
    encode_credential_identity, public_fingerprint, validate_public_key_package, BootstrapError,
    DeviceBootstrap, CIPHERSUITE, CREDENTIAL_IDENTITY_LENGTH,
};

const MAGIC: &[u8; 8] = b"YVMLSST\0";
const FORMAT_VERSION: u16 = 1;
const PROVIDER_STORAGE_VERSION: u16 = 1;
pub(super) const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
const MAX_KEY_PACKAGE_BYTES: usize = 1024 * 1024;
const MAX_STORAGE_ENTRIES: usize = 4096;
const MAX_STORAGE_KEY_BYTES: usize = 64 * 1024;
const MAX_STORAGE_VALUE_BYTES: usize = 4 * 1024 * 1024;

pub(super) fn encode(
    bootstrap: &DeviceBootstrap,
    revision: u64,
) -> Result<Vec<u8>, BootstrapError> {
    if revision == 0 {
        return Err(BootstrapError::SnapshotCorrupt);
    }
    let values = bootstrap
        ._provider
        .storage()
        .values
        .read()
        .map_err(|_| BootstrapError::StorageUnavailable)?;
    encode_parts(
        bootstrap.credential_identity(),
        bootstrap.signature_public_key(),
        &bootstrap.key_package,
        revision,
        &values,
    )
}

fn encode_parts(
    identity: &[u8],
    signature_public_key: &[u8],
    key_package: &[u8],
    revision: u64,
    values: &HashMap<Vec<u8>, Vec<u8>>,
) -> Result<Vec<u8>, BootstrapError> {
    if identity.len() != CREDENTIAL_IDENTITY_LENGTH
        || values.len() > MAX_STORAGE_ENTRIES
        || key_package.len() > MAX_KEY_PACKAGE_BYTES
        || signature_public_key.len() > u16::MAX as usize
    {
        return Err(BootstrapError::SnapshotTooLarge);
    }
    let sorted = values.iter().collect::<BTreeMap<_, _>>();
    let mut output = Vec::new();
    output.extend_from_slice(MAGIC);
    push_u16(&mut output, FORMAT_VERSION);
    push_u16(&mut output, PROVIDER_STORAGE_VERSION);
    push_u64(&mut output, revision);
    output.extend_from_slice(identity);
    push_u16(&mut output, signature_public_key.len() as u16);
    output.extend_from_slice(signature_public_key);
    push_u32(
        &mut output,
        u32::try_from(key_package.len()).map_err(|_| BootstrapError::SnapshotTooLarge)?,
    );
    output.extend_from_slice(key_package);
    push_u32(
        &mut output,
        u32::try_from(sorted.len()).map_err(|_| BootstrapError::SnapshotTooLarge)?,
    );
    for (key, value) in sorted {
        if key.len() > MAX_STORAGE_KEY_BYTES || value.len() > MAX_STORAGE_VALUE_BYTES {
            return Err(BootstrapError::SnapshotTooLarge);
        }
        push_u32(
            &mut output,
            u32::try_from(key.len()).map_err(|_| BootstrapError::SnapshotTooLarge)?,
        );
        push_u32(
            &mut output,
            u32::try_from(value.len()).map_err(|_| BootstrapError::SnapshotTooLarge)?,
        );
        output.extend_from_slice(key);
        output.extend_from_slice(value);
        if output.len() > MAX_SNAPSHOT_BYTES {
            return Err(BootstrapError::SnapshotTooLarge);
        }
    }
    Ok(output)
}

pub(super) fn restore(
    bytes: &[u8],
    expected_user_id: &str,
    expected_device_id: &str,
) -> Result<(DeviceBootstrap, u64), BootstrapError> {
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(BootstrapError::SnapshotTooLarge);
    }
    let mut reader = Reader::new(bytes);
    if reader.take(MAGIC.len())? != MAGIC {
        return Err(BootstrapError::SnapshotCorrupt);
    }
    if reader.u16()? != FORMAT_VERSION || reader.u16()? != PROVIDER_STORAGE_VERSION {
        return Err(BootstrapError::SnapshotVersionUnsupported);
    }
    let revision = reader.u64()?;
    if revision == 0 {
        return Err(BootstrapError::SnapshotCorrupt);
    }
    let identity = reader.take(CREDENTIAL_IDENTITY_LENGTH)?.to_vec();
    let expected_identity = encode_credential_identity(expected_user_id, expected_device_id)?;
    if identity != expected_identity {
        return Err(BootstrapError::SnapshotIdentityMismatch);
    }
    let signature_public_key_length = reader.u16()? as usize;
    let signature_public_key =
        reader.bounded_vec(signature_public_key_length, u16::MAX as usize)?;
    if signature_public_key.len() != 32 {
        return Err(BootstrapError::SnapshotCorrupt);
    }
    let key_package_length = reader.u32()? as usize;
    let key_package = reader.bounded_vec(key_package_length, MAX_KEY_PACKAGE_BYTES)?;
    let entry_count = reader.u32()? as usize;
    if entry_count > MAX_STORAGE_ENTRIES {
        return Err(BootstrapError::SnapshotTooLarge);
    }
    let mut values = HashMap::with_capacity(entry_count);
    for _ in 0..entry_count {
        let key_length = reader.u32()? as usize;
        let value_length = reader.u32()? as usize;
        let key = reader.bounded_vec(key_length, MAX_STORAGE_KEY_BYTES)?;
        let value = reader.bounded_vec(value_length, MAX_STORAGE_VALUE_BYTES)?;
        if values.insert(key, value).is_some() {
            return Err(BootstrapError::SnapshotCorrupt);
        }
    }
    if !reader.is_finished() {
        return Err(BootstrapError::SnapshotCorrupt);
    }

    validate_public_key_package(&key_package, &identity, &signature_public_key)
        .map_err(|_| BootstrapError::SnapshotCorrupt)?;
    let provider = OpenMlsRustCrypto::default();
    *provider
        .storage()
        .values
        .write()
        .map_err(|_| BootstrapError::StorageUnavailable)? = values;
    let signer = SignatureKeyPair::read(
        provider.storage(),
        &signature_public_key,
        SignatureScheme::ED25519,
    )
    .ok_or(BootstrapError::SnapshotCorrupt)?;

    let credential = CredentialWithKey {
        credential: BasicCredential::new(identity.clone()).into(),
        signature_key: signature_public_key.clone().into(),
    };
    let mut key_package_input = key_package.as_slice();
    let parsed_key_package =
        openmls::key_packages::KeyPackageIn::tls_deserialize(&mut key_package_input)
            .map_err(|_| BootstrapError::SnapshotCorrupt)?
            .validate(provider.crypto(), openmls::prelude::ProtocolVersion::Mls10)
            .map_err(|_| BootstrapError::SnapshotCorrupt)?;
    // OpenMLS removes a one-time KeyPackage bundle after consuming the Welcome.
    // The immutable public package remains part of the device registration, but
    // its private init key is correctly absent after use and must not make an
    // otherwise complete MLS group snapshot unrestorable.
    if parsed_key_package.ciphersuite() != CIPHERSUITE {
        return Err(BootstrapError::SnapshotCorrupt);
    }
    let fingerprint = public_fingerprint(&provider, &identity, &signature_public_key)?;
    let bootstrap = DeviceBootstrap {
        _provider: provider,
        signer,
        credential,
        key_package,
        fingerprint,
    };
    bootstrap.validate()?;
    Ok((bootstrap, revision))
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_be_bytes());
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], BootstrapError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(BootstrapError::SnapshotTooLarge)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(BootstrapError::SnapshotCorrupt)?;
        self.offset = end;
        Ok(value)
    }

    fn bounded_vec(&mut self, length: usize, maximum: usize) -> Result<Vec<u8>, BootstrapError> {
        if length > maximum {
            return Err(BootstrapError::SnapshotTooLarge);
        }
        Ok(self.take(length)?.to_vec())
    }

    fn u16(&mut self) -> Result<u16, BootstrapError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| BootstrapError::SnapshotCorrupt)?;
        Ok(u16::from_be_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32, BootstrapError> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| BootstrapError::SnapshotCorrupt)?;
        Ok(u32::from_be_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, BootstrapError> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| BootstrapError::SnapshotCorrupt)?;
        Ok(u64::from_be_bytes(bytes))
    }

    fn is_finished(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openmls_traits::{crypto::OpenMlsCrypto, signatures::Signer};

    const USER_ID: &str = "1b0a32e8-144f-4f60-bcb6-112f71bd5316";
    const DEVICE_ID: &str = "50d6b08a-84ae-4bd7-829a-f40f38e9a2c1";

    #[test]
    fn round_trip_preserves_public_anchors_and_private_signer() {
        let original = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let bytes = encode(&original, 7).unwrap();
        let (restored, revision) = restore(&bytes, USER_ID, DEVICE_ID).unwrap();

        assert_eq!(revision, 7);
        assert_eq!(
            restored.credential_identity(),
            original.credential_identity()
        );
        assert_eq!(
            restored.signature_public_key(),
            original.signature_public_key()
        );
        assert_eq!(restored.key_package(), original.key_package());
        assert_eq!(restored.fingerprint(), original.fingerprint());
        restored.validate().unwrap();
        let payload = b"restored-device-proof";
        let signature = restored.signer.sign(payload).unwrap();
        restored
            ._provider
            .crypto()
            .verify_signature(
                SignatureScheme::ED25519,
                payload,
                restored.signature_public_key(),
                &signature,
            )
            .unwrap();
        assert_eq!(encode(&restored, revision).unwrap(), bytes);
    }

    #[test]
    fn snapshot_encoding_is_deterministic() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        assert_eq!(
            encode(&bootstrap, 1).unwrap(),
            encode(&bootstrap, 1).unwrap()
        );
    }

    #[test]
    fn rejects_truncation_trailing_bytes_and_unsupported_versions() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let bytes = encode(&bootstrap, 1).unwrap();
        assert_eq!(
            restore(&bytes[..bytes.len() - 1], USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotCorrupt),
        );
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert_eq!(
            restore(&trailing, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotCorrupt),
        );
        let mut unsupported = bytes;
        unsupported[MAGIC.len()] = 0;
        unsupported[MAGIC.len() + 1] = 2;
        assert_eq!(
            restore(&unsupported, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotVersionUnsupported),
        );
    }

    #[test]
    fn rejects_wrong_expected_identity_and_zero_revision() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let bytes = encode(&bootstrap, 1).unwrap();
        assert_eq!(
            restore(&bytes, "539eb4a8-a416-4057-80fe-2e7337768dd0", DEVICE_ID,).err(),
            Some(BootstrapError::SnapshotIdentityMismatch),
        );
        assert_eq!(encode(&bootstrap, 0), Err(BootstrapError::SnapshotCorrupt));
        let mut zero_revision = bytes;
        zero_revision[MAGIC.len() + 4..MAGIC.len() + 12].fill(0);
        assert_eq!(
            restore(&zero_revision, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotCorrupt),
        );
    }

    #[test]
    fn rejects_missing_signer_record() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let bytes = encode(&bootstrap, 1).unwrap();
        let (mut parsed, _) = parse_for_test(&bytes);
        parsed.retain(|key, _| !key.starts_with(b"SignatureKeyPair"));
        let broken = encode_with_values_for_test(&bootstrap, 1, parsed);
        assert_eq!(
            restore(&broken, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotCorrupt),
        );
    }

    #[test]
    fn rejects_changed_public_key_duplicate_records_and_oversized_fields() {
        let bootstrap = DeviceBootstrap::generate(USER_ID, DEVICE_ID).unwrap();
        let bytes = encode(&bootstrap, 1).unwrap();

        let mut changed_public_key = bytes.clone();
        let signature_key_offset = MAGIC.len() + 2 + 2 + 8 + CREDENTIAL_IDENTITY_LENGTH + 2;
        changed_public_key[signature_key_offset] ^= 0x80;
        assert_eq!(
            restore(&changed_public_key, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotCorrupt),
        );

        let mut reader = Reader::new(&bytes);
        reader
            .take(MAGIC.len() + 2 + 2 + 8 + CREDENTIAL_IDENTITY_LENGTH)
            .unwrap();
        let signature_len = reader.u16().unwrap() as usize;
        reader.take(signature_len).unwrap();
        let key_package_len_offset = reader.offset;
        let key_package_len = reader.u32().unwrap() as usize;
        reader.take(key_package_len).unwrap();
        let entry_count_offset = reader.offset;
        let entry_count = reader.u32().unwrap();
        let first_entry_start = reader.offset;
        let first_key_len = reader.u32().unwrap() as usize;
        let first_value_len = reader.u32().unwrap() as usize;
        reader.take(first_key_len + first_value_len).unwrap();
        let duplicate_entry = bytes[first_entry_start..reader.offset].to_vec();
        let mut duplicate = bytes.clone();
        duplicate[entry_count_offset..entry_count_offset + 4]
            .copy_from_slice(&(entry_count + 1).to_be_bytes());
        duplicate.extend_from_slice(&duplicate_entry);
        assert_eq!(
            restore(&duplicate, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotCorrupt),
        );

        let mut oversized = bytes;
        oversized[key_package_len_offset..key_package_len_offset + 4]
            .copy_from_slice(&((MAX_KEY_PACKAGE_BYTES as u32) + 1).to_be_bytes());
        assert_eq!(
            restore(&oversized, USER_ID, DEVICE_ID).err(),
            Some(BootstrapError::SnapshotTooLarge),
        );
    }

    fn parse_for_test(bytes: &[u8]) -> (HashMap<Vec<u8>, Vec<u8>>, usize) {
        let mut reader = Reader::new(bytes);
        reader
            .take(MAGIC.len() + 2 + 2 + 8 + CREDENTIAL_IDENTITY_LENGTH)
            .unwrap();
        let signature_len = reader.u16().unwrap() as usize;
        reader.take(signature_len).unwrap();
        let key_package_len = reader.u32().unwrap() as usize;
        reader.take(key_package_len).unwrap();
        let count = reader.u32().unwrap() as usize;
        let mut values = HashMap::new();
        for _ in 0..count {
            let key_len = reader.u32().unwrap() as usize;
            let value_len = reader.u32().unwrap() as usize;
            values.insert(
                reader.take(key_len).unwrap().to_vec(),
                reader.take(value_len).unwrap().to_vec(),
            );
        }
        (values, reader.offset)
    }

    fn encode_with_values_for_test(
        bootstrap: &DeviceBootstrap,
        revision: u64,
        values: HashMap<Vec<u8>, Vec<u8>>,
    ) -> Vec<u8> {
        encode_parts(
            bootstrap.credential_identity(),
            bootstrap.signature_public_key(),
            &bootstrap.key_package,
            revision,
            &values,
        )
        .unwrap()
    }
}
