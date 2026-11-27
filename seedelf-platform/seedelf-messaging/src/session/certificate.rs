//! A Seedelf's certificate: the proof that binds its messaging register to
//! its datum's register (docs/protocol.md §21.4, chunk 55).
//!
//! One Fiat–Shamir challenge over two Schnorr proofs, ANDed: the Seedelf key
//! x for u_S = [x]g_S, and the messaging key x_m for m_S = [x_m]h_S, h_S the
//! Seedelf's hashed base. x's half binds M_S to the Seedelf; x_m's half is
//! the back-signature, so no one binds someone else's messaging register to
//! their own Seedelf.
//!
//! The only function in Messages that takes x is [`Certificate::make`].

use blstrs::{G1Affine, Scalar};
use ff::Field;
use group::Curve;
use sha2::{Digest, Sha256};

use crate::keys::scalar_mod_q;
use crate::register::{POINT_LEN, Register, decode_point, matches_register};
use crate::relay::listing_digest;
use crate::session::draw::{Draw, OsDraw, hedge, hedged_aux_draws};
use crate::session::first_contact::{MAX_TO_LEN, Reader};
use crate::session::seedelf::{Chain, Handle, POLICY_LEN, Seedelf};
use crate::{Error, SecretKey};

/// The certificate's version byte.
pub const CERTIFICATE_VERSION: u8 = 0x01;

/// The only generation v1 takes: rotation comes later (§21.5).
pub const CERTIFICATE_GENERATION: u8 = 0x00;

/// The proof's bytes: `c ‖ z_x ‖ z_m`, each a scalar below the group order,
/// big-endian.
pub const CERTIFICATE_PROOF_LEN: usize = 3 * 32;

/// The bytes before the name: version, network, generation, the policy's
/// hash and the name's length.
const HEAD_LEN: usize = 3 + POLICY_LEN + 1;

/// A certificate's smallest size: a 1-byte name. 273 bytes.
pub const CERTIFICATE_MIN_LEN: usize = HEAD_LEN + 1 + 3 * POINT_LEN + CERTIFICATE_PROOF_LEN;

/// A certificate's largest size: a full 32-byte name. 304 bytes.
pub const CERTIFICATE_MAX_LEN: usize =
    HEAD_LEN + MAX_TO_LEN + 3 * POINT_LEN + CERTIFICATE_PROOF_LEN;

/// SHA-256's label for the challenge.
pub(crate) const CERTIFICATE_LABEL: &[u8] = b"Seedelf-Messaging|v1|certificate";

/// HMAC-SHA-512's label for k_m, keyed by x_m.
pub(crate) const CERTIFICATE_NONCE_M_LABEL: &[u8] = b"Seedelf-Messaging|v1|certificate-nonce|m";

/// HMAC-SHA-512's label for k_x, keyed by x.
pub(crate) const CERTIFICATE_NONCE_X_LABEL: &[u8] = b"Seedelf-Messaging|v1|certificate-nonce|x";

/// A checked certificate: holding one means its proof verifies for its
/// statement, under the chain it was read under. Whether it's *good* for
/// its Seedelf, whether (g_S, u_S) is the register the chain gives the name
/// now, is the caller's to check against its own read of the contract
/// ([`Certificate::is_for`], §21.5).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Certificate {
    handle: Handle,
    proof: CertificateProof,
}

/// The AND-proof's challenge and two responses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct CertificateProof {
    pub(crate) c: Scalar,
    pub(crate) z_x: Scalar,
    pub(crate) z_m: Scalar,
}

/// The statement's bytes: `version ‖ network ‖ generation ‖ policy ‖ len(N)
/// ‖ N ‖ g_S ‖ u_S ‖ m_S`, every point compressed. What the challenge and
/// both nonces cover.
pub(crate) fn statement(handle: &Handle) -> Vec<u8> {
    let seedelf = handle.seedelf();
    let name = seedelf.name();
    let mut out = Vec::with_capacity(HEAD_LEN + name.len() + 3 * POINT_LEN);
    out.push(CERTIFICATE_VERSION);
    out.push(seedelf.chain().network());
    out.push(CERTIFICATE_GENERATION);
    out.extend_from_slice(seedelf.chain().policy());
    out.push(name.len() as u8);
    out.extend_from_slice(name);
    out.extend_from_slice(&seedelf.register().to_bytes());
    out.extend_from_slice(&handle.register().public_value_bytes());
    out
}

/// `SHA-256("Seedelf-Messaging|v1|certificate" ‖ statement ‖ T_x ‖ T_m)`,
/// the commitments compressed (O as `0xc0` and 47 zero bytes).
pub(crate) fn challenge(statement: &[u8], t_x: &G1Affine, t_m: &G1Affine) -> [u8; 32] {
    Sha256::new()
        .chain_update(CERTIFICATE_LABEL)
        .chain_update(statement)
        .chain_update(t_x.to_compressed())
        .chain_update(t_m.to_compressed())
        .finalize()
        .into()
}

/// k_m's message: `"…|certificate-nonce|m" ‖ statement ‖ aux`.
pub(crate) fn nonce_m_message(statement: &[u8], aux: &[u8; 32]) -> Vec<u8> {
    let mut out = CERTIFICATE_NONCE_M_LABEL.to_vec();
    out.extend_from_slice(statement);
    out.extend_from_slice(aux);
    out
}

/// k_x's message: `"…|certificate-nonce|x" ‖ statement ‖ T_m ‖ aux`. It
/// covers T_m, so k_x never meets two challenges whatever the x_m half does.
pub(crate) fn nonce_x_message(statement: &[u8], t_m: &G1Affine, aux: &[u8; 32]) -> Vec<u8> {
    let mut out = CERTIFICATE_NONCE_X_LABEL.to_vec();
    out.extend_from_slice(statement);
    out.extend_from_slice(&t_m.to_compressed());
    out.extend_from_slice(aux);
    out
}

impl Certificate {
    /// Makes the certificate of `seedelf`, one of the wallet's own: `spend`
    /// is the Seedelf key x, `messaging` the messaging key x_m (§21.4).
    ///
    /// Refuses, before either key meets anything, one key given for both
    /// ([`Error::SameKey`]), and a Seedelf whose register isn't `spend`'s
    /// ([`Error::NotOwned`]): a proof for a register that isn't x's would
    /// hand out `[x]g_S`. The register's points were checked when it was
    /// decoded (canonical, in G1, not the identity).
    ///
    /// One call makes the whole certificate, from one 32-byte aux: k_m over
    /// the statement and aux, then k_x over the statement, T_m and aux. So
    /// one nonce never meets two challenges, whatever the random source does.
    pub fn make(
        spend: &SecretKey,
        messaging: &SecretKey,
        seedelf: &Seedelf,
    ) -> Result<Self, Error> {
        Self::make_with(spend, messaging, seedelf, &mut OsDraw)
    }

    pub(crate) fn make_with(
        spend: &SecretKey,
        messaging: &SecretKey,
        seedelf: &Seedelf,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        if spend.register().public_value_bytes() == messaging.register().public_value_bytes() {
            return Err(Error::SameKey);
        }
        if !matches_register(spend, seedelf.register()) {
            return Err(Error::NotOwned);
        }
        let handle = seedelf.handle(messaging)?;
        let statement = statement(&handle);
        let (x, x_m) = (spend.scalar(), messaging.scalar());
        let h = handle.register().generator();
        let g = seedelf.register().generator();
        let (k_x, k_m, t_m) = hedged_aux_draws(draw, |aux| {
            let k_m = hedge(&x_m, &nonce_m_message(&statement, aux));
            if bool::from(k_m.is_zero()) {
                return None;
            }
            let t_m = (h * k_m).to_affine();
            let k_x = hedge(&x, &nonce_x_message(&statement, &t_m, aux));
            if bool::from(k_x.is_zero()) {
                return None;
            }
            Some((k_x, k_m, t_m))
        });
        let t_x = (g * k_x).to_affine();
        let c = scalar_mod_q(&challenge(&statement, &t_x, &t_m));
        Ok(Self {
            handle,
            proof: CertificateProof {
                c,
                z_x: k_x + c * x,
                z_m: k_m + c * x_m,
            },
        })
    }

    /// The commitments the proof gives: T_x = [z_x]g_S − [c]u_S and
    /// T_m = [z_m]h_S − [c]m_S.
    pub(crate) fn commitments(&self) -> (G1Affine, G1Affine) {
        let seedelf = self.handle.seedelf().register();
        let messaging = self.handle.register();
        let t_x = seedelf.generator() * self.proof.z_x - seedelf.public_value() * self.proof.c;
        let t_m = messaging.generator() * self.proof.z_m - messaging.public_value() * self.proof.c;
        (t_x.to_affine(), t_m.to_affine())
    }

    /// Whether the proof verifies for the statement.
    pub(crate) fn verifies(&self) -> bool {
        let (t_x, t_m) = self.commitments();
        scalar_mod_q(&challenge(&statement(&self.handle), &t_x, &t_m)) == self.proof.c
    }

    /// A certificate from exactly its bytes, read under `chain`, and
    /// checked (§21.4's checks, in order):
    ///
    /// 1. its length (273 to 304, matching its name's), version, network
    ///    (`chain`'s), generation (0) and policy (`chain`'s), and a name of
    ///    1 to 32 bytes: [`Error::InvalidCertificate`], or
    ///    [`Error::UnsupportedVersion`] for another version;
    /// 2. g_S, u_S and m_S canonical, in G1 and not the identity (each its
    ///    own error, as everywhere), and c, z_x and z_m below the group
    ///    order ([`Error::InvalidCertificate`]);
    /// 3. h_S, from the Seedelf;
    /// 4. the proof ([`Error::InvalidCertificate`]).
    pub fn from_bytes(chain: &Chain, bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() < CERTIFICATE_MIN_LEN || bytes.len() > CERTIFICATE_MAX_LEN {
            return Err(Error::InvalidCertificate);
        }
        let mut reader = Reader::new(bytes);
        let version = reader.byte()?;
        if version != CERTIFICATE_VERSION {
            return Err(Error::UnsupportedVersion(version));
        }
        let network = reader.byte()?;
        let generation = reader.byte()?;
        let policy: [u8; POLICY_LEN] = reader.array()?;
        if network != chain.network()
            || generation != CERTIFICATE_GENERATION
            || policy != *chain.policy()
        {
            return Err(Error::InvalidCertificate);
        }
        let len = usize::from(reader.byte()?);
        if len == 0
            || len > MAX_TO_LEN
            || bytes.len() != HEAD_LEN + len + 3 * POINT_LEN + CERTIFICATE_PROOF_LEN
        {
            return Err(Error::InvalidCertificate);
        }
        let name = reader.take(len)?;
        let generator = decode_point(&reader.array()?)?;
        let public_value = decode_point(&reader.array()?)?;
        let value = decode_point(&reader.array()?)?;
        let mut scalar = || -> Result<Scalar, Error> {
            Option::from(Scalar::from_bytes_be(&reader.array()?)).ok_or(Error::InvalidCertificate)
        };
        let proof = CertificateProof {
            c: scalar()?,
            z_x: scalar()?,
            z_m: scalar()?,
        };
        if !reader.is_done() {
            return Err(Error::InvalidCertificate);
        }
        let seedelf = Seedelf::new(
            *chain,
            name,
            Register::from_checked(generator, public_value),
        )?;
        let base = seedelf.base()?;
        let certificate = Self {
            handle: Handle::from_value(seedelf, base, value),
            proof,
        };
        if !certificate.verifies() {
            return Err(Error::InvalidCertificate);
        }
        Ok(certificate)
    }

    /// The certificate's bytes: 273 to 304.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = statement(&self.handle);
        for scalar in [self.proof.c, self.proof.z_x, self.proof.z_m] {
            out.extend_from_slice(&scalar.to_bytes_be());
        }
        out
    }

    /// The Seedelf it certifies, with the register it names.
    pub fn seedelf(&self) -> &Seedelf {
        self.handle.seedelf()
    }

    /// The handle a writer writes to: the Seedelf and its messaging register
    /// M_S. Write to it only while the certificate is good (§21.5).
    pub fn handle(&self) -> &Handle {
        &self.handle
    }

    /// Whether this certificate names `seedelf`: the same chain, name and
    /// register. Good for the Seedelf when `seedelf` is what the reader's
    /// own read of the contract gives the name now (§21.5).
    pub fn is_for(&self, seedelf: &Seedelf) -> bool {
        self.handle.seedelf() == seedelf
    }

    /// The commitment T_x and response z_x of x's half, what a spending
    /// verifier would be handed if a certificate were taken for a spend.
    /// For the tests that the spending verifiers refuse it (§21.4).
    #[cfg(test)]
    pub(crate) fn seedelf_transcript(&self) -> (G1Affine, Scalar, Scalar) {
        (self.commitments().0, self.proof.c, self.proof.z_x)
    }
}

/// A withdrawal's version byte.
pub const WITHDRAWAL_VERSION: u8 = 0x01;

/// A withdrawal's size: version, network, the digest, c and z. 98 bytes.
pub const WITHDRAWAL_LEN: usize = 2 + 32 + 32 + 32;

/// SHA-256's label for a withdrawal's challenge.
pub(crate) const WITHDRAWAL_LABEL: &[u8] = b"Seedelf-Messaging|v1|withdrawal";

/// HMAC-SHA-512's label for a withdrawal's nonce, keyed by x_m.
pub(crate) const WITHDRAWAL_NONCE_LABEL: &[u8] = b"Seedelf-Messaging|v1|withdrawal-nonce";

/// A withdrawal: takes one certificate off the relay's list
/// (docs/protocol.md §21.7, chunk 55's call 9). A Schnorr proof of the
/// messaging key x_m on the withdrawn certificate's own messaging register
/// (h_S, m_S), over its listing digest under the pool's name, never a use of
/// the Seedelf key.
///
/// Holding one says only that its shape reads. It checks against the
/// certificate it names, the one the list holds under its digest
/// ([`Withdrawal::check`]).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Withdrawal {
    network: u8,
    digest: [u8; 32],
    c: Scalar,
    z: Scalar,
}

/// The withdrawal's statement: `version ‖ network ‖ digest`.
fn withdrawal_statement(network: u8, digest: &[u8; 32]) -> [u8; 34] {
    let mut out = [0u8; 34];
    out[0] = WITHDRAWAL_VERSION;
    out[1] = network;
    out[2..].copy_from_slice(digest);
    out
}

/// `SHA-256("Seedelf-Messaging|v1|withdrawal" ‖ statement ‖ h_S ‖ m_S ‖ T)`,
/// every point compressed.
pub(crate) fn withdrawal_challenge(
    statement: &[u8],
    messaging: &Register,
    t: &G1Affine,
) -> [u8; 32] {
    Sha256::new()
        .chain_update(WITHDRAWAL_LABEL)
        .chain_update(statement)
        .chain_update(messaging.to_bytes())
        .chain_update(t.to_compressed())
        .finalize()
        .into()
}

/// The nonce's message: `"…|withdrawal-nonce" ‖ statement ‖ h_S ‖ m_S ‖
/// aux`. It covers everything the challenge does, T following from k.
pub(crate) fn withdrawal_nonce_message(
    statement: &[u8],
    messaging: &Register,
    aux: &[u8; 32],
) -> Vec<u8> {
    let mut out = WITHDRAWAL_NONCE_LABEL.to_vec();
    out.extend_from_slice(statement);
    out.extend_from_slice(&messaging.to_bytes());
    out.extend_from_slice(aux);
    out
}

impl Certificate {
    /// The certificate's listing digest under its chain's pool
    /// (docs/protocol.md §21.7): what its post's stamp is over, what a
    /// removal names it by, and what a withdrawal of it names.
    pub fn listing_digest(&self) -> [u8; 32] {
        listing_digest(self.seedelf().chain().pool(), &self.to_bytes())
            .expect("a pool's name is short")
    }
}

impl Withdrawal {
    /// Withdraws `certificate`, one of the wallet's own: `messaging` is the
    /// messaging key x_m, never the Seedelf key. Refuses a certificate whose
    /// messaging value isn't `messaging`'s ([`Error::NotForThisKey`]): the
    /// proof would be for a register that isn't the key's.
    pub fn make(messaging: &SecretKey, certificate: &Certificate) -> Result<Self, Error> {
        Self::make_with(messaging, certificate, &mut OsDraw)
    }

    pub(crate) fn make_with(
        messaging: &SecretKey,
        certificate: &Certificate,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        let register = *certificate.handle().register();
        if !matches_register(messaging, &register) {
            return Err(Error::NotForThisKey);
        }
        let network = certificate.seedelf().chain().network();
        let digest = certificate.listing_digest();
        let statement = withdrawal_statement(network, &digest);
        let x_m = messaging.scalar();
        let k = hedged_aux_draws(draw, |aux| {
            let k = hedge(&x_m, &withdrawal_nonce_message(&statement, &register, aux));
            (!bool::from(k.is_zero())).then_some(k)
        });
        let t = (register.generator() * k).to_affine();
        let c = scalar_mod_q(&withdrawal_challenge(&statement, &register, &t));
        Ok(Self {
            network,
            digest,
            c,
            z: k + c * x_m,
        })
    }

    /// A withdrawal from exactly its bytes, read under `chain`: 98 bytes,
    /// version 1, `chain`'s network, c and z below the group order
    /// ([`Error::InvalidWithdrawal`] for each, or
    /// [`Error::UnsupportedVersion`] for another version). Its proof is
    /// checked against the certificate it names ([`Withdrawal::check`]).
    pub fn from_bytes(chain: &Chain, bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() != WITHDRAWAL_LEN {
            return Err(Error::InvalidWithdrawal);
        }
        if bytes[0] != WITHDRAWAL_VERSION {
            return Err(Error::UnsupportedVersion(bytes[0]));
        }
        if bytes[1] != chain.network() {
            return Err(Error::InvalidWithdrawal);
        }
        let scalar = |at: usize| -> Result<Scalar, Error> {
            let bytes: [u8; 32] = bytes[at..at + 32].try_into().expect("32 bytes");
            Option::from(Scalar::from_bytes_be(&bytes)).ok_or(Error::InvalidWithdrawal)
        };
        Ok(Self {
            network: bytes[1],
            digest: bytes[2..34].try_into().expect("32 bytes"),
            c: scalar(34)?,
            z: scalar(66)?,
        })
    }

    /// The withdrawal's bytes: 98.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = withdrawal_statement(self.network, &self.digest).to_vec();
        out.extend_from_slice(&self.c.to_bytes_be());
        out.extend_from_slice(&self.z.to_bytes_be());
        out
    }

    /// The listing digest of the certificate it withdraws.
    pub fn digest(&self) -> &[u8; 32] {
        &self.digest
    }

    /// Checks the withdrawal against `certificate`, the one the list holds
    /// under its digest: the digest must be the certificate's, and the proof
    /// must verify on its messaging register, `T = [z]h_S − [c]m_S`
    /// ([`Error::InvalidWithdrawal`] otherwise).
    pub fn check(&self, certificate: &Certificate) -> Result<(), Error> {
        if self.network != certificate.seedelf().chain().network()
            || self.digest != certificate.listing_digest()
        {
            return Err(Error::InvalidWithdrawal);
        }
        let register = certificate.handle().register();
        let t = (register.generator() * self.z - register.public_value() * self.c).to_affine();
        let statement = withdrawal_statement(self.network, &self.digest);
        if scalar_mod_q(&withdrawal_challenge(&statement, register, &t)) != self.c {
            return Err(Error::InvalidWithdrawal);
        }
        Ok(())
    }
}
