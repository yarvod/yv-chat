//! Domain-separated WebRTC DTLS fingerprint authentication.
//!
//! Signatures use the device credential key already authenticated by the local
//! MLS group. Private key material never leaves [`DeviceBootstrap`].

use openmls::prelude::SignatureScheme;
use openmls_traits::{crypto::OpenMlsCrypto, signatures::Signer, OpenMlsProvider};
use thiserror::Error;
use uuid::Uuid;

use crate::{encode_credential_identity, BootstrapError, DeviceBootstrap, CIPHERSUITE};

const CALL_BINDING_LABEL: &[u8] = b"yv-chat-webrtc-call-binding-v1\0";
const CALL_CODE_LABEL: &[u8] = b"yv-chat-webrtc-call-code-v1\0";
const OFFER_ROLE: u8 = 1;
const ANSWER_ROLE: u8 = 2;
const SIGNATURE_LENGTH: usize = 64;
const FINGERPRINT_LENGTH: usize = 32;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum CallIdentityError {
    #[error("invalid call identity context")]
    InvalidContext,
    #[error("invalid or ambiguous WebRTC DTLS fingerprint")]
    InvalidFingerprint,
    #[error("call identity signer does not match this device")]
    WrongLocalDevice,
    #[error("expected device is not a current MLS member")]
    DeviceNotInGroup,
    #[error("invalid call identity signature")]
    InvalidSignature,
    #[error("call identity cryptography is unavailable")]
    CryptoUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallBindingRole {
    Offer,
    Answer,
}

impl CallBindingRole {
    fn byte(self) -> u8 {
        match self {
            Self::Offer => OFFER_ROLE,
            Self::Answer => ANSWER_ROLE,
        }
    }
}

pub struct CallBindingInput<'a> {
    pub role: CallBindingRole,
    pub conversation_id: &'a str,
    pub call_id: &'a str,
    pub caller_user_id: &'a str,
    pub caller_device_id: &'a str,
    pub callee_user_id: &'a str,
    pub callee_device_id: Option<&'a str>,
    pub sdp: &'a str,
}

impl DeviceBootstrap {
    pub fn sign_call_binding(
        &self,
        input: &CallBindingInput<'_>,
    ) -> Result<Vec<u8>, CallIdentityError> {
        let signer_identity = match input.role {
            CallBindingRole::Offer => {
                if input.callee_device_id.is_some() {
                    return Err(CallIdentityError::InvalidContext);
                }
                encode_identity(input.caller_user_id, input.caller_device_id)?
            }
            CallBindingRole::Answer => encode_identity(
                input.callee_user_id,
                input
                    .callee_device_id
                    .ok_or(CallIdentityError::InvalidContext)?,
            )?,
        };
        if signer_identity.as_slice() != self.credential_identity() {
            return Err(CallIdentityError::WrongLocalDevice);
        }
        self.signer
            .sign(&canonical_binding(input)?)
            .map_err(|_| CallIdentityError::CryptoUnavailable)
    }

    pub fn verify_call_binding(
        &self,
        input: &CallBindingInput<'_>,
        signature: &[u8],
    ) -> Result<(), CallIdentityError> {
        if signature.len() != SIGNATURE_LENGTH {
            return Err(CallIdentityError::InvalidSignature);
        }
        let verifier_matches = match input.role {
            CallBindingRole::Offer => {
                let callee_user = canonical_uuid(input.callee_user_id)?;
                self.credential_identity().get(1..17) == Some(callee_user.as_bytes())
            }
            CallBindingRole::Answer => {
                encode_identity(input.caller_user_id, input.caller_device_id)?.as_slice()
                    == self.credential_identity()
            }
        };
        if !verifier_matches {
            return Err(CallIdentityError::WrongLocalDevice);
        }
        let (signer_user_id, signer_device_id) = match input.role {
            CallBindingRole::Offer => {
                if input.callee_device_id.is_some() {
                    return Err(CallIdentityError::InvalidContext);
                }
                (input.caller_user_id, input.caller_device_id)
            }
            CallBindingRole::Answer => (
                input.callee_user_id,
                input
                    .callee_device_id
                    .ok_or(CallIdentityError::InvalidContext)?,
            ),
        };
        let public_key = self
            .device_signature_key(input.conversation_id, signer_user_id, signer_device_id)
            .map_err(|_| CallIdentityError::DeviceNotInGroup)?;
        self._provider
            .crypto()
            .verify_signature(
                SignatureScheme::ED25519,
                &canonical_binding(input)?,
                &public_key,
                signature,
            )
            .map_err(|_| CallIdentityError::InvalidSignature)
    }

    pub fn call_verification_code(
        &self,
        offer: &CallBindingInput<'_>,
        offer_signature: &[u8],
        answer: &CallBindingInput<'_>,
        answer_signature: &[u8],
    ) -> Result<String, CallIdentityError> {
        if offer.role != CallBindingRole::Offer
            || answer.role != CallBindingRole::Answer
            || offer_signature.len() != SIGNATURE_LENGTH
            || answer_signature.len() != SIGNATURE_LENGTH
            || offer.conversation_id != answer.conversation_id
            || offer.call_id != answer.call_id
            || offer.caller_user_id != answer.caller_user_id
            || offer.caller_device_id != answer.caller_device_id
            || offer.callee_user_id != answer.callee_user_id
        {
            return Err(CallIdentityError::InvalidContext);
        }
        let offer_binding = canonical_binding(offer)?;
        let answer_binding = canonical_binding(answer)?;
        let mut value = Vec::with_capacity(
            CALL_CODE_LABEL.len()
                + offer_binding.len()
                + answer_binding.len()
                + offer_signature.len()
                + answer_signature.len(),
        );
        value.extend_from_slice(CALL_CODE_LABEL);
        value.extend_from_slice(&offer_binding);
        value.extend_from_slice(offer_signature);
        value.extend_from_slice(&answer_binding);
        value.extend_from_slice(answer_signature);
        let digest = self
            ._provider
            .crypto()
            .hash(CIPHERSUITE.hash_algorithm(), &value)
            .map_err(|_| CallIdentityError::CryptoUnavailable)?;
        let numeric = u64::from_be_bytes(
            digest[..8]
                .try_into()
                .map_err(|_| CallIdentityError::CryptoUnavailable)?,
        ) % 1_000_000_000_000;
        let digits = format!("{numeric:012}");
        Ok(format!(
            "{} {} {}",
            &digits[..4],
            &digits[4..8],
            &digits[8..12]
        ))
    }
}

fn canonical_binding(input: &CallBindingInput<'_>) -> Result<Vec<u8>, CallIdentityError> {
    let conversation = canonical_uuid(input.conversation_id)?;
    let call = canonical_uuid(input.call_id)?;
    let caller_user = canonical_uuid(input.caller_user_id)?;
    let caller_device = canonical_uuid(input.caller_device_id)?;
    let callee_user = canonical_uuid(input.callee_user_id)?;
    let callee_device = match (input.role, input.callee_device_id) {
        (CallBindingRole::Offer, None) => [0_u8; 16],
        (CallBindingRole::Answer, Some(value)) => *canonical_uuid(value)?.as_bytes(),
        _ => return Err(CallIdentityError::InvalidContext),
    };
    if caller_user == callee_user {
        return Err(CallIdentityError::InvalidContext);
    }
    let fingerprint = parse_dtls_fingerprint(input.sdp)?;
    let mut binding = Vec::with_capacity(CALL_BINDING_LABEL.len() + 1 + 6 * 16 + 32);
    binding.extend_from_slice(CALL_BINDING_LABEL);
    binding.push(input.role.byte());
    binding.extend_from_slice(conversation.as_bytes());
    binding.extend_from_slice(call.as_bytes());
    binding.extend_from_slice(caller_user.as_bytes());
    binding.extend_from_slice(caller_device.as_bytes());
    binding.extend_from_slice(callee_user.as_bytes());
    binding.extend_from_slice(&callee_device);
    binding.extend_from_slice(&fingerprint);
    Ok(binding)
}

fn parse_dtls_fingerprint(sdp: &str) -> Result<[u8; FINGERPRINT_LENGTH], CallIdentityError> {
    let mut found: Option<[u8; FINGERPRINT_LENGTH]> = None;
    for line in sdp.lines().map(|line| line.trim_end_matches('\r')) {
        let Some(encoded) = line.strip_prefix("a=fingerprint:sha-256 ") else {
            if line.starts_with("a=fingerprint:") {
                return Err(CallIdentityError::InvalidFingerprint);
            }
            continue;
        };
        let parts = encoded.split(':').collect::<Vec<_>>();
        if parts.len() != FINGERPRINT_LENGTH {
            return Err(CallIdentityError::InvalidFingerprint);
        }
        let mut fingerprint = [0_u8; FINGERPRINT_LENGTH];
        for (index, part) in parts.into_iter().enumerate() {
            if part.len() != 2 || !part.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(CallIdentityError::InvalidFingerprint);
            }
            fingerprint[index] =
                u8::from_str_radix(part, 16).map_err(|_| CallIdentityError::InvalidFingerprint)?;
        }
        if found.is_some_and(|existing| existing != fingerprint) {
            return Err(CallIdentityError::InvalidFingerprint);
        }
        found = Some(fingerprint);
    }
    found.ok_or(CallIdentityError::InvalidFingerprint)
}

fn canonical_uuid(value: &str) -> Result<Uuid, CallIdentityError> {
    let parsed = Uuid::parse_str(value).map_err(|_| CallIdentityError::InvalidContext)?;
    if parsed.hyphenated().to_string() != value {
        return Err(CallIdentityError::InvalidContext);
    }
    Ok(parsed)
}

fn encode_identity(user_id: &str, device_id: &str) -> Result<Vec<u8>, CallIdentityError> {
    encode_credential_identity(user_id, device_id)
        .map(|identity| identity.to_vec())
        .map_err(|error| match error {
            BootstrapError::InvalidUserId | BootstrapError::InvalidDeviceId => {
                CallIdentityError::InvalidContext
            }
            _ => CallIdentityError::CryptoUnavailable,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALICE_USER: &str = "1b0a32e8-144f-4f60-bcb6-112f71bd5316";
    const ALICE_DEVICE: &str = "50d6b08a-84ae-4bd7-829a-f40f38e9a2c1";
    const BOB_USER: &str = "abfef0af-10d0-4655-b4c7-84b3b418e4b7";
    const BOB_DEVICE: &str = "d44483ee-2c69-4eef-aeba-5ce92bc9181d";
    const OTHER_DEVICE: &str = "47782869-4399-4534-9202-ae53bed6a0fa";
    const CONVERSATION: &str = "f6a5941b-c417-4e50-a69c-9a30bd7ed28c";
    const CALL: &str = "538998bb-1943-4cf3-beb1-8b87cadf0fc1";
    const STALE_CALL: &str = "784ace60-fba9-445d-b1e4-df34d56ad053";
    const SDP_ONE: &str = "v=0\r\na=fingerprint:sha-256 00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F\r\n";
    const SDP_TWO: &str = "v=0\r\na=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10\r\n";

    fn pair() -> (DeviceBootstrap, DeviceBootstrap) {
        let mut alice = DeviceBootstrap::generate(ALICE_USER, ALICE_DEVICE).unwrap();
        let mut bob = DeviceBootstrap::generate(BOB_USER, BOB_DEVICE).unwrap();
        alice.create_conversation(CONVERSATION).unwrap();
        let added = alice
            .add_members_and_merge(CONVERSATION, &[bob.key_package().to_vec()])
            .unwrap();
        bob.join_conversation(CONVERSATION, &added.welcome, &added.ratchet_tree)
            .unwrap();
        (alice, bob)
    }

    fn offer<'a>(call_id: &'a str, sdp: &'a str) -> CallBindingInput<'a> {
        CallBindingInput {
            role: CallBindingRole::Offer,
            conversation_id: CONVERSATION,
            call_id,
            caller_user_id: ALICE_USER,
            caller_device_id: ALICE_DEVICE,
            callee_user_id: BOB_USER,
            callee_device_id: None,
            sdp,
        }
    }

    fn answer<'a>(sdp: &'a str) -> CallBindingInput<'a> {
        CallBindingInput {
            role: CallBindingRole::Answer,
            conversation_id: CONVERSATION,
            call_id: CALL,
            caller_user_id: ALICE_USER,
            caller_device_id: ALICE_DEVICE,
            callee_user_id: BOB_USER,
            callee_device_id: Some(BOB_DEVICE),
            sdp,
        }
    }

    #[test]
    fn both_devices_authenticate_bindings_and_derive_the_same_code() {
        let (alice, bob) = pair();
        let offer = offer(CALL, SDP_ONE);
        let offer_signature = alice.sign_call_binding(&offer).unwrap();
        bob.verify_call_binding(&offer, &offer_signature).unwrap();
        let answer = answer(SDP_TWO);
        let answer_signature = bob.sign_call_binding(&answer).unwrap();
        alice
            .verify_call_binding(&answer, &answer_signature)
            .unwrap();
        assert_eq!(
            alice
                .call_verification_code(&offer, &offer_signature, &answer, &answer_signature,)
                .unwrap(),
            bob.call_verification_code(&offer, &offer_signature, &answer, &answer_signature,)
                .unwrap(),
        );
    }

    #[test]
    fn modified_sdp_stale_call_and_wrong_device_fail_closed() {
        let (alice, bob) = pair();
        let signature = alice.sign_call_binding(&offer(CALL, SDP_ONE)).unwrap();
        assert_eq!(
            bob.verify_call_binding(&offer(CALL, SDP_TWO), &signature),
            Err(CallIdentityError::InvalidSignature),
        );
        assert_eq!(
            bob.verify_call_binding(&offer(STALE_CALL, SDP_ONE), &signature),
            Err(CallIdentityError::InvalidSignature),
        );
        let wrong_device = CallBindingInput {
            caller_device_id: OTHER_DEVICE,
            ..offer(CALL, SDP_ONE)
        };
        assert_eq!(
            bob.verify_call_binding(&wrong_device, &signature),
            Err(CallIdentityError::DeviceNotInGroup),
        );
    }

    #[test]
    fn ambiguous_or_non_sha256_fingerprint_is_rejected() {
        let bootstrap = DeviceBootstrap::generate(ALICE_USER, ALICE_DEVICE).unwrap();
        let conflicting = format!("{SDP_ONE}{}", &SDP_TWO[5..]);
        assert_eq!(
            bootstrap.sign_call_binding(&offer(CALL, &conflicting)),
            Err(CallIdentityError::InvalidFingerprint),
        );
        let sha1 = SDP_ONE.replace("sha-256", "sha-1");
        assert_eq!(
            bootstrap.sign_call_binding(&offer(CALL, &sha1)),
            Err(CallIdentityError::InvalidFingerprint),
        );
    }
}
