//! Requests, tombstones, continuations, and the routing of an opened message
//! (docs/protocol.md §3.1, §5 and §6).

use std::collections::BTreeMap;

use blstrs::G1Projective;
use group::Curve;

use crate::register::{Register, matches_register};
use crate::relay::stamp_bits;
use crate::session::conversation::{Conversation, Texts};
use crate::session::draw::{Draw, OsDraw};
use crate::session::first_contact::{
    CID_LEN, ConversationId, FIRST_CONTACT_MAX_AGE, FIRST_CONTACT_STAMP_BITS, FirstContact, Handle,
    Reader, within_window,
};
use crate::session::wire::{MAX_ENVELOPE_LEN, Opened, Outer, open};
use crate::{Error, SecretKey};

/// The most requests kept per network.
pub const MAX_REQUESTS: usize = 50;

/// The most bytes of requests kept per network: their inner messages,
/// unpadded.
pub const MAX_REQUEST_BYTES: usize = 256 * 1024;

/// A request's share, in messages: the most first-contact messages one
/// request holds, and an initiator sends before a reply. A first-contact
/// message's header has PN 0 and N below it, or it doesn't parse
/// (docs/protocol.md §3.1). Every later reader honours it, so raising it is
/// a change older readers drop.
pub const MAX_REQUEST_MESSAGES: usize = 16;

/// A request's share, in bytes: the most one request holds, and an
/// initiator sends before a reply, of their inner messages, unpadded, as
/// [`Request::stored_len`] counts them. Two of the largest fit; three don't.
pub const MAX_ONE_REQUEST_BYTES: usize = 64 * 1024;

/// How long after its `t` a first message to a deleted conversation could
/// still be read: 48 hours, the window's.
pub const TOMBSTONE_AFTER_START: u64 = FIRST_CONTACT_MAX_AGE;

/// How much longer than its `t` + 48 hours a tombstone is kept: 7 days, a
/// choice (docs/protocol.md §16.4), 24 bytes a deletion. A tombstone refuses
/// its ID whatever the clock says while it's kept, so a clock that ran ahead
/// by less than this for an expiry, then was set right, can't reopen a
/// deleted conversation.
pub const TOMBSTONE_MARGIN: u64 = 7 * 24 * 3600;

/// The serialization format of [`Requests`]: 2. A record of version 1, a
/// development build's, is refused at its first byte.
pub const REQUESTS_VERSION: u8 = 2;

/// The serialization format of [`Tombstones`]: 1, whose layout is unchanged.
pub const TOMBSTONES_VERSION: u8 = 1;

/// What a request's `replaces` amounts to (docs/protocol.md §6).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Continues {
    /// The same base and the same two public values, in either order, as the
    /// reader's conversation of that ID. The static DH in SK proves the
    /// writer holds the old key for their side.
    Verified(ConversationId),
    /// A claim: no conversation of that ID here, or different identities.
    Unverified(ConversationId),
}

/// A conversation someone else started, not yet replied to: F and its
/// first-contact messages as they arrived, and no ratchet state.
#[derive(Clone, Debug)]
pub struct Request {
    seq: u64,
    first: FirstContact,
    continues: Option<Continues>,
    /// Each message's arrival time and the message, in arrival order.
    messages: Vec<(u64, Opened)>,
}

impl Request {
    /// The conversation ID.
    pub fn cid(&self) -> ConversationId {
        self.first.cid
    }

    /// F.
    pub fn first_contact(&self) -> &FirstContact {
        &self.first
    }

    /// What its `replaces` amounts to, judged when it arrived.
    pub fn continues(&self) -> Option<Continues> {
        self.continues
    }

    /// How many first-contact messages it holds.
    pub fn message_count(&self) -> usize {
        self.messages.len()
    }

    /// When each message arrived, by the reader's clock, in arrival order:
    /// the order [`Request::read`] gives their texts in.
    pub fn arrivals(&self) -> impl Iterator<Item = u64> + '_ {
        self.messages.iter().map(|(at, _)| *at)
    }

    /// Its stored bytes, as counted against [`MAX_REQUEST_BYTES`] and the
    /// request's share: its inner messages, unpadded.
    pub fn stored_len(&self) -> usize {
        self.messages
            .iter()
            .map(|(_, opened)| opened.bytes.len())
            .sum()
    }

    /// Decrypts its messages in memory to show them, as the reply would build
    /// the state, and keeps nothing. Each message's text, in arrival order.
    pub fn read(&self, key: &SecretKey) -> Result<Texts, Error> {
        Ok(self.build(key, &mut OsDraw)?.1)
    }

    pub(crate) fn build(
        &self,
        key: &SecretKey,
        draw: &mut dyn Draw,
    ) -> Result<(Conversation, Texts), Error> {
        self.build_with(None, key, draw)
    }

    /// The state a reply would build: RatchetInitBob, then the stored
    /// messages in the order they arrived, each with its arrival time, then
    /// `extra` if there is one.
    fn build_with(
        &self,
        extra: Option<(&Opened, u64)>,
        key: &SecretKey,
        draw: &mut dyn Draw,
    ) -> Result<(Conversation, Texts), Error> {
        let mut messages: Vec<_> = self
            .messages
            .iter()
            .map(|(at, opened)| (opened, *at))
            .collect();
        messages.extend(extra);
        Conversation::accept_with(key, &messages, draw)
    }
}

/// The requests of one network, oldest first by arrival, within
/// [`MAX_REQUESTS`] and [`MAX_REQUEST_BYTES`].
#[derive(Clone, Debug, Default)]
pub struct Requests {
    next_seq: u64,
    list: Vec<Request>,
}

impl Requests {
    /// No requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// The requests, oldest first.
    pub fn iter(&self) -> impl Iterator<Item = &Request> {
        self.list.iter()
    }

    /// The request of `cid`.
    pub fn get(&self, cid: ConversationId) -> Option<&Request> {
        self.list.iter().find(|request| request.cid() == cid)
    }

    /// How many there are.
    pub fn len(&self) -> usize {
        self.list.len()
    }

    /// Whether there are none.
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    /// Their stored bytes in all.
    pub fn stored_len(&self) -> usize {
        self.list.iter().map(Request::stored_len).sum()
    }

    fn contains(&self, cid: ConversationId) -> bool {
        self.get(cid).is_some()
    }

    fn take(&mut self, cid: ConversationId) -> Option<Request> {
        let i = self.list.iter().position(|request| request.cid() == cid)?;
        Some(self.list.remove(i))
    }

    /// After a new request, past either bound, the oldest go first, never
    /// the newest: one message is within both bounds alone. Returns the IDs
    /// removed. Only a new request, with its own stamp, pushes others out: a
    /// join that doesn't fit is refused instead.
    fn evict(&mut self) -> Vec<ConversationId> {
        let mut evicted = Vec::new();
        while self.list.len() > 1
            && (self.list.len() > MAX_REQUESTS || self.stored_len() > MAX_REQUEST_BYTES)
        {
            evicted.push(self.list.remove(0).cid());
        }
        evicted
    }

    /// The record's bytes: no secrets, only what arrived.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = vec![REQUESTS_VERSION];
        out.extend_from_slice(&self.next_seq.to_be_bytes());
        out.extend_from_slice(&(self.list.len() as u16).to_be_bytes());
        for request in &self.list {
            out.extend_from_slice(&request.seq.to_be_bytes());
            match request.continues {
                None => out.push(0),
                Some(Continues::Verified(cid)) => {
                    out.push(1);
                    out.extend_from_slice(&cid.0);
                }
                Some(Continues::Unverified(cid)) => {
                    out.push(2);
                    out.extend_from_slice(&cid.0);
                }
            }
            out.extend_from_slice(&(request.messages.len() as u16).to_be_bytes());
            for (at, opened) in &request.messages {
                out.extend_from_slice(&at.to_be_bytes());
                out.extend_from_slice(&(opened.bytes.len() as u32).to_be_bytes());
                out.extend_from_slice(&opened.bytes);
            }
        }
        out
    }

    /// The record from its bytes, every message parsed and checked again.
    /// A record of another version is [`Error::UnsupportedStateVersion`] at
    /// its first byte: version 1 is a development build's.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        match bytes.first() {
            Some(&REQUESTS_VERSION) => {}
            Some(&version) => return Err(Error::UnsupportedStateVersion(version)),
            None => return Err(Error::InvalidState),
        }
        Self::parse_v2(&bytes[1..]).map_err(|_| Error::InvalidState)
    }

    /// Each request holds 1 to [`MAX_REQUEST_MESSAGES`] messages and at most
    /// [`MAX_ONE_REQUEST_BYTES`], all with the first's F and its header key
    /// S_A, PN 0 (which parsing checks) and N each its own: what the
    /// reader's rules let in (docs/protocol.md §16.5).
    fn parse_v2(bytes: &[u8]) -> Result<Self, Error> {
        let mut reader = Reader::new(bytes);
        let next_seq = u64::from_be_bytes(reader.array()?);
        let count = usize::from(u16::from_be_bytes(reader.array()?));
        if count > MAX_REQUESTS {
            return Err(Error::InvalidState);
        }
        let mut list = Vec::with_capacity(count);
        for _ in 0..count {
            let seq = u64::from_be_bytes(reader.array()?);
            let continues = match reader.byte()? {
                0 => None,
                1 => Some(Continues::Verified(ConversationId(reader.array()?))),
                2 => Some(Continues::Unverified(ConversationId(reader.array()?))),
                _ => return Err(Error::InvalidState),
            };
            let n = usize::from(u16::from_be_bytes(reader.array()?));
            if n > MAX_REQUEST_MESSAGES {
                return Err(Error::InvalidState);
            }
            let mut messages = Vec::with_capacity(n);
            for _ in 0..n {
                let at = u64::from_be_bytes(reader.array()?);
                let len = u32::from_be_bytes(reader.array()?) as usize;
                if len > MAX_ENVELOPE_LEN {
                    return Err(Error::InvalidState);
                }
                messages.push((at, Opened::parse(reader.take(len)?, Outer::Checked)?));
            }
            let first = match messages.first() {
                Some((
                    _,
                    Opened {
                        first: Some((first, bytes)),
                        header,
                        ..
                    },
                )) => {
                    // Every message on the first's F and its header key S_A,
                    // the key the keys proof covers: one on another would
                    // meet x in a replay whose first message failed.
                    let same = messages.iter().all(|(_, opened)| {
                        opened.first.as_ref().is_some_and(|(_, b)| b == bytes)
                            && opened.header.dh == header.dh
                    });
                    // One key and PN 0, so a header held twice is an N
                    // held twice, which a join refuses.
                    let distinct = messages.iter().enumerate().all(|(i, (_, opened))| {
                        messages[..i]
                            .iter()
                            .all(|(_, other)| other.header.n != opened.header.n)
                    });
                    let within: usize = messages.iter().map(|(_, o)| o.bytes.len()).sum();
                    if !same || !distinct || within > MAX_ONE_REQUEST_BYTES || seq >= next_seq {
                        return Err(Error::InvalidState);
                    }
                    first.clone()
                }
                _ => return Err(Error::InvalidState),
            };
            list.push(Request {
                seq,
                first,
                continues,
                messages,
            });
        }
        if !reader.is_done() {
            return Err(Error::InvalidState);
        }
        let requests = Self { next_seq, list };
        let ordered = requests
            .list
            .windows(2)
            .all(|pair| pair[0].seq < pair[1].seq);
        let unique = requests.list.iter().enumerate().all(|(i, request)| {
            requests.list[..i]
                .iter()
                .all(|other| other.cid() != request.cid())
        });
        if !ordered || !unique || requests.stored_len() > MAX_REQUEST_BYTES {
            return Err(Error::InvalidState);
        }
        Ok(requests)
    }
}

/// Deleted conversations' IDs, each kept until its `t` + 48 hours and
/// `TOMBSTONE_MARGIN`, 7 days, more.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tombstones {
    list: Vec<(ConversationId, u64)>,
}

impl Tombstones {
    /// None.
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether `cid` is held: from its deletion until [`Tombstones::expire`]
    /// deletes it, whatever the clock says meanwhile. A clock set back can't
    /// reopen a deleted conversation's ID, and once the tombstone goes, the
    /// window has refused its first messages for at least the margin.
    pub fn holds(&self, cid: ConversationId) -> bool {
        self.list.iter().any(|(held, _)| *held == cid)
    }

    /// How many there are.
    pub fn len(&self) -> usize {
        self.list.len()
    }

    /// Whether there are none.
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    fn add(&mut self, cid: ConversationId, t: u64) {
        self.list.retain(|(held, _)| *held != cid);
        self.list.push((cid, t));
    }

    /// Deletes the tombstones past their `t` + 48 hours and 7 days
    /// (`TOMBSTONE_MARGIN`): the window refuses their first messages by
    /// itself from 48 hours on, and the margin covers a clock that ran ahead
    /// by less than it for this expiry and is then set right.
    pub fn expire(&mut self, now: u64) {
        self.list.retain(|(_, t)| {
            now <= t
                .saturating_add(TOMBSTONE_AFTER_START)
                .saturating_add(TOMBSTONE_MARGIN)
        });
    }

    /// The record's bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = vec![TOMBSTONES_VERSION];
        out.extend_from_slice(&(self.list.len() as u32).to_be_bytes());
        for (cid, t) in &self.list {
            out.extend_from_slice(&cid.0);
            out.extend_from_slice(&t.to_be_bytes());
        }
        out
    }

    /// The record from its bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        match bytes.first() {
            Some(&TOMBSTONES_VERSION) => {}
            Some(&version) => return Err(Error::UnsupportedStateVersion(version)),
            None => return Err(Error::InvalidState),
        }
        let mut reader = Reader::new(&bytes[1..]);
        let count = reader
            .array()
            .map(u32::from_be_bytes)
            .map_err(|_| Error::InvalidState)? as usize;
        if count > (bytes.len() - 1) / (CID_LEN + 8) {
            return Err(Error::InvalidState);
        }
        let mut list = Vec::with_capacity(count);
        for _ in 0..count {
            let cid = ConversationId(reader.array().map_err(|_| Error::InvalidState)?);
            let t = u64::from_be_bytes(reader.array().map_err(|_| Error::InvalidState)?);
            list.push((cid, t));
        }
        if !reader.is_done() {
            return Err(Error::InvalidState);
        }
        Ok(Self { list })
    }
}

/// What an envelope delivered.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Received {
    /// A message of a conversation.
    Message {
        /// The conversation.
        cid: ConversationId,
        /// The text.
        plaintext: Vec<u8>,
    },
    /// A first-contact message from someone the reader hasn't replied to.
    Request {
        /// The request.
        cid: ConversationId,
        /// The text.
        plaintext: Vec<u8>,
        /// Whether it started a request, rather than joining one.
        new: bool,
        /// Requests the bounds pushed out, oldest first: only a new request
        /// pushes others out, never itself, so always empty for a join.
        evicted: Vec<ConversationId>,
    },
}

/// One network's messaging state: conversations, requests and tombstones,
/// with the rules of docs/protocol.md §5 and §6 over them.
///
/// Every operation leaves everything as it was when it fails. The wallet
/// stores each part as its own record ([`Conversation::to_bytes`],
/// [`Requests::to_bytes`], [`Tombstones::to_bytes`]); this type is the rules
/// over them.
#[derive(Clone, Debug)]
pub struct Inbox {
    conversations: BTreeMap<ConversationId, Conversation>,
    requests: Requests,
    tombstones: Tombstones,
    /// The work a new conversation's stamp must show: not stored.
    first_contact_bits: u32,
}

impl Default for Inbox {
    fn default() -> Self {
        Self {
            conversations: BTreeMap::new(),
            requests: Requests::new(),
            tombstones: Tombstones::new(),
            first_contact_bits: FIRST_CONTACT_STAMP_BITS,
        }
    }
}

impl Inbox {
    /// Nothing yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// The work a first message's stamp must show here, in bits:
    /// [`FIRST_CONTACT_STAMP_BITS`] unless set.
    pub fn first_contact_bits(&self) -> u32 {
        self.first_contact_bits
    }

    /// Asks a different work of first messages' stamps: for tests, which
    /// can't wait for 2²⁴ attempts, and for tuning. Writers solve at
    /// [`FIRST_CONTACT_STAMP_BITS`], so a reader asking more drops their
    /// first messages.
    pub fn set_first_contact_bits(&mut self, bits: u32) {
        self.first_contact_bits = bits;
    }

    /// From stored parts. Refuses a conversation ID held twice.
    pub fn from_parts(
        conversations: Vec<Conversation>,
        requests: Requests,
        tombstones: Tombstones,
    ) -> Result<Self, Error> {
        let mut map = BTreeMap::new();
        for conversation in conversations {
            let cid = conversation.cid();
            if requests.contains(cid) || map.insert(cid, conversation).is_some() {
                return Err(Error::InvalidState);
            }
        }
        Ok(Self {
            conversations: map,
            requests,
            tombstones,
            first_contact_bits: FIRST_CONTACT_STAMP_BITS,
        })
    }

    /// The conversation of `cid`.
    pub fn conversation(&self, cid: ConversationId) -> Option<&Conversation> {
        self.conversations.get(&cid)
    }

    /// Every conversation.
    pub fn conversations(&self) -> impl Iterator<Item = &Conversation> {
        self.conversations.values()
    }

    /// The requests.
    pub fn requests(&self) -> &Requests {
        &self.requests
    }

    /// The tombstones.
    pub fn tombstones(&self) -> &Tombstones {
        &self.tombstones
    }

    /// Starts a conversation with the owner of `handle`, named `to`
    /// (docs/protocol.md §3). Its stamp comes next: [`Inbox::stamp_digest`],
    /// then [`Inbox::set_stamp`].
    pub fn start(
        &mut self,
        key: &SecretKey,
        handle: &Register,
        to: &[u8],
        now: u64,
    ) -> Result<ConversationId, Error> {
        self.insert(Conversation::start(key, handle, to, now)?)
    }

    /// Starts a conversation continuing `old`, with its identities (§6).
    pub fn start_continuing(
        &mut self,
        key: &SecretKey,
        old: ConversationId,
        now: u64,
    ) -> Result<ConversationId, Error> {
        let previous = self
            .conversations
            .get(&old)
            .ok_or(Error::UnknownConversation)?;
        self.insert(Conversation::start_continuing(key, previous, now)?)
    }

    /// What `cid`'s first-contact stamp is over ([`Conversation::stamp_digest`]).
    pub fn stamp_digest(&self, cid: ConversationId) -> Result<[u8; 32], Error> {
        Ok(self
            .conversations
            .get(&cid)
            .ok_or(Error::UnknownConversation)?
            .stamp_digest())
    }

    /// Sets `cid`'s first-contact stamp ([`Conversation::set_stamp`]).
    pub fn set_stamp(&mut self, cid: ConversationId, nonce: u64) -> Result<(), Error> {
        self.conversations
            .get_mut(&cid)
            .ok_or(Error::UnknownConversation)?
            .set_stamp(nonce)
    }

    fn insert(&mut self, conversation: Conversation) -> Result<ConversationId, Error> {
        let cid = conversation.cid();
        if self.conversations.contains_key(&cid) || self.requests.contains(cid) {
            return Err(Error::InvalidState);
        }
        self.conversations.insert(cid, conversation);
        Ok(cid)
    }

    /// The next message of `cid`'s conversation, as an envelope.
    pub fn send(&mut self, cid: ConversationId, plaintext: &[u8]) -> Result<Vec<u8>, Error> {
        self.conversations
            .get_mut(&cid)
            .ok_or(Error::UnknownConversation)?
            .send(plaintext)
    }

    /// Opens an envelope addressed to `key` and applies §5 and §6.
    /// `handles` are the reader's: every register each of its Seedelfs is
    /// known to have held. Only a register of `key`'s counts: the base proof's
    /// other branch is its register's key, so one of another key under the
    /// name binds no base, and is passed over.
    ///
    /// - A known conversation's ID: its ratchet, on a copy (a `0x01` only
    ///   with the stored F).
    /// - A request's ID: a `0x01` with the stored F and the first stored
    ///   message's header key joins it, authenticated and within its share
    ///   and the bounds ([`Error::RequestFull`] otherwise, before it's read:
    ///   a join never pushes another request out); a `0x02` is
    ///   [`Error::UnexpectedMessage`].
    /// - A tombstone's: [`Error::Deleted`], whatever the clock.
    /// - A new ID: a `0x01` becomes a request if it's inside the window, its
    ///   stamp shows [`Inbox::first_contact_bits`], its base proof shows its
    ///   base re-randomizes a register of `key`'s that the handle its `to`
    ///   names has held (or, without a `to`, it's a verified continuation),
    ///   its keys proof shows its writer knows the keys of `E_A`, its header
    ///   key and, from a handle, `A`, and it authenticates. In that order:
    ///   each binds a point before the next check multiplies it by the key.
    ///   A `0x02` is
    ///   [`Error::UnknownConversation`], a conversation this browser no
    ///   longer has.
    ///
    /// Every message's envelope must have gone to its conversation identity
    /// re-randomized by the message's outer scalar.
    pub fn receive(
        &mut self,
        key: &SecretKey,
        handles: &[Handle],
        envelope: &[u8],
        now: u64,
    ) -> Result<Received, Error> {
        let opened = open(key, envelope)?;
        self.receive_opened(key, handles, &opened, now, &mut OsDraw)
    }

    pub(crate) fn receive_opened(
        &mut self,
        key: &SecretKey,
        handles: &[Handle],
        opened: &Opened,
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Received, Error> {
        let cid = opened.cid;
        if let Some(conversation) = self.conversations.get_mut(&cid) {
            let plaintext = conversation.receive_with(opened, now, draw)?;
            return Ok(Received::Message { cid, plaintext });
        }
        if self.requests.contains(cid) {
            return self.join(key, opened, now, draw);
        }
        if self.tombstones.holds(cid) {
            return Err(Error::Deleted);
        }
        let (Some((first, _)), Some(stamp)) = (&opened.first, opened.stamp) else {
            return Err(Error::UnknownConversation);
        };
        if !within_window(first.started_at, now) {
            return Err(Error::OutsideWindow);
        }
        // The stamp before any key is computed.
        if stamp_bits(&first.stamp_digest(), stamp) < self.first_contact_bits {
            return Err(Error::StampTooLow);
        }
        // Then p₀ is bound, before the key meets it: by the base proof for a
        // register of the reader's that the handle `to` names has held, or
        // for a continuation by being the base of a conversation held here
        // (`judge` multiplies only a held base).
        // The keys proof, in `accept_with`, then binds E_A, A and S_A.
        let continues = if first.to.is_empty() {
            // No handle: only a verified continuation of this reader's.
            let continues = first.replaces.map(|old| self.judge(key, first, old));
            if !matches!(continues, Some(Continues::Verified(_))) {
                return Err(Error::UnverifiedContinuation);
            }
            continues
        } else {
            let mut named = handles
                .iter()
                .filter(|handle| handle.name() == first.to.as_slice())
                .peekable();
            if named.peek().is_none() {
                return Err(Error::UnknownHandle);
            }
            // The base proof's other branch is the handle's key, so it binds
            // p₀ only for a register of the reader's: a register of another
            // key under the name (one the Seedelf held before it came here)
            // would let that key's holder prove any p₀.
            if !named.any(|handle| {
                first.proves_base(handle.register()) && matches_register(key, handle.register())
            }) {
                return Err(Error::InvalidBaseProof);
            }
            first.replaces.map(|old| self.judge(key, first, old))
        };
        let (_, mut results) = Conversation::accept_with(key, &[(opened, now)], draw)?;
        let plaintext = results.remove(0)?;
        let seq = self.requests.next_seq;
        self.requests.next_seq += 1;
        self.requests.list.push(Request {
            seq,
            first: first.clone(),
            continues,
            messages: vec![(now, opened.checked())],
        });
        let evicted = self.requests.evict();
        Ok(Received::Request {
            cid,
            plaintext,
            new: true,
            evicted,
        })
    }

    /// A later `0x01` of a request, in this order: the same F byte for byte,
    /// a header not yet held (so a page read twice stays a duplicate), the
    /// first stored message's header key, and room in the request's share
    /// and the bounds ([`Error::RequestFull`]), all before any key is
    /// derived; then read after the stored messages as processing each on
    /// arrival would read it. So a request shows exactly what its
    /// conversation will hold. A join never pushes another request out.
    fn join(
        &mut self,
        key: &SecretKey,
        opened: &Opened,
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<Received, Error> {
        let Some((_, bytes)) = &opened.first else {
            return Err(Error::UnexpectedMessage);
        };
        let request = self.requests.get(opened.cid).expect("the caller checked");
        let first = &request.messages[0].1;
        let (_, stored) = first.first.as_ref().expect("a request holds F");
        if bytes != stored {
            return Err(Error::DifferentFirstContact);
        }
        if request
            .messages
            .iter()
            .any(|(_, held)| held.header == opened.header)
        {
            return Err(Error::KeyUsedOrDeleted);
        }
        // The key the keys proof covers, which the scratch state's x meets.
        if opened.header.dh != first.header.dh {
            return Err(Error::InvalidKeysProof);
        }
        // With one key, PN 0 and N below 16, sixteen headers fill a request:
        // the count can't be reached past the check above. The bytes can.
        let len = opened.bytes.len();
        if request.messages.len() >= MAX_REQUEST_MESSAGES
            || request.stored_len() + len > MAX_ONE_REQUEST_BYTES
            || self.requests.stored_len() + len > MAX_REQUEST_BYTES
        {
            return Err(Error::RequestFull);
        }
        let (_, mut results) = request.build_with(Some((opened, now)), key, draw)?;
        let plaintext = results.pop().expect("one result a message")?;
        let request = self
            .requests
            .list
            .iter_mut()
            .find(|request| request.cid() == opened.cid)
            .expect("the caller checked");
        request.messages.push((now, opened.checked()));
        Ok(Received::Request {
            cid: opened.cid,
            plaintext,
            new: false,
            evicted: Vec::new(),
        })
    }

    /// §6: verified only with the same base and the same two public values,
    /// in either order, as the reader's conversation of that ID.
    fn judge(&self, key: &SecretKey, first: &FirstContact, old: ConversationId) -> Continues {
        let Some(previous) = self.conversations.get(&old) else {
            return Continues::Unverified(old);
        };
        if previous.first.base != first.base {
            return Continues::Unverified(old);
        }
        let mine = (G1Projective::from(first.base) * key.scalar()).to_affine();
        let (old_a, old_w0) = (previous.first.initiator, previous.responder);
        if (first.initiator == old_a && mine == old_w0)
            || (first.initiator == old_w0 && mine == old_a)
        {
            Continues::Verified(old)
        } else {
            Continues::Unverified(old)
        }
    }

    /// Replies to a request: builds its state from F and its messages, in
    /// the order they arrived, each with its arrival time (§3.1), and makes
    /// it a conversation. The reply itself is [`Inbox::send`].
    pub fn accept(&mut self, key: &SecretKey, cid: ConversationId) -> Result<(), Error> {
        self.accept_with(key, cid, &mut OsDraw)
    }

    pub(crate) fn accept_with(
        &mut self,
        key: &SecretKey,
        cid: ConversationId,
        draw: &mut dyn Draw,
    ) -> Result<(), Error> {
        let request = self.requests.get(cid).ok_or(Error::UnknownConversation)?;
        let (conversation, _) = request.build(key, draw)?;
        self.requests.take(cid);
        self.conversations.insert(cid, conversation);
        Ok(())
    }

    /// Deletes a conversation or request, keeping its ID as a tombstone until
    /// its `t` + 48 hours and 7 days, whatever the clock meanwhile. Whether
    /// there was one.
    pub fn delete(&mut self, cid: ConversationId) -> bool {
        let t = if let Some(conversation) = self.conversations.remove(&cid) {
            conversation.first.started_at
        } else if let Some(request) = self.requests.take(cid) {
            request.first.started_at
        } else {
            return false;
        };
        self.tombstones.add(cid, t);
        true
    }

    /// Deletes skipped keys past their 48 hours, and tombstones past their
    /// `t` + 48 hours and 7 days.
    pub fn expire(&mut self, now: u64) {
        for conversation in self.conversations.values_mut() {
            conversation.expire(now);
        }
        self.tombstones.expire(now);
    }
}
