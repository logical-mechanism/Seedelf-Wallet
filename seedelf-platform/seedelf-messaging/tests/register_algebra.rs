//! The register algebra (Tests 1–3), and the proposed pairing construction's
//! identity and its consequences (Test 5; docs/construction.md §3).

mod common;

use std::collections::HashSet;

use blstrs::{G1Projective, G2Affine, G2Projective, pairing};
use group::Curve;
use group::prime::PrimeCurveAffine;

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

// --- Test 5: the pairing identity (the construction that was set aside) ------

/// PEACE's H0 (app/src/constants.py), a G2 point.
const PEACE_H0: &str = "a5acbe8bdb762cf7b4bfa9171b9ffa23b6ed710b290280b271a0258e285354aac338bb9e5a9ee41b4454e4c410f40eea16c82b493986bfc754aa789e1408b2b526f8b92e9ddcd4eee1a6c4daa84d561a6ceb452afc4559fe81a1c7f3f26715db";

fn h0s() -> Vec<G2Affine> {
    let peace: [u8; 96] = hex::decode(PEACE_H0).unwrap().try_into().unwrap();
    let peace = Option::from(G2Affine::from_compressed(&peace)).expect("PEACE's H0 is in G2");
    let random = (G2Projective::from(G2Affine::generator()) * random_nonzero()).to_affine();
    vec![peace, random]
}

struct Capsule {
    y: blstrs::Scalar,
    a: blstrs::Scalar,
    p: G1Projective,
    w: G1Projective,
    c1: G1Projective,
    c2: G1Projective,
}

/// `p = [b]g`, `w = [b]v`, `C1 = [r]p`, `C2 = [a]p + [r]w`.
fn capsule() -> Capsule {
    let (y, a, r, b) = (
        random_nonzero(),
        random_nonzero(),
        random_nonzero(),
        random_nonzero(),
    );
    let (p, w) = (g1() * b, g1() * y * b);
    Capsule {
        y,
        a,
        p,
        w,
        c1: p * r,
        c2: p * a + w * r,
    }
}

/// `e([a]p, h0) == e(C2, h0) − e(C1, [y]h0)`. blstrs writes GT additively,
/// so the quotient is a subtraction.
#[test]
fn the_pairing_identity_holds() {
    for h0 in h0s() {
        for _ in 0..32 {
            let k = capsule();
            let y_h0 = (G2Projective::from(h0) * k.y).to_affine();
            let key = pairing(&(k.p * k.a).to_affine(), &h0);
            let recovered = pairing(&k.c2.to_affine(), &h0) - pairing(&k.c1.to_affine(), &y_h0);
            assert_eq!(key, recovered);
        }
    }
}

/// The recipient can recover `[a]p = C2 − [y]C1` in G1, with no pairing: the
/// capsule is ElGamal encryption of `[a]p`, and `K = e([a]p, h0)` is a fixed
/// map of it.
#[test]
fn the_capsule_is_elgamal_on_a_p() {
    for h0 in h0s() {
        for _ in 0..16 {
            let k = capsule();
            let m = k.c2 - k.c1 * k.y;
            assert_eq!(m, k.p * k.a);
            assert_eq!(
                pairing(&m.to_affine(), &h0),
                pairing(&(k.p * k.a).to_affine(), &h0)
            );
        }
    }
}

/// Anyone can change the capsule, or rescale the register, without changing
/// `K`: the header must be bound into the key derivation or the AEAD.
#[test]
fn the_capsule_and_register_are_malleable() {
    for _ in 0..16 {
        let k = capsule();
        let (s, t) = (random_nonzero(), random_nonzero());
        // (C1 + [s]p, C2 + [s]w) hides the same [a]p.
        let (c1, c2) = (k.c1 + k.p * s, k.c2 + k.w * s);
        assert_eq!(c2 - c1 * k.y, k.p * k.a);
        // ([t]p, [t]w) is still the recipient's, and C2 − [y]C1 is unchanged.
        let (p, w) = (k.p * t, k.w * t);
        assert_eq!(p * k.y, w);
        assert_eq!(k.c2 - k.c1 * k.y, k.p * k.a);
    }
}

/// If `[y]h0` were ever public, anyone could compute `K`, and anyone could
/// link a re-randomized register to its owner: `e(p, [y]h0) == e(w, h0)`.
#[test]
fn a_public_y_h0_would_break_confidentiality_and_unlinkability() {
    for h0 in h0s() {
        let k = capsule();
        let y_h0 = (G2Projective::from(h0) * k.y).to_affine();
        // An observer with p, w, C1, C2, h0 and [y]h0, but not y:
        let observed = pairing(&k.c2.to_affine(), &h0) - pairing(&k.c1.to_affine(), &y_h0);
        assert_eq!(observed, pairing(&(k.p * k.a).to_affine(), &h0));
        assert_eq!(
            pairing(&k.p.to_affine(), &y_h0),
            pairing(&k.w.to_affine(), &h0)
        );
        // ...and a stranger's register fails the same test.
        let stranger = random_nonzero();
        let w_other = k.p * stranger;
        assert_ne!(
            pairing(&k.p.to_affine(), &y_h0),
            pairing(&w_other.to_affine(), &h0)
        );
    }
}
