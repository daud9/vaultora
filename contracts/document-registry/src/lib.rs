#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};

/// The immutable data recorded for a document registration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentRecord {
    pub owner: Address,
    pub document_fingerprint: BytesN<32>,
    pub metadata_fingerprint: BytesN<32>,
    pub registered_at: u64,
}

/// Namespaces every record by both its owner and document fingerprint.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Document(Address, BytesN<32>),
}

/// Errors returned by the document registry.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ContractError {
    /// This owner has already registered this document fingerprint.
    DocumentAlreadyRegistered = 1,
}

/// Emitted on successful registration. Both fields are indexed topics; no
/// metadata hash or potentially sensitive off-chain content is included.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentRegistered {
    #[topic]
    pub owner: Address,
    #[topic]
    pub document_fingerprint: BytesN<32>,
}

#[contract]
pub struct DocumentRegistry;

#[contractimpl]
impl DocumentRegistry {
    /// Register a document fingerprint and the fingerprint of its encrypted
    /// metadata. `owner` is the asserted identity and must authorize this
    /// invocation; Soroban does not supply an implicit transaction sender.
    pub fn register_document(
        env: Env,
        document_fingerprint: BytesN<32>,
        metadata_fingerprint: BytesN<32>,
        owner: Address,
    ) -> Result<(), ContractError> {
        owner.require_auth();

        let key = DataKey::Document(owner.clone(), document_fingerprint.clone());
        let storage = env.storage().persistent();
        if storage.has(&key) {
            return Err(ContractError::DocumentAlreadyRegistered);
        }

        let record = DocumentRecord {
            owner: owner.clone(),
            document_fingerprint: document_fingerprint.clone(),
            metadata_fingerprint,
            registered_at: env.ledger().timestamp(),
        };
        storage.set(&key, &record);
        let max_ttl = env.storage().max_ttl();
        storage.extend_ttl(&key, max_ttl, max_ttl);

        DocumentRegistered {
            owner,
            document_fingerprint,
        }
        .publish(&env);

        Ok(())
    }

    /// Return whether a document fingerprint is registered for `owner`.
    pub fn document_exists(env: Env, owner: Address, document_fingerprint: BytesN<32>) -> bool {
        let key = DataKey::Document(owner, document_fingerprint);
        env.storage().persistent().has(&key)
    }

    /// Verify that a record exists for this owner and fingerprint.
    pub fn verify_document(env: Env, owner: Address, document_fingerprint: BytesN<32>) -> bool {
        Self::get_document_record(env, owner, document_fingerprint).is_some()
    }

    /// Return the stored record, if the owner/fingerprint pair is registered.
    pub fn get_document_record(
        env: Env,
        owner: Address,
        document_fingerprint: BytesN<32>,
    ) -> Option<DocumentRecord> {
        let key = DataKey::Document(owner, document_fingerprint);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::{ContractError, DocumentRecord, DocumentRegistry, DocumentRegistryClient};
    use soroban_sdk::{
        testutils::{storage::Persistent as _, Address as _},
        Address, BytesN, Env,
    };

    fn fingerprint(env: &Env, seed: u8) -> BytesN<32> {
        let mut bytes = [0_u8; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = seed.wrapping_add(index as u8);
        }
        BytesN::from_array(env, &bytes)
    }

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(DocumentRegistry, ());
        (env, contract_id)
    }

    #[test]
    fn register_verify_and_retrieve_record() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let document = fingerprint(&env, 1);
        let metadata = fingerprint(&env, 90);

        client.register_document(&document, &metadata, &owner);

        assert!(client.document_exists(&owner, &document));
        assert!(client.verify_document(&owner, &document));
        let record = client
            .get_document_record(&owner, &document)
            .expect("registered record must be returned");
        assert_eq!(
            record,
            DocumentRecord {
                owner,
                document_fingerprint: document,
                metadata_fingerprint: metadata,
                registered_at: env.ledger().timestamp(),
            }
        );
    }

    #[test]
    fn duplicate_registration_returns_explicit_error() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let document = fingerprint(&env, 2);
        let metadata = fingerprint(&env, 91);
        client.register_document(&document, &metadata, &owner);

        assert_eq!(
            client.try_register_document(&document, &metadata, &owner),
            Err(Ok(ContractError::DocumentAlreadyRegistered))
        );
    }

    #[test]
    fn registration_without_owner_authentication_fails() {
        let env = Env::default();
        let contract_id = env.register(DocumentRegistry, ());
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);

        assert!(client
            .try_register_document(&fingerprint(&env, 3), &fingerprint(&env, 92), &owner)
            .is_err());
    }

    #[test]
    fn registration_authorizes_owner_and_extends_persistent_ttl() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let document = fingerprint(&env, 30);
        let metadata = fingerprint(&env, 120);
        let key = super::DataKey::Document(owner.clone(), document.clone());

        client.register_document(&document, &metadata, &owner);

        let auths = env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, owner);
        let expected_ttl = env.storage().max_ttl();
        let actual_ttl = env.as_contract(&contract_id, || env.storage().persistent().get_ttl(&key));
        assert_eq!(actual_ttl, expected_ttl);
    }

    #[test]
    fn unknown_fingerprint_is_false_and_has_no_record() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let unknown = fingerprint(&env, 4);

        assert!(!client.document_exists(&owner, &unknown));
        assert!(!client.verify_document(&owner, &unknown));
        assert_eq!(client.get_document_record(&owner, &unknown), None);
    }

    #[test]
    fn identical_fingerprint_is_independent_per_owner() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let first_owner = Address::generate(&env);
        let second_owner = Address::generate(&env);
        let document = fingerprint(&env, 5);
        let metadata = fingerprint(&env, 93);

        client.register_document(&document, &metadata, &first_owner);
        client.register_document(&document, &metadata, &second_owner);

        assert!(client.verify_document(&first_owner, &document));
        assert!(client.verify_document(&second_owner, &document));
        assert_eq!(
            client
                .get_document_record(&second_owner, &document)
                .unwrap()
                .owner,
            second_owner
        );
    }

    #[test]
    fn different_documents_can_be_registered_by_the_same_owner() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let first_document = fingerprint(&env, 6);
        let second_document = fingerprint(&env, 7);
        let metadata = fingerprint(&env, 94);

        client.register_document(&first_document, &metadata, &owner);
        client.register_document(&second_document, &metadata, &owner);

        assert!(client.verify_document(&owner, &first_document));
        assert!(client.verify_document(&owner, &second_document));
    }

    #[test]
    fn metadata_fingerprint_is_persisted() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let document = fingerprint(&env, 8);
        let metadata = fingerprint(&env, 95);

        client.register_document(&document, &metadata, &owner);

        assert_eq!(
            client
                .get_document_record(&owner, &document)
                .unwrap()
                .metadata_fingerprint,
            metadata
        );
    }

    #[test]
    fn registration_timestamp_matches_ledger_timestamp() {
        let (env, contract_id) = setup();
        let client = DocumentRegistryClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let document = fingerprint(&env, 9);
        let metadata = fingerprint(&env, 96);
        let expected_timestamp = env.ledger().timestamp();

        client.register_document(&document, &metadata, &owner);

        assert_eq!(
            client
                .get_document_record(&owner, &document)
                .unwrap()
                .registered_at,
            expected_timestamp
        );
    }
}
