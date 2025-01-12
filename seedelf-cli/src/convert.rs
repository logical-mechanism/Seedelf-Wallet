use blstrs::Scalar;
use cryptoxide::ed25519;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use pallas_primitives::Hash;

pub fn scalar_to_secret_key(scalar: Scalar) -> SecretKey {
    let scalar_bytes = scalar.to_bytes_be();
    let (_, public) = ed25519::keypair(&scalar_bytes);
    SecretKey::from(public)
}

pub fn secret_key_to_private_key(scalar: Scalar) -> PrivateKey {
    let secret_key: SecretKey = scalar_to_secret_key(scalar);
    PrivateKey::from(secret_key)
}

pub fn secret_key_to_public_key(scalar: Scalar) -> String {
    let one_time_private_key: PrivateKey = secret_key_to_private_key(scalar);
    let public_key_hash: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    hex::encode(public_key_hash)
}
