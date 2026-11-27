//! A Seedelf's messaging register on its hashed base (docs/protocol.md
//! §21.3), and the two keys apart in a conversation (§21.6, §21.8).
//!
//! h_S is RFC 9380's hash to G1 of the Seedelf, never its datum's generator
//! g_S, so nobody chooses it; it differs for every network, policy, name and
//! register; and a handle M_S = (h_S, [x_m]h_S) is the messaging key's,
//! never the Seedelf key's. The hash itself is blstrs's, which calls blst:
//! no other implementation is in the dependency tree, so RFC 9380's own
//! vectors pin that route here, and the clean-room check covers it from
//! outside.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use group::prime::PrimeCurveAffine;

use super::support::{
    HANDLE_NAME, TEST_BITS, datum_register, key, spend_key, test_chain, test_inbox, test_policy,
};
use crate::register::{Register, matches_register};
use crate::relay::find_stamp;
use crate::session::certificate::Certificate;
use crate::session::inbox::Received;
use crate::session::seedelf::{
    Chain, HANDLE_BASE_DST, NETWORK_MAINNET, NETWORK_PREPROD, POLICY_LEN, Seedelf,
};
use crate::{Error, matches_envelope};

const T: u64 = 1_800_000_000;

/// h_S's message as §21.3 spells it, built here: `network ‖ policy ‖ len(N)
/// ‖ N ‖ g_S ‖ u_S`, the points compressed.
fn base_message(
    network: u8,
    policy: &[u8; POLICY_LEN],
    name: &[u8],
    register: &Register,
) -> Vec<u8> {
    let mut message = vec![network];
    message.extend_from_slice(policy);
    message.push(name.len() as u8);
    message.extend_from_slice(name);
    message.extend_from_slice(&register.generator_bytes());
    message.extend_from_slice(&register.public_value_bytes());
    message
}

/// RFC 9380's hash to G1 under the suite's own test DST, against its
/// Appendix J.9.1 vectors: blstrs's `hash_to_curve` with no augmentation is
/// `BLS12381G1_XMD:SHA-256_SSWU_RO_`, the suite h_S names.
#[test]
fn blstrs_hash_to_curve_is_rfc_9380s_g1_suite() {
    let dst = b"QUUX-V01-CS02-with-BLS12381G1_XMD:SHA-256_SSWU_RO_";
    let cases: [(&[u8], &str, &str); 2] = [
        (
            b"",
            "052926add2207b76ca4fa57a8734416c8dc95e24501772c814278700eed6d1e4e8cf62d9c09db0fac349612b759e79a1",
            "08ba738453bfed09cb546dbb0783dbb3a5f1f566ed67bb6be0e8c67e2e81a4cc68ee29813bb7994998f3eae0c9c6a265",
        ),
        (
            b"abc",
            "03567bc5ef9c690c2ab2ecdf6a96ef1c139cc0b2f284dca0a9a7943388a49a3aee664ba5379a7655d3c68900be2f6903",
            "0b9c15f3fe6e5cf4211f346271d7b01c8f3b28be689c8429c85b67af215533311f0b8dfaaa154fa6b88176c229f2885d",
        ),
    ];
    for (msg, x, y) in cases {
        let point = G1Projective::hash_to_curve(msg, dst, &[]).to_affine();
        assert_eq!(hex::encode(point.to_uncompressed()), format!("{x}{y}"));
    }
}

/// h_S is the hash of the Seedelf under `HANDLE_BASE_DST`, the message built
/// here from §21.3, and never g_S: not for a Seedelf at the standard
/// generator, not for one at any other. The DST is the spec's, ending in the
/// suite's ID.
#[test]
fn h_s_is_the_hash_of_the_seedelf_and_never_its_generator() {
    assert_eq!(
        HANDLE_BASE_DST,
        b"Seedelf-Messaging|v1|handle-base|BLS12381G1_XMD:SHA-256_SSWU_RO_"
    );
    assert_eq!(HANDLE_BASE_DST.len(), 64);
    assert!(HANDLE_BASE_DST.ends_with(b"BLS12381G1_XMD:SHA-256_SSWU_RO_"));
    let chain = test_chain();
    let messaging = key("alice");
    for register in [
        datum_register("alice", "a"),
        datum_register("alice", "b"),
        spend_key("alice").register(),
    ] {
        let seedelf = Seedelf::new(chain, HANDLE_NAME, register).unwrap();
        let message = base_message(chain.network(), chain.policy(), HANDLE_NAME, &register);
        assert_eq!(seedelf.base_message(), message);
        let hashed = G1Projective::hash_to_curve(&message, HANDLE_BASE_DST, &[]).to_affine();
        assert_eq!(seedelf.base().unwrap(), hashed);
        let handle = seedelf.handle(&messaging).unwrap();
        assert_eq!(handle.register().generator_point(), hashed);
        // In G1, not O, and never g_S.
        assert!(bool::from(hashed.is_torsion_free()) && !bool::from(hashed.is_identity()));
        assert_ne!(hashed, register.generator_point());
        assert_ne!(handle.register().generator(), register.generator());
        // The same message under a DST without the suite's ID isn't it.
        let bare = G1Projective::hash_to_curve(&message, b"Seedelf-Messaging|v1|handle-base", &[]);
        assert_ne!(bare.to_affine(), hashed);
    }
    // The root register's generator is G: h_S isn't G either.
    let root = Seedelf::new(chain, HANDLE_NAME, spend_key("alice").register()).unwrap();
    assert_ne!(root.base().unwrap(), G1Affine::generator());
}

/// One Seedelf's h_S is no other's: another network, another policy,
/// another name (by a byte, or by its length), another register of the
/// same key ([2](g_S, u_S)), another key's register on the same g_S, or the
/// register's points swapped.
#[test]
fn h_s_differs_across_network_policy_name_and_register() {
    let register = datum_register("alice", "a");
    let doubled = Register::from_checked(
        (register.generator() * Scalar::from(2u64)).to_affine(),
        (register.public_value() * Scalar::from(2u64)).to_affine(),
    );
    let others_key = Register::from_checked(
        register.generator_point(),
        (register.generator() * spend_key("bob").scalar()).to_affine(),
    );
    let swapped = Register::from_checked(
        register.public_value().to_affine(),
        register.generator_point(),
    );
    let mut policy = test_policy();
    policy[13] ^= 0x01;
    let preprod = test_chain();
    let mainnet = Chain::new(NETWORK_MAINNET, test_policy()).unwrap();
    let other_policy = Chain::new(NETWORK_PREPROD, policy).unwrap();
    let mut renamed = HANDLE_NAME.to_vec();
    renamed[0] ^= 0x01;
    let seedelfs = [
        (preprod, HANDLE_NAME.to_vec(), register),
        (mainnet, HANDLE_NAME.to_vec(), register),
        (other_policy, HANDLE_NAME.to_vec(), register),
        (preprod, renamed, register),
        (
            preprod,
            HANDLE_NAME[..HANDLE_NAME.len() - 1].to_vec(),
            register,
        ),
        (preprod, HANDLE_NAME.to_vec(), doubled),
        (preprod, HANDLE_NAME.to_vec(), others_key),
        (preprod, HANDLE_NAME.to_vec(), swapped),
    ];
    let bases: Vec<G1Affine> = seedelfs
        .iter()
        .map(|(chain, name, register)| {
            Seedelf::new(*chain, name, *register)
                .unwrap()
                .base()
                .unwrap()
        })
        .collect();
    for (i, one) in bases.iter().enumerate() {
        for (j, two) in bases.iter().enumerate().skip(i + 1) {
            assert_ne!(one, two, "Seedelfs {i} and {j} share h_S");
        }
    }
}

/// A handle's register is the messaging key's, on h_S: never on g_S, never
/// the Seedelf key's, and its base the same whichever key takes it.
#[test]
fn a_handle_is_the_messaging_keys_and_never_on_g_s() {
    let (x, x_m) = (spend_key("alice"), key("alice"));
    let seedelf = Seedelf::new(test_chain(), HANDLE_NAME, datum_register("alice", "a")).unwrap();
    assert!(matches_register(&x, seedelf.register()));
    assert!(!matches_register(&x_m, seedelf.register()));
    let handle = seedelf.handle(&x_m).unwrap();
    assert_eq!(handle.seedelf(), &seedelf);
    assert_eq!(handle.name(), HANDLE_NAME);
    assert!(matches_register(&x_m, handle.register()));
    assert!(!matches_register(&x, handle.register()));
    assert_ne!(
        handle.register().generator_bytes(),
        seedelf.register().generator_bytes()
    );
    let h_s = seedelf.base().unwrap();
    assert_eq!(
        handle.register().public_value(),
        G1Projective::from(h_s) * x_m.scalar()
    );
    // Another key on the same Seedelf: the same base, another value.
    let other = seedelf.handle(&x).unwrap();
    assert_eq!(other.register().generator_point(), h_s);
    assert_ne!(other.register(), handle.register());
}

/// A datum register never serves as a messaging register (rule 1m): for
/// any key, the Seedelf's key, its messaging key, another's or 1, a
/// handle of a Seedelf is never its datum register (g_S, u_S), nor on g_S.
/// And a Seedelf whose datum register is another Seedelf's messaging
/// register M_B, put on chain as a datum, has a handle on its own hash,
/// never M_B or h_B: no datum makes the wallet answer on a base it chose.
#[test]
fn a_handle_never_has_its_seedelfs_datum_register_for_any_key() {
    let chain = test_chain();
    let keys = [
        spend_key("alice"),
        key("alice"),
        key("bob"),
        crate::SecretKey::from_scalar(Scalar::from(1u64)).unwrap(),
    ];
    let bobs = Seedelf::new(chain, b"b", datum_register("bob", "b")).unwrap();
    let m_b = *bobs.handle(&key("bob")).unwrap().register();
    let seedelfs = [
        Seedelf::new(chain, HANDLE_NAME, datum_register("alice", "a")).unwrap(),
        Seedelf::new(chain, HANDLE_NAME, spend_key("alice").register()).unwrap(),
        bobs.clone(),
        // A datum that is Bob's messaging register.
        Seedelf::new(chain, b"a", m_b).unwrap(),
    ];
    for (i, seedelf) in seedelfs.iter().enumerate() {
        for (j, key) in keys.iter().enumerate() {
            let handle = seedelf.handle(key).unwrap();
            assert_ne!(
                handle.register(),
                seedelf.register(),
                "Seedelf {i}, key {j}"
            );
            assert_ne!(
                handle.register().generator_bytes(),
                seedelf.register().generator_bytes(),
                "Seedelf {i}, key {j}"
            );
            // M_B is Bob's handle of his own Seedelf, and no other.
            assert_eq!(
                handle.register() == &m_b,
                (i, j) == (2, 2),
                "Seedelf {i}, key {j}"
            );
        }
    }
}

/// A Seedelf's chain and name: preprod and mainnet only, a name of 1 to 32
/// bytes.
#[test]
fn a_seedelf_is_on_a_known_network_with_a_whole_name() {
    for network in [NETWORK_PREPROD, NETWORK_MAINNET] {
        let chain = Chain::new(network, test_policy()).unwrap();
        assert_eq!((chain.network(), chain.policy()), (network, &test_policy()));
    }
    assert_eq!((NETWORK_PREPROD, NETWORK_MAINNET), (0x00, 0x01));
    for network in [0x02, 0x03, 0x7f, 0xff] {
        assert_eq!(
            Chain::new(network, test_policy()),
            Err(Error::UnknownNetwork)
        );
    }
    let register = datum_register("alice", "a");
    for len in [1usize, 32] {
        assert!(Seedelf::new(test_chain(), &[0x5e; 32][..len], register).is_ok());
    }
    for name in [&[][..], &[0x5e; 33][..]] {
        assert_eq!(
            Seedelf::new(test_chain(), name, register),
            Err(Error::InvalidMessage)
        );
    }
}

/// The handle a writer gets from a certificate, as the relay's list gives
/// it: a first message to it is taken by the reader holding that Seedelf's
/// messaging key, and refused by one holding only its Seedelf key, with or
/// without the messaging key's handles, its envelope never matching that
/// key. Then the conversation runs, and the writer's reveal of its own
/// Seedelf names the messaging register its certificate does (§21.8, §21.9).
#[test]
fn a_first_message_to_a_certified_handle_reads_with_the_messaging_key_alone() {
    let chain = test_chain();
    let (bob_x, bob_m) = (spend_key("bob"), key("bob"));
    let (alice_x, alice_m) = (spend_key("alice"), key("alice"));
    let bobs = Seedelf::new(chain, HANDLE_NAME, datum_register("bob", "certified")).unwrap();
    let posted = Certificate::make(&bob_x, &bob_m, &bobs).unwrap().to_bytes();

    // Alice reads Bob's certificate and his Seedelf's register on chain.
    let certificate = Certificate::from_bytes(&chain, &posted).unwrap();
    assert!(certificate.is_for(&bobs));
    let mut alices = test_inbox();
    let cid = alices.start(&alice_m, certificate.handle(), T).unwrap();
    let digest = alices.stamp_digest(cid).unwrap();
    alices
        .set_stamp(cid, find_stamp(&digest, TEST_BITS, 0, u64::MAX).unwrap())
        .unwrap();
    let envelope = alices.send(cid, b"hello, Seedelf").unwrap();

    // Only the messaging key's scan finds it.
    assert!(matches_envelope(&bob_m, &envelope).unwrap());
    assert!(!matches_envelope(&bob_x, &envelope).unwrap());
    for handles in [
        vec![bobs.handle(&bob_x).unwrap()],
        vec![bobs.handle(&bob_m).unwrap()],
    ] {
        let mut spends_only = test_inbox();
        assert_eq!(
            spends_only.receive(&bob_x, &handles, &envelope, T),
            Err(Error::NotForThisKey)
        );
        assert!(spends_only.requests().is_empty());
    }
    let mut bobs_inbox = test_inbox();
    let Received::Request { plaintext, .. } = bobs_inbox
        .receive(&bob_m, &[bobs.handle(&bob_m).unwrap()], &envelope, T)
        .unwrap()
    else {
        panic!("a first message is a request")
    };
    assert_eq!(plaintext, b"hello, Seedelf");

    // Bob replies; Alice reads it, and shows him her own Seedelf.
    bobs_inbox.accept(&bob_m, cid).unwrap();
    let reply = bobs_inbox.send(cid, b"who is this?").unwrap();
    assert!(!matches_envelope(&alice_x, &reply).unwrap());
    assert_eq!(
        alices.receive(&alice_m, &[], &reply, T + 60).unwrap(),
        Received::Message {
            cid,
            plaintext: b"who is this?".to_vec()
        }
    );
    let her = Seedelf::new(chain, b"alice", datum_register("alice", "hers")).unwrap();
    let her_certificate = Certificate::from_bytes(
        &chain,
        &Certificate::make(&alice_x, &alice_m, &her)
            .unwrap()
            .to_bytes(),
    )
    .unwrap();
    let conversation = alices.conversation(cid).unwrap();
    // The reveal is made with the messaging key; the Seedelf key makes none.
    assert_eq!(
        conversation
            .reveal(&alice_x, &her.handle(&alice_x).unwrap())
            .err(),
        Some(Error::NotForThisKey)
    );
    let reveal = conversation
        .reveal(&alice_m, &her.handle(&alice_m).unwrap())
        .unwrap();
    let read = crate::session::Reveal::from_bytes(&chain, &reveal.to_bytes()).unwrap();
    assert_eq!(
        bobs_inbox.conversation(cid).unwrap().verify_reveal(&read),
        Ok(())
    );
    assert!(her_certificate.is_for(read.handle().seedelf()));
    assert_eq!(
        read.messaging_register(),
        her_certificate.handle().register()
    );
}
