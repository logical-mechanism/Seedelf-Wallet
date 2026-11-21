//! The register algebra (Tests 1–3): ownership, re-randomization, and many
//! re-randomizations of one register.

mod common;

use std::collections::HashSet;

use blstrs::G1Projective;

use common::{g1, random_nonzero};
use seedelf_messaging::{Register, SecretKey, matches_register, rerandomize_register};

fn register_of(generator: &G1Projective, public_value: &G1Projective) -> Register {
    Register::from_bytes(&generator.to_compressed(), &public_value.to_compressed()).unwrap()
}

// --- Test 1: the basic register ---------------------------------------------

#[test]
fn a_root_register_is_g_and_g_to_the_y() {
    for _ in 0..32 {
        let y = random_nonzero();
        let key = SecretKey::from_scalar(y).unwrap();
        let register = key.register();
        assert_eq!(register.generator_bytes(), g1().to_compressed());
        assert_eq!(register.public_value_bytes(), (g1() * y).to_compressed());
        assert!(matches_register(&key, &register));
    }
}

// --- Test 2: re-randomization -----------------------------------------------

/// `([b]g)^y == [b]v`, for explicit `b`, many times over.
#[test]
fn rerandomizing_keeps_the_relation() {
    for _ in 0..200 {
        let (y, b) = (random_nonzero(), random_nonzero());
        let key = SecretKey::from_scalar(y).unwrap();
        let (g, v) = (g1(), g1() * y);
        let (p, w) = (g * b, v * b);
        assert_eq!(p * y, w);
        assert!(matches_register(&key, &register_of(&p, &w)));
    }
}

/// The library's own re-randomization needs only the register, never the key.
#[test]
fn rerandomize_register_needs_no_secret_and_keeps_ownership() {
    for _ in 0..50 {
        let key = SecretKey::generate();
        let public: Register = key.register();
        let rerandomized = rerandomize_register(&public);
        assert_ne!(rerandomized, public);
        assert!(matches_register(&key, &rerandomized));
    }
}

/// A register whose generator isn't `G`, as a Seedelf datum's isn't, and a
/// re-randomization of a re-randomization: the relation carries through.
#[test]
fn rerandomizing_any_generator_and_chains_keep_ownership() {
    let y = random_nonzero();
    let key = SecretKey::from_scalar(y).unwrap();
    let d = random_nonzero();
    let mut register = register_of(&(g1() * d), &(g1() * d * y));
    for _ in 0..20 {
        register = rerandomize_register(&register);
        assert!(matches_register(&key, &register));
    }
}

// --- Test 3: many re-randomizations -----------------------------------------

#[test]
fn a_hundred_rerandomizations_are_all_owned_and_all_distinct() {
    let key = SecretKey::generate();
    let root = key.register();
    let mut seen = HashSet::new();
    seen.insert(root.to_bytes());
    for _ in 0..100 {
        let register = rerandomize_register(&root);
        assert!(matches_register(&key, &register));
        let (p, w) = (
            common::point(&register.generator_bytes()),
            common::point(&register.public_value_bytes()),
        );
        assert_ne!(p, w);
        assert!(seen.insert(register.to_bytes()), "a repeated register");
    }
    assert_eq!(seen.len(), 101);
}
