//! A Seedelf's certificate (docs/protocol.md §21.4): made, read back and
//! checked; every refusal of its parser, in order; the maker's refusals; its
//! nonces, recomputed from §21.4's formulas with HMAC-SHA-512 itself; that
//! the spending verifiers refuse its transcript; and the vectors
//! (tests/vectors/messaging_certificate_v1.json).

use std::path::PathBuf;

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256, Sha512};

use super::support::{
    Seeded, Stuck, datum_register, identity, key, off_curve, outside_g1, spend_key, test_chain,
    test_policy, test_scalar,
};
use crate::keys::scalar_mod_q;
use crate::register::Register;
use crate::relay::{LISTING_STAMP_LABEL, UNLISTING_STAMP_LABEL, listing_digest};
use crate::session::certificate::{
    CERTIFICATE_GENERATION, CERTIFICATE_LABEL, CERTIFICATE_MAX_LEN, CERTIFICATE_MIN_LEN,
    CERTIFICATE_NONCE_M_LABEL, CERTIFICATE_NONCE_X_LABEL, CERTIFICATE_PROOF_LEN,
    CERTIFICATE_VERSION, Certificate, WITHDRAWAL_LABEL, WITHDRAWAL_NONCE_LABEL, challenge,
    nonce_m_message, nonce_x_message, statement,
};
use crate::session::seedelf::{
    Chain, HANDLE_BASE_DST, NETWORK_MAINNET, NETWORK_PREPROD, POLICY_LEN, Seedelf,
};
use crate::{Error, SecretKey};

const VECTORS: &str = "tests/vectors/messaging_certificate_v1.json";

/// q, BLS12-381's scalar field order, big-endian.
pub(super) const GROUP_ORDER: &str =
    "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

/// p, BLS12-381's base field modulus, big-endian.
const FIELD_MODULUS: &str = "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";

fn recording() -> bool {
    std::env::var("RECORD_MESSAGING_CERTIFICATE_VECTORS").as_deref() == Ok("1")
}

pub(super) fn hex(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(bytes)
}

pub(super) fn mainnet() -> Chain {
    Chain::new(NETWORK_MAINNET, test_policy()).unwrap()
}

/// A Seedelf name of `len` bytes: the prefix, then a label's hash.
pub(super) fn name(len: usize) -> Vec<u8> {
    let mut name = vec![0x5e, 0xed, 0x0e, 0x1f];
    name.extend_from_slice(&Sha256::digest(b"a certified Seedelf")[..28]);
    name.truncate(len);
    name
}

/// A Seedelf of `label`'s wallet under `chain`, named `name`, at the datum
/// register of its Seedelf key.
pub(super) fn seedelf_of(label: &str, chain: Chain, name: &[u8]) -> Seedelf {
    Seedelf::new(
        chain,
        name,
        datum_register(label, &format!("{label}'s certified seedelf")),
    )
    .unwrap()
}

/// Alice's certificate of her Seedelf named `name` under `chain`, from the
/// draws `label` gives, and its bytes.
pub(super) fn alices(chain: Chain, name: &[u8], label: &str) -> (Seedelf, Certificate, Vec<u8>) {
    let seedelf = seedelf_of("alice", chain, name);
    let certificate = Certificate::make_with(
        &spend_key("alice"),
        &key("alice"),
        &seedelf,
        &mut Seeded::new(label),
    )
    .unwrap();
    let bytes = certificate.to_bytes();
    (seedelf, certificate, bytes)
}

/// Where a certificate with a `len`-byte name holds g_S, u_S, m_S and c,
/// z_x, z_m.
pub(super) fn offsets(len: usize) -> ([usize; 3], [usize; 3]) {
    let g = 3 + POLICY_LEN + 1 + len;
    let proof = g + 3 * 48;
    ([g, g + 48, g + 96], [proof, proof + 32, proof + 64])
}

pub(super) fn with_bytes(bytes: &[u8], at: usize, value: &[u8]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[at..at + value.len()].copy_from_slice(value);
    out
}

/// HMAC-SHA-512 keyed by `key` over `message`, from the hmac crate itself.
pub(super) fn hmac_sha512(key: &[u8], message: &[u8]) -> [u8; 64] {
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(key).unwrap();
    mac.update(message);
    mac.finalize().into_bytes().into()
}

#[test]
fn the_sizes_are_the_specs() {
    assert_eq!((CERTIFICATE_MIN_LEN, CERTIFICATE_MAX_LEN), (273, 304));
    assert_eq!(CERTIFICATE_PROOF_LEN, 96);
    assert_eq!((CERTIFICATE_VERSION, CERTIFICATE_GENERATION), (0x01, 0x00));
}

/// A certificate made for each network, with a name of 1 byte and of 32,
/// reads back as itself under its chain: its Seedelf, the handle the
/// messaging key takes of it, and its bytes, the statement then c, z_x and
/// z_m. Each is made afresh, and every one checks.
#[test]
fn a_certificate_is_made_read_back_and_checked() {
    for chain in [test_chain(), mainnet()] {
        for len in [1usize, 32] {
            let seedelf = seedelf_of("alice", chain, &name(len));
            let made = Certificate::make(&spend_key("alice"), &key("alice"), &seedelf).unwrap();
            let bytes = made.to_bytes();
            assert_eq!(bytes.len(), 272 + len);
            let read = Certificate::from_bytes(&chain, &bytes).unwrap();
            assert_eq!(read, made);
            assert_eq!(read.to_bytes(), bytes);
            assert_eq!(read.seedelf(), &seedelf);
            assert_eq!(read.handle(), &seedelf.handle(&key("alice")).unwrap());
            assert!(read.is_for(&seedelf));
            assert_eq!(
                &bytes[..bytes.len() - CERTIFICATE_PROOF_LEN],
                &statement(read.handle())[..]
            );
            assert_eq!(
                (bytes[0], bytes[1], bytes[2]),
                (CERTIFICATE_VERSION, chain.network(), CERTIFICATE_GENERATION)
            );
            // A fresh aux: other bytes for the same key, each checking.
            let again = Certificate::make(&spend_key("alice"), &key("alice"), &seedelf).unwrap();
            assert_ne!(again.to_bytes(), bytes);
            assert_eq!(again.handle(), made.handle());
            assert!(Certificate::from_bytes(&chain, &again.to_bytes()).is_ok());
        }
    }
}

/// Each way a certificate's bytes are refused, with the chain it's read
/// under and what it's refused as, from a good one of a 1-byte name and one
/// of 32, both preprod's. §21.4's checks in the parser's order: the length
/// (273 to 304), the version, the network, generation and policy, the name's
/// length and the length it gives; then g_S, u_S and m_S, each canonical, in
/// G1 and not O; then c, z_x and z_m, each below q; then the proof. Where two
/// faults meet, the earlier check names the refusal.
#[allow(clippy::type_complexity)]
fn refusals(short: &[u8], long: &[u8]) -> Vec<(String, Chain, Vec<u8>, Result<(), Error>)> {
    let preprod = test_chain();
    let q: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    let mut x_is_p: [u8; 48] = hex::decode(FIELD_MODULUS).unwrap().try_into().unwrap();
    x_is_p[0] |= 0x80;
    let mut stray = identity();
    stray[47] = 0x01;
    let mut signed_identity = identity();
    signed_identity[0] |= 0x20;
    let (points, scalars) = offsets(32);
    let name_len_at = 3 + POLICY_LEN;
    let mut cases: Vec<(String, Chain, Vec<u8>, Result<(), Error>)> =
        vec![
        ("273 bytes: a 1-byte name's".into(), preprod, short.to_vec(), Ok(())),
        ("304 bytes: a 32-byte name's".into(), preprod, long.to_vec(), Ok(())),
        (
            "272 bytes: one short of the least".into(),
            preprod,
            short[..272].to_vec(),
            Err(Error::InvalidCertificate),
        ),
        (
            "305 bytes: a byte after the most".into(),
            preprod,
            [long, &[0]].concat(),
            Err(Error::InvalidCertificate),
        ),
        (
            "303 bytes: a 32-byte name's, its last byte cut".into(),
            preprod,
            long[..303].to_vec(),
            Err(Error::InvalidCertificate),
        ),
        ("no bytes".into(), preprod, Vec::new(), Err(Error::InvalidCertificate)),
        (
            "version 0x00".into(),
            preprod,
            with_bytes(long, 0, &[0x00]),
            Err(Error::UnsupportedVersion(0x00)),
        ),
        (
            "version 0x02".into(),
            preprod,
            with_bytes(long, 0, &[0x02]),
            Err(Error::UnsupportedVersion(0x02)),
        ),
        (
            "mainnet's network byte, read under preprod".into(),
            preprod,
            with_bytes(long, 1, &[NETWORK_MAINNET]),
            Err(Error::InvalidCertificate),
        ),
        (
            "preprod's certificate, read under mainnet".into(),
            mainnet(),
            long.to_vec(),
            Err(Error::InvalidCertificate),
        ),
        (
            "network 0x02".into(),
            preprod,
            with_bytes(long, 1, &[0x02]),
            Err(Error::InvalidCertificate),
        ),
        (
            "generation 0x01: rotation comes later".into(),
            preprod,
            with_bytes(long, 2, &[0x01]),
            Err(Error::InvalidCertificate),
        ),
        (
            "generation 0xff".into(),
            preprod,
            with_bytes(long, 2, &[0xff]),
            Err(Error::InvalidCertificate),
        ),
        (
            "the policy's first byte changed".into(),
            preprod,
            with_bytes(long, 3, &[long[3] ^ 0x01]),
            Err(Error::InvalidCertificate),
        ),
        (
            "the policy's last byte changed".into(),
            preprod,
            with_bytes(long, 2 + POLICY_LEN, &[long[2 + POLICY_LEN] ^ 0x80]),
            Err(Error::InvalidCertificate),
        ),
        (
            "a good certificate read under another policy".into(),
            Chain::new(NETWORK_PREPROD, {
                let mut policy = test_policy();
                policy[27] ^= 0x01;
                policy
            })
            .unwrap(),
            long.to_vec(),
            Err(Error::InvalidCertificate),
        ),
        (
            "a name of 0: the length byte 0 in 273 bytes".into(),
            preprod,
            with_bytes(short, name_len_at, &[0]),
            Err(Error::InvalidCertificate),
        ),
        (
            "a name of 33: the length byte 33 in 304 bytes".into(),
            preprod,
            with_bytes(long, name_len_at, &[33]),
            Err(Error::InvalidCertificate),
        ),
        (
            "a name of 33 whose length is a 33-byte name's, 305 bytes: the length first".into(),
            preprod,
            {
                let mut out = long[..=name_len_at].to_vec();
                out[name_len_at] = 33;
                out.extend_from_slice(&long[name_len_at + 1..name_len_at + 33]);
                out.push(0x00);
                out.extend_from_slice(&long[name_len_at + 33..]);
                out
            },
            Err(Error::InvalidCertificate),
        ),
        (
            "273 bytes whose length byte says 2".into(),
            preprod,
            with_bytes(short, name_len_at, &[2]),
            Err(Error::InvalidCertificate),
        ),
        (
            "304 bytes whose length byte says 31".into(),
            preprod,
            with_bytes(long, name_len_at, &[31]),
            Err(Error::InvalidCertificate),
        ),
        (
            "version 0x02 in 305 bytes: the length before the version".into(),
            preprod,
            [&with_bytes(long, 0, &[0x02])[..], &[0]].concat(),
            Err(Error::InvalidCertificate),
        ),
        (
            "version 0x02 and the wrong network: the version before the network".into(),
            preprod,
            with_bytes(&with_bytes(long, 0, &[0x02]), 1, &[NETWORK_MAINNET]),
            Err(Error::UnsupportedVersion(0x02)),
        ),
        (
            "version 0x02 and a length byte that doesn't fit: the version before the name's length"
                .into(),
            preprod,
            with_bytes(&with_bytes(long, 0, &[0x02]), name_len_at, &[31]),
            Err(Error::UnsupportedVersion(0x02)),
        ),
        (
            "the wrong network and g_S off the curve: the head before the points".into(),
            preprod,
            with_bytes(&with_bytes(long, 1, &[NETWORK_MAINNET]), points[0], &off_curve()),
            Err(Error::InvalidCertificate),
        ),
    ];
    for (point, at) in ["g_S", "u_S", "m_S"].into_iter().zip(points) {
        let mut uncompressed = long.to_vec();
        uncompressed[at] &= 0x7f;
        for (fault, bytes, error) in [
            (
                "off the curve",
                with_bytes(long, at, &off_curve()),
                Error::InvalidEncoding,
            ),
            (
                "outside G1",
                with_bytes(long, at, &outside_g1()),
                Error::NotInSubgroup,
            ),
            (
                "the identity",
                with_bytes(long, at, &identity()),
                Error::IdentityPoint,
            ),
            (
                "with O's flags and a stray bit of x",
                with_bytes(long, at, &stray),
                Error::InvalidEncoding,
            ),
            (
                "with O's flags and the sign flag",
                with_bytes(long, at, &signed_identity),
                Error::InvalidEncoding,
            ),
            (
                "with x not below p",
                with_bytes(long, at, &x_is_p),
                Error::InvalidEncoding,
            ),
            (
                "without the compression flag",
                uncompressed,
                Error::InvalidEncoding,
            ),
        ] {
            cases.push((format!("{point} {fault}"), preprod, bytes, Err(error)));
        }
    }
    cases.push((
        "g_S off the curve and u_S outside G1: the points in order".into(),
        preprod,
        with_bytes(
            &with_bytes(long, points[0], &off_curve()),
            points[1],
            &outside_g1(),
        ),
        Err(Error::InvalidEncoding),
    ));
    cases.push((
        "u_S the identity and m_S off the curve: the points in order".into(),
        preprod,
        with_bytes(
            &with_bytes(long, points[1], &identity()),
            points[2],
            &off_curve(),
        ),
        Err(Error::IdentityPoint),
    ));
    cases.push((
        "m_S outside G1 and c at q: the points before the scalars".into(),
        preprod,
        with_bytes(&with_bytes(long, points[2], &outside_g1()), scalars[0], &q),
        Err(Error::NotInSubgroup),
    ));
    for (scalar, at) in ["c", "z_x", "z_m"].into_iter().zip(scalars) {
        cases.push((
            format!("{scalar} at q: {scalar} and {scalar} + q would be one certificate twice"),
            preprod,
            with_bytes(long, at, &q),
            Err(Error::InvalidCertificate),
        ));
        cases.push((
            format!("{scalar} all ones"),
            preprod,
            with_bytes(long, at, &[0xff; 32]),
            Err(Error::InvalidCertificate),
        ));
        cases.push((
            format!("{scalar}'s last byte flipped: the proof"),
            preprod,
            with_bytes(long, at + 31, &[long[at + 31] ^ 0x01]),
            Err(Error::InvalidCertificate),
        ));
    }
    let (_, short_scalars) = offsets(1);
    cases.push((
        "a 1-byte name's z_m with its first byte flipped".into(),
        preprod,
        with_bytes(short, short_scalars[2], &[short[short_scalars[2]] ^ 0x01]),
        Err(Error::InvalidCertificate),
    ));
    cases
}

/// The refusals the clean-room check's mutation pass found the file didn't
/// pin, from the good certificate of a 32-byte name. They follow the 60
/// above in the file, so those keep their indices:
///
/// - each of c, z_x and z_m plus q, still 32 bytes since q < 2²⁵⁶: a reader
///   that reduced a scalar mod q instead of refusing it would take each,
///   since reduced it's the good certificate again (the at-q and all-ones
///   refusals can't catch that: their proofs fail too, with the same code);
/// - the generation's and the policy's place in the order, each before the
///   points, as the network's is;
/// - g_S and m_S with x = 0, either sign: (0, ±2) are on the curve and
///   outside G1, but blst refuses them as it decodes, so they're
///   `invalid_encoding` (construction.md §4.4), not `not_in_subgroup`.
#[allow(clippy::type_complexity)]
fn pinned_refusals(long: &[u8]) -> Vec<(String, Chain, Vec<u8>, Result<(), Error>)> {
    let preprod = test_chain();
    let q: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    let (points, scalars) = offsets(32);
    let mut cases = Vec::new();
    for (scalar, at) in ["c", "z_x", "z_m"].into_iter().zip(scalars) {
        let value: [u8; 32] = long[at..at + 32].try_into().unwrap();
        let mut sum = [0u8; 32];
        let mut carry = 0u16;
        for i in (0..32).rev() {
            let digit = u16::from(value[i]) + u16::from(q[i]) + carry;
            sum[i] = digit as u8;
            carry = digit >> 8;
        }
        assert_eq!(carry, 0, "{scalar} + q is below 2²⁵⁶");
        assert_eq!(
            scalar_mod_q(&sum),
            scalar_mod_q(&value),
            "reduced, it's {scalar}"
        );
        cases.push((
            format!(
                "{scalar} + q, 32 bytes still: a reader that reduced {scalar} mod q, not refusing it, would take it"
            ),
            preprod,
            with_bytes(long, at, &sum),
            Err(Error::InvalidCertificate),
        ));
    }
    cases.push((
        "generation 0x01 and g_S off the curve: the generation before the points".into(),
        preprod,
        with_bytes(&with_bytes(long, 2, &[0x01]), points[0], &off_curve()),
        Err(Error::InvalidCertificate),
    ));
    cases.push((
        "another policy and g_S off the curve: the policy before the points".into(),
        preprod,
        with_bytes(
            &with_bytes(long, 3, &[long[3] ^ 0x01]),
            points[0],
            &off_curve(),
        ),
        Err(Error::InvalidCertificate),
    ));
    let mut x_zero = [0u8; 48];
    x_zero[0] = 0x80;
    let mut x_zero_signed = x_zero;
    x_zero_signed[0] |= 0x20;
    for (point, at) in [("g_S", points[0]), ("m_S", points[2])] {
        for (fault, encoding) in [
            ("x = 0", x_zero),
            ("x = 0 and the sign flag", x_zero_signed),
        ] {
            cases.push((
                format!(
                    "{point} with {fault}: (0, ±2) is on the curve and outside G1, and refused as it decodes"
                ),
                preprod,
                with_bytes(long, at, &encoding),
                Err(Error::InvalidEncoding),
            ));
        }
    }
    cases
}

/// A Seedelf's certificate with the m_S of another's: Mallory's Seedelf,
/// whose x she knows, with Bob's messaging value from his certificate, not
/// on her h_S. x's half she proves; x_m's half she can only guess, with her
/// own messaging key. The back-signature refuses it.
fn mallory_binds_bobs_messaging_value() -> Vec<u8> {
    let chain = test_chain();
    let bobs = Certificate::make_with(
        &spend_key("bob"),
        &key("bob"),
        &seedelf_of("bob", chain, &name(32)),
        &mut Seeded::new("bob's certificate"),
    )
    .unwrap();
    let hers = seedelf_of("mallory", chain, &name(32));
    let mut bytes = Certificate::make_with(
        &spend_key("mallory"),
        &key("mallory"),
        &hers,
        &mut Seeded::new("mallory's certificate"),
    )
    .unwrap()
    .to_bytes();
    let (points, scalars) = offsets(32);
    let m_s = bobs.handle().register().public_value_bytes();
    bytes[points[2]..points[2] + 48].copy_from_slice(&m_s);
    // Her proof over that statement: T_x and T_m from nonces of hers, z_x
    // with her x, z_m with her messaging key in place of the one she lacks.
    let (k_x, k_m) = (test_scalar("mallory's k_x"), test_scalar("mallory's k_m"));
    let h_s = G1Projective::from(hers.base().unwrap());
    let t_x = (hers.register().generator() * k_x).to_affine();
    let t_m = (h_s * k_m).to_affine();
    let c = scalar_mod_q(&challenge(&bytes[..scalars[0]], &t_x, &t_m));
    let z_x = k_x + c * spend_key("mallory").scalar();
    let z_m = k_m + c * key("mallory").scalar();
    for (scalar, at) in [c, z_x, z_m].into_iter().zip(scalars) {
        bytes[at..at + 32].copy_from_slice(&scalar.to_bytes_be());
    }
    bytes
}

/// x = 0's points, (0, ±2), are on the curve, y² = 0³ + 4, and outside
/// G1; blst refuses them as it decodes, so the crate's decoder gives
/// `InvalidEncoding` for either sign (construction.md §4.4).
#[test]
fn a_point_with_x_zero_is_a_bad_encoding() {
    let mut x_zero = [0u8; 48];
    x_zero[0] = 0x80;
    for flags in [0x80u8, 0xa0] {
        x_zero[0] = flags;
        assert_eq!(
            crate::register::decode_point(&x_zero),
            Err(Error::InvalidEncoding)
        );
        assert!(Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(&x_zero)).is_none());
    }
}

#[test]
fn from_bytes_refuses_each_fault_in_its_order() {
    let (_, _, short) = alices(test_chain(), &name(1), "certificate refusals, short");
    let (_, _, long) = alices(test_chain(), &name(32), "certificate refusals, long");
    for (case, chain, bytes, expected) in refusals(&short, &long)
        .into_iter()
        .chain(pinned_refusals(&long))
    {
        let verdict = Certificate::from_bytes(&chain, &bytes).map(|_| ());
        assert_eq!(verdict, expected, "{case}");
    }
    assert_eq!(
        Certificate::from_bytes(&test_chain(), &mallory_binds_bobs_messaging_value()).err(),
        Some(Error::InvalidCertificate)
    );
}

/// No single bit changed in a certificate reads as one.
#[test]
fn no_single_bit_changed_reads_as_a_certificate() {
    let (_, _, bytes) = alices(test_chain(), &name(1), "certificate bits");
    for i in 0..bytes.len() * 8 {
        let mut changed = bytes.clone();
        changed[i / 8] ^= 1 << (i % 8);
        assert!(
            Certificate::from_bytes(&test_chain(), &changed).is_err(),
            "bit {i} changed still checks"
        );
    }
}

/// The maker refuses one key given for both, then a Seedelf whose register
/// isn't the Seedelf key's, before either key meets anything: nothing is
/// drawn. The keys given the other way round are such a Seedelf.
#[test]
fn make_refuses_one_key_for_both_and_a_seedelf_not_the_keys() {
    let alices = seedelf_of("alice", test_chain(), &name(32));
    let x = spend_key("alice");
    let twin = SecretKey::from_scalar(x.scalar()).unwrap();
    let cases: [(&SecretKey, &SecretKey, &Seedelf, Error); 5] = [
        (&x, &x, &alices, Error::SameKey),
        (&x, &twin, &alices, Error::SameKey),
        // The same key, for a Seedelf that isn't its: one key is checked first.
        (&key("bob"), &key("bob"), &alices, Error::SameKey),
        (&spend_key("bob"), &key("bob"), &alices, Error::NotOwned),
        // The two keys swapped: the messaging key holds no Seedelf.
        (&key("alice"), &x, &alices, Error::NotOwned),
    ];
    for (spend, messaging, seedelf, refusal) in cases {
        let mut draw = Seeded::new("refused");
        assert_eq!(
            Certificate::make_with(spend, messaging, seedelf, &mut draw).err(),
            Some(refusal)
        );
        assert!(draw.drain().is_empty(), "{refusal:?} draws nothing");
        assert_eq!(
            Certificate::make(spend, messaging, seedelf).err(),
            Some(refusal)
        );
    }
}

/// `is_for` holds for exactly the Seedelf the certificate names: its chain,
/// its name and its register. A Seedelf that moved, or the same name and
/// register on another chain, isn't it.
#[test]
fn a_certificate_is_for_exactly_its_seedelf() {
    let (seedelf, certificate, _) = alices(test_chain(), &name(32), "certificate is_for");
    assert!(certificate.is_for(&seedelf));
    let register = *seedelf.register();
    let moved = Register::from_checked(
        (register.generator() * Scalar::from(2u64)).to_affine(),
        (register.public_value() * Scalar::from(2u64)).to_affine(),
    );
    let mut renamed = name(32);
    renamed[31] ^= 1;
    let mut policy = test_policy();
    policy[0] ^= 1;
    for other in [
        Seedelf::new(test_chain(), &renamed, register).unwrap(),
        Seedelf::new(test_chain(), &name(31), register).unwrap(),
        Seedelf::new(test_chain(), &name(32), moved).unwrap(),
        Seedelf::new(mainnet(), &name(32), register).unwrap(),
        Seedelf::new(
            Chain::new(NETWORK_PREPROD, policy).unwrap(),
            &name(32),
            register,
        )
        .unwrap(),
        seedelf_of("bob", test_chain(), &name(32)),
    ] {
        assert!(!certificate.is_for(&other), "{other:?}");
    }
}

/// The statement, every byte before c, as §21.4 spells it, built here:
/// `version ‖ network ‖ generation ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S ‖ m_S`,
/// with m_S = [x_m]h_S and h_S the hash of §21.3.
fn spelled_statement(seedelf: &Seedelf, messaging: &SecretKey) -> (Vec<u8>, G1Projective) {
    let chain = seedelf.chain();
    let mut base_message = vec![chain.network()];
    base_message.extend_from_slice(chain.policy());
    base_message.push(seedelf.name().len() as u8);
    base_message.extend_from_slice(seedelf.name());
    base_message.extend_from_slice(&seedelf.register().to_bytes());
    let h_s = G1Projective::hash_to_curve(&base_message, HANDLE_BASE_DST, &[]);
    let mut out = vec![0x01, chain.network(), 0x00];
    out.extend_from_slice(chain.policy());
    out.push(seedelf.name().len() as u8);
    out.extend_from_slice(seedelf.name());
    out.extend_from_slice(&seedelf.register().to_bytes());
    out.extend_from_slice(&(h_s * messaging.scalar()).to_compressed());
    (out, h_s)
}

/// The nonces, recomputed from §21.4's formulas with the hmac crate, not the
/// crate's helpers: k_m = HMAC-SHA-512(x_m, label_m ‖ statement ‖ aux) mod q
/// and T_m = [k_m]h_S; k_x = HMAC-SHA-512(x, label_x ‖ statement ‖ T_m ‖
/// aux) mod q and T_x = [k_x]g_S; c = SHA-256(label ‖ statement ‖ T_x ‖
/// T_m) mod q; z_x = k_x + c·x and z_m = k_m + c·x_m. The labels are the
/// spec's ASCII, and k_x is keyed by x alone: under x_m, over the same
/// message, it's another scalar.
#[test]
fn the_nonces_are_hmac_sha512_of_the_statement_under_each_key() {
    assert_eq!(CERTIFICATE_LABEL, b"Seedelf-Messaging|v1|certificate");
    assert_eq!(
        CERTIFICATE_NONCE_M_LABEL,
        b"Seedelf-Messaging|v1|certificate-nonce|m"
    );
    assert_eq!(
        CERTIFICATE_NONCE_X_LABEL,
        b"Seedelf-Messaging|v1|certificate-nonce|x"
    );
    let (x, x_m) = (spend_key("alice"), key("alice"));
    for (chain, len) in [(test_chain(), 1usize), (mainnet(), 32)] {
        let seedelf = seedelf_of("alice", chain, &name(len));
        let mut draw = Seeded::new(&format!("certificate nonces {len}"));
        let certificate = Certificate::make_with(&x, &x_m, &seedelf, &mut draw).unwrap();
        let drawn = draw.drain();
        assert_eq!(drawn.len(), 1, "a certificate draws its aux alone");
        let aux = &drawn[0];
        let bytes = certificate.to_bytes();

        let (spelled, h_s) = spelled_statement(&seedelf, &x_m);
        assert_eq!(&bytes[..bytes.len() - 96], &spelled[..]);
        assert_eq!(statement(certificate.handle()), spelled);

        let message_m = [
            &b"Seedelf-Messaging|v1|certificate-nonce|m"[..],
            &spelled,
            aux,
        ]
        .concat();
        let k_m = scalar_mod_q(&hmac_sha512(&x_m.scalar().to_bytes_be(), &message_m));
        let t_m = (h_s * k_m).to_affine();
        let message_x = [
            &b"Seedelf-Messaging|v1|certificate-nonce|x"[..],
            &spelled,
            &t_m.to_compressed(),
            aux,
        ]
        .concat();
        let k_x = scalar_mod_q(&hmac_sha512(&x.scalar().to_bytes_be(), &message_x));
        let t_x = (seedelf.register().generator() * k_x).to_affine();
        let hash: [u8; 32] = Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|certificate")
            .chain_update(&spelled)
            .chain_update(t_x.to_compressed())
            .chain_update(t_m.to_compressed())
            .finalize()
            .into();
        let c = scalar_mod_q(&hash);
        let (z_x, z_m) = (k_x + c * x.scalar(), k_m + c * x_m.scalar());
        assert_eq!(
            &bytes[bytes.len() - 96..],
            &[c.to_bytes_be(), z_x.to_bytes_be(), z_m.to_bytes_be()].concat()[..]
        );
        // The crate's own messages and commitments agree.
        let aux: [u8; 32] = aux.clone().try_into().unwrap();
        assert_eq!(nonce_m_message(&spelled, &aux), message_m);
        assert_eq!(nonce_x_message(&spelled, &t_m, &aux), message_x);
        assert_eq!(certificate.commitments(), (t_x, t_m));
        // k_x keyed by x alone: whoever holds x_m computes k_m and T_m, and
        // not k_x.
        assert_ne!(
            scalar_mod_q(&hmac_sha512(&x_m.scalar().to_bytes_be(), &message_x)),
            k_x
        );
        assert_ne!(k_x, k_m);
    }
}

/// One aux, one certificate: a source that repeats gives the same
/// certificate again, byte for byte, never one nonce under two challenges.
/// The same stuck source on another statement gives other nonces, for both
/// halves; another aux, other nonces for the same statement.
#[test]
fn a_repeated_draw_gives_the_identical_certificate() {
    let (x, x_m) = (spend_key("alice"), key("alice"));
    let stuck = |aux: u8| Stuck {
        scalar: Scalar::from(5u64),
        aux: [aux; 32],
    };
    let seedelf = seedelf_of("alice", test_chain(), &name(32));
    let once = Certificate::make_with(&x, &x_m, &seedelf, &mut stuck(0x5a)).unwrap();
    let again = Certificate::make_with(&x, &x_m, &seedelf, &mut stuck(0x5a)).unwrap();
    assert_eq!(once, again);
    assert_eq!(once.to_bytes(), again.to_bytes());

    let register = *seedelf.register();
    let moved = Register::from_checked(
        (register.generator() * Scalar::from(3u64)).to_affine(),
        (register.public_value() * Scalar::from(3u64)).to_affine(),
    );
    let mut renamed = name(32);
    renamed[0] ^= 1;
    let statements = [
        (seedelf.clone(), &x_m),
        (
            Seedelf::new(test_chain(), &renamed, register).unwrap(),
            &x_m,
        ),
        (Seedelf::new(test_chain(), &name(32), moved).unwrap(), &x_m),
        (Seedelf::new(mainnet(), &name(32), register).unwrap(), &x_m),
        // Another messaging key: another m_S, so another statement.
        (seedelf.clone(), &key("alice's other wallet")),
    ];
    let mut seen: Vec<(G1Affine, G1Affine, Scalar)> = Vec::new();
    for (seedelf, messaging) in &statements {
        let made = Certificate::make_with(&x, messaging, seedelf, &mut stuck(0x5a)).unwrap();
        let (t_x, t_m) = made.commitments();
        let (_, c, _) = made.seedelf_transcript();
        for (other_x, other_m, other_c) in &seen {
            assert_ne!(t_x, *other_x, "k_x under two challenges");
            assert_ne!(t_m, *other_m, "k_m under two challenges");
            assert_ne!(c, *other_c);
        }
        seen.push((t_x, t_m, c));
    }
    let other_aux = Certificate::make_with(&x, &x_m, &seedelf, &mut stuck(0xa5)).unwrap();
    assert_ne!(other_aux.commitments().0, once.commitments().0);
    assert_ne!(other_aux.commitments().1, once.commitments().1);
}

/// Never a spending proof (§21.4). A certificate's x half is a Schnorr
/// transcript (T_x, c, z_x) on the Seedelf's own register (g_S, u_S), the
/// register a spend proves. seedelf-crypto's verifiers, the chain's and
/// Lovejoin's owner proof, refuse it as it is and mauled to any challenge t,
/// T′ = T_x + [c − t]u_S, for t the verifier's own challenge of T_x among
/// others, under several vkhs and contexts, and for [d] of the register;
/// each still takes a proof the Seedelf key makes for the same register.
#[test]
fn the_spending_verifiers_refuse_a_certificates_transcript() {
    use seedelf_crypto::lovejoin::{
        SchnorrProof, fs_hash_schnorr, prove_schnorr, reduce, verify_schnorr,
    };
    use seedelf_crypto::schnorr::{create_proof, fiat_shamir_heuristic, prove};
    let x = spend_key("alice");
    let hex_point = |point: &G1Projective| hex(point.to_compressed());
    let vkhs = [
        "00".repeat(28),
        "11".repeat(28),
        "5eed".repeat(14),
        hex(&Sha256::digest(b"a one-time key")[..28]),
    ];
    let contexts: [&[u8]; 2] = [b"any ctx", b"lovejoin"];
    for (chain, len, label) in [
        (test_chain(), 32usize, "certificate cross protocol, long"),
        (mainnet(), 1, "certificate cross protocol, short"),
    ] {
        let (seedelf, certificate, _) = alices(chain, &name(len), label);
        let (t_x, c, z_x) = certificate.seedelf_transcript();
        let (g, u) = (
            seedelf.register().generator(),
            seedelf.register().public_value(),
        );
        let t = G1Projective::from(t_x);
        assert_eq!(g * z_x, t + u * c, "a transcript under the certificate's c");

        // The verifiers asked as a spend and a Lovejoin owner proof ask them.
        let register = seedelf_crypto::register::Register::new(hex_point(&g), hex_point(&u));
        let (z, proof_t) = create_proof(register, x.scalar(), vkhs[0].clone()).unwrap();
        assert!(prove(&hex_point(&g), &hex_point(&u), &z, &proof_t, &vkhs[0]).unwrap());
        let owner = prove_schnorr(&g, &x.scalar(), contexts[0]).unwrap();
        assert!(verify_schnorr(&g, &u, &owner, contexts[0]));

        for d in [Scalar::from(1u64), test_scalar("d1"), test_scalar("d2")] {
            let (gd, ud, td) = (g * d, u * d, t * d);
            for vkh in &vkhs {
                // The chain's own challenge of T_x: blake2b-224 of g ‖ T ‖ u ‖ vkh.
                let own = fiat_shamir_heuristic(
                    hex_point(&gd),
                    hex_point(&td),
                    hex_point(&ud),
                    vkh.clone(),
                )
                .unwrap();
                let own: [u8; 32] = hex::decode(format!("{own:0>64}"))
                    .unwrap()
                    .try_into()
                    .unwrap();
                let own = scalar_mod_q(&own);
                for t_challenge in [c, own, test_scalar("any t")] {
                    // Mauled to t: a transcript under t, its T′ fixed by t.
                    let mauled = td + ud * (c - t_challenge);
                    assert_eq!(gd * z_x, mauled + ud * t_challenge);
                    assert!(
                        !prove(
                            &hex_point(&gd),
                            &hex_point(&ud),
                            &hex(z_x.to_bytes_be()),
                            &hex_point(&mauled),
                            vkh
                        )
                        .unwrap()
                    );
                }
                assert!(
                    !prove(
                        &hex_point(&gd),
                        &hex_point(&ud),
                        &hex(z_x.to_bytes_be()),
                        &hex_point(&td),
                        vkh
                    )
                    .unwrap()
                );
            }
            for ctx in contexts {
                let own = reduce(&fs_hash_schnorr(
                    &gd.to_compressed(),
                    &ud.to_compressed(),
                    &td.to_compressed(),
                    ctx,
                ));
                for t_challenge in [c, own] {
                    let mauled = td + ud * (c - t_challenge);
                    let transcript = SchnorrProof {
                        t: mauled.to_compressed(),
                        z: z_x.to_bytes_be(),
                    };
                    assert!(!verify_schnorr(&gd, &ud, &transcript, ctx));
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The vectors
// ---------------------------------------------------------------------------

/// The code a refusal goes by in the vectors: the variant's name in snake
/// case, as seedelf-wasm names it.
fn code(error: Error) -> &'static str {
    match error {
        Error::InvalidCertificate => "invalid_certificate",
        Error::UnsupportedVersion(_) => "unsupported_version",
        Error::InvalidEncoding => "invalid_encoding",
        Error::NotInSubgroup => "not_in_subgroup",
        Error::IdentityPoint => "identity_point",
        other => panic!("no vector refuses with {other:?}"),
    }
}

fn hmac_json(key: &Scalar, message: &[u8]) -> (Scalar, Value) {
    let okm = hmac_sha512(&key.to_bytes_be(), message);
    let scalar = scalar_mod_q(&okm);
    (
        scalar,
        json!({ "message": hex(message), "hmac": hex(okm), "scalar": hex(scalar.to_bytes_be()) }),
    )
}

/// One good certificate with every value between its keys and its bytes,
/// each checked against the certificate the crate made from the same draw.
fn good_json(
    description: &str,
    spend: &SecretKey,
    messaging: &SecretKey,
    seedelf: &Seedelf,
    label: &str,
) -> (Value, Vec<u8>) {
    let mut draw = Seeded::new(label);
    let certificate = Certificate::make_with(spend, messaging, seedelf, &mut draw).unwrap();
    let drawn = draw.drain();
    assert_eq!(drawn.len(), 1);
    let aux: [u8; 32] = drawn[0].clone().try_into().unwrap();
    let handle = certificate.handle();
    let statement = statement(handle);
    let h_s = seedelf.base().unwrap();
    assert_eq!(handle.register().generator_point(), h_s);
    let (k_m, nonce_m) = hmac_json(&messaging.scalar(), &nonce_m_message(&statement, &aux));
    let t_m = (G1Projective::from(h_s) * k_m).to_affine();
    let (k_x, nonce_x) = hmac_json(&spend.scalar(), &nonce_x_message(&statement, &t_m, &aux));
    let t_x = (seedelf.register().generator() * k_x).to_affine();
    assert_eq!(certificate.commitments(), (t_x, t_m));
    let hash = challenge(&statement, &t_x, &t_m);
    let c = scalar_mod_q(&hash);
    let (z_x, z_m) = (k_x + c * spend.scalar(), k_m + c * messaging.scalar());
    let bytes = certificate.to_bytes();
    assert_eq!(
        bytes,
        [
            &statement[..],
            &c.to_bytes_be(),
            &z_x.to_bytes_be(),
            &z_m.to_bytes_be()
        ]
        .concat()
    );
    let chain = seedelf.chain();
    // Its listing digest under its pool's name, the relay's function and
    // §21.7's formula built here.
    let pool = if chain.network() == NETWORK_MAINNET {
        "mainnet"
    } else {
        "preprod"
    };
    let listing = listing_digest(pool, &bytes).unwrap();
    let by_hand: [u8; 32] = Sha256::new()
        .chain_update(b"Seedelf-Messaging|v1|listing-stamp|")
        .chain_update([pool.len() as u8])
        .chain_update(pool.as_bytes())
        .chain_update(&bytes)
        .finalize()
        .into();
    assert_eq!(listing, by_hand);
    let value = json!({
        "name": description,
        "network": chain.network(),
        "policy": hex(chain.policy()),
        "pool": pool,
        "version": CERTIFICATE_VERSION,
        "generation": CERTIFICATE_GENERATION,
        "seedelf": {
            "name": hex(seedelf.name()),
            "generator": hex(seedelf.register().generator_bytes()),
            "public_value": hex(seedelf.register().public_value_bytes()),
            "base_message": hex(seedelf.base_message()),
            "base": hex(h_s.to_compressed()),
        },
        "spend_secret_key": hex(spend.scalar().to_bytes_be()),
        "messaging_secret_key": hex(messaging.scalar().to_bytes_be()),
        "messaging_value": hex(handle.register().public_value_bytes()),
        "statement": hex(&statement),
        "draws": { "aux": hex(aux) },
        "nonce_m": nonce_m,
        "t_m": hex(t_m.to_compressed()),
        "nonce_x": nonce_x,
        "t_x": hex(t_x.to_compressed()),
        "challenge": hex(hash),
        "c": hex(c.to_bytes_be()),
        "z_x": hex(z_x.to_bytes_be()),
        "z_m": hex(z_m.to_bytes_be()),
        "certificate": hex(&bytes),
        "listing_digest": hex(listing),
    });
    (value, bytes)
}

fn all_vectors() -> Value {
    let label = |who: &str| format!("seedelf-messaging certificate v1 {who}");
    let (alice, bob) = (label("alice"), label("bob"));
    let seedelf = |who: &str, chain: Chain, name: &[u8], generator: &str| {
        Seedelf::new(chain, name, datum_register(who, generator)).unwrap()
    };
    let full = name(32);
    let one = [0x5eu8];
    // The first draw whose challenge hash is at least q, so a reader that
    // doesn't reduce it gets that certificate wrong.
    let at_least_q = |spend: &SecretKey, messaging: &SecretKey, seedelf: &Seedelf, label: &str| {
        let made =
            Certificate::make_with(spend, messaging, seedelf, &mut Seeded::new(label)).unwrap();
        let (t_x, t_m) = made.commitments();
        let hash = challenge(&statement(made.handle()), &t_x, &t_m);
        Option::<Scalar>::from(Scalar::from_bytes_be(&hash)).is_none()
    };
    let cases = [
        (
            "Alice's Seedelf on preprod under a 1-byte name: the shortest, 273 bytes",
            &alice,
            seedelf(&alice, test_chain(), &one, "alice's preprod seedelf"),
            false,
        ),
        (
            "Alice's Seedelf on preprod under a 32-byte name: the longest, 304 bytes, its challenge hash at least q",
            &alice,
            seedelf(&alice, test_chain(), &full, "alice's other preprod seedelf"),
            true,
        ),
        (
            "Bob's Seedelf on mainnet under a 1-byte name",
            &bob,
            seedelf(&bob, mainnet(), &one, "bob's mainnet seedelf"),
            false,
        ),
        (
            "Bob's Seedelf on mainnet under a 32-byte name",
            &bob,
            seedelf(&bob, mainnet(), &full, "bob's other mainnet seedelf"),
            false,
        ),
    ];
    let mut goods = Vec::new();
    let mut bytes = Vec::new();
    let mut made_by = Vec::new();
    for (i, (description, who, seedelf, reduce)) in cases.iter().enumerate() {
        let (spend, messaging) = (spend_key(who), key(who));
        let draw = if *reduce {
            (0..)
                .map(|t| format!("certificate v1 {i}, try {t}"))
                .find(|label| at_least_q(&spend, &messaging, seedelf, label))
                .unwrap()
        } else {
            format!("certificate v1 {i}")
        };
        let (value, made) = good_json(description, &spend, &messaging, seedelf, &draw);
        made_by.push((
            Certificate::from_bytes(seedelf.chain(), &made).unwrap(),
            who.to_string(),
        ));
        goods.push(value);
        bytes.push(made);
    }
    let (withdrawals, withdrawal_refusals) = super::withdrawal::vectors(&made_by);
    let refusals: Vec<Value> = refusals(&bytes[0], &bytes[1])
        .into_iter()
        .chain(std::iter::once((
            "Mallory's Seedelf with Bob's m_S: x's half proved, x_m's guessed".to_string(),
            test_chain(),
            mallory_binds_bobs_messaging_value(),
            Err(Error::InvalidCertificate),
        )))
        .chain(pinned_refusals(&bytes[1]))
        .map(|(name, chain, certificate, expected)| {
            let result = match Certificate::from_bytes(&chain, &certificate) {
                Ok(_) => "ok",
                Err(error) => code(error),
            };
            assert_eq!(result, expected.map_or_else(code, |()| "ok"), "{name}");
            json!({
                "name": name,
                "network": chain.network(),
                "policy": hex(chain.policy()),
                "certificate": hex(&certificate),
                "result": result,
            })
        })
        .collect();
    json!({
        "version": 1,
        "description": "Seedelf Messaging's certificate (docs/protocol.md §21.4): one Fiat–Shamir challenge over two Schnorr proofs, knowledge of the Seedelf key x with u_S = [x]g_S and of the messaging key x_m with m_S = [x_m]h_S, h_S RFC 9380's hash to G1 of the Seedelf's base_message (network ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S) under handle_base_dst (§21.3). The statement is every byte before c. aux is the one draw: k_m = HMAC-SHA-512(x_m, nonce_m_label ‖ statement ‖ aux) mod q, T_m = [k_m]h_S, k_x = HMAC-SHA-512(x, nonce_x_label ‖ statement ‖ T_m ‖ aux) mod q, T_x = [k_x]g_S, c = SHA-256(label ‖ statement ‖ T_x ‖ T_m) mod q, z_x = k_x + c·x and z_m = k_m + c·x_m, the keys and scalars 32 bytes big-endian, the points 48-byte compressed G1. Network 0 is preprod, 1 mainnet; the policy is variant 1's Seedelf policy. Each good certificate's listing_digest is SHA-256(listing_stamp_label ‖ len(pool) ‖ pool ‖ certificate) under its pool's name, preprod or mainnet, the digest its post's stamp is over (§21.7). A refusal is read under its network and policy, its result the reader's: ok, or the refusal's code, the crate's error in snake case. The scalars plus q (still 32 bytes) are refused, never reduced: reduced, each is a good certificate again. Each withdrawal (§21.7) takes the certificate at its index off its pool's list: its statement is version ‖ network ‖ digest, the digest that certificate's listing_digest; k = HMAC-SHA-512(x_m, withdrawal_nonce_label ‖ statement ‖ h_S ‖ m_S ‖ aux) mod q, T = [k]h_S, c = SHA-256(withdrawal_label ‖ statement ‖ h_S ‖ m_S ‖ T) mod q and z = k + c·x_m, the withdrawal statement ‖ c ‖ z, 98 bytes, with (h_S, m_S) the certificate's messaging register; its unlisting_digest is SHA-256(unlisting_stamp_label ‖ len(pool) ‖ pool ‖ withdrawal). A withdrawal refusal is read under its network and policy, then checked against the certificate under `against`, read under that one's.",
        "label": String::from_utf8(CERTIFICATE_LABEL.to_vec()).unwrap(),
        "nonce_m_label": String::from_utf8(CERTIFICATE_NONCE_M_LABEL.to_vec()).unwrap(),
        "nonce_x_label": String::from_utf8(CERTIFICATE_NONCE_X_LABEL.to_vec()).unwrap(),
        "handle_base_dst": String::from_utf8(HANDLE_BASE_DST.to_vec()).unwrap(),
        "listing_stamp_label": String::from_utf8(LISTING_STAMP_LABEL.to_vec()).unwrap(),
        "withdrawal_label": String::from_utf8(WITHDRAWAL_LABEL.to_vec()).unwrap(),
        "withdrawal_nonce_label": String::from_utf8(WITHDRAWAL_NONCE_LABEL.to_vec()).unwrap(),
        "unlisting_stamp_label": String::from_utf8(UNLISTING_STAMP_LABEL.to_vec()).unwrap(),
        "group_order": GROUP_ORDER,
        "networks": { "preprod": NETWORK_PREPROD, "mainnet": NETWORK_MAINNET },
        "certificates": goods,
        "refusals": refusals,
        "withdrawals": withdrawals,
        "withdrawal_refusals": withdrawal_refusals,
    })
}

/// The vectors file is what the code computes.
/// `RECORD_MESSAGING_CERTIFICATE_VECTORS=1` rewrites it, for a deliberate
/// change of format only: other implementations, and the relay's copy of
/// the check, are held to these bytes. It never touches the other vectors
/// files.
#[test]
fn certificate_vectors_match_the_file() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let computed = all_vectors();
    if recording() {
        let text = serde_json::to_string_pretty(&computed).expect("serializes") + "\n";
        std::fs::write(&path, text).expect("writes the vectors");
    }
    let recorded: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("reads the vectors"))
            .expect("parses the vectors");
    assert_eq!(computed, recorded);
}
