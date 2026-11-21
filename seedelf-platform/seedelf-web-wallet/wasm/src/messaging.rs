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
//! crate's [`Error`] ([`code`]). A request that doesn't parse, bytes that
//! aren't hex, or a stored record that doesn't read is an error, thrown: the
//! worker's mistake, or a record that isn't this wallet's.
//!
//! **Receiving is two calls.** [`open`] says which conversation an envelope
//! is for, and nothing secret; [`receive`] then takes that conversation's
//! record, and the one its `replaces` names, with the requests and the
//! tombstones. Only an envelope the scan matched is ever opened, so the
//! second opening costs only matches.

use std::fmt;

use anyhow::{Result, anyhow};
use blstrs::Scalar;
use seedelf_messaging::relay::{self, MAX_STAMP_BITS};
use seedelf_messaging::session::{
    Continues, Conversation, ConversationId, ENVELOPE_SIZES, FIRST_CONTACT_MAX_AGE,
    FIRST_CONTACT_MAX_AHEAD, FIRST_CONTACT_STAMP_BITS, Handle, Inbox, MAX_REQUEST_BYTES,
    MAX_REQUESTS, Received, Requests, Role, SKIPPED_KEY_LIFETIME, Tombstones,
};
use seedelf_messaging::{Error, POINT_LEN, Register, SecretKey, matches_envelope};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

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

    fn bytes(&self, what: &str) -> Result<Zeroizing<Vec<u8>>> {
        hex::decode(&self.0)
            .map(Zeroizing::new)
            .map_err(|e| anyhow!("{what} isn't hex: {e}"))
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
            Answer::Refused { refused } => Some(refused),
        }
    }
}

fn answer<T>(result: Result<T, Error>) -> Answer<T> {
    match result {
        Ok(value) => Answer::Done(value),
        Err(error) => Answer::Refused {
            refused: code(error),
        },
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
        Error::WrongEnvelopeRegister => "wrong_envelope_register",
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
    /// Every register it's known to have held.
    pub registers: Vec<RegisterHex>,
}

/// The crate's handles, one for each register. The wallet's own registers
/// are its to pass: one that doesn't read throws.
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

fn secret_key(sk: Scalar) -> Result<SecretKey> {
    SecretKey::from_scalar(sk).map_err(|e| anyhow!("the key: {e}"))
}

fn conversation(record: &Secret) -> Result<Conversation> {
    Conversation::from_bytes(&record.bytes("a conversation's record")?)
        .map_err(|e| anyhow!("a conversation's record doesn't read: {e}"))
}

fn requests(record: Option<&str>) -> Result<Requests> {
    match record {
        None => Ok(Requests::new()),
        Some(hex) => Requests::from_bytes(&decode(hex, "the requests' record")?)
            .map_err(|e| anyhow!("the requests' record doesn't read: {e}")),
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

/// The indexes of the envelopes addressed to `sk` among `envelopes`, in
/// order: the scan of a relay page, one batch at a time (protocol.md §4.1).
/// An envelope that isn't a v1 envelope with valid `p` and `w` isn't the
/// reader's; only one that isn't hex throws.
pub fn scan(sk: Scalar, envelopes: &[String]) -> Result<Vec<usize>> {
    let key = secret_key(sk)?;
    let mut found = Vec::new();
    for (i, envelope) in envelopes.iter().enumerate() {
        let bytes = decode(envelope, "an envelope")?;
        if matches_envelope(&key, &bytes).unwrap_or(false) {
            found.push(i);
        }
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
pub fn open(sk: Scalar, envelope: &str) -> Result<Answer<Opened>> {
    let key = secret_key(sk)?;
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
        /// Requests the bounds pushed out, oldest first; possibly this one.
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
/// stranger's first message without its work or proof, a forgery).
pub fn receive(sk: Scalar, request: ReceiveRequest) -> Result<Answer<ReceiveResult>> {
    let key = secret_key(sk)?;
    let envelope = decode(&request.envelope, "the envelope")?;
    let handles = handles(&request.handles)?;
    let conversations = request
        .conversations
        .iter()
        .map(conversation)
        .collect::<Result<Vec<_>>>()?;
    let mut inbox = inbox(
        conversations,
        requests(request.requests.as_deref())?,
        tombstones(request.tombstones.as_deref())?,
    )?;
    if let Some(bits) = request.first_contact_bits {
        inbox.set_first_contact_bits(bits);
    }
    let received = match inbox.receive(&key, &handles, &envelope, request.now) {
        Ok(received) => received,
        Err(error) => return Ok(answer(Err(error))),
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
                conversation: Some(Secret::of(&held.to_bytes())),
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

fn started(conversation: &Conversation) -> Started {
    Started {
        cid: cid_hex(conversation.cid()),
        conversation: Secret::of(&conversation.to_bytes()),
        digest: hex::encode(conversation.stamp_digest()),
    }
}

/// Starts a conversation with a Seedelf's owner (protocol.md §3): both
/// identities, F with its proof, the session key and the sending chain. A
/// register that isn't valid, a `to` that isn't 1 to 32 bytes and a
/// register of `sk`'s own are refused.
pub fn start(sk: Scalar, request: StartRequest) -> Result<Answer<Started>> {
    let key = secret_key(sk)?;
    let to = decode(&request.to, "`to`")?;
    let handle = match request.handle.read("the handle")? {
        Ok(handle) => handle,
        Err(error) => return Ok(answer(Err(error))),
    };
    Ok(answer(
        Conversation::start(&key, &handle, &to, request.now).map(|c| started(&c)),
    ))
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
pub fn start_continuing(sk: Scalar, request: ContinueRequest) -> Result<Answer<Started>> {
    let key = secret_key(sk)?;
    let old = conversation(&request.conversation)?;
    Ok(answer(
        Conversation::start_continuing(&key, &old, request.now).map(|c| started(&c)),
    ))
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
        conversation: Secret::of(&held.to_bytes()),
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
    /// The envelope: 512, 2,048, 8,192 or 32,768 bytes.
    pub envelope: String,
}

/// The next message of a conversation, sealed in its envelope: a
/// first-contact message until the initiator has a reply. No key: the
/// record holds the chain.
pub fn send(request: SendRequest) -> Result<Answer<Sent>> {
    let mut held = conversation(&request.conversation)?;
    let plaintext = request.plaintext.bytes("the text")?;
    let envelope = match held.send(&plaintext) {
        Ok(envelope) => envelope,
        Err(error) => return Ok(answer(Err(error))),
    };
    Ok(Answer::Done(Sent {
        conversation: Secret::of(&held.to_bytes()),
        envelope: hex::encode(envelope),
    }))
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
/// each as it arrived (protocol.md §3.1). [`send`] then sends the reply.
pub fn accept(sk: Scalar, request: RequestOf) -> Result<Answer<Accepted>> {
    let key = secret_key(sk)?;
    let cid = cid_of(&request.cid)?;
    let mut inbox = inbox(
        Vec::new(),
        requests(Some(&request.requests))?,
        Tombstones::new(),
    )?;
    let continues = inbox.requests().get(cid).and_then(|r| r.continues());
    if let Err(error) = inbox.accept(&key, cid) {
        return Ok(answer(Err(error)));
    }
    let held = inbox.conversation(cid).expect("an accepted request's");
    Ok(Answer::Done(Accepted {
        conversation: Secret::of(&held.to_bytes()),
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
/// would read them. Nothing changes: the record keeps only what arrived.
pub fn read_request(sk: Scalar, request: RequestOf) -> Result<Answer<RequestTexts>> {
    let key = secret_key(sk)?;
    let cid = cid_of(&request.cid)?;
    let requests = requests(Some(&request.requests))?;
    let Some(held) = requests.get(cid) else {
        return Ok(answer(Err(Error::UnknownConversation)));
    };
    let texts = match held.read(&key) {
        Ok(texts) => texts,
        Err(error) => return Ok(answer(Err(error))),
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
    /// The conversation's record, to delete a conversation.
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
    /// record, if it passed it.
    pub deleted: bool,
    /// The requests' new record.
    pub requests: String,
    /// The tombstones' new record, holding its ID until its `t` + 48 hours.
    pub tombstones: String,
}

/// Deletes a conversation or a request, keeping its ID as a tombstone
/// (protocol.md §5, rule 3).
pub fn delete(request: DeleteRequest) -> Result<Deleted> {
    let cid = cid_of(&request.cid)?;
    let conversations = request
        .conversation
        .as_ref()
        .map(conversation)
        .transpose()?
        .into_iter()
        .collect();
    let mut inbox = inbox(
        conversations,
        requests(request.requests.as_deref())?,
        tombstones(request.tombstones.as_deref())?,
    )?;
    let deleted = inbox.delete(cid);
    Ok(Deleted {
        deleted,
        requests: hex::encode(inbox.requests().to_bytes()),
        tombstones: hex::encode(inbox.tombstones().to_bytes()),
    })
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
    /// The tombstones' record, to delete those past their `t` + 48 hours.
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

/// Deletes what has had its 48 hours: a conversation's skipped keys, whose
/// messages then count as missing, and tombstones.
pub fn expire(request: ExpireRequest) -> Result<Expired> {
    let conversation = match &request.conversation {
        None => None,
        Some(record) => {
            let mut held = conversation(record)?;
            held.expire(request.now);
            Some(Secret::of(&held.to_bytes()))
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
    /// The longest text the next message can carry, in bytes.
    pub max_text_len: usize,
}

/// A conversation's record, read without its secrets.
pub fn conversation_info(record: &Secret) -> Result<ConversationInfo> {
    let held = conversation(record)?;
    let first = held.first_contact();
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
    /// Its stored bytes, as counted against the bound of 256 KiB in all.
    pub bytes: usize,
}

/// The requests, oldest first, without their texts.
pub fn requests_info(record: &str) -> Result<Vec<RequestInfo>> {
    Ok(requests(Some(record))?
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
        .collect())
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
    }
}
