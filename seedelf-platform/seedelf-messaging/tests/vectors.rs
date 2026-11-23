//! The recorded vectors (tests/vectors/messaging_v1.json), read back through
//! the public API alone, as another implementation's reader would. The unit
//! test `test_vectors_match_the_file` holds the encryption side to them.

use serde_json::Value;
use sha2::{Digest, Sha256};

use seedelf_messaging::{
    Envelope, HEADER_LEN, Register, SecretKey, decrypt_message, matches_envelope, matches_register,
};

fn bytes(vector: &Value, field: &str) -> Vec<u8> {
    hex::decode(vector[field].as_str().unwrap()).unwrap()
}

fn point(hex_str: &Value) -> [u8; 48] {
    hex::decode(hex_str.as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap()
}

fn register(value: &Value) -> Register {
    Register::from_bytes(&point(&value["generator"]), &point(&value["public_value"])).unwrap()
}

#[test]
fn every_vector_decrypts_through_the_public_api() {
    let file: Value = serde_json::from_str(include_str!("vectors/messaging_v1.json")).unwrap();
    assert_eq!(file["version"], 1);
    let tag_label = file["tag_label"].as_str().unwrap();
    assert_eq!(tag_label, "Seedelf-Messaging|v1|envelope|tag");
    let vectors = file["vectors"].as_array().unwrap();
    assert!(vectors.len() >= 4);
    for vector in vectors {
        let key = SecretKey::from_bytes(&bytes(vector, "secret_key").try_into().unwrap()).unwrap();
        assert!(matches_register(&key, &register(&vector["root_register"])));

        let envelope_bytes = bytes(vector, "envelope");
        assert_eq!(&envelope_bytes[..HEADER_LEN], &bytes(vector, "header")[..]);
        let envelope = Envelope::from_bytes(&envelope_bytes).unwrap();
        assert_eq!(envelope.to_bytes(), envelope_bytes);

        // The header is 0x01 ‖ p ‖ tag ‖ c: p and w are the re-randomized
        // register's, and only w's tag is in the envelope.
        let rerandomized = register(&vector["rerandomized_register"]);
        assert!(matches_register(&key, &rerandomized));
        assert_eq!(envelope_bytes[0], 1);
        assert_eq!(&envelope_bytes[1..49], &rerandomized.generator_bytes()[..]);
        let tag: [u8; 32] = Sha256::new()
            .chain_update(tag_label.as_bytes())
            .chain_update(rerandomized.public_value_bytes())
            .finalize()
            .into();
        assert_eq!(&envelope_bytes[49..81], &tag[..]);
        assert_eq!(&envelope_bytes[49..81], &bytes(vector, "tag")[..]);
        assert_eq!(
            &envelope_bytes[81..HEADER_LEN],
            &point(&vector["ephemeral"])[..]
        );
        let w = rerandomized.public_value_bytes();
        assert!(!envelope_bytes.windows(48).any(|window| window == w));

        assert!(matches_envelope(&key, &envelope_bytes).unwrap());
        assert!(envelope.is_for(&key));
        assert_eq!(
            decrypt_message(&key, &envelope).unwrap(),
            bytes(vector, "plaintext")
        );
    }
}
