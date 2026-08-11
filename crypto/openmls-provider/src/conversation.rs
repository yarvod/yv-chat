//! MLS conversation state owned by one device bootstrap.
//!
//! The delivery service only receives the opaque outputs of this module. Group
//! secrets, sender ratchets and application plaintext remain in this crate and
//! are persisted only as part of the sealed provider snapshot.

use openmls::{
    key_packages::{KeyPackage, KeyPackageIn},
    prelude::{
        GroupId, MlsGroup, MlsGroupJoinConfig, MlsMessageBodyIn, MlsMessageIn,
        ProcessedMessageContent, ProtocolVersion, RatchetTreeIn, StagedWelcome,
        PURE_CIPHERTEXT_WIRE_FORMAT_POLICY,
    },
};
use openmls_traits::OpenMlsProvider;
use thiserror::Error;
use tls_codec::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{DeviceBootstrap, CIPHERSUITE};

const APPLICATION_AAD_LABEL: &[u8] = b"yv-chat-mls-v2\0";
const MAX_WIRE_BYTES: usize = 1024 * 1024;
const MAX_APPLICATION_BYTES: usize = 256 * 1024;
const MAX_ADD_MEMBERS: usize = 49;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversationError {
    #[error("invalid conversation identifier")]
    InvalidConversationId,
    #[error("invalid client message identifier")]
    InvalidMessageId,
    #[error("MLS group already exists")]
    GroupAlreadyExists,
    #[error("MLS group is not available")]
    GroupNotFound,
    #[error("invalid MLS key package")]
    InvalidKeyPackage,
    #[error("invalid MLS welcome")]
    InvalidWelcome,
    #[error("invalid MLS ratchet tree")]
    InvalidRatchetTree,
    #[error("MLS group membership update failed")]
    MembershipUpdateFailed,
    #[error("MLS group state persistence failed")]
    StorageUnavailable,
    #[error("MLS wire message serialization failed")]
    SerializationFailed,
    #[error("MLS application message is invalid")]
    InvalidApplicationMessage,
    #[error("MLS application message AAD does not match server routing")]
    AadMismatch,
    #[error("MLS application payload is too large")]
    PayloadTooLarge,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AddMembersOutput {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
    pub ratchet_tree: Vec<u8>,
    pub epoch: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ProtectedApplicationMessage {
    pub ciphertext: Vec<u8>,
    pub epoch: u64,
}

impl DeviceBootstrap {
    pub fn create_conversation(&mut self, conversation_id: &str) -> Result<u64, ConversationError> {
        let group_id = canonical_group_id(conversation_id)?;
        if MlsGroup::load(self._provider.storage(), &group_id)
            .map_err(|_| ConversationError::StorageUnavailable)?
            .is_some()
        {
            return Err(ConversationError::GroupAlreadyExists);
        }
        let group = MlsGroup::builder()
            .with_group_id(group_id)
            .ciphersuite(CIPHERSUITE)
            .with_wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
            .build(&self._provider, &self.signer, self.credential.clone())
            .map_err(|_| ConversationError::StorageUnavailable)?;
        Ok(group.epoch().as_u64())
    }

    /// Add members and atomically advance the creator's local epoch.
    ///
    /// The caller must durably route the returned Commit/Welcome before
    /// advertising the generation as ready. Any outer persistence failure must
    /// discard this in-memory value instead of checkpointing it.
    pub fn add_members_and_merge(
        &mut self,
        conversation_id: &str,
        serialized_key_packages: &[Vec<u8>],
    ) -> Result<AddMembersOutput, ConversationError> {
        if serialized_key_packages.is_empty() || serialized_key_packages.len() > MAX_ADD_MEMBERS {
            return Err(ConversationError::InvalidKeyPackage);
        }
        let mut group = self.load_group(conversation_id)?;
        let key_packages = serialized_key_packages
            .iter()
            .map(|serialized| parse_key_package(&self._provider, serialized))
            .collect::<Result<Vec<_>, _>>()?;
        let (commit, welcome, _) = group
            .add_members(&self._provider, &self.signer, &key_packages)
            .map_err(|_| ConversationError::MembershipUpdateFailed)?;
        let commit = commit
            .tls_serialize_detached()
            .map_err(|_| ConversationError::SerializationFailed)?;
        let welcome = welcome
            .tls_serialize_detached()
            .map_err(|_| ConversationError::SerializationFailed)?;
        group
            .merge_pending_commit(&self._provider)
            .map_err(|_| ConversationError::MembershipUpdateFailed)?;
        let ratchet_tree = group
            .export_ratchet_tree()
            .tls_serialize_detached()
            .map_err(|_| ConversationError::SerializationFailed)?;
        Ok(AddMembersOutput {
            commit,
            welcome,
            ratchet_tree,
            epoch: group.epoch().as_u64(),
        })
    }

    pub fn join_conversation(
        &mut self,
        conversation_id: &str,
        serialized_welcome: &[u8],
        serialized_ratchet_tree: &[u8],
    ) -> Result<u64, ConversationError> {
        let expected_group_id = canonical_group_id(conversation_id)?;
        if MlsGroup::load(self._provider.storage(), &expected_group_id)
            .map_err(|_| ConversationError::StorageUnavailable)?
            .is_some()
        {
            return Err(ConversationError::GroupAlreadyExists);
        }
        let welcome_message = parse_message(serialized_welcome, ConversationError::InvalidWelcome)?;
        let welcome = match welcome_message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(ConversationError::InvalidWelcome),
        };
        let ratchet_tree = parse_ratchet_tree(serialized_ratchet_tree)?;
        let join_config = MlsGroupJoinConfig::builder()
            .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
            .build();
        let group = StagedWelcome::new_from_welcome(
            &self._provider,
            &join_config,
            welcome,
            Some(ratchet_tree),
        )
        .map_err(|_| ConversationError::InvalidWelcome)?
        .into_group(&self._provider)
        .map_err(|_| ConversationError::InvalidWelcome)?;
        if group.group_id() != &expected_group_id || group.ciphersuite() != CIPHERSUITE {
            return Err(ConversationError::InvalidWelcome);
        }
        Ok(group.epoch().as_u64())
    }

    pub fn protect_application_message(
        &mut self,
        conversation_id: &str,
        client_message_id: &str,
        plaintext: &[u8],
    ) -> Result<ProtectedApplicationMessage, ConversationError> {
        if plaintext.is_empty() || plaintext.len() > MAX_APPLICATION_BYTES {
            return Err(ConversationError::PayloadTooLarge);
        }
        let mut group = self.load_group(conversation_id)?;
        group.set_aad(application_aad(conversation_id, client_message_id)?);
        let epoch = group.epoch().as_u64();
        let ciphertext = group
            .create_message(&self._provider, &self.signer, plaintext)
            .map_err(|_| ConversationError::InvalidApplicationMessage)?
            .tls_serialize_detached()
            .map_err(|_| ConversationError::SerializationFailed)?;
        Ok(ProtectedApplicationMessage { ciphertext, epoch })
    }

    pub fn unprotect_application_message(
        &mut self,
        conversation_id: &str,
        client_message_id: &str,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, ConversationError> {
        let expected_aad = application_aad(conversation_id, client_message_id)?;
        let mut group = self.load_group(conversation_id)?;
        let message = parse_message(ciphertext, ConversationError::InvalidApplicationMessage)?
            .try_into_protocol_message()
            .map_err(|_| ConversationError::InvalidApplicationMessage)?;
        let processed = group
            .process_message(&self._provider, message)
            .map_err(|_| ConversationError::InvalidApplicationMessage)?;
        if processed.aad() != expected_aad {
            return Err(ConversationError::AadMismatch);
        }
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err(ConversationError::InvalidApplicationMessage),
        }
    }

    fn load_group(&self, conversation_id: &str) -> Result<MlsGroup, ConversationError> {
        let group_id = canonical_group_id(conversation_id)?;
        MlsGroup::load(self._provider.storage(), &group_id)
            .map_err(|_| ConversationError::StorageUnavailable)?
            .ok_or(ConversationError::GroupNotFound)
    }
}

fn canonical_uuid(value: &str, error: ConversationError) -> Result<Uuid, ConversationError> {
    let parsed = Uuid::parse_str(value).map_err(|_| error)?;
    if parsed.hyphenated().to_string() != value {
        return Err(error);
    }
    Ok(parsed)
}

fn canonical_group_id(conversation_id: &str) -> Result<GroupId, ConversationError> {
    let id = canonical_uuid(conversation_id, ConversationError::InvalidConversationId)?;
    Ok(GroupId::from_slice(id.as_bytes()))
}

fn application_aad(
    conversation_id: &str,
    client_message_id: &str,
) -> Result<Vec<u8>, ConversationError> {
    let conversation = canonical_uuid(conversation_id, ConversationError::InvalidConversationId)?;
    let message = canonical_uuid(client_message_id, ConversationError::InvalidMessageId)?;
    let mut aad = Vec::with_capacity(APPLICATION_AAD_LABEL.len() + 32);
    aad.extend_from_slice(APPLICATION_AAD_LABEL);
    aad.extend_from_slice(conversation.as_bytes());
    aad.extend_from_slice(message.as_bytes());
    Ok(aad)
}

fn parse_key_package(
    provider: &impl OpenMlsProvider,
    serialized: &[u8],
) -> Result<KeyPackage, ConversationError> {
    if serialized.is_empty() || serialized.len() > MAX_WIRE_BYTES {
        return Err(ConversationError::InvalidKeyPackage);
    }
    let mut input = serialized;
    let package = KeyPackageIn::tls_deserialize(&mut input)
        .map_err(|_| ConversationError::InvalidKeyPackage)?
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .map_err(|_| ConversationError::InvalidKeyPackage)?;
    if !input.is_empty() || package.ciphersuite() != CIPHERSUITE {
        return Err(ConversationError::InvalidKeyPackage);
    }
    Ok(package)
}

fn parse_message(
    serialized: &[u8],
    error: ConversationError,
) -> Result<MlsMessageIn, ConversationError> {
    if serialized.is_empty() || serialized.len() > MAX_WIRE_BYTES {
        return Err(error);
    }
    let mut input = serialized;
    let message = MlsMessageIn::tls_deserialize(&mut input).map_err(|_| error)?;
    if !input.is_empty() {
        return Err(error);
    }
    Ok(message)
}

fn parse_ratchet_tree(serialized: &[u8]) -> Result<RatchetTreeIn, ConversationError> {
    if serialized.is_empty() || serialized.len() > MAX_WIRE_BYTES {
        return Err(ConversationError::InvalidRatchetTree);
    }
    let mut input = serialized;
    let tree = RatchetTreeIn::tls_deserialize(&mut input)
        .map_err(|_| ConversationError::InvalidRatchetTree)?;
    if !input.is_empty() {
        return Err(ConversationError::InvalidRatchetTree);
    }
    Ok(tree)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALICE_USER: &str = "1b0a32e8-144f-4f60-bcb6-112f71bd5316";
    const ALICE_DEVICE: &str = "50d6b08a-84ae-4bd7-829a-f40f38e9a2c1";
    const BOB_USER: &str = "abfef0af-10d0-4655-b4c7-84b3b418e4b7";
    const BOB_DEVICE: &str = "d44483ee-2c69-4eef-aeba-5ce92bc9181d";
    const CONVERSATION: &str = "f6a5941b-c417-4e50-a69c-9a30bd7ed28c";
    const MESSAGE_ONE: &str = "538998bb-1943-4cf3-beb1-8b87cadf0fc1";
    const MESSAGE_TWO: &str = "784ace60-fba9-445d-b1e4-df34d56ad053";

    fn joined_pair() -> (DeviceBootstrap, DeviceBootstrap) {
        let mut alice = DeviceBootstrap::generate(ALICE_USER, ALICE_DEVICE).unwrap();
        let mut bob = DeviceBootstrap::generate(BOB_USER, BOB_DEVICE).unwrap();
        assert_eq!(alice.create_conversation(CONVERSATION).unwrap(), 0);
        let added = alice
            .add_members_and_merge(CONVERSATION, &[bob.key_package().to_vec()])
            .unwrap();
        assert_eq!(added.epoch, 1);
        assert!(!added.commit.is_empty());
        assert_eq!(
            bob.join_conversation(CONVERSATION, &added.welcome, &added.ratchet_tree)
                .unwrap(),
            1,
        );
        (alice, bob)
    }

    #[test]
    fn alice_and_bob_exchange_ciphertext_with_exact_outer_aad() {
        let (mut alice, mut bob) = joined_pair();
        let protected = alice
            .protect_application_message(CONVERSATION, MESSAGE_ONE, b"hello bob")
            .unwrap();
        assert_eq!(protected.epoch, 1);
        assert!(!protected
            .ciphertext
            .windows(9)
            .any(|part| part == b"hello bob"));
        assert_eq!(
            bob.unprotect_application_message(CONVERSATION, MESSAGE_ONE, &protected.ciphertext,)
                .unwrap(),
            b"hello bob",
        );
    }

    #[test]
    fn wrong_message_routing_aad_fails_closed() {
        let (mut alice, mut bob) = joined_pair();
        let protected = alice
            .protect_application_message(CONVERSATION, MESSAGE_ONE, b"bound payload")
            .unwrap();
        assert_eq!(
            bob.unprotect_application_message(CONVERSATION, MESSAGE_TWO, &protected.ciphertext,),
            Err(ConversationError::AadMismatch),
        );
    }

    #[test]
    fn sealed_snapshot_restores_group_and_sender_ratchet_state() {
        let (mut alice, bob) = joined_pair();
        let first = alice
            .protect_application_message(CONVERSATION, MESSAGE_ONE, b"first")
            .unwrap();
        let alice_snapshot = alice.snapshot_for_sealing(9).unwrap();
        let bob_snapshot = bob.snapshot_for_sealing(4).unwrap();
        let (mut restored_alice, alice_revision) = DeviceBootstrap::restore_from_unsealed_snapshot(
            &alice_snapshot,
            ALICE_USER,
            ALICE_DEVICE,
        )
        .unwrap();
        let (mut restored_bob, bob_revision) =
            DeviceBootstrap::restore_from_unsealed_snapshot(&bob_snapshot, BOB_USER, BOB_DEVICE)
                .unwrap();
        assert_eq!((alice_revision, bob_revision), (9, 4));
        assert_eq!(
            restored_bob
                .unprotect_application_message(CONVERSATION, MESSAGE_ONE, &first.ciphertext)
                .unwrap(),
            b"first",
        );
        let second = restored_alice
            .protect_application_message(CONVERSATION, MESSAGE_TWO, b"after restore")
            .unwrap();
        assert_eq!(
            restored_bob
                .unprotect_application_message(CONVERSATION, MESSAGE_TWO, &second.ciphertext)
                .unwrap(),
            b"after restore",
        );
        let bob_after_receive = restored_bob.snapshot_for_sealing(5).unwrap();
        let (mut twice_restored_bob, revision) = DeviceBootstrap::restore_from_unsealed_snapshot(
            &bob_after_receive,
            BOB_USER,
            BOB_DEVICE,
        )
        .unwrap();
        assert_eq!(revision, 5);
        assert_eq!(
            twice_restored_bob.unprotect_application_message(
                CONVERSATION,
                MESSAGE_TWO,
                &second.ciphertext,
            ),
            Err(ConversationError::InvalidApplicationMessage),
        );
    }

    #[test]
    fn rejects_trailing_or_wrong_group_welcome_data() {
        let mut alice = DeviceBootstrap::generate(ALICE_USER, ALICE_DEVICE).unwrap();
        let mut bob = DeviceBootstrap::generate(BOB_USER, BOB_DEVICE).unwrap();
        alice.create_conversation(CONVERSATION).unwrap();
        let added = alice
            .add_members_and_merge(CONVERSATION, &[bob.key_package().to_vec()])
            .unwrap();
        let mut trailing = added.welcome.clone();
        trailing.push(0);
        assert_eq!(
            bob.join_conversation(CONVERSATION, &trailing, &added.ratchet_tree),
            Err(ConversationError::InvalidWelcome),
        );
        assert_eq!(
            bob.join_conversation(MESSAGE_ONE, &added.welcome, &added.ratchet_tree),
            Err(ConversationError::InvalidWelcome),
        );
    }
}
