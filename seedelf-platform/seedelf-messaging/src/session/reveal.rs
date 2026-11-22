//! The verified reveal (docs/protocol.md §19): the side that wrote first
//! shows the other which Seedelf it holds, inside the ratchet, once a reply
//! has come.
//!
//! The proof is designated-verifier and bound to the conversation: a
//! Fiat–Shamir OR-proof (Cramer, Damgård and Schoenmakers) that either the
//! Seedelf's register and the initiator's identity `A` share a key
//! (Chaum–Pedersen), or the prover knows the key of the reader's identity
//! `w₀`. The initiator proves the first. The reader holds the second, so it
//! could have made the proof itself: it convinces the reader and no one else,
//! and the conversation stays deniable.
//!
//! ```text
//! len (1) | name (1–32) | g_S (48) | u_S (48) | c₁ (32) | c₂ (32) | z₁ (32) | z₂ (32)
//! ```

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use sha2::{Digest, Sha256};

use crate::keys::scalar_mod_q;
use crate::register::{POINT_LEN, Register, decode_point, matches_register};
use crate::session::conversation::{Conversation, Role};
use crate::session::draw::{Draw, OsDraw};
use crate::session::first_contact::{Handle, MAX_TO_LEN, Reader};
use crate::{Error, SecretKey};

/// The proof's bytes: `c₁ ‖ c₂ ‖ z₁ ‖ z₂`, each a scalar below the group
/// order, big-endian.
pub const REVEAL_PROOF_LEN: usize = 4 * 32;

/// A reveal's smallest size: a 1-byte name. 226 bytes.
pub const REVEAL_MIN_LEN: usize = 1 + 1 + 2 * POINT_LEN + REVEAL_PROOF_LEN;

/// A reveal's largest size: a Seedelf's full 32-byte name. 257 bytes.
pub const REVEAL_MAX_LEN: usize = 1 + MAX_TO_LEN + 2 * POINT_LEN + REVEAL_PROOF_LEN;

/// SHA-256's label for the proof's challenge.
pub(crate) const REVEAL_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|reveal";

/// A Seedelf shown with its proof: what the initiator sends, and what the
/// reader checks against its conversation
/// ([`Conversation::verify_reveal`]).
///
/// Holding one says nothing until it's checked: parsing checks only that its
/// name is 1 to 32 bytes, its points are canonical, in G1 and not the
/// identity, and its scalars are below the group order.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Reveal {
    pub(crate) seedelf: Handle,
    pub(crate) proof: RevealProof,
}

/// The OR-proof's challenge shares and responses. Branch 1 is the Seedelf's
/// key (`log_{g_S} u_S = log_{p₀} A`), branch 2 the reader's
/// (`log_{p₀} w₀`); `c₁ + c₂` is the challenge, mod q.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct RevealProof {
    pub(crate) c1: Scalar,
    pub(crate) c2: Scalar,
    pub(crate) z1: Scalar,
    pub(crate) z2: Scalar,
}

/// What a reveal's proof is about: the conversation's ID and identities, and
/// the Seedelf shown.
pub(crate) struct Statement<'a> {
    pub(crate) cid: &'a [u8; 16],
    /// `p₀`.
    pub(crate) base: G1Affine,
    /// `A = [x_A]p₀`, the initiator's identity: the prover's.
    pub(crate) initiator: G1Affine,
    /// `w₀ = [x_B]p₀`, the responder's identity: the reader's.
    pub(crate) responder: G1Affine,
    pub(crate) seedelf: &'a Handle,
}

/// The three commitments: `T₁ = [k₁]p₀` and `T₁′ = [k₁]g_S` for branch 1,
/// `T₂ = [k₂]p₀` for branch 2, or what the simulated branch's challenge and
/// response give in their place.
pub(crate) struct Commitments {
    pub(crate) t1: G1Affine,
    pub(crate) t1_seedelf: G1Affine,
    pub(crate) t2: G1Affine,
}

impl Statement<'_> {
    /// The statement a conversation's reveal of `seedelf` is about.
    pub(crate) fn of<'a>(conversation: &'a Conversation, seedelf: &'a Handle) -> Statement<'a> {
        Statement {
            cid: &conversation.first.cid.0,
            base: conversation.first.base,
            initiator: conversation.first.initiator,
            responder: conversation.responder,
            seedelf,
        }
    }

    /// `SHA-256("Seedelf-Messaging|v1|session|reveal" ‖ cid ‖ p₀ ‖ A ‖ w₀ ‖
    /// len ‖ name ‖ g_S ‖ u_S ‖ T₁ ‖ T₁′ ‖ T₂)`, every point compressed.
    pub(crate) fn challenge(&self, commitments: &Commitments) -> [u8; 32] {
        let name = self.seedelf.name();
        Sha256::new()
            .chain_update(REVEAL_LABEL)
            .chain_update(self.cid)
            .chain_update(self.base.to_compressed())
            .chain_update(self.initiator.to_compressed())
            .chain_update(self.responder.to_compressed())
            // A handle's name is 1 to 32 bytes.
            .chain_update([name.len() as u8])
            .chain_update(name)
            .chain_update(self.seedelf.register().to_bytes())
            .chain_update(commitments.t1.to_compressed())
            .chain_update(commitments.t1_seedelf.to_compressed())
            .chain_update(commitments.t2.to_compressed())
            .finalize()
            .into()
    }

    /// The commitments a proof's responses and challenge shares give: what
    /// the reader recomputes, and what a simulated branch's are.
    pub(crate) fn commitments_of(&self, proof: &RevealProof) -> Commitments {
        let p0 = G1Projective::from(self.base);
        let register = self.seedelf.register();
        Commitments {
            t1: (p0 * proof.z1 - G1Projective::from(self.initiator) * proof.c1).to_affine(),
            t1_seedelf: (register.generator() * proof.z1 - register.public_value() * proof.c1)
                .to_affine(),
            t2: (p0 * proof.z2 - G1Projective::from(self.responder) * proof.c2).to_affine(),
        }
    }

    /// Branch 1 proved with `x`, the key of `A` and of the Seedelf's
    /// register, and branch 2 simulated. Draws `k₁`, then `c₂`, then `z₂`.
    pub(crate) fn prove_seedelf(
        &self,
        x: &Scalar,
        draw: &mut dyn Draw,
    ) -> (RevealProof, Commitments) {
        let k = draw.scalar();
        let c2 = draw.scalar();
        let z2 = draw.scalar();
        let p0 = G1Projective::from(self.base);
        let commitments = Commitments {
            t1: (p0 * k).to_affine(),
            t1_seedelf: (self.seedelf.register().generator() * k).to_affine(),
            t2: (p0 * z2 - G1Projective::from(self.responder) * c2).to_affine(),
        };
        let c = scalar_mod_q(&self.challenge(&commitments));
        let c1 = c - c2;
        let proof = RevealProof {
            c1,
            c2,
            z1: k + c1 * x,
            z2,
        };
        (proof, commitments)
    }

    /// Whether `proof` verifies: `c₁ + c₂` is the challenge over the
    /// commitments it gives.
    pub(crate) fn verifies(&self, proof: &RevealProof) -> bool {
        let c = scalar_mod_q(&self.challenge(&self.commitments_of(proof)));
        proof.c1 + proof.c2 == c
    }
}

impl Reveal {
    /// The Seedelf shown: its name and the register the proof is for.
    pub fn seedelf(&self) -> &Handle {
        &self.seedelf
    }

    /// The Seedelf's asset name.
    pub fn name(&self) -> &[u8] {
        self.seedelf.name()
    }

    /// The register the proof is for: the reader checks it's the one the
    /// chain gives the name now.
    pub fn register(&self) -> &Register {
        self.seedelf.register()
    }

    /// The reveal's bytes: 226 to 257.
    pub fn to_bytes(&self) -> Vec<u8> {
        let name = self.seedelf.name();
        let mut out = Vec::with_capacity(REVEAL_MAX_LEN);
        out.push(name.len() as u8);
        out.extend_from_slice(name);
        out.extend_from_slice(&self.seedelf.register().to_bytes());
        for scalar in [self.proof.c1, self.proof.c2, self.proof.z1, self.proof.z2] {
            out.extend_from_slice(&scalar.to_bytes_be());
        }
        out
    }

    /// A reveal from exactly its bytes. A name of 0 or more than 32 bytes, a
    /// scalar not below the group order, or a length that isn't exact is
    /// [`Error::InvalidMessage`]; a point that doesn't decode is its own
    /// error, as everywhere.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        let mut reader = Reader::new(bytes);
        let len = usize::from(reader.byte()?);
        if len == 0 || len > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        let name = reader.take(len)?;
        let generator = decode_point(&reader.array()?)?;
        let public_value = decode_point(&reader.array()?)?;
        let mut scalar = || -> Result<Scalar, Error> {
            Option::from(Scalar::from_bytes_be(&reader.array()?)).ok_or(Error::InvalidMessage)
        };
        let proof = RevealProof {
            c1: scalar()?,
            c2: scalar()?,
            z1: scalar()?,
            z2: scalar()?,
        };
        if !reader.is_done() {
            return Err(Error::InvalidMessage);
        }
        Ok(Self {
            seedelf: Handle::new(name, Register::from_checked(generator, public_value))?,
            proof,
        })
    }
}

impl Conversation {
    /// Shows the other side which Seedelf this side holds (docs/protocol.md
    /// §19): a proof, bound to this conversation, that `seedelf`'s register
    /// and this side's identity share a key, which only the other side can
    /// check. The wallet sends its bytes as a message of their own kind (§18).
    ///
    /// Only the side that wrote first, and only once a reply has decrypted:
    /// before it, messages are first-contact messages, which a later theft
    /// of the reader's key reads ([`Error::RevealNotAllowed`]). `seedelf` is
    /// the Seedelf's name and its datum's register as the chain gives it
    /// now, and must be `key`'s, as `key` must be this side's
    /// ([`Error::NotForThisKey`]).
    pub fn reveal(&self, key: &SecretKey, seedelf: &Handle) -> Result<Reveal, Error> {
        self.reveal_with(key, seedelf, &mut OsDraw)
    }

    pub(crate) fn reveal_with(
        &self,
        key: &SecretKey,
        seedelf: &Handle,
        draw: &mut dyn Draw,
    ) -> Result<Reveal, Error> {
        if self.role != Role::Initiator || self.sends_first_contact() {
            return Err(Error::RevealNotAllowed);
        }
        let x = key.scalar();
        if (G1Projective::from(self.first.base) * x).to_affine() != self.first.initiator
            || !matches_register(key, seedelf.register())
        {
            return Err(Error::NotForThisKey);
        }
        let (proof, _) = Statement::of(self, seedelf).prove_seedelf(&x, draw);
        Ok(Reveal {
            seedelf: seedelf.clone(),
            proof,
        })
    }

    /// Checks a reveal the other side sent (docs/protocol.md §19): whether
    /// whoever controls this conversation's other identity holds the key of
    /// the register it names.
    ///
    /// Only the side written to checks one ([`Error::RevealNotAllowed`]): at
    /// the side that wrote first, a reveal proves nothing, since the other
    /// side's key, w₀'s, makes one for any Seedelf. A proof that doesn't verify for
    /// this conversation is [`Error::InvalidReveal`]. A reveal that verifies
    /// says only that the other side holds that register's key; the wallet
    /// then checks the register is the one the chain gives the name now.
    pub fn verify_reveal(&self, reveal: &Reveal) -> Result<(), Error> {
        if self.role != Role::Responder {
            return Err(Error::RevealNotAllowed);
        }
        if !Statement::of(self, &reveal.seedelf).verifies(&reveal.proof) {
            return Err(Error::InvalidReveal);
        }
        Ok(())
    }
}
