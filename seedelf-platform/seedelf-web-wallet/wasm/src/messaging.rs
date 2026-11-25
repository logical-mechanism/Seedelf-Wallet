//! Seedelf Messaging for the worker (chunk 54's 54d): seedelf-messaging's
//! session layer and relay module, JSON in and out, every byte string hex.
//!
//! **Stateless.** Each call takes the records it needs as the wallet stores
//! them, a conversation's, the requests' and the tombstones'
//! (protocol.md §16.5), and gives back the ones it changed. Nothing outlives
//! a call, so the worker's one queue decides every write (§4.2), and a
//! worker Chrome stops loses nothing it had stored. The Seedelf key never
//! leaves WebAssembly. A conversation's record holds its secrets: the wallet
//! seals it, and this module wipes its own copies ([`Secret`]).
//!
//! **Answers and errors.** An operation the crate refuses (an envelope that
//! isn't the reader's to take, a message too long, a handle whose register
//! isn't valid) is an answer, `{ "refused": "<code>" }`, the code naming the
//! crate's [`Error`] ([`code`]). So is a requests' record the crate doesn't
//! read, in every call that reads one: `unsupported_state_version` with the
//! record's `version`, or `invalid_state`, so the worker can drop a
//! development build's record and set a later version's aside
//! ([`Constants::requests_version`] says which is which). A request that
//! doesn't parse, bytes that aren't hex, or a conversation's or the
//! tombstones' record that doesn't read is an error, thrown: the worker's
//! mistake, or a record that isn't this wallet's. [`delete`] takes a
//! conversation's record that doesn't read as absent.
//!
//! **Receiving is two calls.** [`open`] says which conversation an envelope
//! is for, and nothing secret; [`receive`] then takes that conversation's
//! record, and the one its `replaces` names, with the requests and the
//! tombstones. Only an envelope the scan matched is ever opened, so the
//! second opening costs only matches.

use std::borrow::Borrow;
use std::fmt;

use anyhow::{Result, anyhow};
use blstrs::Scalar;
use seedelf_messaging::relay::{self, MAX_STAMP_BITS};
use seedelf_messaging::session::{
    Continues, Conversation, ConversationId, ENVELOPE_SIZES, FIRST_CONTACT_MAX_AGE,
    FIRST_CONTACT_MAX_AHEAD, FIRST_CONTACT_STAMP_BITS, Handle, Inbox, MAX_AUTH_STEPS,
    MAX_ONE_REQUEST_BYTES, MAX_REQUEST_BYTES, MAX_REQUEST_MESSAGES, MAX_REQUESTS,
    RATCHET_HEADER_LEN, RATCHET_OVERHEAD, REQUESTS_VERSION, Received, Requests, Reveal, Role,
    SKIPPED_KEY_LIFETIME, STAMP_LEN, Tombstones,
};
use seedelf_messaging::{Error, POINT_LEN, Register, SecretKey, matches_envelope};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

/// The most work the wallet solves for a post: room above the pools' 24-bit
/// ceiling, so a relay can raise that far and 1.10.0 still pays
/// (protocol.md §20). A choice of the wallet's, not the crate's.
pub const PRICE_CEILING_BITS: u32 = 26;

/// A hex string holding a secret or a message's text: a conversation's
/// record, a plaintext. Wiped when dropped, so WebAssembly's copies don't
/// outlive the call; JavaScript's are the worker's to keep or seal.
#[derive(Deserialize, Serialize, Default, Clone, PartialEq, Eq)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// The hex of `bytes`.
    pub fn of(bytes: &[u8]) -> Self {
        Secret(hex::encode(bytes))
    }

    /// The hex, as JavaScript gets it.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The bytes, decoded into one buffer sized once: `hex::decode` collects
    /// into a Vec that grows, and each buffer it outgrows is freed holding a
    /// prefix of them, unwiped. An odd length is refused before anything is
    /// decoded.
    fn bytes(&self, what: &str) -> Result<Zeroizing<Vec<u8>>> {
        let hex = self.0.as_bytes();
        let mut out = Zeroizing::new(vec![0u8; hex.len() / 2]);
        hex::decode_to_slice(hex, &mut out[..]).map_err(|e| anyhow!("{what} isn't hex: {e}"))?;
        Ok(out)
    }
}

impl From<String> for Secret {
    fn from(hex: String) -> Self {
        Secret(hex)
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(..)")
    }
}

/// What a call gives: its result, or the crate's refusal as a code.
#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum Answer<T> {
    /// The operation's result.
    Done(T),
    /// The crate refused it: [`code`] of its [`Error`].
    Refused {
        /// The refusal's code.
        refused: &'static str,
        /// For `unsupported_state_version` alone, the version the record's
        /// first byte names: older than this build's
        /// ([`Constants::requests_version`]) is a development build's
        /// record, newer a later version's, which the wallet keeps and never
        /// writes over.
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<u8>,
    },
}

impl<T> Answer<T> {
    /// The result, if there is one.
    pub fn done(self) -> Option<T> {
        match self {
            Answer::Done(value) => Some(value),
            Answer::Refused { .. } => None,
        }
    }

    /// The refusal's code, if it was refused.
    pub fn refused(&self) -> Option<&'static str> {
        match self {
            Answer::Done(_) => None,
            Answer::Refused { refused, .. } => Some(refused),
        }
    }
}

/// The crate's refusal, as JavaScript gets it.
fn refusal<T>(error: Error) -> Answer<T> {
    Answer::Refused {
        refused: code(error),
        version: match error {
            Error::UnsupportedStateVersion(version) => Some(version),
            _ => None,
        },
    }
}

fn answer<T>(result: Result<T, Error>) -> Answer<T> {
    match result {
        Ok(value) => Answer::Done(value),
        Err(error) => refusal(error),
    }
}

/// The code JavaScript gets for each of the crate's refusals: the variant's
/// name in snake case, as the relay's vectors name its refusals. Stable: the
/// worker branches on it, and never on an error's words. Every variant is
/// named, so a new one doesn't build until it has a code.
pub fn code(error: Error) -> &'static str {
    match error {
        Error::InvalidEncoding => "invalid_encoding",
        Error::NotInSubgroup => "not_in_subgroup",
        Error::IdentityPoint => "identity_point",
        Error::InvalidScalar => "invalid_scalar",
        Error::UnsupportedVersion(_) => "unsupported_version",
        Error::InvalidLength => "invalid_length",
        Error::PlaintextTooLarge => "plaintext_too_large",
        Error::NotForThisKey => "not_for_this_key",
        Error::DecryptionFailed => "decryption_failed",
        Error::InvalidPadding => "invalid_padding",
        Error::InvalidMessage => "invalid_message",
        Error::MessageTooLarge => "message_too_large",
        Error::OutsideWindow => "outside_window",
        Error::Deleted => "deleted",
        Error::DifferentFirstContact => "different_first_contact",
        Error::TooFarAhead => "too_far_ahead",
        Error::KeyUsedOrDeleted => "key_used_or_deleted",
        Error::UnknownConversation => "unknown_conversation",
        Error::UnexpectedMessage => "unexpected_message",
        Error::OwnRegister => "own_register",
        Error::ChainExhausted => "chain_exhausted",
        Error::InvalidState => "invalid_state",
        Error::UnsupportedStateVersion(_) => "unsupported_state_version",
        Error::StampTooHard => "stamp_too_hard",
        Error::StampTooLow => "stamp_too_low",
        Error::Unstamped => "unstamped",
        Error::UnknownHandle => "unknown_handle",
        Error::InvalidBaseProof => "invalid_base_proof",
        Error::UnverifiedContinuation => "unverified_continuation",
        Error::InvalidKeysProof => "invalid_keys_proof",
        Error::RequestFull => "request_full",
        Error::WrongEnvelopeRegister => "wrong_envelope_register",
        Error::RevealNotAllowed => "reveal_not_allowed",
        Error::InvalidReveal => "invalid_reveal",
    }
}

// ---------------------------------------------------------------------------
// Reading what JavaScript passes
// ---------------------------------------------------------------------------

/// A register as the wallet passes one everywhere: two compressed points,
/// hex, as a Seedelf datum holds them.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisterHex {
    /// `g`, 48 bytes.
    pub generator: String,
    /// `v = [x]g`, 48 bytes.
    pub public_value: String,
}

impl RegisterHex {
    /// The register, or the crate's refusal of a point: hex that isn't 48
    /// bytes throws.
    fn read(&self, what: &str) -> Result<Result<Register, Error>> {
        let point = |hex: &str, which: &str| -> Result<[u8; POINT_LEN]> {
            hex::decode(hex)
                .ok()
                .and_then(|bytes| bytes.try_into().ok())
                .ok_or_else(|| anyhow!("{what}'s {which} isn't 48 bytes of hex"))
        };
        Ok(Register::from_bytes(
            &point(&self.generator, "generator")?,
            &point(&self.public_value, "public value")?,
        ))
    }
}

/// One of the reader's Seedelfs: its asset name, hex, and every register
/// the wallet knows it has held (protocol.md §16.4).
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HandleHex {
    /// The asset name, 1 to 32 bytes.
    pub name: String,
    /// Every register it's known to have held. Only those of the reader's
    /// key count: the crate passes over one of another key's, which would
    /// let that key's holder prove any base.
    pub registers: Vec<RegisterHex>,
}

/// The crate's handles, one for each register. The wallet's own registers
/// are its to pass, and the crate takes a base proof only against a register
/// of the reader's key: one that doesn't read throws.
fn handles(given: &[HandleHex]) -> Result<Vec<Handle>> {
    let mut out = Vec::new();
    for handle in given {
        let name = decode(&handle.name, "a handle's name")?;
        for register in &handle.registers {
            let register = register
                .read("a handle's register")?
                .map_err(|e| anyhow!("a handle's register isn't one: {e}"))?;
            out.push(
                Handle::new(&name, register)
                    .map_err(|_| anyhow!("a handle's name must be 1 to 32 bytes"))?,
            );
        }
    }
    Ok(out)
}

fn decode(hex: &str, what: &str) -> Result<Vec<u8>> {
    hex::decode(hex).map_err(|e| anyhow!("{what} isn't hex: {e}"))
}

fn cid_of(hex: &str) -> Result<ConversationId> {
    decode(hex, "the conversation ID")?
        .try_into()
        .map(ConversationId)
        .map_err(|_| anyhow!("a conversation ID is 16 bytes"))
}

fn cid_hex(cid: ConversationId) -> String {
    hex::encode(cid.0)
}

fn secret_key(sk: &Scalar) -> Result<SecretKey> {
    SecretKey::from_scalar(*sk).map_err(|e| anyhow!("the key: {e}"))
}

fn conversation(record: &Secret) -> Result<Conversation> {
    Conversation::from_bytes(&record.bytes("a conversation's record")?)
        .map_err(|e| anyhow!("a conversation's record doesn't read: {e}"))
}

/// A conversation's record, for JavaScript to seal and keep. Never a state
/// whose ratchet key is the conversation's own identity key: that key's
/// secret is the Seedelf key itself, which no record may hold. The crate
/// returns no such state and reads none back; `to_bytes` can't refuse one,
/// so this does, and throws.
fn record_of(held: &Conversation) -> Result<Secret> {
    if held.ratchet_key_is_identity() {
        return Err(anyhow!(
            "a conversation's state holds its identity key as its ratchet key: it isn't written"
        ));
    }
    Ok(Secret::of(&held.to_bytes()))
}

/// The requests' record, none yet when absent. Bytes that aren't hex throw;
/// a record the crate doesn't read is its refusal, for the caller to give
/// back ([`refusal`]): `unsupported_state_version` with the record's
/// version, or `invalid_state`.
fn requests(record: Option<&str>) -> Result<Result<Requests, Error>> {
    match record {
        None => Ok(Ok(Requests::new())),
        Some(hex) => Ok(Requests::from_bytes(&decode(hex, "the requests' record")?)),
    }
}

fn tombstones(record: Option<&str>) -> Result<Tombstones> {
    match record {
        None => Ok(Tombstones::new()),
        Some(hex) => Tombstones::from_bytes(&decode(hex, "the tombstones' record")?)
            .map_err(|e| anyhow!("the tombstones' record doesn't read: {e}")),
    }
}

fn inbox(
    conversations: Vec<Conversation>,
    requests: Requests,
    tombstones: Tombstones,
) -> Result<Inbox> {
    Inbox::from_parts(conversations, requests, tombstones)
        .map_err(|_| anyhow!("the records hold one conversation ID twice"))
}

// ---------------------------------------------------------------------------
// The scan and opening
// ---------------------------------------------------------------------------

/// Which of `envelopes` are addressed to `sk`: the scan of a relay page, one
/// batch at a time (protocol.md §4.1). One digit for each envelope, in
/// order, `1` where it's the reader's and `0` where it isn't, so the answer
/// is as long as the batch whatever matched. Each digit is the match's bit
/// added to `0`, written in its place, with no branch on it: a match costs
/// what a miss does, in the answer as in the test (the 1.10.0 gate's
/// scan-timing#1; whether an envelope is a v1 envelope with a valid `p` is
/// in its bytes, for anyone to see). An envelope that isn't one isn't the
/// reader's; only one that isn't hex throws.
pub fn scan(sk: impl Borrow<Scalar>, envelopes: &[String]) -> Result<String> {
    let key = secret_key(sk.borrow())?;
    let mut found = String::with_capacity(envelopes.len());
    for envelope in envelopes {
        let bytes = decode(envelope, "an envelope")?;
        let matched = matches_envelope(&key, &bytes).unwrap_or(false);
        found.push(char::from(b'0' + u8::from(matched)));
    }
    Ok(found)
}

/// What an opened envelope is for, and nothing secret: which records
/// [`receive`] needs.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// The conversation ID, 16 bytes.
    pub cid: String,
    /// `first-contact` (`0x01`, carrying F) or `session` (`0x02`).
    pub kind: &'static str,
    /// F's `t`, for a first-contact message.
    pub t: Option<u64>,
    /// F's `to`, the handle's asset name, for a first-contact message: empty
    /// for a continuation.
    pub to: Option<String>,
    /// The conversation F says it continues, if any.
    pub replaces: Option<String>,
}

/// Opens an envelope addressed to `sk` and says which conversation it's
/// for: every point checked, the padding exact. Its message isn't decrypted.
pub fn open(sk: impl Borrow<Scalar>, envelope: &str) -> Result<Answer<Opened>> {
    let key = secret_key(sk.borrow())?;
    let bytes = decode(envelope, "the envelope")?;
    Ok(answer(seedelf_messaging::session::open(&key, &bytes).map(
        |opened| {
            let first = opened.first_contact();
            Opened {
                cid: cid_hex(opened.cid()),
                kind: if first.is_some() {
                    "first-contact"
                } else {
                    "session"
                },
                t: first.map(|f| f.started_at()),
                to: first.map(|f| hex::encode(f.to())),
                replaces: first.and_then(|f| f.replaces()).map(cid_hex),
            }
        },
    )))
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

/// [`receive`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveRequest {
    /// The envelope, as the scan matched it.
    pub envelope: String,
    /// The reader's clock, Unix seconds.
    pub now: u64,
    /// The reader's Seedelfs, each with every register it has held.
    #[serde(default)]
    pub handles: Vec<HandleHex>,
    /// The records of the conversation [`open`] named and of the one its
    /// `replaces` names, whichever the wallet holds.
    #[serde(default)]
    pub conversations: Vec<Secret>,
    /// The requests' record; none yet when absent.
    #[serde(default)]
    pub requests: Option<String>,
    /// The tombstones' record; none yet when absent.
    #[serde(default)]
    pub tombstones: Option<String>,
    /// The work a new conversation's stamp must show, for tests and tuning
    /// only: readers ask [`FIRST_CONTACT_STAMP_BITS`] when it's absent, and a
    /// reader asking less takes cheaper first messages from strangers.
    #[serde(default)]
    pub first_contact_bits: Option<u32>,
}

/// What an envelope delivered.
#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReceivedView {
    /// A message of a conversation.
    Message {
        /// The conversation.
        cid: String,
        /// The text.
        plaintext: Secret,
    },
    /// A first-contact message from someone the reader hasn't replied to.
    Request {
        /// The request.
        cid: String,
        /// The text.
        plaintext: Secret,
        /// Whether it started a request, rather than joining one.
        new: bool,
        /// Requests the bounds pushed out, oldest first: only a new request
        /// pushes others out, never itself, so always empty for a join.
        evicted: Vec<String>,
    },
}

/// [`receive`]'s result: what arrived, and the one record it changed.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveResult {
    /// What arrived.
    pub received: ReceivedView,
    /// A message's conversation, its new record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<Secret>,
    /// A request's new requests' record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests: Option<String>,
}

/// Takes an envelope addressed to `sk`, under protocol.md §5 and §6's rules:
/// a message of a held conversation, a request started or joined, or a
/// refusal that changes nothing (a duplicate, a deleted conversation's, a
/// stranger's first message without its work or proofs, a join past its
/// request's share or the bounds, `request_full`, a forgery). `too_far_ahead`
/// is said only of a session message of a held conversation that
/// authenticates and whose envelope checks (§16.4): a forgery past the bound
/// is `decryption_failed`. A requests' record that doesn't read is refused.
pub fn receive(sk: impl Borrow<Scalar>, request: ReceiveRequest) -> Result<Answer<ReceiveResult>> {
    let key = secret_key(sk.borrow())?;
    let envelope = decode(&request.envelope, "the envelope")?;
    let handles = handles(&request.handles)?;
    let conversations = request
        .conversations
        .iter()
        .map(conversation)
        .collect::<Result<Vec<_>>>()?;
    let requests = match requests(request.requests.as_deref())? {
        Ok(requests) => requests,
        Err(error) => return Ok(refusal(error)),
    };
    let mut inbox = inbox(
        conversations,
        requests,
        tombstones(request.tombstones.as_deref())?,
    )?;
    if let Some(bits) = request.first_contact_bits {
        inbox.set_first_contact_bits(bits);
    }
    let received = match inbox.receive(&key, &handles, &envelope, request.now) {
        Ok(received) => received,
        Err(error) => return Ok(refusal(error)),
    };
    Ok(Answer::Done(match received {
        Received::Message { cid, plaintext } => {
            let plaintext = Zeroizing::new(plaintext);
            let held = inbox
                .conversation(cid)
                .expect("a message's conversation is held");
            ReceiveResult {
                received: ReceivedView::Message {
                    cid: cid_hex(cid),
                    plaintext: Secret::of(&plaintext),
                },
                conversation: Some(record_of(held)?),
                requests: None,
            }
        }
        Received::Request {
            cid,
            plaintext,
            new,
            evicted,
        } => {
            let plaintext = Zeroizing::new(plaintext);
            ReceiveResult {
                received: ReceivedView::Request {
                    cid: cid_hex(cid),
                    plaintext: Secret::of(&plaintext),
                    new,
                    evicted: evicted.into_iter().map(cid_hex).collect(),
                },
                conversation: None,
                requests: Some(hex::encode(inbox.requests().to_bytes())),
            }
        }
    }))
}

// ---------------------------------------------------------------------------
// Starting, the first-contact stamp, and sending
// ---------------------------------------------------------------------------

/// [`start`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    /// The Seedelf's register, as the chain read gives it.
    pub handle: RegisterHex,
    /// The Seedelf's asset name, hex: 1 to 32 bytes.
    pub to: String,
    /// The writer's clock, Unix seconds: the conversation's `t`.
    pub now: u64,
}

/// A new conversation, before its first-contact stamp.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    /// The conversation ID.
    pub cid: String,
    /// Its record.
    pub conversation: Secret,
    /// What its stamp's work is over: solve it with [`find_stamp`] at
    /// [`FIRST_CONTACT_STAMP_BITS`], in slices, then [`set_stamp`].
    pub digest: String,
}

fn started(conversation: &Conversation) -> Result<Started> {
    Ok(Started {
        cid: cid_hex(conversation.cid()),
        conversation: record_of(conversation)?,
        digest: hex::encode(conversation.stamp_digest()),
    })
}

/// Starts a conversation with a Seedelf's owner (protocol.md §3): both
/// identities, F with its proof, the session key and the sending chain. A
/// register that isn't valid, a `to` that isn't 1 to 32 bytes and a
/// register of `sk`'s own are refused.
pub fn start(sk: impl Borrow<Scalar>, request: StartRequest) -> Result<Answer<Started>> {
    let key = secret_key(sk.borrow())?;
    let to = decode(&request.to, "`to`")?;
    let handle = match request.handle.read("the handle")? {
        Ok(handle) => handle,
        Err(error) => return Ok(answer(Err(error))),
    };
    match Conversation::start(&key, &handle, &to, request.now) {
        Ok(conversation) => Ok(Answer::Done(started(&conversation)?)),
        Err(error) => Ok(refusal(error)),
    }
}

/// [`start_continuing`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContinueRequest {
    /// The record of the conversation the new one continues.
    pub conversation: Secret,
    /// The writer's clock, Unix seconds: the new conversation's `t`.
    pub now: u64,
}

/// Starts a conversation continuing an old one, with its identities and no
/// `to` (protocol.md §6). Either side can. The old record is unchanged.
pub fn start_continuing(
    sk: impl Borrow<Scalar>,
    request: ContinueRequest,
) -> Result<Answer<Started>> {
    let key = secret_key(sk.borrow())?;
    let old = conversation(&request.conversation)?;
    match Conversation::start_continuing(&key, &old, request.now) {
        Ok(conversation) => Ok(Answer::Done(started(&conversation)?)),
        Err(error) => Ok(refusal(error)),
    }
}

/// [`set_stamp`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetStampRequest {
    /// The conversation's record.
    pub conversation: Secret,
    /// The nonce [`find_stamp`] found.
    pub nonce: u64,
}

/// A conversation with its stamp set.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stamped {
    /// Its new record.
    pub conversation: Secret,
    /// The work the nonce shows. Readers ask [`FIRST_CONTACT_STAMP_BITS`];
    /// this doesn't refuse less.
    pub bits: u32,
}

/// Sets the first-contact stamp every first-contact message carries. Only
/// the initiator sends them.
pub fn set_stamp(request: SetStampRequest) -> Result<Answer<Stamped>> {
    let mut held = conversation(&request.conversation)?;
    if let Err(error) = held.set_stamp(request.nonce) {
        return Ok(answer(Err(error)));
    }
    let bits = held.stamp().map_or(0, |(_, bits)| bits);
    Ok(Answer::Done(Stamped {
        conversation: record_of(&held)?,
        bits,
    }))
}

/// [`send`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    /// The conversation's record.
    pub conversation: Secret,
    /// The text, hex.
    pub plaintext: Secret,
}

/// A message sealed in its envelope, and the state after it.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    /// The new record, to store with the envelope before posting it
    /// (protocol.md §4.2).
    pub conversation: Secret,
    /// The envelope: 2,048, 8,192 or 32,768 bytes, the size its text would
    /// take as a first-contact message (protocol.md §9). Never 512 bytes,
    /// which a reader still takes.
    pub envelope: String,
}

/// The next message of a conversation, sealed in its envelope: a
/// first-contact message until the initiator has a reply. Every message,
/// either side's, before a reply and after one, is padded to the envelope
/// its text would take as a first-contact message, so a reply taken changes
/// no size, and a text whose first-contact form doesn't fit 32 KiB is
/// refused, `message_too_large` (protocol.md §9). No key: the record holds
/// the chain. Before a reply, the writer's share is 16
/// first-contact messages and 64 KiB of them (protocol.md §3.1,
/// [`ConversationInfo::first_contact_left`]): one past it is refused,
/// `request_full`, before the chain moves.
pub fn send(request: SendRequest) -> Result<Answer<Sent>> {
    let mut held = conversation(&request.conversation)?;
    let plaintext = request.plaintext.bytes("the text")?;
    let envelope = match held.send(&plaintext) {
        Ok(envelope) => envelope,
        Err(error) => return Ok(refusal(error)),
    };
    Ok(Answer::Done(Sent {
        conversation: record_of(&held)?,
        envelope: hex::encode(envelope),
    }))
}

// ---------------------------------------------------------------------------
// The verified reveal (protocol.md §19)
// ---------------------------------------------------------------------------

/// [`reveal`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RevealRequest {
    /// The conversation's record: its initiator's, once a reply has come.
    pub conversation: Secret,
    /// The Seedelf's asset name, hex: 1 to 32 bytes.
    pub name: String,
    /// The Seedelf's register now, as the chain read gives it.
    pub register: RegisterHex,
}

/// A reveal, to send as a message of its own kind (protocol.md §18).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Revealed {
    /// The reveal's bytes, hex (§19.3), without the kind byte.
    pub reveal: String,
}

/// Shows the other side of a conversation which Seedelf `sk` holds
/// (protocol.md §19): a proof only that side can check, bound to the
/// conversation. Only its initiator, once a reply has come
/// (`reveal_not_allowed`); the Seedelf's register must be `sk`'s, as the
/// conversation's own identity must (`not_for_this_key`). The record is
/// unchanged: the wallet then sends the reveal with [`send`].
pub fn reveal(sk: impl Borrow<Scalar>, request: RevealRequest) -> Result<Answer<Revealed>> {
    let key = secret_key(sk.borrow())?;
    let held = conversation(&request.conversation)?;
    let name = decode(&request.name, "the Seedelf's name")?;
    let seedelf = match request
        .register
        .read("the Seedelf's register")?
        .and_then(|register| Handle::new(&name, register))
    {
        Ok(seedelf) => seedelf,
        Err(error) => return Ok(answer(Err(error))),
    };
    Ok(answer(held.reveal(&key, &seedelf).map(|reveal| Revealed {
        reveal: hex::encode(reveal.to_bytes()),
    })))
}

/// [`check_reveal`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckRevealRequest {
    /// The conversation's record, as it stands after the message that
    /// carried the reveal.
    pub conversation: Secret,
    /// The reveal's bytes, hex: the message's plaintext after its kind byte.
    pub reveal: String,
}

/// A reveal whose proof verifies, and what the wallet then checks against
/// the chain: that the name's register is this one now (protocol.md §19.4).
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevealChecked {
    /// The Seedelf's asset name, hex.
    pub name: String,
    /// The register the proof is for.
    pub register: RegisterHex,
}

/// Checks a reveal the other side of a conversation sent (protocol.md
/// §19.4's steps 2 and 3): it parses, and its proof verifies for the
/// conversation. Only its responder checks one (`reveal_not_allowed`); one
/// that doesn't parse or verify is refused. Nothing changes. Bytes that
/// aren't hex throw.
pub fn check_reveal(request: CheckRevealRequest) -> Result<Answer<RevealChecked>> {
    let held = conversation(&request.conversation)?;
    let bytes = decode(&request.reveal, "the reveal")?;
    Ok(answer(Reveal::from_bytes(&bytes).and_then(|reveal| {
        held.verify_reveal(&reveal)?;
        Ok(RevealChecked {
            name: hex::encode(reveal.name()),
            register: RegisterHex {
                generator: hex::encode(reveal.register().generator_bytes()),
                public_value: hex::encode(reveal.register().public_value_bytes()),
            },
        })
    })))
}

// ---------------------------------------------------------------------------
// Requests, deleting and expiring
// ---------------------------------------------------------------------------

/// [`accept`]'s and [`read_request`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RequestOf {
    /// The requests' record.
    pub requests: String,
    /// The request's conversation ID.
    pub cid: String,
}

/// What a `replaces` amounts to (protocol.md §6).
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContinuesView {
    /// The conversation it names.
    pub cid: String,
    /// Whether it has that conversation's identities: then it continues it.
    /// Otherwise it only says so.
    pub verified: bool,
}

fn continues_view(continues: Option<Continues>) -> Option<ContinuesView> {
    continues.map(|c| match c {
        Continues::Verified(cid) => ContinuesView {
            cid: cid_hex(cid),
            verified: true,
        },
        Continues::Unverified(cid) => ContinuesView {
            cid: cid_hex(cid),
            verified: false,
        },
    })
}

/// A request accepted: a conversation the reader can reply in.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Accepted {
    /// The conversation's record. The reply is [`send`].
    pub conversation: Secret,
    /// The requests' new record, without it.
    pub requests: String,
    /// What its `replaces` amounted to when it arrived, which the
    /// conversation's record doesn't keep: the wallet keeps the label.
    pub continues: Option<ContinuesView>,
}

/// Replies to a request: builds its conversation from F and its messages,
/// each as it arrived (protocol.md §3.1). [`send`] then sends the reply. A
/// requests' record that doesn't read is refused.
pub fn accept(sk: impl Borrow<Scalar>, request: RequestOf) -> Result<Answer<Accepted>> {
    let key = secret_key(sk.borrow())?;
    let cid = cid_of(&request.cid)?;
    let requests = match requests(Some(&request.requests))? {
        Ok(requests) => requests,
        Err(error) => return Ok(refusal(error)),
    };
    let mut inbox = inbox(Vec::new(), requests, Tombstones::new())?;
    let continues = inbox.requests().get(cid).and_then(|r| r.continues());
    if let Err(error) = inbox.accept(&key, cid) {
        return Ok(refusal(error));
    }
    let held = inbox.conversation(cid).expect("an accepted request's");
    Ok(Answer::Done(Accepted {
        conversation: record_of(held)?,
        requests: hex::encode(inbox.requests().to_bytes()),
        continues: continues_view(continues),
    }))
}

/// A request's text, or why one of its messages doesn't read.
#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum RequestText {
    /// A message's text.
    Read {
        /// When it arrived, by the reader's clock.
        at: u64,
        /// The text.
        plaintext: Secret,
    },
    /// A message that doesn't read now.
    Refused {
        /// When it arrived.
        at: u64,
        /// [`code`].
        refused: &'static str,
    },
}

/// A request's texts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RequestTexts {
    /// In the order they arrived.
    pub messages: Vec<RequestText>,
}

/// A request's messages, decrypted in memory to show them, as the reply
/// would read them. Nothing changes: the record keeps only what arrived. A
/// requests' record that doesn't read is refused.
pub fn read_request(sk: impl Borrow<Scalar>, request: RequestOf) -> Result<Answer<RequestTexts>> {
    let key = secret_key(sk.borrow())?;
    let cid = cid_of(&request.cid)?;
    let requests = match requests(Some(&request.requests))? {
        Ok(requests) => requests,
        Err(error) => return Ok(refusal(error)),
    };
    let Some(held) = requests.get(cid) else {
        return Ok(refusal(Error::UnknownConversation));
    };
    let texts = match held.read(&key) {
        Ok(texts) => texts,
        Err(error) => return Ok(refusal(error)),
    };
    let messages = held
        .arrivals()
        .zip(texts)
        .map(|(at, text)| match text {
            Ok(plaintext) => {
                let plaintext = Zeroizing::new(plaintext);
                RequestText::Read {
                    at,
                    plaintext: Secret::of(&plaintext),
                }
            }
            Err(error) => RequestText::Refused {
                at,
                refused: code(error),
            },
        })
        .collect();
    Ok(Answer::Done(RequestTexts { messages }))
}

/// [`delete`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    /// The conversation or request to delete.
    pub cid: String,
    /// The conversation's record, to delete a conversation. One the crate
    /// doesn't read is taken as absent.
    #[serde(default)]
    pub conversation: Option<Secret>,
    /// The requests' record.
    #[serde(default)]
    pub requests: Option<String>,
    /// The tombstones' record.
    #[serde(default)]
    pub tombstones: Option<String>,
}

/// After a deletion.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Deleted {
    /// Whether there was one: then the wallet deletes the conversation's
    /// record, if it passed it. A record that doesn't read was none here,
    /// and the wallet deletes it all the same.
    pub deleted: bool,
    /// The requests' new record.
    pub requests: String,
    /// The tombstones' new record, holding its ID until its `t` + 48 hours
    /// and 7 days more, whatever the clock meanwhile.
    pub tombstones: String,
}

/// Deletes a conversation or a request, keeping its ID as a tombstone
/// (protocol.md §5, rule 3). A conversation's record the crate doesn't read
/// (a development build's, a later version's, or damaged) is taken as
/// absent: nothing of it is deleted here, and so no tombstone holds its ID,
/// whose `t` it doesn't give. A requests' record that doesn't read is
/// refused.
pub fn delete(request: DeleteRequest) -> Result<Answer<Deleted>> {
    let cid = cid_of(&request.cid)?;
    let conversations = match &request.conversation {
        None => Vec::new(),
        Some(record) => Conversation::from_bytes(&record.bytes("a conversation's record")?)
            .ok()
            .into_iter()
            .collect(),
    };
    let requests = match requests(request.requests.as_deref())? {
        Ok(requests) => requests,
        Err(error) => return Ok(refusal(error)),
    };
    let mut inbox = inbox(
        conversations,
        requests,
        tombstones(request.tombstones.as_deref())?,
    )?;
    let deleted = inbox.delete(cid);
    Ok(Answer::Done(Deleted {
        deleted,
        requests: hex::encode(inbox.requests().to_bytes()),
        tombstones: hex::encode(inbox.tombstones().to_bytes()),
    }))
}

/// [`expire`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExpireRequest {
    /// The reader's clock, Unix seconds.
    pub now: u64,
    /// A conversation's record, to delete its skipped keys past 48 hours.
    #[serde(default)]
    pub conversation: Option<Secret>,
    /// The tombstones' record, to delete those past their `t` + 48 hours
    /// and 7 days.
    #[serde(default)]
    pub tombstones: Option<String>,
}

/// The records after expiring, each one given.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Expired {
    /// The conversation's new record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<Secret>,
    /// The tombstones' new record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tombstones: Option<String>,
}

/// Deletes what has had its time: a conversation's skipped keys past their
/// 48 hours, whose messages then count as missing, and tombstones past their
/// `t` + 48 hours and 7 days (the margin covers a clock that ran ahead for an
/// expiry and was then set right: protocol.md §16.4).
pub fn expire(request: ExpireRequest) -> Result<Expired> {
    let conversation = match &request.conversation {
        None => None,
        Some(record) => {
            let mut held = conversation(record)?;
            held.expire(request.now);
            Some(record_of(&held)?)
        }
    };
    let tombstones = match request.tombstones.as_deref() {
        None => None,
        Some(hex) => {
            let mut held = tombstones(Some(hex))?;
            held.expire(request.now);
            Some(hex::encode(held.to_bytes()))
        }
    };
    Ok(Expired {
        conversation,
        tombstones,
    })
}

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

/// A conversation's stamp.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StampView {
    /// The nonce.
    pub nonce: u64,
    /// The work it shows.
    pub bits: u32,
}

/// A conversation, without its secrets.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationInfo {
    /// The conversation ID.
    pub cid: String,
    /// `initiator`, who wrote first, or `responder`.
    pub role: &'static str,
    /// F's `t`.
    pub t: u64,
    /// F's `to`, hex: the handle written to, empty for a continuation.
    pub to: String,
    /// The conversation F says it continues.
    pub replaces: Option<String>,
    /// Whether the next message is a first-contact message: the initiator,
    /// until a reply has decrypted.
    pub sends_first_contact: bool,
    /// The initiator's stamp, once set.
    pub stamp: Option<StampView>,
    /// Messages missing so far (protocol.md §6): never "expired".
    pub missing: u64,
    /// Messages sent in the current sending chain.
    pub sent_in_chain: u32,
    /// The longest text the next message can carry, in bytes: the largest
    /// envelope's room for it as a first-contact message of this
    /// conversation, which every message is padded as (protocol.md §9),
    /// before a reply and after one, at either side: 32,768 − 145 − 1 −
    /// (F + 97), 31,987 to 32,243. And, before a reply, what's left of the
    /// share's; 0 once that's used up.
    pub max_text_len: usize,
    /// What's left of the writer's share while this side sends first-contact
    /// messages, the initiator until a reply decrypts (protocol.md §3.1);
    /// null after that, and always at the responder.
    pub first_contact_left: Option<ShareLeft>,
}

/// What's left of a request's share: what its reader keeps, and its writer
/// sends, before a reply. Each first-contact message takes one of
/// `messages`, and its text's length (its kind byte included) and
/// `per_message` more of `bytes`.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShareLeft {
    /// First-contact messages left, of [`Constants::max_request_messages`].
    pub messages: u32,
    /// Bytes of their inner messages left, of
    /// [`Constants::max_one_request_bytes`]: not text room.
    pub bytes: usize,
    /// What each first-contact message takes beside its text: its type, F,
    /// the stamp, the ratchet header, and the ratchet ciphertext's salt and
    /// tag. F's length and 97.
    pub per_message: usize,
}

/// A conversation's record, read without its secrets.
pub fn conversation_info(record: &Secret) -> Result<ConversationInfo> {
    let held = conversation(record)?;
    let first = held.first_contact();
    let per_message = 1 + first.len() + STAMP_LEN + RATCHET_HEADER_LEN + RATCHET_OVERHEAD;
    Ok(ConversationInfo {
        cid: cid_hex(held.cid()),
        role: match held.role() {
            Role::Initiator => "initiator",
            Role::Responder => "responder",
        },
        t: first.started_at(),
        to: hex::encode(first.to()),
        replaces: first.replaces().map(cid_hex),
        sends_first_contact: held.sends_first_contact(),
        stamp: held.stamp().map(|(nonce, bits)| StampView { nonce, bits }),
        missing: held.missing(),
        sent_in_chain: held.sent_in_chain(),
        max_text_len: held.max_text_len(),
        first_contact_left: held
            .first_contact_left()
            .map(|(messages, bytes)| ShareLeft {
                messages,
                bytes,
                per_message,
            }),
    })
}

/// A request, without its texts.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestInfo {
    /// The conversation ID.
    pub cid: String,
    /// F's `t`.
    pub t: u64,
    /// F's `to`, hex: which of the reader's handles it was written to,
    /// verified by its proof; empty for a continuation.
    pub to: String,
    /// What its `replaces` amounts to, judged when it arrived.
    pub continues: Option<ContinuesView>,
    /// When each message arrived, in order.
    pub arrivals: Vec<u64>,
    /// Its stored bytes, as counted against its share of 64 KiB and the
    /// bound of 256 KiB in all.
    pub bytes: usize,
}

/// The requests, oldest first, without their texts. A record that doesn't
/// read is refused.
pub fn requests_info(record: &str) -> Result<Answer<Vec<RequestInfo>>> {
    let requests = match requests(Some(record))? {
        Ok(requests) => requests,
        Err(error) => return Ok(refusal(error)),
    };
    Ok(Answer::Done(
        requests
            .iter()
            .map(|request| {
                let first = request.first_contact();
                RequestInfo {
                    cid: cid_hex(request.cid()),
                    t: first.started_at(),
                    to: hex::encode(first.to()),
                    continues: continues_view(request.continues()),
                    arrivals: request.arrivals().collect(),
                    bytes: request.stored_len(),
                }
            })
            .collect(),
    ))
}

// ---------------------------------------------------------------------------
// Proof of work and the relay
// ---------------------------------------------------------------------------

/// [`find_stamp`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FindStampRequest {
    /// The digest: a conversation's ([`Started::digest`]) or a post's
    /// ([`relay_digest`]).
    pub digest: String,
    /// The work to find: [`FIRST_CONTACT_STAMP_BITS`], or the relay's price.
    pub bits: u32,
    /// The first nonce of the slice.
    pub from: u64,
    /// How many nonces to try.
    pub attempts: u64,
}

/// One slice's outcome.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// The first nonce in the slice with the work, or null: then the next
    /// slice starts at `from + attempts`.
    pub nonce: Option<u64>,
}

/// One slice of a stamp's search, so the worker yields between slices:
/// each attempt is one SHA-256 block, and `bits` takes 2^bits attempts on
/// average. Past [`MAX_STAMP_BITS`] it's refused.
pub fn find_stamp(request: FindStampRequest) -> Result<Answer<Found>> {
    let digest: [u8; 32] = decode(&request.digest, "the digest")?
        .try_into()
        .map_err(|_| anyhow!("a digest is 32 bytes"))?;
    if request.bits > MAX_STAMP_BITS {
        return Ok(answer(Err(Error::StampTooHard)));
    }
    Ok(Answer::Done(Found {
        nonce: relay::find_stamp(&digest, request.bits, request.from, request.attempts),
    }))
}

/// What a post's stamp is over: the envelope and the pool it's posted to,
/// `mainnet` or `preprod` (protocol.md §17.3).
pub fn relay_digest(pool: &str, envelope: &str) -> Result<String> {
    let envelope = decode(envelope, "the envelope")?;
    relay::stamp_digest(pool, &envelope)
        .map(hex::encode)
        .map_err(|_| anyhow!("a pool's name is at most 255 bytes"))
}

/// [`post_body`]'s request.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PostRequest {
    /// The stamp's nonce.
    pub nonce: u64,
    /// The envelope.
    pub envelope: String,
}

/// The bytes to post: `nonce (8, big-endian) ‖ envelope` (protocol.md §17.2).
pub fn post_body(request: PostRequest) -> Result<Vec<u8>> {
    Ok(relay::post_body(
        request.nonce,
        &decode(&request.envelope, "the envelope")?,
    ))
}

/// The numbers the worker works by, so it holds no copy of them.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Constants {
    /// The work a first-contact stamp must show.
    pub first_contact_stamp_bits: u32,
    /// The most work [`find_stamp`] takes on.
    pub max_stamp_bits: u32,
    /// Every session envelope is one of these.
    pub envelope_sizes: [usize; 4],
    /// A first message is read until its `t` is this old, in seconds.
    pub first_contact_max_age: u64,
    /// ... and from when its `t` is at most this far ahead.
    pub first_contact_max_ahead: u64,
    /// A skipped key's life, in seconds.
    pub skipped_key_lifetime: u64,
    /// The most requests kept per network.
    pub max_requests: usize,
    /// The most bytes of requests kept per network.
    pub max_request_bytes: usize,
    /// A request's share, in first-contact messages: the most its writer
    /// sends, and its reader keeps, before a reply.
    pub max_request_messages: usize,
    /// A request's share, in bytes of those messages' inner messages.
    pub max_one_request_bytes: usize,
    /// The most keys a message past the skipped keys' bound is stepped, to
    /// learn whether it authenticates: past it, a message is refused as a
    /// forgery is, never `too_far_ahead`.
    pub max_auth_steps: u32,
    /// The most work the wallet solves for a post, in bits.
    pub price_ceiling_bits: u32,
    /// The version of the requests' record this build writes: one a refusal
    /// names below it is a development build's, above it a later version's.
    pub requests_version: u8,
}

/// [`Constants`].
pub fn constants() -> Constants {
    Constants {
        first_contact_stamp_bits: FIRST_CONTACT_STAMP_BITS,
        max_stamp_bits: MAX_STAMP_BITS,
        envelope_sizes: ENVELOPE_SIZES,
        first_contact_max_age: FIRST_CONTACT_MAX_AGE,
        first_contact_max_ahead: FIRST_CONTACT_MAX_AHEAD,
        skipped_key_lifetime: SKIPPED_KEY_LIFETIME,
        max_requests: MAX_REQUESTS,
        max_request_bytes: MAX_REQUEST_BYTES,
        max_request_messages: MAX_REQUEST_MESSAGES,
        max_one_request_bytes: MAX_ONE_REQUEST_BYTES,
        max_auth_steps: MAX_AUTH_STEPS,
        price_ceiling_bits: PRICE_CEILING_BITS,
        requests_version: REQUESTS_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::Secret;

    /// A secret's hex (a conversation's record, a message's text) is decoded
    /// into one buffer of exactly its length, so no buffer a growing Vec
    /// left behind holds an unwiped prefix of it (the 1.10.0 gate's wasm#5):
    /// 100 bytes, which a Vec doubling from 8 would hold in 128. Either case
    /// of hex reads; an odd length or a digit that isn't hex is an error.
    #[test]
    fn a_secret_is_decoded_into_one_buffer_of_its_length() {
        let bytes: Vec<u8> = (0..100).collect();
        let decoded = Secret::of(&bytes).bytes("a test's secret").unwrap();
        assert_eq!(*decoded, bytes);
        assert_eq!(decoded.capacity(), bytes.len());
        let upper = Secret::from(hex::encode_upper(&bytes));
        assert_eq!(*upper.bytes("a test's secret").unwrap(), bytes);
        assert!(Secret::of(&[]).bytes("a test's secret").unwrap().is_empty());
        for bad in ["abc", "0g", "zz00"] {
            let error = Secret::from(bad.to_string()).bytes("a test's secret");
            assert!(
                error
                    .unwrap_err()
                    .to_string()
                    .starts_with("a test's secret isn't hex"),
                "{bad}"
            );
        }
    }
}
