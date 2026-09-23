use blstrs::Scalar;
use cryptoxide::ed25519;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::Hash;
use pallas_wallet::PrivateKey;

/// Derive an Ed25519 SecretKey deterministically from a BLS scalar.
///
/// Note: this is a load-bearing derivation — the public key it produces is
/// used as the disclosed signer / one-time pkh that the on-chain Schnorr
/// proof binds to. Changing it would invalidate every existing wallet.
///
/// The derivation chain is, intentionally, *not* the obvious "use the
/// scalar bytes as the ed25519 seed". Instead:
///   1. Feed the BLS scalar's 32 big-endian bytes to `cryptoxide::ed25519::keypair`.
///   2. Discard the resulting extended-secret half and take the public-key
///      bytes (32 bytes).
///   3. Treat those 32 bytes as the seed for `pallas`'s `SecretKey`.
///
/// Step 2 is what the historical comment in this file ("discards the secret
/// half") observed. The behaviour is locked in by the pinned-vector test in
/// `tests/convert_test.rs`; any future refactor must preserve it.
fn scalar_to_secret_key(scalar: Scalar) -> SecretKey {
    let scalar_bytes: [u8; 32] = scalar.to_bytes_be();
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
