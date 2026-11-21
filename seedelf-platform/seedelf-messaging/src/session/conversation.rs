//! A conversation's state, and every operation on it (docs/protocol.md §3,
//! §4 and §12).

use std::fmt;

use blstrs::{G1Affine, G1Projective};
use group::Curve;
use zeroize::Zeroizing;

use crate::envelope::seal;
use crate::keys::scalar_from_bytes;
use crate::register::{POINT_LEN, Register, decode_point, matches_register, rerandomize_with};
use crate::session::draw::{Draw, OsDraw};
use crate::session::first_contact::{
    CID_LEN, ConversationId, FirstContact, MAX_TO_LEN, Reader, session_key,
};
use crate::session::ratchet::{
    KeyPair, MAX_STORED_SKIPPED, RATCHET_HEADER_LEN, RATCHET_OVERHEAD, Ratchet, Skipped, encrypt,
};
use crate::session::secret::Secret32;
use crate::session::wire::{
    FIRST_CONTACT_TYPE, MAX_ENVELOPE_LEN, Opened, SESSION_OVERHEAD, SESSION_TYPE, envelope_size,
    inner_capacity, pad,
};
use crate::{Error, SecretKey};

/// Each message's text or refusal, in order.
pub(crate) type Texts = Vec<Result<Vec<u8>, Error>>;

/// The conversation state's serialization format.
pub const STATE_VERSION: u8 = 1;

/// Which side of a conversation this state is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Wrote first: made both identities and F ("Alice").
    Initiator,
    /// Was written to, and replied ("Bob").
    Responder,
}

/// One side of a one-to-one conversation: its identities, F, and its Double
/// Ratchet.
///
/// Every operation that can fail leaves the state as it was: it works on a
/// copy and keeps it only on success (docs/protocol.md §4.2). The secrets
/// in it are wiped when it drops; its `Debug` shows none of them.
#[derive(Clone)]
pub struct Conversation {
    pub(crate) role: Role,
    pub(crate) first: FirstContact,
    pub(crate) first_bytes: Vec<u8>,
    /// w₀ = [x_B]p₀, the responder's public value.
    pub(crate) responder: G1Affine,
    pub(crate) ratchet: Ratchet,
}

impl Conversation {
    /// Starts a conversation with the owner of `handle`, a Seedelf's register
    /// (docs/protocol.md §3): makes both identities, F, SK and the sending
    /// chain. `to` is the handle's asset name, or empty; `now` becomes `t`.
    ///
    /// Refuses a handle of `key`'s own: both identities would be one.
    pub fn start(key: &SecretKey, handle: &Register, to: &[u8], now: u64) -> Result<Self, Error> {
        Self::start_with(key, handle, to, now, &mut OsDraw)
    }

    pub(crate) fn start_with(
        key: &SecretKey,
        handle: &Register,
        to: &[u8],
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        if to.len() > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        if matches_register(key, handle) {
            return Err(Error::OwnRegister);
        }
        let rb = rerandomize_with(handle, &draw.scalar());
        let base = rb.generator().to_affine();
        let responder = rb.public_value().to_affine();
        Self::begin(key, base, responder, to, None, now, draw)
    }

    /// Starts a new conversation that continues `old`, with its identities
    /// (docs/protocol.md §6): the same base, the other side's public value as
    /// the responder, and `replaces` naming `old`. Either side can.
    pub fn start_continuing(
        key: &SecretKey,
        old: &Conversation,
        to: &[u8],
        now: u64,
    ) -> Result<Self, Error> {
        Self::continue_with(key, old, to, now, &mut OsDraw)
    }

    pub(crate) fn continue_with(
        key: &SecretKey,
        old: &Conversation,
        to: &[u8],
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        if to.len() > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        let (mine, theirs) = match old.role {
            Role::Initiator => (old.first.initiator, old.responder),
            Role::Responder => (old.responder, old.first.initiator),
        };
        if (G1Projective::from(old.first.base) * key.scalar()).to_affine() != mine {
            return Err(Error::NotForThisKey);
        }
        Self::begin(key, old.first.base, theirs, to, Some(old.cid()), now, draw)
    }

    /// The initiator's side of §3, from the base and the responder's value.
    /// Draws `cid`, `e_A`, then `s_A`.
    pub(crate) fn begin(
        key: &SecretKey,
        base: G1Affine,
        responder: G1Affine,
        to: &[u8],
        replaces: Option<ConversationId>,
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        let cid = ConversationId(draw.bytes16());
        let e = draw.scalar();
        let s = KeyPair::generate(&base, draw);
        let x = key.scalar();
        let p0 = G1Projective::from(base);
        let first = FirstContact {
            cid,
            started_at: now,
            to: to.to_vec(),
            replaces,
            base,
            initiator: (p0 * x).to_affine(),
            ephemeral: (p0 * e).to_affine(),
        };
        let first_bytes = first.to_bytes();
        let w0 = G1Projective::from(responder);
        let ephemeral_dh = Zeroizing::new((w0 * e).to_compressed());
        let static_dh = Zeroizing::new((w0 * x).to_compressed());
        let sk = session_key(&ephemeral_dh, &static_dh, &first_bytes);
        Ok(Self {
            role: Role::Initiator,
            first,
            first_bytes,
            responder,
            ratchet: Ratchet::init_alice(&sk, s, responder),
        })
    }

    /// The responder's side of §3: SK from F and `key`, `RatchetInitBob`, then
    /// each message in order, each with the time it arrived. The state is
    /// kept if any message authenticates; each message's result is returned.
    ///
    /// The scratch state holds `x` as its first ratchet key only until the
    /// first message's ratchet step replaces it, so a returned conversation
    /// never holds `x`.
    pub(crate) fn accept_with(
        key: &SecretKey,
        messages: &[(&Opened, u64)],
        draw: &mut dyn Draw,
    ) -> Result<(Self, Texts), Error> {
        let (first, first_bytes) = messages
            .first()
            .and_then(|(opened, _)| opened.first.clone())
            .ok_or(Error::UnexpectedMessage)?;
        let x = key.scalar();
        let w0 = (G1Projective::from(first.base) * x).to_affine();
        let ephemeral_dh =
            Zeroizing::new((G1Projective::from(first.ephemeral) * x).to_compressed());
        let static_dh = Zeroizing::new((G1Projective::from(first.initiator) * x).to_compressed());
        let sk = session_key(&ephemeral_dh, &static_dh, &first_bytes);
        let mine = KeyPair {
            secret: Secret32::from_bytes(x.to_bytes_be()),
            public: w0,
        };
        let mut conversation = Self {
            role: Role::Responder,
            first,
            first_bytes,
            responder: w0,
            ratchet: Ratchet::init_bob(sk, mine),
        };
        let results: Vec<_> = messages
            .iter()
            .map(|(opened, at)| conversation.receive_with(opened, *at, draw))
            .collect();
        if conversation.ratchet.cks.is_none() {
            return Err(Error::DecryptionFailed);
        }
        Ok((conversation, results))
    }

    /// Encrypts `plaintext` as the next message and seals it in an envelope
    /// to a fresh re-randomization of the other side's identity: a `0x01`
    /// until the initiator has received a reply, then `0x02`.
    ///
    /// The caller stores the new state and the envelope together before
    /// posting it (docs/protocol.md §4.2). On an error the state is as it
    /// was.
    pub fn send(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, Error> {
        self.send_with(plaintext, &mut OsDraw)
    }

    /// Draws the ratchet's salt, then the envelope's `b` and `r`.
    pub(crate) fn send_with(
        &mut self,
        plaintext: &[u8],
        draw: &mut dyn Draw,
    ) -> Result<Vec<u8>, Error> {
        let size = envelope_size(self.inner_overhead() + plaintext.len())?;
        let mut ratchet = self.ratchet.clone();
        let (header, mk) = ratchet.next_sending()?;
        let salt = draw.bytes16();
        let mut ad = self.ad_prefix();
        ad.extend_from_slice(&header.to_bytes());
        let ciphertext = encrypt(&mk, &salt, plaintext, &ad)?;
        let mut inner = Vec::with_capacity(self.inner_overhead() + plaintext.len());
        if self.sends_first_contact() {
            inner.push(FIRST_CONTACT_TYPE);
            inner.extend_from_slice(&self.first_bytes);
        } else {
            inner.push(SESSION_TYPE);
            inner.extend_from_slice(&self.cid().0);
        }
        inner.extend_from_slice(&header.to_bytes());
        inner.extend_from_slice(&ciphertext);
        let padded = pad(&inner, size);
        let (b, r) = (draw.scalar(), draw.scalar());
        let envelope = seal(&self.their_register(), &b, &r, &padded)?.to_bytes();
        self.ratchet = ratchet;
        Ok(envelope)
    }

    /// Decrypts an opened message of this conversation at `now`, by the
    /// reader's clock.
    ///
    /// A first-contact message counts only if it carries the stored F, and
    /// only at the responder. The ratchet runs on a copy, kept only if the
    /// message authenticates; no message makes it skip more than `MAX_SKIP`
    /// keys. On an error the state is as it was.
    pub fn receive(&mut self, opened: &Opened, now: u64) -> Result<Vec<u8>, Error> {
        self.receive_with(opened, now, &mut OsDraw)
    }

    pub(crate) fn receive_with(
        &mut self,
        opened: &Opened,
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Vec<u8>, Error> {
        if opened.cid != self.cid() {
            return Err(Error::UnknownConversation);
        }
        if let Some((_, bytes)) = &opened.first {
            if self.role == Role::Initiator {
                return Err(Error::UnexpectedMessage);
            }
            if *bytes != self.first_bytes {
                return Err(Error::DifferentFirstContact);
            }
        }
        let mut ratchet = self.ratchet.clone();
        let plaintext = ratchet.decrypt(
            &self.first.base,
            &opened.header,
            &opened.ciphertext,
            &self.ad_prefix(),
            now,
            draw,
        )?;
        self.ratchet = ratchet;
        Ok(plaintext)
    }

    /// Deletes skipped keys whose 48 hours have passed; their messages count
    /// as missing.
    pub fn expire(&mut self, now: u64) {
        self.ratchet.expire(now);
    }

    /// The conversation ID.
    pub fn cid(&self) -> ConversationId {
        self.first.cid
    }

    /// Which side this is.
    pub fn role(&self) -> Role {
        self.role
    }

    /// F.
    pub fn first_contact(&self) -> &FirstContact {
        &self.first
    }

    /// Whether the next message is a first-contact message: the initiator,
    /// until a reply from the other side has decrypted.
    pub fn sends_first_contact(&self) -> bool {
        self.role == Role::Initiator && self.ratchet.ckr.is_none()
    }

    /// Messages missing so far: skipped keys still waiting for their message,
    /// and skipped keys deleted before it came. Never "expired": the reader
    /// can't tell why one is missing (docs/protocol.md §6).
    pub fn missing(&self) -> u64 {
        self.ratchet.skipped.len() as u64 + self.ratchet.lost
    }

    /// Messages sent in the current sending chain.
    pub fn sent_in_chain(&self) -> u32 {
        self.ratchet.ns
    }

    /// R_A = (p₀, A), the initiator's conversation identity.
    pub fn initiator_register(&self) -> Register {
        Register::from_checked(self.first.base, self.first.initiator)
    }

    /// R_B = (p₀, w₀), the responder's conversation identity.
    pub fn responder_register(&self) -> Register {
        Register::from_checked(self.first.base, self.responder)
    }

    /// The longest text the next message can carry.
    pub fn max_text_len(&self) -> usize {
        inner_capacity(MAX_ENVELOPE_LEN) - self.inner_overhead()
    }

    /// The other side's identity, which this side's messages go to.
    fn their_register(&self) -> Register {
        match self.role {
            Role::Initiator => self.responder_register(),
            Role::Responder => self.initiator_register(),
        }
    }

    /// `cid ‖ R_A ‖ R_B`: the associated data before the ratchet header.
    pub(crate) fn ad_prefix(&self) -> Vec<u8> {
        let mut ad = Vec::with_capacity(CID_LEN + 4 * POINT_LEN + RATCHET_HEADER_LEN);
        ad.extend_from_slice(&self.cid().0);
        ad.extend_from_slice(&self.initiator_register().to_bytes());
        ad.extend_from_slice(&self.responder_register().to_bytes());
        ad
    }

    fn inner_overhead(&self) -> usize {
        if self.sends_first_contact() {
            1 + self.first_bytes.len() + RATCHET_HEADER_LEN + RATCHET_OVERHEAD
        } else {
            SESSION_OVERHEAD
        }
    }

    /// The state's bytes, for the wallet's sealed records (docs/protocol.md
    /// §16.5 has the layout). They hold the conversation's secrets.
    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        let r = &self.ratchet;
        let mut out = Zeroizing::new(Vec::with_capacity(
            512 + r.skipped.len() * (POINT_LEN + 4 + 32 + 8),
        ));
        out.push(STATE_VERSION);
        out.push(match self.role {
            Role::Initiator => 0,
            Role::Responder => 1,
        });
        // F is at most 218 bytes.
        out.extend_from_slice(&(self.first_bytes.len() as u16).to_be_bytes());
        out.extend_from_slice(&self.first_bytes);
        out.extend_from_slice(&self.responder.to_compressed());
        out.extend_from_slice(r.rk.bytes());
        let flags = u8::from(r.cks.is_some())
            | u8::from(r.ckr.is_some()) << 1
            | u8::from(r.dhr.is_some()) << 2;
        out.push(flags);
        if let Some(cks) = &r.cks {
            out.extend_from_slice(cks.bytes());
        }
        if let Some(ckr) = &r.ckr {
            out.extend_from_slice(ckr.bytes());
        }
        out.extend_from_slice(r.dhs.secret.bytes());
        out.extend_from_slice(&r.dhs.public.to_compressed());
        if let Some(dhr) = &r.dhr {
            out.extend_from_slice(&dhr.to_compressed());
        }
        out.extend_from_slice(&r.ns.to_be_bytes());
        out.extend_from_slice(&r.nr.to_be_bytes());
        out.extend_from_slice(&r.pn.to_be_bytes());
        out.extend_from_slice(&r.lost.to_be_bytes());
        // At most MAX_STORED_SKIPPED, which fits a u16.
        out.extend_from_slice(&(r.skipped.len() as u16).to_be_bytes());
        for key in &r.skipped {
            out.extend_from_slice(&key.dh.to_compressed());
            out.extend_from_slice(&key.n.to_be_bytes());
            out.extend_from_slice(key.mk.bytes());
            out.extend_from_slice(&key.stored_at.to_be_bytes());
        }
        out
    }

    /// A state from its bytes. Every point, scalar, count and invariant is
    /// checked; anything else is [`Error::InvalidState`].
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        match bytes.first() {
            Some(&STATE_VERSION) => {}
            Some(&version) => return Err(Error::UnsupportedStateVersion(version)),
            None => return Err(Error::InvalidState),
        }
        Self::parse_v1(&bytes[1..]).map_err(|_| Error::InvalidState)
    }

    fn parse_v1(bytes: &[u8]) -> Result<Self, Error> {
        let mut reader = Reader::new(bytes);
        let role = match reader.byte()? {
            0 => Role::Initiator,
            1 => Role::Responder,
            _ => return Err(Error::InvalidState),
        };
        let first_len = usize::from(u16::from_be_bytes(reader.array()?));
        let first_bytes = reader.take(first_len)?.to_vec();
        let first = FirstContact::from_bytes(&first_bytes)?;
        let responder = decode_point(&reader.array()?)?;
        let rk = Secret32::from_bytes(reader.array()?);
        let flags = reader.byte()?;
        if flags & !0b111 != 0 {
            return Err(Error::InvalidState);
        }
        let cks = (flags & 1 != 0)
            .then(|| reader.array().map(Secret32::from_bytes))
            .transpose()?;
        let ckr = (flags & 2 != 0)
            .then(|| reader.array().map(Secret32::from_bytes))
            .transpose()?;
        let secret = Secret32::from_bytes(reader.array()?);
        let scalar = scalar_from_bytes(secret.bytes())?;
        let public = decode_point(&reader.array()?)?;
        if (G1Projective::from(first.base) * scalar).to_affine() != public {
            return Err(Error::InvalidState);
        }
        let dhr = (flags & 4 != 0)
            .then(|| {
                reader
                    .array()
                    .map_err(|_| Error::InvalidState)
                    .and_then(|p| decode_point(&p))
            })
            .transpose()?;
        let ns = u32::from_be_bytes(reader.array()?);
        let nr = u32::from_be_bytes(reader.array()?);
        let pn = u32::from_be_bytes(reader.array()?);
        let lost = u64::from_be_bytes(reader.array()?);
        let count = usize::from(u16::from_be_bytes(reader.array()?));
        if count > MAX_STORED_SKIPPED {
            return Err(Error::InvalidState);
        }
        let mut skipped = Vec::with_capacity(count);
        for _ in 0..count {
            skipped.push(Skipped {
                dh: decode_point(&reader.array()?)?,
                n: u32::from_be_bytes(reader.array()?),
                mk: Secret32::from_bytes(reader.array()?),
                stored_at: u64::from_be_bytes(reader.array()?),
            });
        }
        if !reader.is_done() {
            return Err(Error::InvalidState);
        }
        // Every reachable state has a sending chain and a DHr. A responder has
        // a receiving chain too; an initiator without one is still on w₀.
        let consistent = cks.is_some()
            && dhr.is_some()
            && match role {
                Role::Responder => ckr.is_some(),
                Role::Initiator => ckr.is_some() || (dhr == Some(responder) && pn == 0),
            };
        if !consistent {
            return Err(Error::InvalidState);
        }
        Ok(Self {
            role,
            first,
            first_bytes,
            responder,
            ratchet: Ratchet {
                rk,
                cks,
                ckr,
                dhs: KeyPair { secret, public },
                dhr,
                ns,
                nr,
                pn,
                skipped,
                lost,
            },
        })
    }
}

impl fmt::Debug for Conversation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Conversation")
            .field("cid", &self.cid())
            .field("role", &self.role)
            .field("ns", &self.ratchet.ns)
            .field("nr", &self.ratchet.nr)
            .field("missing", &self.missing())
            .finish_non_exhaustive()
    }
}
