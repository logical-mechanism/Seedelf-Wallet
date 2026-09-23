//! Property tests for the Schnorr / Register protocol core.
//!
//! The headline invariant: re-randomization applies the *same* scalar to both
//! points, so a register stays owned by its secret across re-randomization.
//! Get that wrong — `(g^d, u^d')` with `d != d'` — and the UTxO is permanently
//! locked. The example-based tests pin specific vectors; these check the
//! invariants hold for arbitrary scalars.

use blstrs::Scalar;
use proptest::prelude::*;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, prove};

/// A valid 28-byte (blake2b-224-shaped) key hash for the Fiat-Shamir challenge.
const VKH: &str = "00112233445566778899aabbccddeeff00112233445566778899aabb";

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    /// A register created from `sk` is owned by `sk`.
    #[test]
    fn register_is_owned_by_its_scalar(sk in any::<u64>()) {
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
    fn rerandomized_register_stays_owned_and_valid(sk in any::<u64>()) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap().rerandomize().unwrap();
        prop_assert!(register.is_owned(scalar).unwrap());
        prop_assert!(register.is_valid().unwrap());
    }

    /// A proof produced for `sk` verifies against `sk`'s register.
    #[test]
    fn schnorr_proof_round_trips(sk in any::<u64>()) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap();
        let (z, g_r) = create_proof(register.clone(), scalar, VKH.to_string()).unwrap();
        prop_assert!(
            prove(&register.generator, &register.public_value, &z, &g_r, VKH).unwrap()
        );
    }

    /// A re-randomized register is still spendable via a fresh proof.
    #[test]
    fn schnorr_proof_round_trips_after_rerandomize(sk in any::<u64>()) {
        let scalar = Scalar::from(sk);
        let register = Register::create(scalar).unwrap().rerandomize().unwrap();
        let (z, g_r) = create_proof(register.clone(), scalar, VKH.to_string()).unwrap();
        prop_assert!(
            prove(&register.generator, &register.public_value, &z, &g_r, VKH).unwrap()
        );
    }

    /// A proof of knowledge of the wrong scalar does not verify — you cannot
    /// spend a register you do not own.
    #[test]
    fn schnorr_proof_rejects_wrong_scalar(owner in any::<u64>(), attacker in any::<u64>()) {
        prop_assume!(owner != attacker);
        let register = Register::create(Scalar::from(owner)).unwrap();
        let (z, g_r) =
            create_proof(register.clone(), Scalar::from(attacker), VKH.to_string()).unwrap();
        prop_assert!(
            !prove(&register.generator, &register.public_value, &z, &g_r, VKH).unwrap()
        );
    }
}
