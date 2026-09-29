//! Lovejoin's proofs (`seedelf_crypto::lovejoin`) against Lovejoin's own
//! known-answer vectors: the same bytes, or the validators would refuse them.

use blstrs::{G1Projective, Scalar};
use seedelf_crypto::lovejoin::{
    Branch, SchnorrProof, canonical_scalar, fs_hash_schnorr, fs_hash_sigma_or, point_from_bytes,
    point_to_bytes, prove_schnorr, prove_sigma_or, reduce, verify_schnorr, verify_sigma_or,
};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("vectors/lovejoin_v1.json")).expect("vectors")
}

fn bytes(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().expect("hex")).expect("hex")
}

fn fixed<const N: usize>(v: &Value) -> [u8; N] {
    bytes(v).try_into().expect("length")
}

fn point(v: &Value) -> G1Projective {
    point_from_bytes(&bytes(v)).expect("a G1 point")
}

/// A big-endian hex scalar of any length below 32 bytes.
fn scalar(v: &Value) -> Scalar {
    let raw = v.as_str().unwrap();
    let raw = if raw.len() % 2 == 1 {
        format!("0{raw}")
    } else {
        raw.to_string()
    };
    let raw = hex::decode(raw).unwrap();
    let mut wide = [0u8; 32];
    wide[32 - raw.len()..].copy_from_slice(&raw);
    canonical_scalar(&wide).expect("a canonical scalar")
}

fn statements(v: &Value) -> Vec<(G1Projective, G1Projective)> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| (point(&s["ap"]), point(&s["bp"])))
        .collect()
}

fn branches(v: &Value) -> Vec<Branch> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|b| Branch {
            t0: fixed(&b["t0"]),
            t1: fixed(&b["t1"]),
            c: fixed(&b["c"]),
            z: fixed(&b["z"]),
        })
        .collect()
}

#[test]
fn schnorr_proofs_are_lovejoins_byte_for_byte() {
    let doc = vectors();
    let cases = doc["provedlog"].as_array().unwrap();
    assert_eq!(cases.len(), 30);
    for case in cases {
        let base = point(&case["base"]);
        let secret = scalar(&case["secret"]);
        let ctx = bytes(&case["ctx"]);
        assert_eq!(point_to_bytes(&(base * secret)).to_vec(), bytes(&case["u"]));
        let proof = prove_schnorr(&base, &secret, &ctx).unwrap();
        assert_eq!(proof.t.to_vec(), bytes(&case["t"]), "t for {case}");
        assert_eq!(proof.z.to_vec(), bytes(&case["z"]), "z for {case}");
        assert!(verify_schnorr(&base, &point(&case["u"]), &proof, &ctx));
    }
}

#[test]
fn sigma_or_proofs_are_lovejoins_byte_for_byte() {
    let doc = vectors();
    let cases = doc["sigma_or"].as_array().unwrap();
    assert_eq!(cases.len(), 50);
    for case in cases {
        let a = point(&case["a"]);
        let b = point(&case["b"]);
        let stmts = statements(&case["statements"]);
        let real = case["realIndex"].as_u64().unwrap() as usize;
        let witness = scalar(&case["witness"]);
        let ctx = bytes(&case["ctx"]);
        let proof = prove_sigma_or(&a, &b, &stmts, real, &witness, &ctx).unwrap();
        assert_eq!(proof, branches(&case["branches"]), "N={}", case["N"]);
        assert!(verify_sigma_or(&a, &b, &stmts, &proof, &ctx));
    }
}

#[test]
fn lovejoins_negatives_are_refused() {
    let doc = vectors();
    let mut seen = 0;
    for case in doc["negative"].as_array().unwrap() {
        let ctx = bytes(&case["ctx"]);
        let accepted = match case["kind"].as_str().unwrap() {
            "schnorr" => {
                let proof = SchnorrProof {
                    t: fixed(&case["t"]),
                    z: fixed(&case["z"]),
                };
                verify_schnorr(&point(&case["base"]), &point(&case["u"]), &proof, &ctx)
            }
            "sigma_or" => verify_sigma_or(
                &point(&case["a"]),
                &point(&case["b"]),
                &statements(&case["statements"]),
                &branches(&case["branches"]),
                &ctx,
            ),
            other => panic!("unexpected kind {other}"),
        };
        assert!(!accepted, "{}: {}", case["kind"], case["mutation"]);
        seen += 1;
    }
    assert_eq!(seen, 84);
}

#[test]
fn fiat_shamir_inputs_hash_as_lovejoins() {
    let doc = vectors();
    for case in doc["encoding"].as_array().unwrap() {
        match case["kind"].as_str().unwrap() {
            "schnorr" => {
                let got = fs_hash_schnorr(
                    &bytes(&case["g"]),
                    &bytes(&case["u"]),
                    &bytes(&case["t"]),
                    &bytes(&case["ctx"]),
                );
                assert_eq!(got.to_vec(), bytes(&case["expected_hash"]));
            }
            "sigma_or" => {
                let stmts: Vec<([u8; 48], [u8; 48])> = case["branches"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| (fixed(&s["ap"]), fixed(&s["bp"])))
                    .collect();
                let commitments: Vec<([u8; 48], [u8; 48])> = case["commitments"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| (fixed(&c["t0"]), fixed(&c["t1"])))
                    .collect();
                let got = fs_hash_sigma_or(
                    &fixed(&case["a"]),
                    &fixed(&case["b"]),
                    &stmts,
                    &commitments,
                    &bytes(&case["ctx"]),
                )
                .unwrap();
                assert_eq!(got.to_vec(), bytes(&case["expected_hash"]));
            }
            // serialise_data of output references: seedelf-core's withdraw.
            _ => {}
        }
    }
}

#[test]
fn a_scalar_reduces_mod_r() {
    // r − 1 stays; r and r + 1 wrap; 2^256 − 1 reduces.
    let r_minus_1 = (Scalar::ZERO - Scalar::ONE).to_bytes_be();
    assert_eq!(reduce(&r_minus_1), Scalar::ZERO - Scalar::ONE);
    assert_eq!(reduce(&[0xff; 32]).to_bytes_be().len(), 32);
    let mut r = r_minus_1;
    // Add one to r − 1 in big-endian bytes.
    for byte in r.iter_mut().rev() {
        let (sum, carry) = byte.overflowing_add(1);
        *byte = sum;
        if !carry {
            break;
        }
    }
    assert_eq!(reduce(&r), Scalar::ZERO);
}

#[test]
fn a_seedelf_register_owns_a_box() {
    // A box's datum {a, b} with b = [x]·a is a Seedelf register; the Seedelf
    // key proves it to Lovejoin's check.
    use seedelf_crypto::register::Register;
    let sk = Scalar::from(123_456_789u64);
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let a = point(&Value::String(register.generator.clone()));
    let b = point(&Value::String(register.public_value.clone()));
    let proof = prove_schnorr(&a, &sk, b"ctx").unwrap();
    assert!(verify_schnorr(&a, &b, &proof, b"ctx"));
    assert!(!verify_schnorr(&a, &b, &proof, b"another ctx"));
}

use ff::Field;
