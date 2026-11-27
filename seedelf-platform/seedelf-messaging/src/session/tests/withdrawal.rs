//! A withdrawal (docs/protocol.md §21.7, chunk 55's call 9): made, read back
//! and checked against the certificate it names; the maker's refusal; its
//! nonce, challenge and response recomputed from §21.7's formulas with the
//! hmac crate itself; every refusal of its parser and its check, in order;
//! that the spending verifiers refuse its transcript; that it and a
//! certificate never read as each other; its unlisting digest; and its part
//! of tests/vectors/messaging_certificate_v1.json, which the certificate's
//! recorder writes.

use blstrs::{G1Projective, Scalar};
use group::Curve;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::certificate::{
    GROUP_ORDER, alices, hex, hmac_sha512, mainnet, name, offsets, seedelf_of, with_bytes,
};
use super::support::{Seeded, Stuck, key, spend_key, test_chain, test_policy, test_scalar};
use crate::keys::scalar_mod_q;
use crate::relay::{
    LISTING_STAMP_LABEL, UNLISTING_STAMP_LABEL, listing_digest, stamp_digest, unlisting_digest,
};
use crate::session::certificate::{
    Certificate, WITHDRAWAL_LABEL, WITHDRAWAL_LEN, WITHDRAWAL_NONCE_LABEL, WITHDRAWAL_VERSION,
    Withdrawal, withdrawal_challenge, withdrawal_nonce_message,
};
use crate::session::seedelf::{Chain, NETWORK_MAINNET, Seedelf};
use crate::{Error, SecretKey};

/// Where a withdrawal holds its digest, c and z.
const DIGEST_AT: usize = 2;
const C_AT: usize = 34;
const Z_AT: usize = 66;

/// A refusal: its name, the chain the withdrawal is read under, its bytes,
/// the certificate it's checked against with the chain that's read under,
/// and what it comes to.
pub(super) type Case = (String, Chain, Vec<u8>, (Chain, Vec<u8>), Result<(), Error>);

/// A withdrawal's statement as §21.7 spells it, built here: `version ‖
/// network ‖ digest`, the digest the certificate's listing digest under its
/// pool's name.
fn spelled_statement(certificate: &Certificate) -> Vec<u8> {
    let chain = certificate.seedelf().chain();
    let digest = listing_digest(chain.pool(), &certificate.to_bytes()).unwrap();
    [&[0x01, chain.network()][..], &digest].concat()
}

/// A withdrawal of `certificate` proved with `key` and the nonce `k`, built
/// here from §21.7: T = [k]h_S, c the challenge over the statement, h_S,
/// m_S and T, and z = k + c·key. With the certificate's own messaging key
/// it's a good withdrawal; with any other, one its check refuses.
fn built(certificate: &Certificate, key: &Scalar, k: Scalar) -> Vec<u8> {
    let register = certificate.handle().register();
    let statement = spelled_statement(certificate);
    let t = (register.generator() * k).to_affine();
    let c = scalar_mod_q(&withdrawal_challenge(&statement, register, &t));
    [
        &statement[..],
        &c.to_bytes_be(),
        &(k + c * key).to_bytes_be(),
    ]
    .concat()
}

/// The commitment a withdrawal's bytes give on `certificate`'s messaging
/// register: T = [z]h_S − [c]m_S.
fn commitment(bytes: &[u8], certificate: &Certificate) -> (G1Projective, Scalar, Scalar) {
    let scalar = |at: usize| -> Scalar {
        Option::from(Scalar::from_bytes_be(
            &bytes[at..at + 32].try_into().unwrap(),
        ))
        .unwrap()
    };
    let (c, z) = (scalar(C_AT), scalar(Z_AT));
    let register = certificate.handle().register();
    (register.generator() * z - register.public_value() * c, c, z)
}

/// `bytes`' 32-byte value at `at` plus q, still 32 bytes since q < 2²⁵⁶.
fn plus_q(bytes: &[u8], at: usize) -> [u8; 32] {
    let q: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    let mut sum = [0u8; 32];
    let mut carry = 0u16;
    for i in (0..32).rev() {
        let digit = u16::from(bytes[at + i]) + u16::from(q[i]) + carry;
        sum[i] = digit as u8;
        carry = digit >> 8;
    }
    assert_eq!(carry, 0, "a scalar plus q is below 2²⁵⁶");
    assert_eq!(scalar_mod_q(&sum), scalar_mod_q(&bytes[at..at + 32]));
    sum
}

#[test]
fn the_sizes_and_labels_are_the_specs() {
    assert_eq!((WITHDRAWAL_LEN, WITHDRAWAL_VERSION), (98, 0x01));
    assert_eq!(WITHDRAWAL_LABEL, b"Seedelf-Messaging|v1|withdrawal");
    assert_eq!(
        WITHDRAWAL_NONCE_LABEL,
        b"Seedelf-Messaging|v1|withdrawal-nonce"
    );
    assert_eq!(
        UNLISTING_STAMP_LABEL,
        b"Seedelf-Messaging|v1|unlisting-stamp|"
    );
    assert_eq!(test_chain().pool(), "preprod");
    assert_eq!(mainnet().pool(), "mainnet");
}

/// A withdrawal made on each network, of a certificate with a name of 1
/// byte and of 32, reads back as itself and checks against the certificate
/// it names, read back as the relay holds it. It names that certificate by
/// its listing digest under its pool. Each is made afresh.
#[test]
fn a_withdrawal_is_made_read_back_and_checked() {
    let alice = key("alice");
    for chain in [test_chain(), mainnet()] {
        for len in [1usize, 32] {
            let (_, certificate, posted) = alices(chain, &name(len), "withdrawn");
            let held = Certificate::from_bytes(&chain, &posted).unwrap();
            let withdrawal = Withdrawal::make(&alice, &certificate).unwrap();
            let bytes = withdrawal.to_bytes();
            assert_eq!(bytes.len(), WITHDRAWAL_LEN);
            assert_eq!((bytes[0], bytes[1]), (WITHDRAWAL_VERSION, chain.network()));
            let digest = listing_digest(chain.pool(), &posted).unwrap();
            assert_eq!(certificate.listing_digest(), digest);
            assert_eq!(withdrawal.digest(), &digest);
            assert_eq!(&bytes[DIGEST_AT..C_AT], &digest[..]);
            let read = Withdrawal::from_bytes(&chain, &bytes).unwrap();
            assert_eq!(read, withdrawal);
            assert_eq!(read.to_bytes(), bytes);
            assert_eq!(read.check(&held), Ok(()));
            assert_eq!(withdrawal.check(&certificate), Ok(()));
            let again = Withdrawal::make(&alice, &certificate).unwrap();
            assert_ne!(again.to_bytes(), bytes);
            assert_eq!(again.digest(), &digest);
            assert_eq!(again.check(&held), Ok(()));
        }
    }
}

/// The maker refuses a certificate whose m_S isn't its key's, before the
/// key meets anything, drawing nothing: another wallet's certificate, one's
/// own Seedelf certified under another messaging key, and one's own
/// certificate with the Seedelf key, which never withdraws.
#[test]
fn make_refuses_a_certificate_whose_messaging_value_isnt_the_keys() {
    let alice = key("alice");
    let chain = test_chain();
    let bobs = Certificate::make(
        &spend_key("bob"),
        &key("bob"),
        &seedelf_of("bob", chain, &name(32)),
    )
    .unwrap();
    let hers = seedelf_of("alice", chain, &name(32));
    let other_wallet =
        Certificate::make(&spend_key("alice"), &key("alice's other wallet"), &hers).unwrap();
    let own = Certificate::make(&spend_key("alice"), &alice, &hers).unwrap();
    for (key, certificate) in [
        (&alice, &bobs),
        (&alice, &other_wallet),
        (&spend_key("alice"), &own),
    ] {
        let mut draw = Seeded::new("refused withdrawal");
        assert_eq!(
            Withdrawal::make_with(key, certificate, &mut draw).err(),
            Some(Error::NotForThisKey)
        );
        assert!(draw.drain().is_empty());
        assert_eq!(
            Withdrawal::make(key, certificate).err(),
            Some(Error::NotForThisKey)
        );
    }
    assert!(Withdrawal::make(&alice, &own).is_ok());
}

/// k, T, c and z from §21.7's formulas, with the hmac crate and SHA-256
/// themselves: k = HMAC-SHA-512(x_m, label_nonce ‖ statement ‖ h_S ‖ m_S ‖
/// aux) mod q, T = [k]h_S, c = SHA-256(label ‖ statement ‖ h_S ‖ m_S ‖ T)
/// mod q, z = k + c·x_m. The crate's own messages agree, and the withdrawal
/// is the statement, c and z.
#[test]
fn the_nonce_is_hmac_sha512_of_the_statement_and_register_under_x_m() {
    let x_m = key("alice");
    for (chain, len) in [(test_chain(), 32usize), (mainnet(), 1)] {
        let (_, certificate, _) = alices(chain, &name(len), "withdrawal nonce");
        let mut draw = Seeded::new(&format!("withdrawal nonce {len}"));
        let withdrawal = Withdrawal::make_with(&x_m, &certificate, &mut draw).unwrap();
        let drawn = draw.drain();
        assert_eq!(drawn.len(), 1, "a withdrawal draws its aux alone");
        let aux: [u8; 32] = drawn[0].clone().try_into().unwrap();
        let register = certificate.handle().register();
        let (h, m) = (register.generator_bytes(), register.public_value_bytes());
        let statement = spelled_statement(&certificate);
        let message = [
            &b"Seedelf-Messaging|v1|withdrawal-nonce"[..],
            &statement,
            &h,
            &m,
            &aux,
        ]
        .concat();
        assert_eq!(
            withdrawal_nonce_message(&statement, register, &aux),
            message
        );
        let k = scalar_mod_q(&hmac_sha512(&x_m.scalar().to_bytes_be(), &message));
        let t = (register.generator() * k).to_affine();
        let hash: [u8; 32] = Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|withdrawal")
            .chain_update(&statement)
            .chain_update(h)
            .chain_update(m)
            .chain_update(t.to_compressed())
            .finalize()
            .into();
        assert_eq!(withdrawal_challenge(&statement, register, &t), hash);
        let c = scalar_mod_q(&hash);
        let z = k + c * x_m.scalar();
        assert_eq!(
            withdrawal.to_bytes(),
            [&statement[..], &c.to_bytes_be(), &z.to_bytes_be()].concat()
        );
        assert_eq!(built(&certificate, &x_m.scalar(), k), withdrawal.to_bytes());
        assert_eq!(
            commitment(&withdrawal.to_bytes(), &certificate).0,
            G1Projective::from(t)
        );
    }
}

/// One aux, one withdrawal: a source that repeats gives the same withdrawal
/// again, byte for byte. The same stuck source on another posting of the
/// same Seedelf, which has the same (h_S, m_S) and another digest, gives
/// another nonce, as does another aux: never one k under two challenges.
#[test]
fn a_repeated_draw_gives_the_identical_withdrawal() {
    let alice = key("alice");
    let stuck = |aux: u8| Stuck {
        scalar: Scalar::from(5u64),
        aux: [aux; 32],
    };
    let (seedelf, first, _) = alices(test_chain(), &name(32), "a posting");
    let once = Withdrawal::make_with(&alice, &first, &mut stuck(0x5a)).unwrap();
    let again = Withdrawal::make_with(&alice, &first, &mut stuck(0x5a)).unwrap();
    assert_eq!(once, again);
    assert_eq!(once.to_bytes(), again.to_bytes());
    let second = Certificate::make_with(
        &spend_key("alice"),
        &alice,
        &seedelf,
        &mut Seeded::new("another posting"),
    )
    .unwrap();
    assert_eq!(second.handle(), first.handle());
    assert_ne!(second.listing_digest(), first.listing_digest());
    let other = Withdrawal::make_with(&alice, &second, &mut stuck(0x5a)).unwrap();
    let (t_once, c_once, _) = commitment(&once.to_bytes(), &first);
    let (t_other, c_other, _) = commitment(&other.to_bytes(), &second);
    assert_ne!(t_once, t_other, "one k under two challenges");
    assert_ne!(c_once, c_other);
    let other_aux = Withdrawal::make_with(&alice, &first, &mut stuck(0xa5)).unwrap();
    assert_ne!(commitment(&other_aux.to_bytes(), &first).0, t_once);
}

/// The refusals of `Withdrawal::from_bytes`, in its order, from `good`, a
/// good withdrawal read under preprod and checked against `against`: its
/// length (98), its version, its network, then c and z below q. Where two
/// faults meet, the earlier check names the refusal.
pub(super) fn parse_refusals(good: &[u8], against: &[u8]) -> Vec<Case> {
    let (preprod, other) = (test_chain(), mainnet());
    let q: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    let held = (preprod, against.to_vec());
    let refused = Err(Error::InvalidWithdrawal);
    let case = |name: &str, chain: Chain, bytes: Vec<u8>, expected: Result<(), Error>| {
        (name.to_string(), chain, bytes, held.clone(), expected)
    };
    vec![
        case(
            "a good withdrawal, against its certificate",
            preprod,
            good.to_vec(),
            Ok(()),
        ),
        case("97 bytes: one short", preprod, good[..97].to_vec(), refused),
        case(
            "99 bytes: a byte after",
            preprod,
            [good, &[0]].concat(),
            refused,
        ),
        case("no bytes", preprod, Vec::new(), refused),
        case(
            "version 0x02",
            preprod,
            with_bytes(good, 0, &[0x02]),
            Err(Error::UnsupportedVersion(0x02)),
        ),
        case(
            "version 0x00",
            preprod,
            with_bytes(good, 0, &[0x00]),
            Err(Error::UnsupportedVersion(0x00)),
        ),
        case(
            "version 0x02 in 99 bytes: the length before the version",
            preprod,
            [&with_bytes(good, 0, &[0x02])[..], &[0]].concat(),
            refused,
        ),
        case(
            "version 0x02 and mainnet's network byte: the version before the network",
            preprod,
            with_bytes(&with_bytes(good, 0, &[0x02]), 1, &[NETWORK_MAINNET]),
            Err(Error::UnsupportedVersion(0x02)),
        ),
        case(
            "mainnet's network byte, read under preprod",
            preprod,
            with_bytes(good, 1, &[NETWORK_MAINNET]),
            refused,
        ),
        case(
            "network 0x02",
            preprod,
            with_bytes(good, 1, &[0x02]),
            refused,
        ),
        case(
            "preprod's withdrawal, read under mainnet",
            other,
            good.to_vec(),
            refused,
        ),
        case("c at q", preprod, with_bytes(good, C_AT, &q), refused),
        case("z at q", preprod, with_bytes(good, Z_AT, &q), refused),
        case(
            "c + q, 32 bytes still: a reader that reduced c mod q, not refusing it, would take it",
            preprod,
            with_bytes(good, C_AT, &plus_q(good, C_AT)),
            refused,
        ),
        case(
            "z + q, 32 bytes still: a reader that reduced z mod q, not refusing it, would take it",
            preprod,
            with_bytes(good, Z_AT, &plus_q(good, Z_AT)),
            refused,
        ),
        case(
            "c all ones",
            preprod,
            with_bytes(good, C_AT, &[0xff; 32]),
            refused,
        ),
        case(
            "z all ones",
            preprod,
            with_bytes(good, Z_AT, &[0xff; 32]),
            refused,
        ),
    ]
}

/// The refusals of `Withdrawal::check`, of withdrawals that read, and of a
/// certificate's bytes read as one: each checked against a certificate of
/// the list. `good` withdraws `posted`, a preprod certificate of `who`'s;
/// `other_seedelf` is a certificate of another Seedelf of the same key's.
pub(super) fn check_refusals(
    good: &[u8],
    posted: &Certificate,
    who: &str,
    other_seedelf: &Certificate,
) -> Vec<Case> {
    let preprod = test_chain();
    let seedelf = posted.seedelf();
    let x_m = key(who);
    let refused = Err(Error::InvalidWithdrawal);
    let held = |certificate: &Certificate| (*certificate.seedelf().chain(), certificate.to_bytes());
    // Another posting of the same Seedelf, with a fresh aux: the same m_S,
    // another digest.
    let reposted = Certificate::make_with(
        &spend_key(who),
        &x_m,
        seedelf,
        &mut Seeded::new("withdrawal v1, another posting"),
    )
    .unwrap();
    assert_eq!(reposted.handle(), posted.handle());
    // The same Seedelf on the other network, its own certificate.
    let twin = Seedelf::new(mainnet(), seedelf.name(), *seedelf.register()).unwrap();
    let twins = Certificate::make_with(
        &spend_key(who),
        &x_m,
        &twin,
        &mut Seeded::new("withdrawal v1, the mainnet twin"),
    )
    .unwrap();
    let k = test_scalar("withdrawal v1, a nonce of the forger's");
    assert_eq!(built(posted, &x_m.scalar(), k).len(), WITHDRAWAL_LEN);
    let other_digest = with_bytes(good, DIGEST_AT, &reposted.listing_digest());
    vec![
        (
            "against another certificate of the same key's: another Seedelf, another digest".into(),
            preprod,
            good.to_vec(),
            held(other_seedelf),
            refused,
        ),
        (
            "against another posting of the same Seedelf: the same m_S, another digest".into(),
            preprod,
            good.to_vec(),
            held(&reposted),
            refused,
        ),
        (
            "with the other posting's digest, against it: the digest is in the challenge".into(),
            preprod,
            other_digest,
            held(&reposted),
            refused,
        ),
        (
            "the digest's first byte flipped".into(),
            preprod,
            with_bytes(good, DIGEST_AT, &[good[DIGEST_AT] ^ 0x01]),
            held(posted),
            refused,
        ),
        (
            "c's last byte flipped".into(),
            preprod,
            with_bytes(good, C_AT + 31, &[good[C_AT + 31] ^ 0x01]),
            held(posted),
            refused,
        ),
        (
            "z's last byte flipped".into(),
            preprod,
            with_bytes(good, Z_AT + 31, &[good[Z_AT + 31] ^ 0x01]),
            held(posted),
            refused,
        ),
        (
            "made under preprod, against the same Seedelf's certificate read under mainnet".into(),
            preprod,
            good.to_vec(),
            held(&twins),
            refused,
        ),
        (
            "a withdrawal of the same Seedelf made under mainnet, against its preprod certificate"
                .into(),
            mainnet(),
            Withdrawal::make_with(&x_m, &twins, &mut Seeded::new("withdrawal v1, the twin's"))
                .unwrap()
                .to_bytes(),
            held(posted),
            refused,
        ),
        (
            "proved with the Seedelf key x, not x_m: x never withdraws".into(),
            preprod,
            built(posted, &spend_key(who).scalar(), k),
            held(posted),
            refused,
        ),
        (
            "proved with another wallet's messaging key".into(),
            preprod,
            built(posted, &key("mallory").scalar(), k),
            held(posted),
            refused,
        ),
        (
            "built here from §21.7 with the certificate's own messaging key: a good one".into(),
            preprod,
            built(posted, &x_m.scalar(), k),
            held(posted),
            Ok(()),
        ),
        (
            "a certificate's own bytes, as a withdrawal".into(),
            preprod,
            posted.to_bytes(),
            held(posted),
            refused,
        ),
    ]
}

/// What a reader makes of a case: the withdrawal read under its chain, then
/// checked against the certificate read under its own.
pub(super) fn verdict(case: &Case) -> Result<(), Error> {
    let (_, chain, bytes, (held_chain, held), _) = case;
    let certificate = Certificate::from_bytes(held_chain, held).expect("a held certificate");
    Withdrawal::from_bytes(chain, bytes)?.check(&certificate)
}

/// The cases' Seedelf and certificates: Alice's, on preprod, and one more of
/// hers.
fn fixtures() -> (Vec<u8>, Certificate, Certificate) {
    let (_, posted, _) = alices(test_chain(), &name(32), "withdrawal refusals");
    let (_, other, _) = alices(test_chain(), &name(1), "withdrawal refusals, another");
    let good = Withdrawal::make_with(&key("alice"), &posted, &mut Seeded::new("refusals"))
        .unwrap()
        .to_bytes();
    (good, posted, other)
}

#[test]
fn from_bytes_refuses_each_fault_in_its_order() {
    let (good, posted, _) = fixtures();
    for case in parse_refusals(&good, &posted.to_bytes()) {
        assert_eq!(verdict(&case), case.4, "{}", case.0);
    }
}

#[test]
fn check_refuses_another_certificate_a_changed_proof_and_another_key() {
    let (good, posted, other) = fixtures();
    for case in check_refusals(&good, &posted, "alice", &other) {
        assert_eq!(verdict(&case), case.4, "{}", case.0);
    }
}

/// Never a spending proof: a withdrawal's (T, c, z) is a Schnorr transcript
/// on the certificate's messaging register (h_S, m_S), which another tool
/// could pay. seedelf-crypto's verifiers, the chain's and Lovejoin's owner
/// proof, refuse it as it is and mauled to any challenge t,
/// T′ = T + [c − t]m_S, under several vkhs and contexts and for [d] of the
/// register; each takes a proof x_m makes for the same register.
#[test]
fn the_spending_verifiers_refuse_a_withdrawals_transcript() {
    use seedelf_crypto::lovejoin::{
        SchnorrProof, fs_hash_schnorr, prove_schnorr, reduce, verify_schnorr,
    };
    use seedelf_crypto::schnorr::{create_proof, fiat_shamir_heuristic, prove};
    let x_m = key("alice");
    let hex_point = |point: &G1Projective| hex(point.to_compressed());
    let vkhs = [
        "00".repeat(28),
        "5eed".repeat(14),
        hex(&Sha256::digest(b"a one-time key")[..28]),
    ];
    let contexts: [&[u8]; 2] = [b"any ctx", b"lovejoin"];
    for chain in [test_chain(), mainnet()] {
        let (_, certificate, _) = alices(chain, &name(32), "withdrawal cross protocol");
        let bytes = Withdrawal::make(&x_m, &certificate).unwrap().to_bytes();
        let (t, c, z) = commitment(&bytes, &certificate);
        let register = certificate.handle().register();
        let (h, m) = (register.generator(), register.public_value());
        assert_eq!(h * z, t + m * c);

        let seedelf_register =
            seedelf_crypto::register::Register::new(hex_point(&h), hex_point(&m));
        let (proof_z, proof_t) =
            create_proof(seedelf_register, x_m.scalar(), vkhs[0].clone()).unwrap();
        assert!(prove(&hex_point(&h), &hex_point(&m), &proof_z, &proof_t, &vkhs[0]).unwrap());
        let owner = prove_schnorr(&h, &x_m.scalar(), contexts[0]).unwrap();
        assert!(verify_schnorr(&h, &m, &owner, contexts[0]));

        for d in [Scalar::from(1u64), test_scalar("d1")] {
            let (hd, md, td) = (h * d, m * d, t * d);
            for vkh in &vkhs {
                let own = fiat_shamir_heuristic(
                    hex_point(&hd),
                    hex_point(&td),
                    hex_point(&md),
                    vkh.clone(),
                )
                .unwrap();
                let own: [u8; 32] = hex::decode(format!("{own:0>64}"))
                    .unwrap()
                    .try_into()
                    .unwrap();
                for challenge in [c, scalar_mod_q(&own), test_scalar("any t")] {
                    let mauled = td + md * (c - challenge);
                    assert_eq!(hd * z, mauled + md * challenge);
                    assert!(
                        !prove(
                            &hex_point(&hd),
                            &hex_point(&md),
                            &hex(z.to_bytes_be()),
                            &hex_point(&mauled),
                            vkh
                        )
                        .unwrap()
                    );
                }
            }
            for ctx in contexts {
                let own = reduce(&fs_hash_schnorr(
                    &hd.to_compressed(),
                    &md.to_compressed(),
                    &td.to_compressed(),
                    ctx,
                ));
                for challenge in [c, own] {
                    let mauled = td + md * (c - challenge);
                    let transcript = SchnorrProof {
                        t: mauled.to_compressed(),
                        z: z.to_bytes_be(),
                    };
                    assert!(!verify_schnorr(&hd, &md, &transcript, ctx));
                }
            }
        }
    }
}

/// A withdrawal's (T, c, z) and a certificate's x_m half (T_m, c, z_m) are
/// both Schnorr transcripts of x_m on the same (h_S, m_S), and neither
/// passes for the other: each challenge is over its own label and its own
/// statement. A withdrawal's c and z put in a certificate as its c and z_m,
/// with any z_x, give T_m = T and are refused; a certificate's c and z_m as
/// a withdrawal of it give T = T_m and are refused.
#[test]
fn a_withdrawals_transcript_never_passes_a_certificates_check_and_the_reverse() {
    let x_m = key("alice");
    let chain = test_chain();
    let (_, certificate, posted) = alices(chain, &name(32), "transcripts apart");
    let register = certificate.handle().register();
    let withdrawal = Withdrawal::make(&x_m, &certificate).unwrap().to_bytes();
    let (t, c, z) = commitment(&withdrawal, &certificate);
    let (_, scalars) = offsets(32);

    // The withdrawal's transcript as the certificate's x_m half.
    let (_, c_cert, z_x) = certificate.seedelf_transcript();
    for any_z_x in [z_x, Scalar::from(0u64), test_scalar("any z_x")] {
        let mut forged = with_bytes(&posted, scalars[0], &c.to_bytes_be());
        forged[scalars[1]..scalars[1] + 32].copy_from_slice(&any_z_x.to_bytes_be());
        forged[scalars[2]..scalars[2] + 32].copy_from_slice(&z.to_bytes_be());
        // The m half's commitment the check recomputes is the withdrawal's T.
        assert_eq!(register.generator() * z - register.public_value() * c, t);
        assert_eq!(
            Certificate::from_bytes(&chain, &forged).err(),
            Some(Error::InvalidCertificate)
        );
    }

    // The certificate's x_m half as a withdrawal of that certificate.
    let z_m = Option::<Scalar>::from(Scalar::from_bytes_be(
        &posted[scalars[2]..].try_into().unwrap(),
    ))
    .unwrap();
    let (_, t_m) = certificate.commitments();
    assert_eq!(
        register.generator() * z_m - register.public_value() * c_cert,
        G1Projective::from(t_m)
    );
    let as_withdrawal = [
        &[WITHDRAWAL_VERSION, chain.network()][..],
        &certificate.listing_digest(),
        &c_cert.to_bytes_be(),
        &z_m.to_bytes_be(),
    ]
    .concat();
    let read = Withdrawal::from_bytes(&chain, &as_withdrawal).unwrap();
    assert_eq!(read.check(&certificate), Err(Error::InvalidWithdrawal));
    // Nor its x half, which is on the Seedelf's register, never a withdrawal's.
    let as_withdrawal = [
        &[WITHDRAWAL_VERSION, chain.network()][..],
        &certificate.listing_digest(),
        &c_cert.to_bytes_be(),
        &z_x.to_bytes_be(),
    ]
    .concat();
    let read = Withdrawal::from_bytes(&chain, &as_withdrawal).unwrap();
    assert_eq!(read.check(&certificate), Err(Error::InvalidWithdrawal));
}

/// A withdrawal's bytes never read as a certificate, nor a certificate's as
/// a withdrawal: not whole, not a withdrawal padded to a certificate's
/// length. A certificate's first 98 bytes may read as a withdrawal's shape,
/// but never check against a certificate.
#[test]
fn a_withdrawal_and_a_certificate_never_read_as_each_other() {
    let alice = key("alice");
    let mut held = Vec::new();
    for chain in [test_chain(), mainnet()] {
        for len in [1usize, 32] {
            let (_, certificate, _) = alices(chain, &name(len), "never each other");
            held.push((chain, certificate));
        }
    }
    for (chain, certificate) in &held {
        let posted = certificate.to_bytes();
        let withdrawal = Withdrawal::make(&alice, certificate).unwrap().to_bytes();
        assert_eq!(
            Certificate::from_bytes(chain, &withdrawal).err(),
            Some(Error::InvalidCertificate)
        );
        let mut padded = withdrawal.clone();
        padded.resize(posted.len(), 0);
        assert_eq!(
            Certificate::from_bytes(chain, &padded).err(),
            Some(Error::InvalidCertificate)
        );
        assert_eq!(
            Withdrawal::from_bytes(chain, &posted).err(),
            Some(Error::InvalidWithdrawal)
        );
        if let Ok(prefix) = Withdrawal::from_bytes(chain, &posted[..WITHDRAWAL_LEN]) {
            for (_, other) in &held {
                assert!(prefix.check(other).is_err());
            }
        }
    }
}

/// A withdrawal post's stamp digest is §21.7's, built here:
/// SHA-256("Seedelf-Messaging|v1|unlisting-stamp|" ‖ len(pool) ‖ pool ‖
/// withdrawal). It's no envelope's stamp digest and no listing digest, and
/// another pool's is another digest.
#[test]
fn the_unlisting_digest_is_its_label_over_the_pool_and_the_withdrawal() {
    let (good, _, _) = fixtures();
    for pool in ["preprod", "mainnet"] {
        let by_hand: [u8; 32] = Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|unlisting-stamp|")
            .chain_update([pool.len() as u8])
            .chain_update(pool.as_bytes())
            .chain_update(&good)
            .finalize()
            .into();
        let digest = unlisting_digest(pool, &good).unwrap();
        assert_eq!(digest, by_hand);
        assert_ne!(digest, stamp_digest(pool, &good).unwrap());
        assert_ne!(digest, listing_digest(pool, &good).unwrap());
    }
    assert_ne!(
        unlisting_digest("preprod", &good).unwrap(),
        unlisting_digest("mainnet", &good).unwrap()
    );
    assert!(UNLISTING_STAMP_LABEL != LISTING_STAMP_LABEL);
    assert_eq!(
        unlisting_digest(&"x".repeat(256), &good),
        Err(Error::InvalidLength)
    );
    assert!(unlisting_digest(&"x".repeat(255), &good).is_ok());
}

// ---------------------------------------------------------------------------
// The vectors: tests/vectors/messaging_certificate_v1.json's withdrawals
// ---------------------------------------------------------------------------

/// The code a withdrawal's refusal goes by in the vectors.
fn code(error: Error) -> &'static str {
    match error {
        Error::InvalidWithdrawal => "invalid_withdrawal",
        Error::UnsupportedVersion(_) => "unsupported_version",
        other => panic!("no withdrawal vector refuses with {other:?}"),
    }
}

/// One good withdrawal of certificate `index` with every value between its
/// key and its bytes, each checked against the withdrawal the crate made
/// from the same draw.
fn good_json(
    index: usize,
    certificate: &Certificate,
    x_m: &SecretKey,
    label: &str,
) -> (Value, Vec<u8>) {
    let mut draw = Seeded::new(label);
    let withdrawal = Withdrawal::make_with(x_m, certificate, &mut draw).unwrap();
    let drawn = draw.drain();
    assert_eq!(drawn.len(), 1);
    let aux: [u8; 32] = drawn[0].clone().try_into().unwrap();
    let chain = certificate.seedelf().chain();
    let register = certificate.handle().register();
    let statement = spelled_statement(certificate);
    let message = withdrawal_nonce_message(&statement, register, &aux);
    let okm = hmac_sha512(&x_m.scalar().to_bytes_be(), &message);
    let k = scalar_mod_q(&okm);
    let t = (register.generator() * k).to_affine();
    let hash = withdrawal_challenge(&statement, register, &t);
    let c = scalar_mod_q(&hash);
    let z = k + c * x_m.scalar();
    let bytes = withdrawal.to_bytes();
    assert_eq!(
        bytes,
        [&statement[..], &c.to_bytes_be(), &z.to_bytes_be()].concat()
    );
    assert_eq!(withdrawal.check(certificate), Ok(()));
    let unlisting = unlisting_digest(chain.pool(), &bytes).unwrap();
    let value = json!({
        "name": format!("certificate {index}'s withdrawal"),
        "certificate": index,
        "network": chain.network(),
        "pool": chain.pool(),
        "digest": hex(certificate.listing_digest()),
        "messaging_secret_key": hex(x_m.scalar().to_bytes_be()),
        "base": hex(register.generator_bytes()),
        "messaging_value": hex(register.public_value_bytes()),
        "statement": hex(&statement),
        "draws": { "aux": hex(aux) },
        "nonce": { "message": hex(&message), "hmac": hex(okm), "scalar": hex(k.to_bytes_be()) },
        "t": hex(t.to_compressed()),
        "challenge": hex(hash),
        "c": hex(c.to_bytes_be()),
        "z": hex(z.to_bytes_be()),
        "withdrawal": hex(&bytes),
        "unlisting_digest": hex(unlisting),
    });
    (value, bytes)
}

/// The withdrawals section of the certificate vectors: one good withdrawal
/// of each of `certificates`, made with the messaging key of its `who`, and
/// the refusals, each with the certificate it's checked against.
pub(super) fn vectors(certificates: &[(Certificate, String)]) -> (Value, Value) {
    let mut goods = Vec::new();
    let mut bytes = Vec::new();
    for (i, (certificate, who)) in certificates.iter().enumerate() {
        let x_m = key(who);
        // Certificate 1's from the first draw whose challenge hash is at
        // least q, so a reader that doesn't reduce it gets it wrong.
        let label = if i == 1 {
            (0..)
                .map(|t| format!("withdrawal v1 {i}, try {t}"))
                .find(|label| {
                    let made =
                        Withdrawal::make_with(&x_m, certificate, &mut Seeded::new(label)).unwrap();
                    let (t, _, _) = commitment(&made.to_bytes(), certificate);
                    let hash = withdrawal_challenge(
                        &spelled_statement(certificate),
                        certificate.handle().register(),
                        &t.to_affine(),
                    );
                    Option::<Scalar>::from(Scalar::from_bytes_be(&hash)).is_none()
                })
                .unwrap()
        } else {
            format!("withdrawal v1 {i}")
        };
        let (value, made) = good_json(i, certificate, &x_m, &label);
        goods.push(value);
        bytes.push(made);
    }
    let (posted, who) = &certificates[1];
    assert_eq!(posted.seedelf().chain(), &test_chain());
    let refusals: Vec<Value> = parse_refusals(&bytes[1], &posted.to_bytes())
        .into_iter()
        .chain(check_refusals(&bytes[1], posted, who, &certificates[0].0))
        .map(|case| {
            let result = match verdict(&case) {
                Ok(()) => "ok",
                Err(error) => code(error),
            };
            assert_eq!(result, case.4.map_or_else(code, |()| "ok"), "{}", case.0);
            let (name, chain, withdrawal, (held_chain, held), _) = case;
            json!({
                "name": name,
                "network": chain.network(),
                "policy": hex(chain.policy()),
                "withdrawal": hex(&withdrawal),
                "against": {
                    "network": held_chain.network(),
                    "policy": hex(held_chain.policy()),
                    "certificate": hex(&held),
                },
                "result": result,
            })
        })
        .collect();
    assert_eq!(test_policy(), *posted.seedelf().chain().policy());
    (json!(goods), json!(refusals))
}
