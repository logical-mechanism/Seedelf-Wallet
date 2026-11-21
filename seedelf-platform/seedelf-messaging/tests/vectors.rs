//! The recorded vectors (tests/vectors/messaging_v1.json), read back through
//! the public API alone, as another implementation's reader would. The unit
//! test `test_vectors_match_the_file` holds the encryption side to them.

use serde_json::Value;

use seedelf_messaging::{
    Envelope, HEADER_LEN, Register, SecretKey, decrypt_message, matches_register,
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
    let vectors = file["vectors"].as_array().unwrap();
    assert!(vectors.len() >= 4);
    for vector in vectors {
        let key = SecretKey::from_bytes(&bytes(vector, "secret_key").try_into().unwrap()).unwrap();
        assert!(matches_register(&key, &register(&vector["root_register"])));

        let envelope_bytes = bytes(vector, "envelope");
        assert_eq!(&envelope_bytes[..HEADER_LEN], &bytes(vector, "header")[..]);
        let envelope = Envelope::from_bytes(&envelope_bytes).unwrap();
        assert_eq!(envelope.to_bytes(), envelope_bytes);
        assert_eq!(
            *envelope.register(),
            register(&vector["rerandomized_register"])
        );
        assert_eq!(
            &envelope_bytes[1 + 96..HEADER_LEN],
            &point(&vector["ephemeral"])[..]
        );

        assert!(envelope.is_for(&key));
        assert_eq!(
            decrypt_message(&key, &envelope).unwrap(),
            bytes(vector, "plaintext")
        );
    }
}
