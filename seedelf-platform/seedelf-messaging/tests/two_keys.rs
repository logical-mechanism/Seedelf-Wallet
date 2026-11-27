//! The two keys through the public API alone (docs/protocol.md §21,
//! joint-security.md rules 1, 1m and 5).
//!
//! - A datum register never serves as a messaging register: no handle of a
//!   Seedelf is its (g_S, u_S), for any key.
//! - A bad point never reaches the certificate's ownership test: a Seedelf's
//!   register is a decoded `Register`, which `Register::from_bytes` refuses
//!   to make from a point off the curve, outside G1 or O, so `make` refuses
//!   `NotOwned` only for a register that decoded.
//! - The calls src/compile_fail.rs's doctests refuse, made as the API takes
//!   them: they compile.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use group::prime::PrimeCurveAffine;

use seedelf_messaging::session::{
    Certificate, Chain, Conversation, Handle, Inbox, NETWORK_MAINNET, NETWORK_PREPROD, Seedelf,
};
use seedelf_messaging::{Error, Register, SecretKey, matches_register, rerandomize_register};

const T: u64 = 1_800_000_000;

/// p, BLS12-381's base field modulus, big-endian.
const FIELD_MODULUS: &str = "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";

fn chain() -> Chain {
    Chain::new(
        NETWORK_PREPROD,
        hex::decode("84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255")
            .unwrap()
            .try_into()
            .unwrap(),
    )
    .unwrap()
}

fn compressed(point: &G1Projective) -> [u8; 48] {
    point.to_affine().to_compressed()
}

/// A compressed encoding of `x`, with the compression flag set.
fn compressed_x(x: u64) -> [u8; 48] {
    let mut bytes = [0u8; 48];
    bytes[40..].copy_from_slice(&x.to_be_bytes());
    bytes[0] |= 0x80;
    bytes
}

/// Each way a point's 48 bytes aren't a point a register may hold, with the
/// error its decoding gives.
fn bad_points() -> Vec<(&'static str, [u8; 48], Error)> {
    let decoded = |b: &[u8; 48]| Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(b));
    let outside_g1 = (1u64..)
        .map(compressed_x)
        .find(|b| {
            decoded(b)
                .is_some_and(|p| bool::from(p.is_on_curve()) && !bool::from(p.is_torsion_free()))
        })
        .unwrap();
    let off_curve = (1u64..)
        .map(compressed_x)
        .find(|b| decoded(b).is_none())
        .unwrap();
    let mut identity = [0u8; 48];
    identity[0] = 0xc0;
    let mut x_is_p: [u8; 48] = hex::decode(FIELD_MODULUS).unwrap().try_into().unwrap();
    x_is_p[0] |= 0x80;
    let mut uncompressed =
        compressed(&(G1Projective::from(G1Affine::generator()) * Scalar::from(7u64)));
    uncompressed[0] &= 0x7f;
    vec![
        ("off the curve", off_curve, Error::InvalidEncoding),
        ("outside G1", outside_g1, Error::NotInSubgroup),
        ("the identity", identity, Error::IdentityPoint),
        ("x = 0", compressed_x(0), Error::InvalidEncoding),
        ("x = p", x_is_p, Error::InvalidEncoding),
        (
            "without the compression flag",
            uncompressed,
            Error::InvalidEncoding,
        ),
    ]
}

/// No handle of a Seedelf is its datum register (g_S, u_S), nor on g_S,
/// whatever the key: the Seedelf's own, a messaging key, or 1. A datum that
/// is another Seedelf's messaging register M_B has its own hashed base too:
/// only Bob's handle of his Seedelf is M_B.
#[test]
fn a_datum_register_never_serves_as_a_messaging_register() {
    let (x, x_m, other) = (
        SecretKey::generate(),
        SecretKey::generate(),
        SecretKey::generate(),
    );
    let one = SecretKey::from_bytes(&{
        let mut one = [0u8; 32];
        one[31] = 1;
        one
    })
    .unwrap();
    let bob_m = SecretKey::generate();
    let bobs = Seedelf::new(chain(), b"bob", rerandomize_register(&other.register())).unwrap();
    let m_b = *bobs.handle(&bob_m).unwrap().register();
    let mainnet = Chain::new(NETWORK_MAINNET, *chain().policy()).unwrap();
    let seedelfs = [
        Seedelf::new(chain(), b"a", x.register()).unwrap(),
        Seedelf::new(chain(), b"a", rerandomize_register(&x.register())).unwrap(),
        Seedelf::new(mainnet, b"a", x.register()).unwrap(),
        Seedelf::new(chain(), b"m_b", m_b).unwrap(),
        bobs.clone(),
    ];
    for (i, seedelf) in seedelfs.iter().enumerate() {
        for key in [&x, &x_m, &other, &one] {
            let handle = seedelf.handle(key).unwrap();
            assert_ne!(handle.register(), seedelf.register(), "Seedelf {i}");
            assert_ne!(
                handle.register().generator_bytes(),
                seedelf.register().generator_bytes(),
                "Seedelf {i}"
            );
            assert_ne!(handle.register(), &m_b, "Seedelf {i}");
            assert_eq!(handle.seedelf(), seedelf);
            assert!(matches_register(key, handle.register()));
        }
    }
    // The Seedelf key's own register is a datum's, and its handle of that
    // Seedelf is on another base.
    let at_root = &seedelfs[0];
    assert!(matches_register(&x, at_root.register()));
    assert_ne!(
        at_root.handle(&x).unwrap().register().generator_bytes(),
        G1Affine::generator().to_compressed()
    );
    assert_eq!(bobs.handle(&bob_m).unwrap().register(), &m_b);
}

/// A Seedelf is made from a `Register`, and a `Register` from bytes only
/// once both points decode: off the curve, outside G1, O, x = 0, x = p or
/// uncompressed, as either point, it's refused, so no Seedelf and no
/// certificate is made with such a point and the ownership test never meets
/// one. Every public way to a `Register` gives one that decodes. With a
/// register that decoded, `make` refuses `NotOwned` for one the Seedelf key
/// doesn't hold, and makes it for one it does.
#[test]
fn a_bad_point_never_reaches_the_ownership_test() {
    let (x, x_m) = (SecretKey::generate(), SecretKey::generate());
    let good = x.register();
    for (fault, bad, error) in bad_points() {
        assert_eq!(
            Register::from_bytes(&bad, &good.public_value_bytes()),
            Err(error),
            "g_S {fault}"
        );
        assert_eq!(
            Register::from_bytes(&good.generator_bytes(), &bad),
            Err(error),
            "u_S {fault}"
        );
    }
    // Every public way to a register gives points that decode again.
    for register in [x.register(), rerandomize_register(&x.register())] {
        assert_eq!(
            Register::from_bytes(&register.generator_bytes(), &register.public_value_bytes()),
            Ok(register)
        );
    }
    // Decoded, not the Seedelf key's: NotOwned. Decoded and its: made.
    let stranger = SecretKey::generate().register();
    let decoded =
        Register::from_bytes(&stranger.generator_bytes(), &stranger.public_value_bytes()).unwrap();
    let theirs = Seedelf::new(chain(), b"theirs", decoded).unwrap();
    assert_eq!(
        Certificate::make(&x, &x_m, &theirs).err(),
        Some(Error::NotOwned)
    );
    let mine = Seedelf::new(chain(), b"mine", rerandomize_register(&x.register())).unwrap();
    assert!(Certificate::make(&x, &x_m, &mine).is_ok());
    assert_eq!(
        Certificate::make(&x_m, &x, &mine).err(),
        Some(Error::NotOwned)
    );
}

/// The calls the compile_fail doctests refuse, made as the API takes them:
/// a handle from `Seedelf::handle`, or from a certificate, and the starts
/// that take one.
#[test]
fn the_compile_fail_doctests_twins_compile() {
    let (alice, bob, bob_x) = (
        SecretKey::generate(),
        SecretKey::generate(),
        SecretKey::generate(),
    );
    let seedelf = Seedelf::new(chain(), b"bob", bob_x.register()).unwrap();
    let own: Handle = seedelf.handle(&bob).unwrap();
    let posted = Certificate::make(&bob_x, &bob, &seedelf)
        .unwrap()
        .to_bytes();
    let certified = Certificate::from_bytes(&chain(), &posted).unwrap();
    assert_eq!(certified.handle(), &own);
    let conversation = Conversation::start(&alice, certified.handle(), T).unwrap();
    assert!(conversation.sends_first_contact());
    let mut inbox = Inbox::new();
    assert!(inbox.start(&alice, &own, T).is_ok());
}
