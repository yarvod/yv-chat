//! WebCrypto sealing for private OpenMLS snapshots.

use super::{BootstrapError, CREDENTIAL_IDENTITY_LENGTH};

#[cfg(target_arch = "wasm32")]
use super::{encode_credential_identity, DeviceBootstrap};

const AAD_LABEL: &[u8] = b"yv-chat-openmls-state-v1\0";
const IV_LENGTH: usize = 12;
const AES_GCM_TAG_LENGTH: usize = 16;
const MAX_CIPHERTEXT_BYTES: usize = super::snapshot::MAX_SNAPSHOT_BYTES + AES_GCM_TAG_LENGTH;

fn build_aad(identity: &[u8], revision: u64) -> Result<Vec<u8>, BootstrapError> {
    if identity.len() != CREDENTIAL_IDENTITY_LENGTH || revision == 0 {
        return Err(BootstrapError::SealedStateInvalid);
    }
    let mut aad = Vec::with_capacity(AAD_LABEL.len() + identity.len() + 8);
    aad.extend_from_slice(AAD_LABEL);
    aad.extend_from_slice(identity);
    aad.extend_from_slice(&revision.to_be_bytes());
    Ok(aad)
}

fn validate_envelope(iv: &[u8], ciphertext: &[u8], revision: u64) -> Result<(), BootstrapError> {
    if revision == 0
        || iv.len() != IV_LENGTH
        || ciphertext.len() < AES_GCM_TAG_LENGTH
        || ciphertext.len() > MAX_CIPHERTEXT_BYTES
    {
        return Err(BootstrapError::SealedStateInvalid);
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use js_sys::{global, Array, Reflect, Uint8Array};
    use wasm_bindgen::{prelude::*, JsCast};
    use wasm_bindgen_futures::JsFuture;
    use web_sys::{AesGcmParams, Crypto, CryptoKey};

    use super::*;

    #[wasm_bindgen]
    pub struct SealedSnapshot {
        revision: u64,
        iv: Vec<u8>,
        ciphertext: Vec<u8>,
        fingerprint: String,
    }

    #[wasm_bindgen]
    impl SealedSnapshot {
        #[wasm_bindgen(getter)]
        pub fn revision(&self) -> u64 {
            self.revision
        }

        #[wasm_bindgen(getter)]
        pub fn iv(&self) -> Vec<u8> {
            self.iv.clone()
        }

        #[wasm_bindgen(getter)]
        pub fn ciphertext(&self) -> Vec<u8> {
            self.ciphertext.clone()
        }

        #[wasm_bindgen(getter)]
        pub fn fingerprint(&self) -> String {
            self.fingerprint.clone()
        }
    }

    fn browser_crypto() -> Result<Crypto, BootstrapError> {
        Reflect::get(&global(), &JsValue::from_str("crypto"))
            .map_err(|_| BootstrapError::SealingFailed)?
            .dyn_into::<Crypto>()
            .map_err(|_| BootstrapError::SealingFailed)
    }

    fn validate_wrapping_key(key: &CryptoKey) -> Result<(), BootstrapError> {
        if key.extractable() || key.type_() != "secret" {
            return Err(BootstrapError::InvalidWrappingKey);
        }
        let algorithm = key
            .algorithm()
            .map_err(|_| BootstrapError::InvalidWrappingKey)?;
        let name = Reflect::get(&algorithm, &JsValue::from_str("name"))
            .map_err(|_| BootstrapError::InvalidWrappingKey)?
            .as_string()
            .ok_or(BootstrapError::InvalidWrappingKey)?;
        let length = Reflect::get(&algorithm, &JsValue::from_str("length"))
            .map_err(|_| BootstrapError::InvalidWrappingKey)?
            .as_f64()
            .ok_or(BootstrapError::InvalidWrappingKey)?;
        let usages: Array = key.usages();
        if name != "AES-GCM"
            || length != 256.0
            || usages.length() != 2
            || !usages.includes(&JsValue::from_str("encrypt"), 0)
            || !usages.includes(&JsValue::from_str("decrypt"), 0)
        {
            return Err(BootstrapError::InvalidWrappingKey);
        }
        Ok(())
    }

    fn aes_gcm_params(iv: &[u8], aad: &[u8]) -> AesGcmParams {
        let iv = Uint8Array::from(iv);
        let aad = Uint8Array::from(aad);
        let params = AesGcmParams::new_with_u8_array("AES-GCM", &iv);
        params.set_additional_data_u8_array(&aad);
        params.set_tag_length(128);
        params
    }

    fn safe_js_error(error: BootstrapError) -> JsError {
        JsError::new(error.to_string().as_str())
    }

    #[wasm_bindgen]
    impl DeviceBootstrap {
        #[wasm_bindgen(js_name = sealState)]
        pub async fn seal_state(
            &self,
            key: &CryptoKey,
            revision: u64,
        ) -> Result<SealedSnapshot, JsError> {
            validate_wrapping_key(key).map_err(safe_js_error)?;
            let aad = build_aad(self.credential_identity(), revision).map_err(safe_js_error)?;
            let crypto = browser_crypto().map_err(safe_js_error)?;
            let mut iv = [0_u8; IV_LENGTH];
            crypto
                .get_random_values_with_u8_array(&mut iv)
                .map_err(|_| safe_js_error(BootstrapError::SealingFailed))?;
            let params = aes_gcm_params(&iv, &aad);
            let mut plaintext = self.snapshot_for_sealing(revision).map_err(safe_js_error)?;
            let promise = match crypto.subtle().encrypt_with_object_and_u8_array(
                params.unchecked_ref(),
                key,
                &plaintext,
            ) {
                Ok(promise) => promise,
                Err(_) => {
                    plaintext.fill(0);
                    return Err(safe_js_error(BootstrapError::SealingFailed));
                }
            };
            let encrypted = JsFuture::from(promise)
                .await
                .map_err(|_| safe_js_error(BootstrapError::SealingFailed));
            plaintext.fill(0);
            let ciphertext = Uint8Array::new(&encrypted?).to_vec();
            validate_envelope(&iv, &ciphertext, revision).map_err(safe_js_error)?;
            Ok(SealedSnapshot {
                revision,
                iv: iv.to_vec(),
                ciphertext,
                fingerprint: self.fingerprint().to_owned(),
            })
        }

        #[wasm_bindgen(js_name = restoreSealedState)]
        pub async fn restore_sealed_state(
            key: &CryptoKey,
            expected_user_id: &str,
            expected_device_id: &str,
            expected_fingerprint: &str,
            revision: u64,
            iv: &[u8],
            ciphertext: &[u8],
        ) -> Result<DeviceBootstrap, JsError> {
            validate_wrapping_key(key).map_err(safe_js_error)?;
            validate_envelope(iv, ciphertext, revision).map_err(safe_js_error)?;
            let identity = encode_credential_identity(expected_user_id, expected_device_id)
                .map_err(safe_js_error)?;
            let aad = build_aad(&identity, revision).map_err(safe_js_error)?;
            let params = aes_gcm_params(iv, &aad);
            let crypto = browser_crypto().map_err(safe_js_error)?;
            let promise = crypto
                .subtle()
                .decrypt_with_object_and_u8_array(params.unchecked_ref(), key, ciphertext)
                .map_err(|_| safe_js_error(BootstrapError::SealedStateInvalid))?;
            let decrypted = JsFuture::from(promise)
                .await
                .map_err(|_| safe_js_error(BootstrapError::SealedStateInvalid))?;
            let decrypted_bytes = Uint8Array::new(&decrypted);
            let mut plaintext = decrypted_bytes.to_vec();
            let restored = DeviceBootstrap::restore_from_unsealed_snapshot(
                &plaintext,
                expected_user_id,
                expected_device_id,
            );
            plaintext.fill(0);
            decrypted_bytes.fill(0, 0, decrypted_bytes.length());
            let (bootstrap, inner_revision) = restored.map_err(safe_js_error)?;
            if inner_revision != revision || bootstrap.fingerprint() != expected_fingerprint {
                return Err(safe_js_error(BootstrapError::SnapshotRollback));
            }
            Ok(bootstrap)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode_credential_identity;

    const USER_ID: &str = "1b0a32e8-144f-4f60-bcb6-112f71bd5316";
    const DEVICE_ID: &str = "50d6b08a-84ae-4bd7-829a-f40f38e9a2c1";

    #[test]
    fn aad_binds_schema_user_device_and_revision() {
        let identity = encode_credential_identity(USER_ID, DEVICE_ID).unwrap();
        let aad = build_aad(&identity, 9).unwrap();
        assert!(aad.starts_with(AAD_LABEL));
        assert_eq!(
            &aad[AAD_LABEL.len()..AAD_LABEL.len() + CREDENTIAL_IDENTITY_LENGTH],
            identity,
        );
        assert_eq!(&aad[aad.len() - 8..], &9_u64.to_be_bytes());

        let other_revision = build_aad(&identity, 10).unwrap();
        assert_ne!(aad, other_revision);
        let other_identity =
            encode_credential_identity(USER_ID, "d44483ee-2c69-4eef-aeba-5ce92bc9181d").unwrap();
        assert_ne!(aad, build_aad(&other_identity, 9).unwrap());
    }

    #[test]
    fn rejects_invalid_revision_iv_and_ciphertext_bounds() {
        let identity = encode_credential_identity(USER_ID, DEVICE_ID).unwrap();
        assert_eq!(
            build_aad(&identity, 0),
            Err(BootstrapError::SealedStateInvalid),
        );
        assert_eq!(
            validate_envelope(&[0; IV_LENGTH - 1], &[0; AES_GCM_TAG_LENGTH], 1),
            Err(BootstrapError::SealedStateInvalid),
        );
        assert_eq!(
            validate_envelope(&[0; IV_LENGTH], &[0; AES_GCM_TAG_LENGTH - 1], 1),
            Err(BootstrapError::SealedStateInvalid),
        );
        assert_eq!(
            validate_envelope(&[0; IV_LENGTH], &[0; AES_GCM_TAG_LENGTH], 1),
            Ok(()),
        );
    }
}
