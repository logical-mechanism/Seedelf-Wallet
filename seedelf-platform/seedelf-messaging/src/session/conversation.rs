//! A conversation's state, and every operation on it (docs/protocol.md §3,
//! §4 and §12).

use std::fmt;

use blstrs::{G1Affine, G1Projective};
use group::Curve;
use zeroize::Zeroizing;

use crate::envelope::seal;
use crate::keys::scalar_from_bytes;
use crate::register::{POINT_LEN, Register, decode_point, matches_register, rerandomize_with};
use crate::relay::stamp_bits;
use crate::session::draw::{Draw, OsDraw};
use crate::session::first_contact::{
    CID_LEN, ConversationId, FirstContact, KeysStatement, MAX_TO_LEN, Reader, STAMP_LEN,
    base_scalar, head_bytes, prove_base, session_key,
};
use crate::session::inbox::{MAX_ONE_REQUEST_BYTES, MAX_REQUEST_MESSAGES};
use crate::session::ratchet::{
    KeyPair, RATCHET_HEADER_LEN, RATCHET_OVERHEAD, RATCHET_SALT_LEN, Ratchet, encrypt,
    envelope_ephemeral_scalar, outer_scalar, read_skipped, skipped_len, write_skipped,
};
use crate::session::secret::Secret32;
use crate::session::wire::{
    FIRST_CONTACT_TYPE, MAX_ENVELOPE_LEN, Opened, Outer, SESSION_OVERHEAD, SESSION_TYPE,
    envelope_size, inner_capacity, pad,
};
use crate::{Error, SecretKey};

/// Each message's text or refusal, in order.
pub(crate) type Texts = Vec<Result<Vec<u8>, Error>>;

/// The conversation state's serialization format: 2 (docs/protocol.md
/// §16.5). A state of version 1, a development build's, is refused at its
/// first byte.
pub const STATE_VERSION: u8 = 2;

/// The flags bit of the initiator's count of first-contact bytes sent.
const SENT_BEFORE_A_REPLY: u8 = 1 << 4;

/// Which side of a conversation this state is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Wrote first: made both identities and F ("Alice").
    Initiator,
    /// Was written to, and replied ("Bob").
    Responder,
}

/// Where a start's base comes from ([`Conversation::begin`]).
pub(crate) enum Origin<'a> {
    /// A handle: the base re-randomizes it by `b`, derived from the writer's
    /// key (§16.2), and F proves it.
    Handle(&'a Register),
    /// A base and the responder's value on it, given, with no proof: a
    /// continuation's, or a test's.
    Base { base: G1Affine, responder: G1Affine },
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
    /// The initiator's first-contact stamp, once solved.
    pub(crate) stamp: Option<u64>,
    /// The initiator's first-contact bytes sealed so far, their inner
    /// messages unpadded, as the reader counts them against the request's
    /// share: there exactly while it sends first-contact messages, until a
    /// reply decrypts.
    pub(crate) first_contact_sent: Option<u32>,
}

impl Conversation {
    /// Starts a conversation with the owner of `handle`, a Seedelf's register
    /// (docs/protocol.md §3): makes both identities, F with its proof that
    /// the base re-randomizes `handle`, SK and the sending chain. `to` is the
    /// handle's asset name, 1 to 32 bytes; `now` becomes `t`.
    ///
    /// Nothing can be sent until the first-contact stamp is set
    /// ([`Conversation::stamp_digest`], [`Conversation::set_stamp`]).
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
        if to.is_empty() || to.len() > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        if matches_register(key, handle) {
            return Err(Error::OwnRegister);
        }
        Self::begin(key, Origin::Handle(handle), to, None, now, draw)
    }

    /// Starts a new conversation that continues `old`, with its identities
    /// (docs/protocol.md §6): the same base, the other side's public value as
    /// the responder, `replaces` naming `old`, and no `to`. Either side can.
    /// Its stamp is set as a start's is.
    pub fn start_continuing(key: &SecretKey, old: &Conversation, now: u64) -> Result<Self, Error> {
        Self::continue_with(key, old, now, &mut OsDraw)
    }

    pub(crate) fn continue_with(
        key: &SecretKey,
        old: &Conversation,
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        let (mine, theirs) = match old.role {
            Role::Initiator => (old.first.initiator, old.responder),
            Role::Responder => (old.responder, old.first.initiator),
        };
        if (G1Projective::from(old.first.base) * key.scalar()).to_affine() != mine {
            return Err(Error::NotForThisKey);
        }
        let origin = Origin::Base {
            base: old.first.base,
            responder: theirs,
        };
        Self::begin(key, origin, b"", Some(old.cid()), now, draw)
    }

    /// The initiator's side of §3. Draws `cid`; from a handle, derives `b`
    /// from `key`, the handle, F's head and drawn bytes (§16.2), and the
    /// base and the responder's value from `b`; then draws `e_A` and `s_A`;
    /// then, from a handle, proves the base with a nonce derived from `b`;
    /// then proves the keys of `E_A`, `S_A` and, from a handle only, `A`
    /// (docs/joint-security.md, use 10), with nonces derived from them.
    pub(crate) fn begin(
        key: &SecretKey,
        origin: Origin<'_>,
        to: &[u8],
        replaces: Option<ConversationId>,
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Self, Error> {
        let cid = ConversationId(draw.bytes16());
        let x = key.scalar();
        let (base, responder, from_handle) = match origin {
            Origin::Handle(handle) => {
                let b = base_scalar(&x, handle, &head_bytes(&cid, now, to, replaces), draw);
                let rb = rerandomize_with(handle, &b);
                (
                    rb.generator().to_affine(),
                    rb.public_value().to_affine(),
                    Some((handle, b)),
                )
            }
            Origin::Base { base, responder } => (base, responder, None),
        };
        let e = draw.scalar();
        let p0 = G1Projective::from(base);
        let s_scalar = draw.scalar();
        let s = KeyPair {
            secret: Secret32::from_bytes(s_scalar.to_bytes_be()),
            public: (p0 * s_scalar).to_affine(),
        };
        let mut first = FirstContact {
            cid,
            started_at: now,
            to: to.to_vec(),
            replaces,
            base,
            initiator: (p0 * x).to_affine(),
            ephemeral: (p0 * e).to_affine(),
            proof: None,
            keys_proof: None,
        };
        // The keys proof covers F″, so the base proof comes first. Only a
        // start from a handle proves A's key (docs/joint-security.md, use
        // 10): a continuation's A and w₀ are values both sides already hold.
        first.keys_proof = Some(match from_handle {
            Some((handle, b)) => {
                first.proof = Some(prove_base(handle, &b, &first.prefix_bytes(), draw));
                KeysStatement::of(&first, &responder, &s.public)
                    .prove_handle(&x, &e, &s_scalar, draw)?
            }
            None => KeysStatement::of(&first, &responder, &s.public)
                .prove_continuation(&e, &s_scalar, draw),
        });
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
            stamp: None,
            first_contact_sent: Some(0),
        })
    }

    /// What the first-contact stamp's work is over: F's digest
    /// ([`FirstContact::stamp_digest`]). The wallet finds a nonce with
    /// [`find_stamp`](crate::relay::find_stamp) at
    /// [`FIRST_CONTACT_STAMP_BITS`](crate::session::FIRST_CONTACT_STAMP_BITS),
    /// in slices, then sets it.
    pub fn stamp_digest(&self) -> [u8; 32] {
        self.first.stamp_digest()
    }

    /// Sets the first-contact stamp every first-contact message carries.
    /// Only the initiator sends them. The reader judges its work; this
    /// doesn't.
    pub fn set_stamp(&mut self, nonce: u64) -> Result<(), Error> {
        if self.role != Role::Initiator {
            return Err(Error::UnexpectedMessage);
        }
        self.stamp = Some(nonce);
        Ok(())
    }

    /// The stamp set, if any, and the work it shows.
    pub fn stamp(&self) -> Option<(u64, u32)> {
        self.stamp
            .map(|nonce| (nonce, stamp_bits(&self.stamp_digest(), nonce)))
    }

    /// The responder's side of §3: the keys proof, then SK from F and `key`,
    /// `RatchetInitBob`, then each message in order, each with the time it
    /// arrived. The state is kept if any message authenticates; each
    /// message's result is returned. If none does, the first one's refusal
    /// is.
    ///
    /// Every path that builds a responder's state comes here: a new cid's
    /// first message, a join's replay, [`Request::read`](crate::session::Request::read)
    /// and [`Inbox::accept`](crate::session::Inbox::accept). So before `x`
    /// meets any point of F's but `p₀`, which the base proof or a held base
    /// bound before this was called, every message must carry the first's
    /// header key `S_A`, and the keys proof must show the writer knows the
    /// keys of `E_A`, `S_A` and, from a handle, `A` (else
    /// [`Error::InvalidKeysProof`]). Then `[x]E_A`, `[x]A`, and in the first
    /// ratchet step `[x]S_A`, are each a value the writer could compute
    /// (docs/joint-security.md, rule 1).
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
        // While no message has authenticated, the scratch state's ratchet
        // key is x, and a message on a new header key would meet it there.
        let header_key = messages[0].0.header.dh;
        if messages
            .iter()
            .any(|(opened, _)| opened.header.dh != header_key)
        {
            return Err(Error::InvalidKeysProof);
        }
        let x = key.scalar();
        let w0 = (G1Projective::from(first.base) * x).to_affine();
        if !first.proves_keys(&w0, &header_key) {
            return Err(Error::InvalidKeysProof);
        }
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
            stamp: None,
            first_contact_sent: None,
        };
        let results: Vec<_> = messages
            .iter()
            .map(|(opened, at)| conversation.receive_with(opened, *at, draw))
            .collect();
        // None authenticated: the first message's own refusal.
        if conversation.ratchet.cks.is_none() {
            return Err(results
                .into_iter()
                .find_map(Result::err)
                .unwrap_or(Error::DecryptionFailed));
        }
        Ok((conversation, results))
    }

    /// Encrypts `plaintext` as the next message and seals it in an envelope
    /// to the other side's identity re-randomized by the message's outer
    /// scalar: a `0x01` until the initiator has received a reply, then
    /// `0x02`. A `0x01` needs the stamp set first ([`Error::Unstamped`]),
    /// and room in the request's share, 16 messages and 64 KiB of their
    /// inner messages before a reply ([`Error::RequestFull`], before the
    /// chain moves; [`Conversation::first_contact_left`] says what's left).
    ///
    /// The caller stores the new state and the envelope together before
    /// posting it (docs/protocol.md §4.2). On an error the state is as it
    /// was.
    pub fn send(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, Error> {
        self.send_with(plaintext, &mut OsDraw)
    }

    /// Draws the ratchet's salt, and nothing else: the envelope's
    /// re-randomization, the outer scalar `o`, and its ephemeral scalar `r`
    /// both come from the message key and the salt (docs/protocol.md §16.2).
    pub(crate) fn send_with(
        &mut self,
        plaintext: &[u8],
        draw: &mut dyn Draw,
    ) -> Result<Vec<u8>, Error> {
        let stamp = match (self.sends_first_contact(), self.stamp) {
            (true, None) => return Err(Error::Unstamped),
            (true, stamp) => stamp,
            (false, _) => None,
        };
        let inner_len = self.inner_overhead() + plaintext.len();
        // The request's share, before the chain moves: a message past it is
        // one the reader would refuse to join.
        if stamp.is_some() && !self.share_takes(inner_len) {
            return Err(Error::RequestFull);
        }
        let size = envelope_size(inner_len)?;
        let mut ratchet = self.ratchet.clone();
        let (header, mk) = ratchet.next_sending()?;
        let salt = draw.bytes16();
        let mut ad = self.ad_prefix();
        ad.extend_from_slice(&header.to_bytes());
        let ciphertext = encrypt(&mk, &salt, plaintext, &ad)?;
        let mut inner = Vec::with_capacity(self.inner_overhead() + plaintext.len());
        if let Some(stamp) = stamp {
            inner.push(FIRST_CONTACT_TYPE);
            inner.extend_from_slice(&self.first_bytes);
            inner.extend_from_slice(&stamp.to_be_bytes());
        } else {
            inner.push(SESSION_TYPE);
            inner.extend_from_slice(&self.cid().0);
        }
        inner.extend_from_slice(&header.to_bytes());
        inner.extend_from_slice(&ciphertext);
        let padded = pad(&inner, size);
        let o = outer_scalar(&mk, &salt);
        let r = envelope_ephemeral_scalar(&mk, &salt);
        // Each with probability about 2⁻²⁵⁵: the state is unchanged, and a
        // retry draws a new salt.
        if bool::from(ff::Field::is_zero(&o)) || bool::from(ff::Field::is_zero(&r)) {
            return Err(Error::InvalidScalar);
        }
        let envelope = seal(&self.their_register(), &o, &r, &padded)?.to_bytes();
        self.ratchet = ratchet;
        if stamp.is_some() {
            // Within the share's 64 KiB, so within a u32.
            let sent = self.first_contact_sent.unwrap_or(0) as usize + inner_len;
            self.first_contact_sent = Some(sent as u32);
        }
        Ok(envelope)
    }

    /// Whether the request's share takes one more first-contact message of
    /// `inner_len` bytes: fewer than 16 sent, and its bytes within 64 KiB.
    fn share_takes(&self, inner_len: usize) -> bool {
        let sent = self.first_contact_sent.unwrap_or(0) as usize;
        self.ratchet.ns < MAX_REQUEST_MESSAGES as u32 && sent + inner_len <= MAX_ONE_REQUEST_BYTES
    }

    /// Decrypts an opened message of this conversation at `now`, by the
    /// reader's clock.
    ///
    /// A first-contact message counts only if it carries the stored F, and
    /// only at the responder. The ratchet runs on a copy, kept only if the
    /// message authenticates and its envelope was addressed to this side's
    /// identity re-randomized by the message's outer scalar, with the
    /// ephemeral point the message key gives; `opened` must come from
    /// [`open`](crate::session::open). No message makes the ratchet skip more
    /// than `MAX_SKIP` keys: past that, a session message is
    /// [`Error::TooFarAhead`] only if it authenticates and its envelope
    /// checks, and anything else is [`Error::DecryptionFailed`]. On an error
    /// the state is as it was.
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
        if opened.outer == Outer::Unknown {
            return Err(Error::WrongEnvelopeRegister);
        }
        let mut ratchet = self.ratchet.clone();
        let decrypted = ratchet.decrypt(
            &self.first.base,
            &opened.header,
            &opened.ciphertext,
            &self.ad_prefix(),
            now,
            draw,
        );
        let (plaintext, mk) = match decrypted {
            Err(Error::TooFarAhead) => return Err(self.too_far_ahead(opened)),
            decrypted => decrypted?,
        };
        self.check_envelope(opened, &mk)?;
        self.ratchet = ratchet;
        // A reply has decrypted: the request's share is behind the initiator.
        if self.ratchet.ckr.is_some() {
            self.first_contact_sent = None;
        }
        Ok(plaintext)
    }

    /// What a message the ratchet found too far ahead amounts to
    /// (docs/protocol.md §16.4): [`Error::TooFarAhead`] only for a session
    /// message of a held conversation that authenticates, read-only, and
    /// whose envelope's p and c check, else the refusal it met, silent as a
    /// forgery's. A first-contact message is never authenticated past the
    /// bound, nor anything at a request's scratch state, which has no
    /// sending chain and whose ratchet key is the reader's long-term key.
    fn too_far_ahead(&self, opened: &Opened) -> Error {
        if opened.first.is_some() || self.ratchet.cks.is_none() {
            return Error::DecryptionFailed;
        }
        let authentic = self
            .ratchet
            .authenticate_far(&opened.header, &opened.ciphertext, &self.ad_prefix())
            .and_then(|mk| self.check_envelope(opened, &mk));
        match authentic {
            Ok(()) => Error::TooFarAhead,
            Err(refusal) => refusal,
        }
    }

    /// The envelope's check, once its message has decrypted under `mk`
    /// (docs/protocol.md §16.4): the envelope went to this side's identity
    /// re-randomized by the message's outer scalar o, so its generator is
    /// p = [o]p₀, and its ephemeral point is [r]p for the message's envelope
    /// scalar r. Both come from `mk` and the message's salt, so a writer can
    /// put neither p nor c on another register, and the scan already showed
    /// the envelope's tag is this key's on p. [`Error::WrongEnvelopeRegister`]
    /// otherwise, and for a message that came without its envelope. A
    /// request's stored messages were checked when they came.
    pub(crate) fn check_envelope(&self, opened: &Opened, mk: &Secret32) -> Result<(), Error> {
        let (generator, ephemeral) = match opened.outer {
            Outer::Envelope {
                generator,
                ephemeral,
            } => (generator, ephemeral),
            Outer::Checked => return Ok(()),
            Outer::Unknown => return Err(Error::WrongEnvelopeRegister),
        };
        let salt: &[u8; RATCHET_SALT_LEN] = opened.ciphertext[..RATCHET_SALT_LEN]
            .try_into()
            .expect("a parsed ciphertext holds its salt");
        let p = G1Projective::from(self.first.base) * outer_scalar(mk, salt);
        if p.to_affine() != generator
            || (p * envelope_ephemeral_scalar(mk, salt)).to_affine() != ephemeral
        {
            return Err(Error::WrongEnvelopeRegister);
        }
        Ok(())
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

    /// The longest text the next message can carry: the largest envelope's
    /// room, and before a reply the request's share's too, 0 once it's used
    /// up.
    pub fn max_text_len(&self) -> usize {
        let room = inner_capacity(MAX_ENVELOPE_LEN) - self.inner_overhead();
        match self.first_contact_left() {
            Some((0, _)) => 0,
            Some((_, bytes)) => room.min(bytes.saturating_sub(self.inner_overhead())),
            None => room,
        }
    }

    /// What's left of the request's share while this side sends
    /// first-contact messages (the initiator, until a reply decrypts): how
    /// many more it may send, of 16, and how many bytes of their inner
    /// messages, of 64 KiB (docs/protocol.md §3.1). Each message takes its
    /// inner message's length, unpadded: its text and F's length and 97
    /// more ([`FirstContact::len`]), as the reader counts it. `None` once a
    /// reply has decrypted: then only the envelope bounds a message.
    pub fn first_contact_left(&self) -> Option<(u32, usize)> {
        if !self.sends_first_contact() {
            return None;
        }
        let sent = self.first_contact_sent.unwrap_or(0) as usize;
        Some((
            (MAX_REQUEST_MESSAGES as u32).saturating_sub(self.ratchet.ns),
            MAX_ONE_REQUEST_BYTES.saturating_sub(sent),
        ))
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
            1 + self.first_bytes.len() + STAMP_LEN + RATCHET_HEADER_LEN + RATCHET_OVERHEAD
        } else {
            SESSION_OVERHEAD
        }
    }

    /// The state's bytes, for the wallet's sealed records (docs/protocol.md
    /// §16.5 has the layout). They hold the conversation's secrets, in one
    /// buffer sized exactly, so no copy of them is left by its growth.
    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        let r = &self.ratchet;
        let len = 1
            + 1
            + 2
            + self.first_bytes.len()
            + POINT_LEN
            + 32
            + 1
            + 32 * usize::from(r.cks.is_some())
            + 32 * usize::from(r.ckr.is_some())
            + 32
            + POINT_LEN
            + POINT_LEN * usize::from(r.dhr.is_some())
            + 8 * usize::from(self.stamp.is_some())
            + 4 * usize::from(self.first_contact_sent.is_some())
            + 4
            + 4
            + 4
            + 8
            + skipped_len(&r.skipped);
        let mut out = Zeroizing::new(Vec::with_capacity(len));
        out.push(STATE_VERSION);
        out.push(match self.role {
            Role::Initiator => 0,
            Role::Responder => 1,
        });
        // F is at most 538 bytes.
        out.extend_from_slice(&(self.first_bytes.len() as u16).to_be_bytes());
        out.extend_from_slice(&self.first_bytes);
        out.extend_from_slice(&self.responder.to_compressed());
        out.extend_from_slice(r.rk.bytes());
        let flags = u8::from(r.cks.is_some())
            | u8::from(r.ckr.is_some()) << 1
            | u8::from(r.dhr.is_some()) << 2
            | u8::from(self.stamp.is_some()) << 3
            | if self.first_contact_sent.is_some() {
                SENT_BEFORE_A_REPLY
            } else {
                0
            };
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
        if let Some(stamp) = self.stamp {
            out.extend_from_slice(&stamp.to_be_bytes());
        }
        if let Some(sent) = self.first_contact_sent {
            out.extend_from_slice(&sent.to_be_bytes());
        }
        out.extend_from_slice(&r.ns.to_be_bytes());
        out.extend_from_slice(&r.nr.to_be_bytes());
        out.extend_from_slice(&r.pn.to_be_bytes());
        out.extend_from_slice(&r.lost.to_be_bytes());
        write_skipped(&r.skipped, &mut out);
        debug_assert_eq!(out.len(), len);
        out
    }

    /// A state from its bytes. Every point, scalar, count and invariant is
    /// checked; anything else is [`Error::InvalidState`]. A state of another
    /// version is [`Error::UnsupportedStateVersion`] at its first byte:
    /// version 1 is a development build's.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        match bytes.first() {
            Some(&STATE_VERSION) => {}
            Some(&version) => return Err(Error::UnsupportedStateVersion(version)),
            None => return Err(Error::InvalidState),
        }
        Self::parse_v2(&bytes[1..]).map_err(|_| Error::InvalidState)
    }

    fn parse_v2(bytes: &[u8]) -> Result<Self, Error> {
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
        if flags & !0b1_1111 != 0 {
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
        let stamp = (flags & 8 != 0)
            .then(|| reader.array().map(u64::from_be_bytes))
            .transpose()?;
        let first_contact_sent = (flags & SENT_BEFORE_A_REPLY != 0)
            .then(|| reader.array().map(u32::from_be_bytes))
            .transpose()?;
        let ns = u32::from_be_bytes(reader.array()?);
        let nr = u32::from_be_bytes(reader.array()?);
        let pn = u32::from_be_bytes(reader.array()?);
        let lost = u64::from_be_bytes(reader.array()?);
        let left = bytes.len() - reader.position();
        let skipped = read_skipped(&mut reader, left)?;
        if !reader.is_done() {
            return Err(Error::InvalidState);
        }
        // Every reachable state has a sending chain and a DHr. A responder has
        // a receiving chain too, and no stamp; an initiator without a
        // receiving chain is still on w₀, and counts what it sent of the
        // request's share: within it, and so at most 16 messages.
        let sending_first_contact = role == Role::Initiator && ckr.is_none();
        let consistent = cks.is_some()
            && dhr.is_some()
            && match role {
                Role::Responder => ckr.is_some() && stamp.is_none(),
                Role::Initiator => ckr.is_some() || (dhr == Some(responder) && pn == 0),
            }
            && first_contact_sent.is_some() == sending_first_contact
            && first_contact_sent.is_none_or(|sent| {
                sent as usize <= MAX_ONE_REQUEST_BYTES && ns <= MAX_REQUEST_MESSAGES as u32
            });
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
            stamp,
            first_contact_sent,
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
