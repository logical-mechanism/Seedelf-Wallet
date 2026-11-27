//! The relay's copy of a certificate's checks (docs/protocol.md §21.4,
//! "Anyone, checking one"; web wallet chunk 55's 55c): seedelf-messaging's
//! `session::certificate`, which the data layer can't depend on, as `check`
//! copies its `relay` module. Held to
//! `seedelf-messaging/tests/vectors/messaging_certificate_v1.json`, which the
//! crate writes: every good certificate in it checks here, every refusal is
//! refused with the file's kind, and h_S is the file's.
//!
//! A certificate is
//!
//! ```text
//! version (1) ‖ network (1) ‖ generation (1) ‖ policy (28) ‖ len(N) (1) ‖ N
//!   ‖ g_S (48) ‖ u_S (48) ‖ m_S (48) ‖ c (32) ‖ z_x (32) ‖ z_m (32)
//! ```
//!
//! 273 to 304 bytes, every byte before c its statement. Its proof is
//! knowledge of the Seedelf key x with u_S = [x]g_S and of the messaging key
//! x_m with m_S = [x_m]h_S, under one Fiat–Shamir challenge, where h_S is
//! RFC 9380's hash to G1 of the Seedelf (§21.3). The relay checks it in two
//! halves, as it does an envelope (§21.7): the shape (§21.4's check 1),
//! which costs nothing and comes before the price, and the points and the
//! proof (checks 2 to 5), about five scalar multiplications and a hash to
//! the curve, which come after the price, the stamp and room.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::{Curve, Group};
use sha2::{Digest, Sha256};

use super::check::{self, POINT_LEN};

/// The only certificate version.
pub const VERSION: u8 = 0x01;

/// The only generation v1 takes: rotation comes later (§21.5).
pub const GENERATION: u8 = 0x00;

/// The network bytes (§21.2): preprod's and mainnet's, never Cardano's
/// network id, which is 0 for every test network.
pub const NETWORK_PREPROD: u8 = 0x00;
pub const NETWORK_MAINNET: u8 = 0x01;

/// A Seedelf policy's hash.
pub const POLICY_LEN: usize = 28;

/// A Seedelf's asset name is 1 to 32 bytes.
pub const MAX_NAME_LEN: usize = 32;

const SCALAR_LEN: usize = 32;

/// The bytes before the name: version, network, generation, the policy and
/// the name's length.
const HEAD_LEN: usize = 3 + POLICY_LEN + 1;

/// `c ‖ z_x ‖ z_m`.
const PROOF_LEN: usize = 3 * SCALAR_LEN;

/// The shortest certificate, a 1-byte name's: 273 bytes.
pub const MIN_LEN: usize = HEAD_LEN + 1 + 3 * POINT_LEN + PROOF_LEN;

/// The longest, a 32-byte name's: 304 bytes.
pub const MAX_LEN: usize = HEAD_LEN + MAX_NAME_LEN + 3 * POINT_LEN + PROOF_LEN;

/// SHA-256's label for the challenge.
pub const LABEL: &[u8] = b"Seedelf-Messaging|v1|certificate";

/// h_S's domain separation tag: RFC 9380's `BLS12381G1_XMD:SHA-256_SSWU_RO_`,
/// the tag ending in that suite's ID.
pub const HANDLE_BASE_DST: &[u8] =
    b"Seedelf-Messaging|v1|handle-base|BLS12381G1_XMD:SHA-256_SSWU_RO_";

/// The listing digest's label, before the pool's name (§21.7): a
/// certificate post's stamp is over the digest, and a removal entry names a
/// certificate by it. seedelf-messaging's `relay::LISTING_STAMP_LABEL`.
pub const LISTING_STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|listing-stamp|";

/// The Seedelf policy a certificate names: variant 1's, the contract the
/// wallet reads, on both networks (`crate::constants::SEEDELF_POLICY`, held
/// to seedelf-core's `constants.rs`).
pub const POLICY: [u8; POLICY_LEN] = policy(crate::constants::SEEDELF_POLICY);

/// The policy's bytes from its hex, at compile time.
const fn policy(hex: &str) -> [u8; POLICY_LEN] {
    const fn nibble(c: u8) -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            _ => panic!("the policy is lowercase hex"),
        }
    }
    let hex = hex.as_bytes();
    assert!(hex.len() == 2 * POLICY_LEN, "the policy is 28 bytes");
    let mut out = [0u8; POLICY_LEN];
    let mut i = 0;
    while i < POLICY_LEN {
        out[i] = (nibble(hex[2 * i]) << 4) | nibble(hex[2 * i + 1]);
        i += 1;
    }
    out
}

/// Why a certificate isn't listed. `name` is the kind the vectors give it,
/// the crate's error in snake case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// Its length is outside 273 to 304, its name's length outside 1 to 32,
    /// or its length isn't its name's.
    InvalidLength,
    UnsupportedVersion,
    /// Another network, generation or Seedelf policy than the pool's.
    OtherChain,
    InvalidEncoding,
    NotInSubgroup,
    IdentityPoint,
    /// c, z_x or z_m isn't below the group order: c and c + q would be one
    /// certificate twice.
    InvalidScalar,
    /// h_S is the identity: about 2⁻²⁵⁵.
    IdentityBase,
    /// The challenge isn't the hash of the statement and the commitments.
    InvalidProof,
}

impl Refused {
    pub fn name(self) -> &'static str {
        match self {
            Refused::UnsupportedVersion => "unsupported_version",
            Refused::InvalidLength
            | Refused::OtherChain
            | Refused::InvalidScalar
            | Refused::InvalidProof => "invalid_certificate",
            Refused::InvalidEncoding => "invalid_encoding",
            Refused::NotInSubgroup => "not_in_subgroup",
            Refused::IdentityPoint | Refused::IdentityBase => "identity_point",
        }
    }

    /// What a 400 says.
    pub fn reason(self) -> &'static str {
        match self {
            Refused::InvalidLength => "not a certificate's length",
            Refused::UnsupportedVersion => "not a version 1 certificate",
            Refused::OtherChain => {
                "not a certificate this pool takes: another network, generation or policy"
            }
            Refused::InvalidEncoding | Refused::NotInSubgroup | Refused::IdentityPoint => {
                "a point in the certificate isn't valid"
            }
            Refused::InvalidScalar => "a scalar in the certificate isn't below the group order",
            Refused::IdentityBase => "the certificate's Seedelf hashes to the identity",
            Refused::InvalidProof => "the certificate's proof doesn't check",
        }
    }
}

/// A certificate whose shape is checked (§21.4's check 1): its fields where
/// its name's length puts them. Nothing in it is decoded yet.
#[derive(Debug, Clone, Copy)]
pub struct Shape<'a> {
    bytes: &'a [u8],
    name_len: usize,
}

impl<'a> Shape<'a> {
    /// The certificate's bytes.
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    /// The Seedelf's asset name, N.
    pub fn name(&self) -> &'a [u8] {
        &self.bytes[HEAD_LEN..HEAD_LEN + self.name_len]
    }

    /// The `i`th point: g_S, u_S, then m_S.
    fn point(&self, i: usize) -> &'a [u8; POINT_LEN] {
        let at = HEAD_LEN + self.name_len + i * POINT_LEN;
        self.bytes[at..at + POINT_LEN]
            .try_into()
            .expect("a point's bytes")
    }

    /// The `i`th scalar: c, z_x, then z_m.
    fn scalar(&self, i: usize) -> &'a [u8; SCALAR_LEN] {
        let at = HEAD_LEN + self.name_len + 3 * POINT_LEN + i * SCALAR_LEN;
        self.bytes[at..at + SCALAR_LEN]
            .try_into()
            .expect("a scalar's bytes")
    }

    /// Every byte before c: what the challenge covers.
    pub fn statement(&self) -> &'a [u8] {
        &self.bytes[..HEAD_LEN + self.name_len + 3 * POINT_LEN]
    }

    /// `len(N) ‖ N ‖ g_S ‖ u_S`: which Seedelf, at which register. At most
    /// two certificates in the list name one (§21.7's check 6).
    pub fn seedelf(&self) -> &'a [u8] {
        &self.bytes[HEAD_LEN - 1..HEAD_LEN + self.name_len + 2 * POINT_LEN]
    }

    /// `g_S ‖ u_S`: the datum register the certificate names, which §21.7's
    /// check 8 compares with the chain's.
    pub fn register(&self) -> &'a [u8] {
        let at = HEAD_LEN + self.name_len;
        &self.bytes[at..at + 2 * POINT_LEN]
    }

    /// `len(N) ‖ N ‖ g_S ‖ u_S ‖ m_S`: what "already held" is (§21.7's check
    /// 3). Two certificates with these the same are one, whatever their
    /// proofs: a repost with a fresh aux makes other bytes for the same key.
    pub fn listing(&self) -> &'a [u8] {
        &self.bytes[HEAD_LEN - 1..HEAD_LEN + self.name_len + 3 * POINT_LEN]
    }

    /// h_S's message (§21.3): `network ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S`.
    pub fn base_message(&self) -> Vec<u8> {
        [
            &self.bytes[1..2],
            &self.bytes[3..3 + POLICY_LEN],
            self.seedelf(),
        ]
        .concat()
    }
}

/// §21.4's check 1, in its order: a length outside 273 to 304; then a
/// version other than 1, its own refusal; then a network other than
/// `network`, a generation other than 0 or a policy other than `policy`;
/// then a name's length outside 1 to 32, or a length other than its name's.
/// Nothing is decoded or hashed.
pub fn check_shape<'a>(
    bytes: &'a [u8],
    network: u8,
    policy: &[u8; POLICY_LEN],
) -> Result<Shape<'a>, Refused> {
    if !(MIN_LEN..=MAX_LEN).contains(&bytes.len()) {
        return Err(Refused::InvalidLength);
    }
    if bytes[0] != VERSION {
        return Err(Refused::UnsupportedVersion);
    }
    if bytes[1] != network || bytes[2] != GENERATION || bytes[3..3 + POLICY_LEN] != policy[..] {
        return Err(Refused::OtherChain);
    }
    let name_len = usize::from(bytes[HEAD_LEN - 1]);
    if name_len == 0 || name_len > MAX_NAME_LEN || bytes.len() != MIN_LEN - 1 + name_len {
        return Err(Refused::InvalidLength);
    }
    Ok(Shape { bytes, name_len })
}

/// §21.4's checks 2 to 5, for a certificate whose shape is checked: g_S,
/// u_S and m_S canonical, in G1 and not the identity, in that order; c,
/// z_x and z_m below the group order; h_S, refused if it's the identity;
/// then the proof.
pub fn check_proof(shape: &Shape) -> Result<(), Refused> {
    commitments(shape).map(|_| ())
}

/// Every check, in the crate's order: the vectors' `result`.
pub fn check_certificate(
    bytes: &[u8],
    network: u8,
    policy: &[u8; POLICY_LEN],
) -> Result<(), Refused> {
    check_proof(&check_shape(bytes, network, policy)?)
}

/// h_S: RFC 9380's hash to G1 of the Seedelf (§21.3). The hash clears the
/// cofactor, so it's in G1; the identity is refused.
pub fn base(shape: &Shape) -> Result<G1Affine, Refused> {
    let base = G1Projective::hash_to_curve(&shape.base_message(), HANDLE_BASE_DST, &[]);
    if bool::from(base.is_identity()) {
        return Err(Refused::IdentityBase);
    }
    Ok(base.to_affine())
}

/// Checks 2 to 5, and the commitments T_x = [z_x]g_S − [c]u_S and
/// T_m = [z_m]h_S − [c]m_S they found good: either may be the identity,
/// hashed as its compressed encoding, `0xc0` then 47 zero bytes.
fn commitments(shape: &Shape) -> Result<(G1Affine, G1Affine), Refused> {
    let [g, u, m] = [0, 1, 2].map(|i| decode(shape.point(i)));
    let (g, u, m) = (g?, u?, m?);
    let scalar = |i: usize| -> Result<Scalar, Refused> {
        Option::from(Scalar::from_bytes_be(shape.scalar(i))).ok_or(Refused::InvalidScalar)
    };
    let (c, z_x, z_m) = (scalar(0)?, scalar(1)?, scalar(2)?);
    let h = base(shape)?;
    let t_x = (G1Projective::from(g) * z_x - G1Projective::from(u) * c).to_affine();
    let t_m = (G1Projective::from(h) * z_m - G1Projective::from(m) * c).to_affine();
    let hash = Sha256::new()
        .chain_update(LABEL)
        .chain_update(shape.statement())
        .chain_update(t_x.to_compressed())
        .chain_update(t_m.to_compressed())
        .finalize();
    if mod_q(&hash) != c {
        return Err(Refused::InvalidProof);
    }
    Ok((t_x, t_m))
}

/// The envelope check's point decoding (`check::decode_point`), its
/// refusals named as a certificate's.
fn decode(bytes: &[u8; POINT_LEN]) -> Result<G1Affine, Refused> {
    check::decode_point(bytes).map_err(|refused| match refused {
        check::Refused::NotInSubgroup => Refused::NotInSubgroup,
        check::Refused::IdentityPoint => Refused::IdentityPoint,
        // `decode_point` refuses a point as one of these three alone.
        check::Refused::InvalidEncoding
        | check::Refused::UnsupportedVersion
        | check::Refused::InvalidLength => Refused::InvalidEncoding,
    })
}

/// A big-endian integer, mod q: the crate's `scalar_mod_q`.
fn mod_q(bytes: &[u8]) -> Scalar {
    let base = Scalar::from(256u64);
    bytes.iter().fold(Scalar::from(0u64), |acc, &byte| {
        acc * base + Scalar::from(u64::from(byte))
    })
}

/// The only withdrawal version (§21.7, "A withdrawal").
pub const WITHDRAWAL_VERSION: u8 = 0x01;

/// A withdrawal: `version ‖ network ‖ digest (32) ‖ c (32) ‖ z (32)`, 98 bytes.
pub const WITHDRAWAL_LEN: usize = 2 + 32 + 2 * SCALAR_LEN;

/// SHA-256's label for a withdrawal's challenge: the crate's `WITHDRAWAL_LABEL`.
pub const WITHDRAWAL_LABEL: &[u8] = b"Seedelf-Messaging|v1|withdrawal";

/// A withdrawal post's stamp digest's label, before the pool's name.
pub const UNLISTING_STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|unlisting-stamp|";

/// Why a withdrawal isn't taken: the crate's `Withdrawal::from_bytes` and
/// `check`, its errors in snake case as `name` gives them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unwithdrawn {
    /// Not 98 bytes.
    InvalidLength,
    UnsupportedVersion,
    /// Another network than the pool's.
    OtherChain,
    /// c or z isn't below the group order.
    InvalidScalar,
    /// Its digest isn't the certificate's listing digest. The relay finds
    /// the certificate by the digest, so meets this only in
    /// [`check_withdrawal`].
    OtherCertificate,
    /// The challenge isn't the hash of the statement, the held certificate's
    /// messaging register and the commitment.
    InvalidProof,
}

impl Unwithdrawn {
    pub fn name(self) -> &'static str {
        match self {
            Unwithdrawn::UnsupportedVersion => "unsupported_version",
            _ => "invalid_withdrawal",
        }
    }

    /// What a 400 says.
    pub fn reason(self) -> &'static str {
        match self {
            Unwithdrawn::InvalidLength => "a post is a nonce, then a withdrawal: 106 bytes",
            Unwithdrawn::UnsupportedVersion => "not a version 1 withdrawal",
            Unwithdrawn::OtherChain => "not a withdrawal for this pool's network",
            Unwithdrawn::InvalidScalar => "a scalar in the withdrawal isn't below the group order",
            Unwithdrawn::OtherCertificate => "the withdrawal names another certificate",
            Unwithdrawn::InvalidProof => "the withdrawal's proof doesn't check",
        }
    }
}

/// A withdrawal whose shape is checked: §21.7's row 2.
#[derive(Debug, Clone, Copy)]
pub struct Withdrawal<'a> {
    bytes: &'a [u8],
    c: Scalar,
    z: Scalar,
}

impl<'a> Withdrawal<'a> {
    /// The listing digest of the certificate it withdraws.
    pub fn digest(&self) -> &'a [u8; 32] {
        self.bytes[2..34].try_into().expect("a digest's bytes")
    }

    /// `version ‖ network ‖ digest`: what its challenge covers before the
    /// register.
    fn statement(&self) -> &'a [u8] {
        &self.bytes[..34]
    }
}

/// §21.7's row 2, the crate's `from_bytes` in its order: 98 bytes; then a
/// version other than 1, its own refusal; then a network other than
/// `network`; then c and z each below q, never reduced.
pub fn check_withdrawal_shape(bytes: &[u8], network: u8) -> Result<Withdrawal<'_>, Unwithdrawn> {
    if bytes.len() != WITHDRAWAL_LEN {
        return Err(Unwithdrawn::InvalidLength);
    }
    if bytes[0] != WITHDRAWAL_VERSION {
        return Err(Unwithdrawn::UnsupportedVersion);
    }
    if bytes[1] != network {
        return Err(Unwithdrawn::OtherChain);
    }
    let scalar = |at: usize| -> Result<Scalar, Unwithdrawn> {
        let bytes: &[u8; SCALAR_LEN] = bytes[at..at + SCALAR_LEN].try_into().expect("32 bytes");
        Option::from(Scalar::from_bytes_be(bytes)).ok_or(Unwithdrawn::InvalidScalar)
    };
    Ok(Withdrawal {
        bytes,
        c: scalar(34)?,
        z: scalar(66)?,
    })
}

/// §21.7's row 6, the crate's `Withdrawal::check`: the proof of x_m on the
/// held certificate's messaging register (h_S, m_S), T = [z]h_S − [c]m_S,
/// and c = SHA-256(`…|withdrawal` ‖ statement ‖ h_S ‖ m_S ‖ T) mod q.
/// `certificate` is the certificate the list holds under the withdrawal's
/// digest, so it's that certificate's, and its points were checked as it
/// was listed; h_S is hashed from it again.
pub fn check_withdrawal_proof(
    withdrawal: &Withdrawal,
    certificate: &Shape,
) -> Result<(), Unwithdrawn> {
    let h = base(certificate).map_err(|_| Unwithdrawn::InvalidProof)?;
    let m = decode(certificate.point(2)).map_err(|_| Unwithdrawn::InvalidProof)?;
    let t =
        (G1Projective::from(h) * withdrawal.z - G1Projective::from(m) * withdrawal.c).to_affine();
    let hash = Sha256::new()
        .chain_update(WITHDRAWAL_LABEL)
        .chain_update(withdrawal.statement())
        .chain_update(h.to_compressed())
        .chain_update(m.to_compressed())
        .chain_update(t.to_compressed())
        .finalize();
    if mod_q(&hash) != withdrawal.c {
        return Err(Unwithdrawn::InvalidProof);
    }
    Ok(())
}

/// The whole check of a withdrawal, in the crate's order (`from_bytes`,
/// then `check`): its shape read under `network`; then against
/// `certificate`, a certificate that checks (§21.4), read under its own
/// network and that network's pool, that the withdrawal's network is the
/// certificate's and its digest the certificate's listing digest; then the
/// proof. The relay's route runs the same, under its pool's network, the
/// digest matched by finding the certificate the list holds under it.
pub fn check_withdrawal(
    bytes: &[u8],
    network: u8,
    certificate: &[u8],
    certificate_network: u8,
    certificate_pool: &str,
) -> Result<(), Unwithdrawn> {
    let withdrawal = check_withdrawal_shape(bytes, network)?;
    let shape = check_shape(certificate, certificate_network, &POLICY)
        .map_err(|_| Unwithdrawn::OtherCertificate)?;
    if network != certificate_network
        || *withdrawal.digest() != listing_digest(certificate_pool, certificate)
    {
        return Err(Unwithdrawn::OtherCertificate);
    }
    check_withdrawal_proof(&withdrawal, &shape)
}

/// `SHA-256(UNLISTING_STAMP_LABEL ‖ len(pool) ‖ pool ‖ withdrawal)`: what a
/// withdrawal post's stamp is over.
pub fn unlisting_digest(pool: &str, withdrawal: &[u8]) -> [u8; 32] {
    let len = u8::try_from(pool.len()).expect("a pool's name is short");
    Sha256::new()
        .chain_update(UNLISTING_STAMP_LABEL)
        .chain_update([len])
        .chain_update(pool.as_bytes())
        .chain_update(withdrawal)
        .finalize()
        .into()
}

/// `SHA-256(LISTING_STAMP_LABEL ‖ len(pool) ‖ pool ‖ certificate)`: the
/// certificate's listing digest under `pool` (§21.7), which its post's stamp
/// is over and a removal entry names it by. Pools are named here, so a name
/// is never longer than a byte counts.
pub fn listing_digest(pool: &str, certificate: &[u8]) -> [u8; 32] {
    let len = u8::try_from(pool.len()).expect("a pool's name is short");
    Sha256::new()
        .chain_update(LISTING_STAMP_LABEL)
        .chain_update([len])
        .chain_update(pool.as_bytes())
        .chain_update(certificate)
        .finalize()
        .into()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::Value;

    pub(crate) fn vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_certificate_v1.json"
        ))
        .unwrap()
    }

    /// seedelf-messaging's `relay` module, where the listing digest's label
    /// is: no vector file carries it.
    const CRATE_RELAY: &str =
        include_str!("../../../../seedelf-platform/seedelf-messaging/src/relay.rs");

    /// seedelf-core's contract variants, where the Seedelf policy is.
    const CORE: &str = include_str!("../../../../seedelf-platform/seedelf-core/src/constants.rs");

    pub(crate) fn bytes(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn chain(vector: &Value) -> (u8, [u8; POLICY_LEN]) {
        let network = vector["network"].as_u64().unwrap() as u8;
        let policy = bytes(vector["policy"].as_str().unwrap())
            .try_into()
            .unwrap();
        (network, policy)
    }

    #[test]
    fn the_constants_are_the_crates() {
        let v = vectors();
        assert_eq!(v["version"], 1);
        assert_eq!(v["label"], std::str::from_utf8(LABEL).unwrap());
        assert_eq!(
            v["handle_base_dst"],
            std::str::from_utf8(HANDLE_BASE_DST).unwrap()
        );
        assert_eq!(HANDLE_BASE_DST.len(), 64);
        assert_eq!(v["networks"]["preprod"], NETWORK_PREPROD);
        assert_eq!(v["networks"]["mainnet"], NETWORK_MAINNET);
        assert_eq!(
            v["listing_stamp_label"],
            std::str::from_utf8(LISTING_STAMP_LABEL).unwrap()
        );
        assert_eq!(
            v["withdrawal_label"],
            std::str::from_utf8(WITHDRAWAL_LABEL).unwrap()
        );
        assert_eq!(
            v["unlisting_stamp_label"],
            std::str::from_utf8(UNLISTING_STAMP_LABEL).unwrap()
        );
        assert_eq!(WITHDRAWAL_LEN, 98);
        assert_eq!((MIN_LEN, MAX_LEN), (273, 304));
        // q itself isn't a scalar, so a scalar's bytes are below it; q − 1 is.
        let q = bytes(v["group_order"].as_str().unwrap());
        let q: [u8; 32] = q.try_into().unwrap();
        assert!(Option::<Scalar>::from(Scalar::from_bytes_be(&q)).is_none());
        let mut below = q;
        below[31] -= 1;
        assert!(Option::<Scalar>::from(Scalar::from_bytes_be(&below)).is_some());
        // The listing digest's label is the crate's, and none of the raw
        // SHA-256 labels a certificate meets is a prefix of another
        // (joint-security.md, rule 3).
        assert!(CRATE_RELAY.contains(
            r#"pub const LISTING_STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|listing-stamp|";"#
        ));
        let labels = [
            LISTING_STAMP_LABEL,
            check::STAMP_LABEL,
            LABEL,
            WITHDRAWAL_LABEL,
            UNLISTING_STAMP_LABEL,
        ];
        for (i, a) in labels.iter().enumerate() {
            for (j, b) in labels.iter().enumerate() {
                assert!(i == j || !b.starts_with(a), "{a:?} is a prefix of {b:?}");
            }
        }
    }

    /// The policy a pool's certificates name is variant 1's: the data
    /// layer's copy, which `constants`'s tests hold to seedelf-core, one
    /// value for both networks there, and every good vector's.
    #[test]
    fn the_policy_is_variant_1s_on_both_networks() {
        assert_eq!(
            POLICY.to_vec(),
            crate::constants::bytes(crate::constants::SEEDELF_POLICY)
        );
        let field = format!(
            "seedelf_policy_id: \"{}\"",
            crate::constants::SEEDELF_POLICY
        );
        assert_eq!(CORE.matches("seedelf_policy_id: \"").count(), 1);
        assert!(CORE.contains(&field));
        for vector in vectors()["certificates"].as_array().unwrap() {
            assert_eq!(chain(vector).1, POLICY, "{}", vector["name"]);
        }
    }

    /// The pool a network byte's certificates are posted to.
    fn pool_of(network: u8) -> &'static str {
        match network {
            NETWORK_PREPROD => "preprod",
            NETWORK_MAINNET => "mainnet",
            other => panic!("network {other}"),
        }
    }

    /// Every good certificate checks under its network and the policy, and
    /// what the check computes on the way is the file's: the statement, h_S
    /// and its message, the commitments the proof gives, and its listing
    /// digest under its pool's name wherever the file gives one.
    #[test]
    fn every_good_certificate_checks_and_its_base_is_the_files() {
        let v = vectors();
        let certificates = v["certificates"].as_array().unwrap();
        assert_eq!(certificates.len(), 4);
        let mut networks = vec![];
        for vector in certificates {
            let name = vector["name"].as_str().unwrap();
            let (network, policy) = chain(vector);
            networks.push(network);
            let certificate = bytes(vector["certificate"].as_str().unwrap());
            let shape = check_shape(&certificate, network, &policy).unwrap();
            assert_eq!(hex(shape.statement()), vector["statement"], "{name}");
            let seedelf = &vector["seedelf"];
            assert_eq!(hex(shape.name()), seedelf["name"], "{name}");
            assert_eq!(
                hex(&shape.base_message()),
                seedelf["base_message"],
                "{name}"
            );
            let h = base(&shape).unwrap();
            assert_eq!(hex(&h.to_compressed()), seedelf["base"], "{name}");
            assert_eq!(hex(shape.point(0)), seedelf["generator"], "{name}");
            assert_eq!(hex(shape.point(1)), seedelf["public_value"], "{name}");
            assert_eq!(hex(shape.point(2)), vector["messaging_value"], "{name}");
            let (t_x, t_m) = commitments(&shape).unwrap();
            assert_eq!(hex(&t_x.to_compressed()), vector["t_x"], "{name}");
            assert_eq!(hex(&t_m.to_compressed()), vector["t_m"], "{name}");
            for (i, field) in ["c", "z_x", "z_m"].into_iter().enumerate() {
                assert_eq!(hex(shape.scalar(i)), vector[field], "{name}: {field}");
            }
            assert_eq!(check_certificate(&certificate, network, &policy), Ok(()));
            // Under the other network, refused.
            let other = network ^ 1;
            assert_eq!(
                check_certificate(&certificate, other, &policy),
                Err(Refused::OtherChain)
            );
            // Its pool is its network's, and its listing digest, what its
            // post's stamp is over, is the file's under that pool's name.
            assert_eq!(vector["pool"], pool_of(network), "{name}");
            let pool = vector["pool"].as_str().unwrap();
            assert_eq!(
                hex(&listing_digest(pool, &certificate)),
                vector["listing_digest"],
                "{name}"
            );
            assert_ne!(
                hex(&listing_digest(pool_of(network ^ 1), &certificate)),
                vector["listing_digest"],
                "{name}"
            );
        }
        networks.sort();
        assert_eq!(networks, [0, 0, 1, 1]);
    }

    /// Every refusal in the file is refused here with its kind, read under
    /// its network and policy, and each good one in it checks; the two
    /// halves the relay runs apart agree with the whole.
    #[test]
    fn every_refusal_is_refused_with_the_files_kind() {
        let v = vectors();
        let refusals = v["refusals"].as_array().unwrap();
        assert_eq!(refusals.len(), 69);
        let mut kinds = std::collections::BTreeSet::new();
        for vector in refusals {
            let name = vector["name"].as_str().unwrap();
            let (network, policy) = chain(vector);
            let certificate = bytes(vector["certificate"].as_str().unwrap());
            let got = check_certificate(&certificate, network, &policy)
                .err()
                .map_or("ok", Refused::name);
            assert_eq!(got, vector["result"], "{name}");
            let halves = check_shape(&certificate, network, &policy)
                .and_then(|shape| check_proof(&shape))
                .err()
                .map_or("ok", Refused::name);
            assert_eq!(halves, got, "{name}");
            kinds.insert(got);
        }
        // Every kind the crate names is met.
        for kind in [
            "identity_point",
            "invalid_certificate",
            "invalid_encoding",
            "not_in_subgroup",
            "ok",
            "unsupported_version",
        ] {
            assert!(kinds.contains(kind), "{kind}");
        }
    }

    /// The shape's refusals are the cheap ones: none of them decodes or
    /// hashes, so a refusal there says nothing of the points.
    #[test]
    fn the_shape_refuses_in_its_order() {
        let v = vectors();
        let good = bytes(v["certificates"][1]["certificate"].as_str().unwrap());
        let (network, policy) = chain(&v["certificates"][1]);
        assert_eq!(good.len(), MAX_LEN);
        let with = |at: usize, byte: u8| {
            let mut bytes = good.clone();
            bytes[at] = byte;
            check_shape(&bytes, network, &policy).err()
        };
        assert_eq!(with(0, 2), Some(Refused::UnsupportedVersion));
        assert_eq!(with(1, network ^ 1), Some(Refused::OtherChain));
        assert_eq!(with(2, 1), Some(Refused::OtherChain));
        assert_eq!(with(3, good[3] ^ 1), Some(Refused::OtherChain));
        assert_eq!(with(31, 0), Some(Refused::InvalidLength));
        assert_eq!(with(31, 33), Some(Refused::InvalidLength));
        assert_eq!(with(31, 31), Some(Refused::InvalidLength));
        // Garbage where the points and scalars are passes the shape.
        let mut garbage = good.clone();
        garbage[64..].fill(0xff);
        assert!(check_shape(&garbage, network, &policy).is_ok());
        for len in [0, 1, MIN_LEN - 1, MAX_LEN + 1, 400] {
            assert_eq!(
                check_shape(&vec![VERSION; len], network, &policy).err(),
                Some(Refused::InvalidLength),
                "{len}"
            );
        }
    }

    /// A scalar at or past q is refused, never reduced: c + q, z_x + q and
    /// z_m + q of a good certificate are each refused, though each reduces
    /// to the good one's. And the fields come before the points: another
    /// generation or policy with g_S off the curve is refused as the field.
    #[test]
    fn a_scalar_past_q_is_refused_and_the_fields_come_before_the_points() {
        let v = vectors();
        let q: [u8; 32] = bytes(v["group_order"].as_str().unwrap())
            .try_into()
            .unwrap();
        let plus_q = |scalar: &[u8]| -> [u8; 32] {
            let mut out = [0u8; 32];
            let mut carry = 0u16;
            for i in (0..32).rev() {
                let sum = u16::from(scalar[i]) + u16::from(q[i]) + carry;
                out[i] = sum as u8;
                carry = sum >> 8;
            }
            // c < q < 2^255, so c + q fits 32 bytes.
            assert_eq!(carry, 0);
            out
        };
        for vector in v["certificates"].as_array().unwrap() {
            let (network, policy) = chain(vector);
            let good = bytes(vector["certificate"].as_str().unwrap());
            let at = good.len() - PROOF_LEN;
            for i in 0..3 {
                let mut past = good.clone();
                let field = at + i * SCALAR_LEN..at + (i + 1) * SCALAR_LEN;
                let bumped = plus_q(&good[field.clone()]);
                past[field].copy_from_slice(&bumped);
                assert_eq!(
                    check_certificate(&past, network, &policy),
                    Err(Refused::InvalidScalar),
                    "{}: scalar {i}",
                    vector["name"]
                );
            }
            // g_S off the curve: x = 1 is no point (1 + 4 isn't a square).
            let mut off = good.clone();
            let g = HEAD_LEN + usize::from(good[HEAD_LEN - 1]);
            off[g..g + POINT_LEN].fill(0);
            off[g] = 0x80;
            off[g + POINT_LEN - 1] = 1;
            assert_eq!(
                check_certificate(&off, network, &policy),
                Err(Refused::InvalidEncoding)
            );
            let mut generation = off.clone();
            generation[2] = 0x01;
            assert_eq!(
                check_certificate(&generation, network, &policy),
                Err(Refused::OtherChain)
            );
            let mut other_policy = off.clone();
            other_policy[10] ^= 1;
            assert_eq!(
                check_certificate(&other_policy, network, &policy),
                Err(Refused::OtherChain)
            );
            assert_eq!(
                check_certificate(&off, network, &[0; POLICY_LEN]),
                Err(Refused::OtherChain)
            );
            // x = 0: (0, ±2) is on the curve but not in G1; blst refuses
            // its encoding.
            for first in [0x80, 0xa0] {
                let mut zero = good.clone();
                zero[g..g + POINT_LEN].fill(0);
                zero[g] = first;
                assert_eq!(
                    check_certificate(&zero, network, &policy),
                    Err(Refused::InvalidEncoding)
                );
            }
        }
    }

    /// Every good withdrawal in the file is taken against its certificate,
    /// and what the check computes on the way is the file's: its statement,
    /// h_S, T and the challenge; its digest is its certificate's listing
    /// digest under its pool; and its post's stamp digest is the file's
    /// `unlisting_digest`.
    #[test]
    fn every_good_withdrawal_is_taken_against_its_certificate() {
        let v = vectors();
        let withdrawals = v["withdrawals"].as_array().unwrap();
        assert_eq!(withdrawals.len(), 4);
        for vector in withdrawals {
            let name = vector["name"].as_str().unwrap();
            let index = vector["certificate"].as_u64().unwrap() as usize;
            let certificate_vector = &v["certificates"][index];
            let certificate = bytes(certificate_vector["certificate"].as_str().unwrap());
            let network = vector["network"].as_u64().unwrap() as u8;
            let pool = vector["pool"].as_str().unwrap();
            assert_eq!(pool, pool_of(network), "{name}");
            assert_eq!(certificate_vector["pool"], pool, "{name}");
            let bytes_ = bytes(vector["withdrawal"].as_str().unwrap());
            assert_eq!(bytes_.len(), WITHDRAWAL_LEN, "{name}");
            let withdrawal = check_withdrawal_shape(&bytes_, network).unwrap();
            assert_eq!(hex(withdrawal.statement()), vector["statement"], "{name}");
            assert_eq!(hex(withdrawal.digest()), vector["digest"], "{name}");
            assert_eq!(
                hex(&listing_digest(pool, &certificate)),
                vector["digest"],
                "{name}"
            );
            assert_eq!(
                hex(&unlisting_digest(pool, &bytes_)),
                vector["unlisting_digest"],
                "{name}"
            );
            let shape = check_shape(&certificate, network, &POLICY).unwrap();
            assert_eq!(
                hex(&base(&shape).unwrap().to_compressed()),
                vector["base"],
                "{name}"
            );
            assert_eq!(hex(shape.point(2)), vector["messaging_value"], "{name}");
            // T from the proof, as the check finds it, is the maker's.
            let h = G1Projective::from(base(&shape).unwrap());
            let m = G1Projective::from(decode(shape.point(2)).unwrap());
            let t = (h * withdrawal.z - m * withdrawal.c).to_affine();
            assert_eq!(hex(&t.to_compressed()), vector["t"], "{name}");
            for (field, scalar) in [("c", withdrawal.c), ("z", withdrawal.z)] {
                assert_eq!(hex(&scalar.to_bytes_be()), vector[field], "{name}: {field}");
            }
            assert_eq!(
                check_withdrawal_proof(&withdrawal, &shape),
                Ok(()),
                "{name}"
            );
            assert_eq!(
                check_withdrawal(&bytes_, network, &certificate, network, pool),
                Ok(())
            );
            // Against another certificate of its network, and under the other
            // network.
            let other = bytes(
                v["certificates"][index ^ 1]["certificate"]
                    .as_str()
                    .unwrap(),
            );
            assert_eq!(
                check_withdrawal(&bytes_, network, &other, network, pool),
                Err(Unwithdrawn::OtherCertificate)
            );
            assert_eq!(
                check_withdrawal_shape(&bytes_, network ^ 1).err(),
                Some(Unwithdrawn::OtherChain)
            );
        }
    }

    /// Every withdrawal refusal in the file is refused with its kind, read
    /// against its `against` certificate under its network and policy, and
    /// each good one in it is taken.
    #[test]
    fn every_withdrawal_refusal_is_refused_with_the_files_kind() {
        let v = vectors();
        let refusals = v["withdrawal_refusals"].as_array().unwrap();
        assert_eq!(refusals.len(), 29);
        let mut kinds = std::collections::BTreeSet::new();
        for vector in refusals {
            let name = vector["name"].as_str().unwrap();
            // Read under its own network, then checked against `against`,
            // read under that one's.
            let (network, policy) = chain(vector);
            let against = &vector["against"];
            let (their_network, their_policy) = chain(against);
            assert_eq!((policy, their_policy), (POLICY, POLICY), "{name}");
            let certificate = bytes(against["certificate"].as_str().unwrap());
            let withdrawal = bytes(vector["withdrawal"].as_str().unwrap());
            let got = check_withdrawal(
                &withdrawal,
                network,
                &certificate,
                their_network,
                pool_of(their_network),
            )
            .err()
            .map_or("ok", Unwithdrawn::name);
            assert_eq!(got, vector["result"], "{name}");
            kinds.insert(got);
        }
        for kind in ["ok", "invalid_withdrawal", "unsupported_version"] {
            assert!(kinds.contains(kind), "{kind}");
        }
    }

    /// §21.7's listing digest: its own label over the pool's name and
    /// length and the certificate's bytes, never an envelope's stamp
    /// digest of the same bytes, and another under the other pool.
    #[test]
    fn a_listing_digest_is_its_own_label_over_the_pool_and_the_certificate() {
        let certificate = [0x5a; 273];
        let expected: [u8; 32] = Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|listing-stamp|")
            .chain_update([7u8])
            .chain_update(b"preprod")
            .chain_update(certificate)
            .finalize()
            .into();
        assert_eq!(listing_digest("preprod", &certificate), expected);
        assert_ne!(
            listing_digest("preprod", &certificate),
            check::stamp_digest("preprod", &certificate)
        );
        assert_ne!(
            listing_digest("preprod", &certificate),
            listing_digest("mainnet", &certificate)
        );
    }

    /// Where a Seedelf and its listing are in the bytes: the key the list
    /// keeps a certificate by is its name, its register and m_S, never its
    /// proof.
    #[test]
    fn a_certificates_seedelf_and_listing_leave_out_its_proof() {
        let v = vectors();
        for vector in v["certificates"].as_array().unwrap() {
            let (network, policy) = chain(vector);
            let certificate = bytes(vector["certificate"].as_str().unwrap());
            let shape = check_shape(&certificate, network, &policy).unwrap();
            let n = shape.name().len();
            assert_eq!(shape.seedelf().len(), 1 + n + 2 * POINT_LEN);
            assert_eq!(shape.listing().len(), 1 + n + 3 * POINT_LEN);
            assert_eq!(shape.seedelf()[0] as usize, n);
            assert!(shape.listing().starts_with(shape.seedelf()));
            assert_eq!(&shape.listing()[1 + n + 2 * POINT_LEN..], shape.point(2));
            assert!(shape.statement().ends_with(shape.listing()));
            assert_eq!(shape.statement().len() + PROOF_LEN, certificate.len());
        }
    }
}
