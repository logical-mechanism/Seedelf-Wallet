//! Lovejoin's proofs, on BLS12-381 G1: the Schnorr proof a box's owner gives
//! to withdraw it, and the N-way sigma-OR proof a mix gives for each box it
//! re-randomizes. A port of Lovejoin's TypeScript prover
//! (`offchain/src/crypto/`, MIT) onto blstrs, checked against its known-answer
//! vectors byte for byte, so the deployed validators accept what it proves.
//!
//! A Lovejoin box's datum `{a, b}` has the shape of a Seedelf [`Register`]:
//! `b = [x]·a`. The wallet's boxes are owned by its Seedelf key, so the
//! Schnorr proof here is made with that key. Its transcript starts with
//! Lovejoin's domain tag, unlike Seedelf's own proof, so neither can be passed
//! off as the other.
//!
//! Nonces are deterministic (RFC 6979's HMAC-SHA256 DRBG over the secret and
//! everything the proof binds), as Lovejoin's are; that's what makes the
//! vectors reproducible.
//!
//! [`Register`]: crate::register::Register

use anyhow::{Result, anyhow, bail};
use blake2::Blake2bVar;
use blake2::digest::{Update, VariableOutput};
use blstrs::{G1Affine, G1Projective, Scalar};
use cryptoxide::digest::Digest;
use cryptoxide::hmac::Hmac;
use cryptoxide::mac::Mac;
use cryptoxide::sha2::Sha256;
use ff::Field;
use group::Group;

pub const DOMAIN_TAG_V1: &[u8] = b"lovejoin/sigmajoin/v1/";
const STATEMENT_ID_PROVE_DLOG: u8 = 0x01;
const STATEMENT_ID_SIGMA_OR_N: u8 = 0x03;

const TAG_REAL: &[u8] = b"lovejoin/sigma-or/real-r/v1";
const TAG_SIM_C: &[u8] = b"lovejoin/sigma-or/sim-c/v1";
const TAG_SIM_Z: &[u8] = b"lovejoin/sigma-or/sim-z/v1";

/// A Schnorr proof of `u = [x]·base`: the commitment and the response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchnorrProof {
    pub t: [u8; 48],
    pub z: [u8; 32],
}

/// One branch of a sigma-OR proof: its two commitments, its challenge share
/// (raw bytes, XOR-composed), and its response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Branch {
    pub t0: [u8; 48],
    pub t1: [u8; 48],
    pub c: [u8; 32],
    pub z: [u8; 32],
}

pub fn blake2b_256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Blake2bVar::new(32).expect("32 is a valid BLAKE2b length");
    hasher.update(bytes);
    let mut out = [0u8; 32];
    hasher
        .finalize_variable(&mut out)
        .expect("the buffer is 32 bytes");
    out
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.input(bytes);
    let mut out = [0u8; 32];
    hasher.result(&mut out);
    out
}

fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = Hmac::new(Sha256::new(), key);
    for part in parts {
        mac.input(part);
    }
    let mut out = [0u8; 32];
    mac.raw_result(&mut out);
    out
}

/// A compressed point, refused unless it's in the prime-order subgroup.
pub fn point_from_bytes(bytes: &[u8]) -> Result<G1Projective> {
    let bytes: [u8; 48] = bytes
        .try_into()
        .map_err(|_| anyhow!("A G1 point is 48 bytes, not {}", bytes.len()))?;
    G1Affine::from_compressed(&bytes)
        .into_option()
        .map(G1Projective::from)
        .ok_or_else(|| anyhow!("Not a point of G1's prime-order subgroup"))
}

pub fn point_to_bytes(point: &G1Projective) -> [u8; 48] {
    point.to_compressed()
}

/// A scalar from 32 big-endian bytes, only if it's already below `r`.
pub fn canonical_scalar(bytes: &[u8; 32]) -> Option<Scalar> {
    Scalar::from_bytes_be(bytes).into_option()
}

/// 32 big-endian bytes taken mod `r`. Each 16-byte half is below `r`, so
/// `hi·2^128 + lo` in the field is exact.
pub fn reduce(bytes: &[u8; 32]) -> Scalar {
    let half = |range: std::ops::Range<usize>| {
        let mut wide = [0u8; 32];
        wide[16..].copy_from_slice(&bytes[range]);
        canonical_scalar(&wide).expect("a 128-bit value is below r")
    };
    let two_64 = Scalar::from(u64::MAX) + Scalar::ONE;
    half(0..16) * two_64 * two_64 + half(16..32)
}

/// RFC 6979's `bits2int` for a 255-bit order: the 256-bit value, shifted
/// right by one bit.
fn bits2int(bytes: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut carry = 0u8;
    for (o, b) in out.iter_mut().zip(bytes.iter()) {
        *o = (b >> 1) | carry;
        carry = (b & 1) << 7;
    }
    out
}

/// A deterministic nonce in `[1, r)` for `secret` and `message`: RFC 6979's
/// HMAC-SHA256 DRBG over the secret and SHA-256 of Lovejoin's domain tag and
/// the message.
pub fn derive_nonce(secret: &Scalar, message: &[u8]) -> Result<Scalar> {
    if bool::from(secret.is_zero()) {
        bail!("The secret must be in [1, r)");
    }
    let mut tagged = DOMAIN_TAG_V1.to_vec();
    tagged.extend_from_slice(message);
    let h1 = sha256(&tagged);
    let x_octets = secret.to_bytes_be();
    let h1_octets = reduce(&bits2int(&h1)).to_bytes_be();

    let mut v = [0x01u8; 32];
    let mut k = [0u8; 32];
    k = hmac_sha256(&k, &[&v, &[0x00], &x_octets, &h1_octets]);
    v = hmac_sha256(&k, &[&v]);
    k = hmac_sha256(&k, &[&v, &[0x01], &x_octets, &h1_octets]);
    v = hmac_sha256(&k, &[&v]);
    loop {
        v = hmac_sha256(&k, &[&v]);
        let candidate = bits2int(&v);
        if let Some(nonce) = canonical_scalar(&candidate)
            && !bool::from(nonce.is_zero())
        {
            return Ok(nonce);
        }
        k = hmac_sha256(&k, &[&v, &[0x00]]);
        v = hmac_sha256(&k, &[&v]);
    }
}

/// The Fiat-Shamir challenge of a Schnorr proof, before reduction.
pub fn fs_hash_schnorr(g: &[u8], u: &[u8], t: &[u8], ctx: &[u8]) -> [u8; 32] {
    let mut input = DOMAIN_TAG_V1.to_vec();
    input.push(STATEMENT_ID_PROVE_DLOG);
    for part in [g, u, t, ctx] {
        input.extend_from_slice(part);
    }
    blake2b_256(&input)
}

/// The Fiat-Shamir challenge of an N-way sigma-OR proof, before reduction:
/// `DOMAIN ‖ 0x03 ‖ N ‖ a ‖ b ‖ (a'ᵢ, b'ᵢ)… ‖ (t0ᵢ, t1ᵢ)… ‖ ctx`.
pub fn fs_hash_sigma_or(
    a: &[u8; 48],
    b: &[u8; 48],
    statements: &[([u8; 48], [u8; 48])],
    commitments: &[([u8; 48], [u8; 48])],
    ctx: &[u8],
) -> Result<[u8; 32]> {
    let n = statements.len();
    if n != commitments.len() || !(2..=255).contains(&n) {
        bail!("A sigma-OR needs between 2 and 255 statements, one commitment pair each");
    }
    let mut input = DOMAIN_TAG_V1.to_vec();
    input.extend_from_slice(&[STATEMENT_ID_SIGMA_OR_N, n as u8]);
    input.extend_from_slice(a);
    input.extend_from_slice(b);
    for (ap, bp) in statements {
        input.extend_from_slice(ap);
        input.extend_from_slice(bp);
    }
    for (t0, t1) in commitments {
        input.extend_from_slice(t0);
        input.extend_from_slice(t1);
    }
    input.extend_from_slice(ctx);
    Ok(blake2b_256(&input))
}

/// Proves knowledge of `secret` with `u = [secret]·base`, bound to `ctx`.
pub fn prove_schnorr(base: &G1Projective, secret: &Scalar, ctx: &[u8]) -> Result<SchnorrProof> {
    if bool::from(secret.is_zero()) {
        bail!("The secret must be in [1, r)");
    }
    let base_bytes = point_to_bytes(base);
    let u_bytes = point_to_bytes(&(base * secret));
    let mut nonce_message = base_bytes.to_vec();
    nonce_message.extend_from_slice(&u_bytes);
    nonce_message.extend_from_slice(ctx);
    let r = derive_nonce(secret, &nonce_message)?;
    let t = point_to_bytes(&(base * r));
    let c = reduce(&fs_hash_schnorr(&base_bytes, &u_bytes, &t, ctx));
    let z = r + c * secret;
    Ok(SchnorrProof {
        t,
        z: z.to_bytes_be(),
    })
}

/// Lovejoin's check of a Schnorr proof, as its validator runs it.
pub fn verify_schnorr(
    base: &G1Projective,
    u: &G1Projective,
    proof: &SchnorrProof,
    ctx: &[u8],
) -> bool {
    let (Ok(t), Some(z)) = (point_from_bytes(&proof.t), canonical_scalar(&proof.z)) else {
        return false;
    };
    let c = reduce(&fs_hash_schnorr(
        &point_to_bytes(base),
        &point_to_bytes(u),
        &proof.t,
        ctx,
    ));
    base * z == t + u * c
}

/// Proves that `(a'ᵢ, b'ᵢ) = ([witness]·a, [witness]·b)` for `real_index`,
/// without saying which `i`, bound to `ctx`. A mix gives one for each box it
/// takes: the box's `(a, b)`, every output as a statement, and the scalar that
/// re-randomized the box into its output.
pub fn prove_sigma_or(
    a: &G1Projective,
    b: &G1Projective,
    statements: &[(G1Projective, G1Projective)],
    real_index: usize,
    witness: &Scalar,
    ctx: &[u8],
) -> Result<Vec<Branch>> {
    let n = statements.len();
    if n < 2 {
        bail!("A sigma-OR needs at least two statements");
    }
    if real_index >= n {
        bail!("The real branch {real_index} is out of range");
    }
    if bool::from(witness.is_zero()) {
        bail!("The witness must be in [1, r)");
    }
    let a_bytes = point_to_bytes(a);
    let b_bytes = point_to_bytes(b);
    let statement_bytes: Vec<([u8; 48], [u8; 48])> = statements
        .iter()
        .map(|(ap, bp)| (point_to_bytes(ap), point_to_bytes(bp)))
        .collect();
    let mut base_message = a_bytes.to_vec();
    base_message.extend_from_slice(&b_bytes);
    for (ap, bp) in &statement_bytes {
        base_message.extend_from_slice(ap);
        base_message.extend_from_slice(bp);
    }
    base_message.extend_from_slice(ctx);
    let message = |i: usize, tag: &[u8]| {
        let mut m = base_message.clone();
        m.extend_from_slice(&(i as u32).to_be_bytes());
        m.extend_from_slice(tag);
        m
    };
    let witness_bytes = witness.to_bytes_be();

    let mut commitments = vec![(G1Projective::identity(), G1Projective::identity()); n];
    let mut challenges = vec![[0u8; 32]; n];
    let mut responses = vec![Scalar::ZERO; n];

    let r = derive_nonce(witness, &message(real_index, TAG_REAL))?;
    commitments[real_index] = (a * r, b * r);
    for (i, (ap, bp)) in statements.iter().enumerate() {
        if i == real_index {
            continue;
        }
        let c = hmac_sha256(&witness_bytes, &[&message(i, TAG_SIM_C)]);
        let z = derive_nonce(witness, &message(i, TAG_SIM_Z))?;
        let c_mod = reduce(&c);
        commitments[i] = (a * z - ap * c_mod, b * z - bp * c_mod);
        challenges[i] = c;
        responses[i] = z;
    }
    let commitment_bytes: Vec<([u8; 48], [u8; 48])> = commitments
        .iter()
        .map(|(t0, t1)| (point_to_bytes(t0), point_to_bytes(t1)))
        .collect();
    let mut real_c =
        fs_hash_sigma_or(&a_bytes, &b_bytes, &statement_bytes, &commitment_bytes, ctx)?;
    for (i, c) in challenges.iter().enumerate() {
        if i != real_index {
            real_c.iter_mut().zip(c).for_each(|(x, y)| *x ^= y);
        }
    }
    challenges[real_index] = real_c;
    responses[real_index] = r + reduce(&real_c) * witness;

    Ok((0..n)
        .map(|i| Branch {
            t0: commitment_bytes[i].0,
            t1: commitment_bytes[i].1,
            c: challenges[i],
            z: responses[i].to_bytes_be(),
        })
        .collect())
}

/// Lovejoin's check of a sigma-OR proof, as its validator runs it.
pub fn verify_sigma_or(
    a: &G1Projective,
    b: &G1Projective,
    statements: &[(G1Projective, G1Projective)],
    branches: &[Branch],
    ctx: &[u8],
) -> bool {
    let n = statements.len();
    if n < 2 || branches.len() != n {
        return false;
    }
    let statement_bytes: Vec<([u8; 48], [u8; 48])> = statements
        .iter()
        .map(|(ap, bp)| (point_to_bytes(ap), point_to_bytes(bp)))
        .collect();
    let commitment_bytes: Vec<([u8; 48], [u8; 48])> =
        branches.iter().map(|br| (br.t0, br.t1)).collect();
    let Ok(expected) = fs_hash_sigma_or(
        &point_to_bytes(a),
        &point_to_bytes(b),
        &statement_bytes,
        &commitment_bytes,
        ctx,
    ) else {
        return false;
    };
    let mut xor = [0u8; 32];
    for br in branches {
        xor.iter_mut().zip(&br.c).for_each(|(x, y)| *x ^= y);
    }
    if xor != expected {
        return false;
    }
    branches.iter().zip(statements).all(|(br, (ap, bp))| {
        let (Ok(t0), Ok(t1), Some(z)) = (
            point_from_bytes(&br.t0),
            point_from_bytes(&br.t1),
            canonical_scalar(&br.z),
        ) else {
            return false;
        };
        let c = reduce(&br.c);
        a * z == t0 + ap * c && b * z == t1 + bp * c
    })
}
