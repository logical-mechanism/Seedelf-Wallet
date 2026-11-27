//! The certificate's nonce mutants (docs/protocol.md §21.4,
//! joint-security.md rules 2 and 2m). A mutant certificate is still a
//! valid proof, so no verifier refuses one: each is caught by the vectors,
//! which hold every byte of the spec's derivation, and the dangerous ones
//! by a test that shows the key it would give away.
//!
//! The maker here derives the two nonces as §21.4 does, or as one mutant
//! does, from aux values it's given. Its spec setting is the crate's maker
//! byte for byte, held to the vectors file:
//!
//! - **k_x without T_m.** Harmless with one maker, so only the vectors
//!   catch it there; under a second derivation of k_m for the same
//!   (statement, aux) it puts k_x under two challenges and gives x. T_m in
//!   k_x's message is x's margin.
//! - **k_x keyed by x_m.** Whoever holds x_m, with an aux a failing source
//!   gave away, computes k_x and gets x = (z_x − k_x)/c from one
//!   certificate.
//! - **k_m keyed by x.** The same with the keys swapped: x and the aux give
//!   x_m.
//! - **An aux for each nonce.** A source that repeats k_m's aux and not
//!   k_x's puts k_m under two challenges: x_m = (z_m − z_m′)/(c − c′).
//! - **k_m without the statement.** One aux under two statements puts k_m
//!   under two challenges.
//! - **k_x keyed by both keys.** No single key gives it away; the vectors
//!   catch it.
//!
//! And the limit rule 2m states: k_m covers only the statement and aux, so
//! it's safe only while one (statement, aux) gives one T_x. A second
//! derivation of k_x under the same aux gives x_m.

use std::path::PathBuf;

use blstrs::{G1Affine, Scalar};
use ff::Field;
use group::Curve;
use serde_json::Value;

use super::support::{Seeded, datum_register, key, spend_key, test_chain};
use crate::keys::scalar_mod_q;
use crate::register::Register;
use crate::session::certificate::{
    CERTIFICATE_NONCE_M_LABEL, CERTIFICATE_NONCE_X_LABEL, Certificate, challenge, statement,
};
use crate::session::draw::hedge;
use crate::session::seedelf::{Chain, Seedelf};
use crate::{SecretKey, matches_register};

const VECTORS: &str = "tests/vectors/messaging_certificate_v1.json";

/// How a maker derives the two nonces.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Maker {
    /// §21.4: k_m over the statement and aux keyed by x_m, then k_x over
    /// the statement, T_m and aux keyed by x, one aux for both.
    Spec,
    KxWithoutTm,
    KxKeyedByXm,
    KxKeyedByBoth,
    KmKeyedByX,
    KmWithoutStatement,
    /// k_m from the first aux, k_x from the second.
    AuxEach,
}

const MUTANTS: [Maker; 6] = [
    Maker::KxWithoutTm,
    Maker::KxKeyedByXm,
    Maker::KxKeyedByBoth,
    Maker::KmKeyedByX,
    Maker::KmWithoutStatement,
    Maker::AuxEach,
];

/// A certificate as a maker made it, with its nonces.
struct Made {
    bytes: Vec<u8>,
    k_x: Scalar,
    k_m: Scalar,
    t_m: G1Affine,
    c: Scalar,
    z_x: Scalar,
    z_m: Scalar,
}

/// HMAC-SHA-512 keyed by `key`'s bytes over `parts`, mod q: the crate's
/// hedge, or, for the both-keys mutant, a 64-byte key.
fn hedged(key: &[Scalar], parts: &[&[u8]]) -> Scalar {
    let message = parts.concat();
    match key {
        [one] => hedge(one, &message),
        both => {
            use hmac::{Hmac, Mac};
            let key: Vec<u8> = both.iter().flat_map(|k| k.to_bytes_be()).collect();
            let mut mac = <Hmac<sha2::Sha512> as Mac>::new_from_slice(&key).unwrap();
            mac.update(&message);
            scalar_mod_q(&mac.finalize().into_bytes())
        }
    }
}

/// `seedelf`'s certificate from `maker`, with `aux` (and `aux_x`, k_x's own,
/// for [`Maker::AuxEach`]). `second_k_m` derives k_m a second way, as
/// another implementation under the same version might: its label's last
/// byte changed.
fn make(
    maker: Maker,
    x: &SecretKey,
    x_m: &SecretKey,
    seedelf: &Seedelf,
    aux: &[u8; 32],
    aux_x: &[u8; 32],
    second_k_m: bool,
) -> Made {
    let handle = seedelf.handle(x_m).unwrap();
    let statement = statement(&handle);
    let (xs, xms) = (x.scalar(), x_m.scalar());
    let mut label_m = CERTIFICATE_NONCE_M_LABEL.to_vec();
    if second_k_m {
        *label_m.last_mut().unwrap() ^= 0x20;
    }
    let k_m = match maker {
        Maker::KmKeyedByX => hedged(&[xs], &[&label_m, &statement, aux]),
        Maker::KmWithoutStatement => hedged(&[xms], &[&label_m, aux]),
        _ => hedged(&[xms], &[&label_m, &statement, aux]),
    };
    let t_m = (handle.register().generator() * k_m).to_affine();
    let t_m_bytes = t_m.to_compressed();
    let label_x = CERTIFICATE_NONCE_X_LABEL;
    let k_x = match maker {
        Maker::KxWithoutTm => hedged(&[xs], &[label_x, &statement, aux]),
        Maker::KxKeyedByXm => hedged(&[xms], &[label_x, &statement, &t_m_bytes, aux]),
        Maker::KxKeyedByBoth => hedged(&[xs, xms], &[label_x, &statement, &t_m_bytes, aux]),
        Maker::AuxEach => hedged(&[xs], &[label_x, &statement, &t_m_bytes, aux_x]),
        _ => hedged(&[xs], &[label_x, &statement, &t_m_bytes, aux]),
    };
    assert!(!bool::from(k_m.is_zero()) && !bool::from(k_x.is_zero()));
    let t_x = (seedelf.register().generator() * k_x).to_affine();
    let c = scalar_mod_q(&challenge(&statement, &t_x, &t_m));
    let (z_x, z_m) = (k_x + c * xs, k_m + c * xms);
    let bytes = [
        &statement[..],
        &c.to_bytes_be(),
        &z_x.to_bytes_be(),
        &z_m.to_bytes_be(),
    ]
    .concat();
    Made {
        bytes,
        k_x,
        k_m,
        t_m,
        c,
        z_x,
        z_m,
    }
}

/// A key from two transcripts on one nonce: (z − z′)/(c − c′).
fn extract(z: Scalar, c: Scalar, z2: Scalar, c2: Scalar) -> Scalar {
    (z - z2) * (c - c2).invert().unwrap()
}

fn alices() -> (SecretKey, SecretKey, Seedelf) {
    let seedelf =
        Seedelf::new(test_chain(), b"mutants", datum_register("alice", "mutants")).unwrap();
    (spend_key("alice"), key("alice"), seedelf)
}

const AUX: [u8; 32] = [0x5a; 32];
const OTHER_AUX: [u8; 32] = [0xa5; 32];

/// The maker's spec setting is the crate's, byte for byte, on fresh draws
/// and on every certificate of the vectors file; every mutant makes a
/// certificate that checks, so only what follows catches it; and each
/// mutant but [`Maker::AuxEach`] makes other bytes than the file's from the
/// file's own keys and aux. (An aux for each half, given the same value
/// twice, makes the spec's bytes: the draw count catches it, one aux,
/// `the_nonces_are_hmac_sha512_of_the_statement_under_each_key`, and so does
/// `an_aux_for_each_nonce_puts_k_m_under_two_challenges`.)
#[test]
fn the_vectors_catch_every_mutant_but_an_aux_for_each() {
    let (x, x_m, seedelf) = alices();
    let mut draw = Seeded::new("mutants: the crate's maker");
    let crate_made = Certificate::make_with(&x, &x_m, &seedelf, &mut draw).unwrap();
    let aux: [u8; 32] = draw.drain()[0].clone().try_into().unwrap();
    assert_eq!(
        make(Maker::Spec, &x, &x_m, &seedelf, &aux, &aux, false).bytes,
        crate_made.to_bytes()
    );
    for maker in MUTANTS {
        let made = make(maker, &x, &x_m, &seedelf, &aux, &OTHER_AUX, false);
        assert!(
            Certificate::from_bytes(&test_chain(), &made.bytes).is_ok(),
            "{maker:?} still makes a certificate that checks"
        );
    }

    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let bytes = |value: &Value| hex::decode(value.as_str().unwrap()).unwrap();
    let certificates = file["certificates"].as_array().unwrap();
    assert_eq!(certificates.len(), 4);
    for vector in certificates {
        let network = u8::try_from(vector["network"].as_u64().unwrap()).unwrap();
        let chain = Chain::new(network, bytes(&vector["policy"]).try_into().unwrap()).unwrap();
        let shown = &vector["seedelf"];
        let register = Register::from_bytes(
            &bytes(&shown["generator"]).try_into().unwrap(),
            &bytes(&shown["public_value"]).try_into().unwrap(),
        )
        .unwrap();
        let seedelf = Seedelf::new(chain, &bytes(&shown["name"]), register).unwrap();
        let secret =
            |name: &str| SecretKey::from_bytes(&bytes(&vector[name]).try_into().unwrap()).unwrap();
        let (x, x_m) = (secret("spend_secret_key"), secret("messaging_secret_key"));
        let aux: [u8; 32] = bytes(&vector["draws"]["aux"]).try_into().unwrap();
        let recorded = bytes(&vector["certificate"]);
        assert_eq!(
            make(Maker::Spec, &x, &x_m, &seedelf, &aux, &aux, false).bytes,
            recorded,
            "{}",
            vector["name"]
        );
        for maker in MUTANTS {
            let made = make(maker, &x, &x_m, &seedelf, &aux, &aux, false);
            if maker == Maker::AuxEach {
                assert_eq!(made.bytes, recorded);
            } else {
                assert_ne!(made.bytes, recorded, "the vectors miss {maker:?}");
            }
        }
    }
}

/// k_x keyed by x_m: whoever holds x_m, and the aux a failing source gave
/// away, computes k_x from the certificate's public values, T_m included,
/// and gets x = (z_x − k_x)/c. The spec's k_x, keyed by x, gives the same
/// thief nothing.
#[test]
fn k_x_keyed_by_x_m_gives_x_to_whoever_holds_x_m() {
    let (x, x_m, seedelf) = alices();
    let thief = |made: &Made| -> Scalar {
        let certificate = Certificate::from_bytes(&test_chain(), &made.bytes).unwrap();
        let (_, t_m) = certificate.commitments();
        let statement = statement(certificate.handle());
        let k_x = hedged(
            &[x_m.scalar()],
            &[
                CERTIFICATE_NONCE_X_LABEL,
                &statement,
                &t_m.to_compressed(),
                &AUX,
            ],
        );
        (made.z_x - k_x) * made.c.invert().unwrap()
    };
    let mutant = make(Maker::KxKeyedByXm, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let stolen = thief(&mutant);
    assert_eq!(stolen, x.scalar(), "the mutant gives x away");
    assert!(matches_register(
        &SecretKey::from_scalar(stolen).unwrap(),
        seedelf.register()
    ));
    let spec = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    assert_ne!(thief(&spec), x.scalar());
}

/// k_m keyed by x: whoever holds x, and the aux, gets x_m = (z_m − k_m)/c,
/// every message sealed to it. The spec's k_m, keyed by x_m, gives the same
/// thief nothing (joint-security.md §1.1's x row: x reveals no message
/// sealed to x_m).
#[test]
fn k_m_keyed_by_x_gives_x_m_to_whoever_holds_x() {
    let (x, x_m, seedelf) = alices();
    let thief = |made: &Made| -> Scalar {
        let statement = statement(&seedelf.handle(&x_m).unwrap());
        let k_m = hedged(
            &[x.scalar()],
            &[CERTIFICATE_NONCE_M_LABEL, &statement, &AUX],
        );
        (made.z_m - k_m) * made.c.invert().unwrap()
    };
    let mutant = make(Maker::KmKeyedByX, &x, &x_m, &seedelf, &AUX, &AUX, false);
    assert_eq!(thief(&mutant), x_m.scalar(), "the mutant gives x_m away");
    let spec = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    assert_ne!(thief(&spec), x_m.scalar());
}

/// An aux for each nonce: a source that repeats k_m's aux and not k_x's
/// puts one k_m under two challenges, which gives x_m. The spec draws one
/// aux for both, so a source that repeats it repeats the whole certificate,
/// and one that doesn't gives another k_m.
#[test]
fn an_aux_for_each_nonce_puts_k_m_under_two_challenges() {
    let (x, x_m, seedelf) = alices();
    let one = make(Maker::AuxEach, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let two = make(Maker::AuxEach, &x, &x_m, &seedelf, &AUX, &OTHER_AUX, false);
    assert_eq!((one.k_m, one.t_m), (two.k_m, two.t_m));
    assert_ne!(one.c, two.c);
    assert_eq!(extract(one.z_m, one.c, two.z_m, two.c), x_m.scalar());
    let spec = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let again = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    assert_eq!(spec.bytes, again.bytes);
    let other = make(
        Maker::Spec,
        &x,
        &x_m,
        &seedelf,
        &OTHER_AUX,
        &OTHER_AUX,
        false,
    );
    assert_ne!(spec.k_m, other.k_m);
    assert_ne!(spec.k_x, other.k_x);
}

/// k_m without the statement: one aux under two statements (two Seedelfs
/// of the wallet's) puts one k_m under two challenges, which gives x_m. The
/// spec's k_m covers the statement.
#[test]
fn k_m_without_the_statement_puts_k_m_under_two_challenges() {
    let (x, x_m, seedelf) = alices();
    let other = Seedelf::new(test_chain(), b"another", datum_register("alice", "another")).unwrap();
    let one = make(
        Maker::KmWithoutStatement,
        &x,
        &x_m,
        &seedelf,
        &AUX,
        &AUX,
        false,
    );
    let two = make(
        Maker::KmWithoutStatement,
        &x,
        &x_m,
        &other,
        &AUX,
        &AUX,
        false,
    );
    assert_eq!(one.k_m, two.k_m);
    assert_eq!(extract(one.z_m, one.c, two.z_m, two.c), x_m.scalar());
    let spec_one = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let spec_two = make(Maker::Spec, &x, &x_m, &other, &AUX, &AUX, false);
    assert_ne!(spec_one.k_m, spec_two.k_m);
    assert_ne!(
        extract(spec_one.z_m, spec_one.c, spec_two.z_m, spec_two.c),
        x_m.scalar()
    );
}

/// One maker, one derivation (rule 2m): k_m covers only the statement and
/// aux, so a second derivation of k_x for the same (statement, aux), here
/// one without T_m, gives another T_x, so another c, over the same k_m:
/// x_m = (z_m − z_m′)/(c − c′). It's why both derivations are fixed by the
/// version byte and the wallet makes a certificate in one call.
#[test]
fn a_second_derivation_of_k_x_under_the_same_aux_gives_x_m() {
    let (x, x_m, seedelf) = alices();
    let first = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let second = make(Maker::KxWithoutTm, &x, &x_m, &seedelf, &AUX, &AUX, false);
    assert_eq!(first.k_m, second.k_m);
    assert_ne!(first.k_x, second.k_x);
    assert_ne!(first.c, second.c);
    assert_eq!(
        extract(first.z_m, first.c, second.z_m, second.c),
        x_m.scalar()
    );
    // Both check: no verifier sees it.
    for made in [&first, &second] {
        assert!(Certificate::from_bytes(&test_chain(), &made.bytes).is_ok());
    }
}

/// T_m in k_x's message is x's margin (rule 2). Without it, a second
/// derivation of k_m for the same (statement, aux) gives another T_m, so
/// another c, over the same k_x: x = (z_x − z_x′)/(c − c′). The spec's k_x
/// covers T_m, so the same two derivations of k_m give two k_x, and x stays
/// whatever the x_m half does.
#[test]
fn k_x_without_t_m_gives_x_under_a_second_derivation_of_k_m() {
    let (x, x_m, seedelf) = alices();
    let one = make(Maker::KxWithoutTm, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let two = make(Maker::KxWithoutTm, &x, &x_m, &seedelf, &AUX, &AUX, true);
    assert_ne!(one.t_m, two.t_m);
    assert_eq!(one.k_x, two.k_x);
    assert_eq!(extract(one.z_x, one.c, two.z_x, two.c), x.scalar());
    let spec_one = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let spec_two = make(Maker::Spec, &x, &x_m, &seedelf, &AUX, &AUX, true);
    assert_ne!(spec_one.k_x, spec_two.k_x);
    assert_ne!(
        extract(spec_one.z_x, spec_one.c, spec_two.z_x, spec_two.c),
        x.scalar()
    );
}

/// k_x keyed by both keys: no single key gives it away, so no extraction
/// shows it. The vectors catch it
/// (`the_vectors_catch_every_mutant_but_an_aux_for_each`), and a thief of
/// x_m alone gets nothing from it.
#[test]
fn k_x_keyed_by_both_keys_gives_neither_key_alone() {
    let (x, x_m, seedelf) = alices();
    let mutant = make(Maker::KxKeyedByBoth, &x, &x_m, &seedelf, &AUX, &AUX, false);
    let certificate = Certificate::from_bytes(&test_chain(), &mutant.bytes).unwrap();
    let (_, t_m) = certificate.commitments();
    let statement = statement(certificate.handle());
    let guess = hedged(
        &[x_m.scalar()],
        &[
            CERTIFICATE_NONCE_X_LABEL,
            &statement,
            &t_m.to_compressed(),
            &AUX,
        ],
    );
    assert_ne!(
        (mutant.z_x - guess) * mutant.c.invert().unwrap(),
        x.scalar()
    );
}
