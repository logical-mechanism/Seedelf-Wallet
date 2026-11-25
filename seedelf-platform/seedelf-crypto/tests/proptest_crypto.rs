//! Property tests for the Schnorr / Register protocol core.
//!
//! The headline invariant: re-randomization applies the *same* scalar to both
//! points, so a register stays owned by its secret across re-randomization.
//! Get that wrong — `(g^d, u^d')` with `d != d'` — and the UTxO is permanently
//! locked. The example-based tests pin specific vectors; these check the
//! invariants hold for arbitrary scalars.

use blstrs::{G1Affine, G1Projective, Scalar};
use proptest::prelude::*;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, fiat_shamir_heuristic, prove};

/// A valid 28-byte (blake2b-224-shaped) key hash for the Fiat-Shamir challenge.
const VKH: &str = "00112233445566778899aabbccddeeff00112233445566778899aabb";

/// A proof for `register` built by hand, as the prover builds one but with a
/// nonce `r` and a key the test chooses: the response `z = r + c·key` and the
/// commitment `T = [r]g`, both hex, in `create_proof`'s order. The challenge
/// `c` comes from the crate's own `fiat_shamir_heuristic`, blake2b-224 over
/// the raw bytes of `g ‖ T ‖ u ‖ vkh` read as a big-endian scalar, which
/// `create_proof` and `prove` both call: this can't drift from them.
/// `create_proof` itself makes no proof with a key that doesn't own the
/// register.
fn proof_by_hand(register: &Register, r: Scalar, key: Scalar, vkh: &str) -> (String, String) {
    let g_bytes: [u8; 48] = hex::decode(&register.generator)
        .unwrap()
        .try_into()
        .unwrap();
    let g = G1Projective::from(G1Affine::from_compressed(&g_bytes).unwrap());
    let t = hex::encode((g * r).to_compressed());
    let c_hex = fiat_shamir_heuristic(
        register.generator.clone(),
        t.clone(),
        register.public_value.clone(),
        vkh.to_string(),
    )
    .unwrap();
    let mut c_bytes = [0u8; 32];
    c_bytes[4..].copy_from_slice(&hex::decode(c_hex).unwrap());
    let c = Scalar::from_bytes_be(&c_bytes).unwrap();
    (hex::encode((r + c * key).to_bytes_be()), t)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    /// A register created from `sk` is owned by `sk`. Zero is left out: its
    /// public value is the identity, which no key owns.
    #[test]
    fn register_is_owned_by_its_scalar(sk in 1..=u64::MAX) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap();
        prop_assert!(register.is_owned(scalar).unwrap());
    }

    /// A register is not owned by any other scalar.
    #[test]
    fn register_not_owned_by_other_scalar(a in any::<u64>(), b in any::<u64>()) {
        prop_assume!(a != b);
        let register = Register::create(Scalar::from(a)).unwrap();
        prop_assert!(!register.is_owned(Scalar::from(b)).unwrap());
    }

    /// Re-randomization preserves ownership: `(g^d, u^d)` is still spendable by
    /// the original `sk`. This is the load-bearing same-scalar invariant.
    #[test]
    fn rerandomized_register_stays_owned_and_valid(sk in 1..=u64::MAX) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap().rerandomize().unwrap();
        prop_assert!(register.is_owned(scalar).unwrap());
        prop_assert!(register.is_valid().unwrap());
    }

    /// A proof produced for `sk` verifies against `sk`'s register. Zero is
    /// left out, as above: no key owns its register, so no proof is made.
    #[test]
    fn schnorr_proof_round_trips(sk in 1..=u64::MAX) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap();
        let (z, g_r) = create_proof(register.clone(), scalar, VKH.to_string()).unwrap();
        prop_assert!(
            prove(&register.generator, &register.public_value, &z, &g_r, VKH).unwrap()
        );
    }

    /// A re-randomized register is still spendable via a fresh proof.
    #[test]
    fn schnorr_proof_round_trips_after_rerandomize(sk in 1..=u64::MAX) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap().rerandomize().unwrap();
        let (z, g_r) = create_proof(register.clone(), scalar, VKH.to_string()).unwrap();
        prop_assert!(
            prove(&register.generator, &register.public_value, &z, &g_r, VKH).unwrap()
        );
    }

    /// No proof is made with a scalar that doesn't own the register: its
    /// response would hand out [scalar]·g (docs: seedelf-messaging's
    /// joint-security.md, rule 1). The owner's proof, checked as the
    /// validator checks it with that register, still verifies.
    #[test]
    fn schnorr_proof_refuses_a_register_the_scalar_doesnt_own(
        owner in 1..=u64::MAX,
        other in any::<u64>(),
    ) {
        prop_assume!(owner != other);
        let register = Register::create(Scalar::from(owner)).unwrap();
        prop_assert!(
            create_proof(register.clone(), Scalar::from(other), VKH.to_string()).is_err()
        );
        let (z, g_r) =
            create_proof(register.clone(), Scalar::from(owner), VKH.to_string()).unwrap();
        prop_assert!(prove(&register.generator, &register.public_value, &z, &g_r, VKH).unwrap());
    }

    /// The verifier refuses a well-formed proof made with another scalar.
    /// `create_proof` makes none, so the proof is built by hand
    /// (`proof_by_hand`): for a re-randomized register of `owner`, a nonce
    /// and a one-time key hash, the response z′ = r + c·other doesn't
    /// verify, and the same with `owner` does. Nor does the owner's proof
    /// verify under another key hash, or against another register of the
    /// same key, `([d]g, [d]u)`, with the same T and z.
    #[test]
    fn schnorr_verifier_rejects_a_proof_made_with_another_scalar(
        owner in 1..=u64::MAX,
        other in any::<u64>(),
        nonce in 1..=u64::MAX,
        vkh in any::<[u8; 28]>(),
        other_vkh in any::<[u8; 28]>(),
    ) {
        prop_assume!(owner != other && vkh != other_vkh);
        let (owner, other, nonce) = (Scalar::from(owner), Scalar::from(other), Scalar::from(nonce));
        let (vkh, other_vkh) = (hex::encode(vkh), hex::encode(other_vkh));
        let register = Register::create(owner).unwrap().rerandomize().unwrap();
        let verifies = |register: &Register, (z, t): &(String, String), vkh: &str| {
            prove(&register.generator, &register.public_value, z, t, vkh).unwrap()
        };

        // The owner's proof verifies; the same nonce with another scalar doesn't.
        let proof = proof_by_hand(&register, nonce, owner, &vkh);
        prop_assert!(verifies(&register, &proof, &vkh));
        let forged = proof_by_hand(&register, nonce, other, &vkh);
        prop_assert!(!verifies(&register, &forged, &vkh));

        // The owner's proof under another key hash, and against another
        // register of the same key.
        prop_assert!(!verifies(&register, &proof, &other_vkh));
        let again = register.clone().rerandomize().unwrap();
        prop_assert!(again.is_owned(owner).unwrap());
        prop_assert!(!verifies(&again, &proof, &vkh));
    }
}
