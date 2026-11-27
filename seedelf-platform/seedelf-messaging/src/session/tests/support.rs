//! Fixed randomness and small helpers for the session layer's unit tests.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use group::prime::PrimeCurveAffine;
use sha2::{Digest, Sha256};

use crate::SecretKey;
use crate::register::Register;
use crate::relay::find_stamp;
use crate::session::certificate::Certificate;
use crate::session::conversation::Conversation;
use crate::session::draw::Draw;
use crate::session::inbox::Inbox;
use crate::session::seedelf::{Chain, Handle, NETWORK_PREPROD, POLICY_LEN, Seedelf};
use crate::session::wire::{Opened, open};

/// The stamp work the tests' readers ask: a few hundred attempts, where
/// readers ask 2²⁴.
pub(crate) const TEST_BITS: u32 = 8;

/// The asset name the tests' handles go by.
pub(crate) const HANDLE_NAME: &[u8] = b"5eed0e1f test handle";

/// An inbox that asks [`TEST_BITS`] of first messages' stamps.
pub(crate) fn test_inbox() -> Inbox {
    let mut inbox = Inbox::new();
    inbox.set_first_contact_bits(TEST_BITS);
    inbox
}

/// The Seedelf policy the tests' Seedelfs go by: variant 1's, the one the
/// wallet reads on either network (seedelf-core's `constants.rs`).
pub(crate) fn test_policy() -> [u8; POLICY_LEN] {
    hex::decode("84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255")
        .unwrap()
        .try_into()
        .unwrap()
}

/// The chain the tests' Seedelfs live on: preprod, under [`test_policy`].
pub(crate) fn test_chain() -> Chain {
    Chain::new(NETWORK_PREPROD, test_policy()).unwrap()
}

/// The Seedelf key x of the wallet whose messaging key is `key(label)`:
/// another key, as the wallet's two are (docs/protocol.md §21.2).
pub(crate) fn spend_key(label: &str) -> SecretKey {
    key(&format!("{label}'s seedelf key"))
}

/// The datum register of a Seedelf of `key_label`'s wallet: its Seedelf
/// key's, `([d]G, [x][d]G)` with d from `generator_label`, as a datum holds
/// it.
pub(crate) fn datum_register(key_label: &str, generator_label: &str) -> Register {
    let generator = g() * test_scalar(generator_label);
    let x = spend_key(key_label).scalar();
    Register::from_checked(generator.to_affine(), (generator * x).to_affine())
}

/// A Seedelf of `key_label`'s wallet named `name`, under [`test_chain`],
/// at its [`datum_register`].
pub(crate) fn seedelf_named(key_label: &str, generator_label: &str, name: &[u8]) -> Seedelf {
    Seedelf::new(
        test_chain(),
        name,
        datum_register(key_label, generator_label),
    )
    .unwrap()
}

/// `key_label`'s own handle of its Seedelf named `name`: M_S, with its
/// messaging key, never its Seedelf key.
pub(crate) fn handle_named(key_label: &str, generator_label: &str, name: &[u8]) -> Handle {
    seedelf_named(key_label, generator_label, name)
        .handle(&key(key_label))
        .unwrap()
}

/// `key_label`'s own handle of its Seedelf named [`HANDLE_NAME`] at the
/// register `generator_label` gives.
pub(crate) fn own_handle(key_label: &str, generator_label: &str) -> Handle {
    handle_named(key_label, generator_label, HANDLE_NAME)
}

/// The handle a writer takes for that Seedelf: its certificate's, made with
/// both of `key_label`'s keys and read back as the relay's list gives it.
pub(crate) fn certified(key_label: &str, generator_label: &str) -> Handle {
    let seedelf = seedelf_named(key_label, generator_label, HANDLE_NAME);
    let made = Certificate::make(&spend_key(key_label), &key(key_label), &seedelf).unwrap();
    let read = Certificate::from_bytes(&test_chain(), &made.to_bytes()).unwrap();
    assert!(read.is_for(&seedelf));
    read.handle().clone()
}

/// A reader's handles, each `(key, generator)` its [`own_handle`].
pub(crate) fn handles(labels: &[(&str, &str)]) -> Vec<Handle> {
    labels.iter().map(|(k, g)| own_handle(k, g)).collect()
}

/// Every handle the unit tests write to under [`HANDLE_NAME`], made once.
fn known_handles() -> &'static [Handle] {
    static KNOWN: std::sync::OnceLock<Vec<Handle>> = std::sync::OnceLock::new();
    KNOWN.get_or_init(|| {
        handles(&[
            ("alice", "a"),
            ("alice", "alice's handle"),
            ("alice", "her handle"),
            ("bob", "b"),
            ("bob", "bob's handle"),
            ("bob", "h"),
            ("carol", "carol's handle"),
            ("mallory", "m"),
        ])
    })
}

/// The handles of `key` among those the unit tests write to, under
/// [`HANDLE_NAME`]: what that reader passes.
pub(crate) fn own_handles(reader: &SecretKey) -> Vec<Handle> {
    known_handles()
        .iter()
        .filter(|handle| crate::matches_register(reader, handle.register()))
        .cloned()
        .collect()
}

/// Solves a conversation's first-contact stamp at [`TEST_BITS`] and sets it.
pub(crate) fn stamp(conversation: &mut Conversation) {
    let nonce = find_stamp(&conversation.stamp_digest(), TEST_BITS, 0, u64::MAX).unwrap();
    conversation.set_stamp(nonce).unwrap();
}

/// Starts a conversation to `handle`, named [`HANDLE_NAME`], with its stamp
/// set.
pub(crate) fn start(
    key: &SecretKey,
    handle: &Register,
    now: u64,
    draw: &mut dyn Draw,
) -> Conversation {
    let mut conversation = Conversation::start_with(key, handle, HANDLE_NAME, now, draw).unwrap();
    stamp(&mut conversation);
    conversation
}

/// Starts a conversation to `handle` through the public API, a writer's
/// handle from a certificate, with its stamp set.
pub(crate) fn start_to(key: &SecretKey, handle: &Handle, now: u64) -> Conversation {
    let mut conversation = Conversation::start(key, handle, now).unwrap();
    stamp(&mut conversation);
    conversation
}

/// Starts an inbox's conversation to `handle`, named [`HANDLE_NAME`], with
/// its stamp set.
pub(crate) fn inbox_start(
    inbox: &mut Inbox,
    key: &SecretKey,
    handle: &Register,
    now: u64,
) -> crate::session::ConversationId {
    let cid = inbox.start_on(key, handle, HANDLE_NAME, now).unwrap();
    let nonce = find_stamp(&inbox.stamp_digest(cid).unwrap(), TEST_BITS, 0, u64::MAX).unwrap();
    inbox.set_stamp(cid, nonce).unwrap();
    cid
}

/// A fixed scalar: SHA-256 of a label with its top two bits cleared, so it's
/// below the group order. Production scalars come from the OS alone.
pub(crate) fn test_scalar(label: &str) -> Scalar {
    let mut bytes: [u8; 32] = Sha256::digest(label.as_bytes()).into();
    bytes[0] &= 0x3f;
    Option::from(Scalar::from_bytes_be(&bytes)).expect("below the group order")
}

pub(crate) fn test_bytes16(label: &str) -> [u8; 16] {
    Sha256::digest(label.as_bytes())[..16].try_into().unwrap()
}

/// Draws derived from a label and a counter, each one logged, so a test can
/// replay them or name them in the vectors.
pub(crate) struct Seeded {
    pub(crate) label: String,
    count: u32,
    pub(crate) log: Vec<Vec<u8>>,
}

impl Seeded {
    pub(crate) fn new(label: &str) -> Self {
        Self {
            label: label.to_string(),
            count: 0,
            log: Vec::new(),
        }
    }

    /// The values drawn since the last call, oldest first.
    pub(crate) fn drain(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.log)
    }
}

impl Draw for Seeded {
    fn scalar(&mut self) -> Scalar {
        let scalar = test_scalar(&format!("{} scalar {}", self.label, self.count));
        self.count += 1;
        self.log.push(scalar.to_bytes_be().to_vec());
        scalar
    }

    fn bytes16(&mut self) -> [u8; 16] {
        let bytes = test_bytes16(&format!("{} bytes {}", self.label, self.count));
        self.count += 1;
        self.log.push(bytes.to_vec());
        bytes
    }

    fn bytes32(&mut self) -> [u8; 32] {
        let bytes: [u8; 32] =
            Sha256::digest(format!("{} bytes32 {}", self.label, self.count).as_bytes()).into();
        self.count += 1;
        self.log.push(bytes.to_vec());
        bytes
    }
}

/// A source that gives the same values every time, as one that fails or
/// repeats would: each scalar is `scalar`, each 32 bytes `aux`, and each 16
/// bytes `aux`'s first 16.
pub(crate) struct Stuck {
    pub(crate) scalar: Scalar,
    pub(crate) aux: [u8; 32],
}

impl Draw for Stuck {
    fn scalar(&mut self) -> Scalar {
        self.scalar
    }
    fn bytes16(&mut self) -> [u8; 16] {
        self.aux[..16].try_into().unwrap()
    }
    fn bytes32(&mut self) -> [u8; 32] {
        self.aux
    }
}

pub(crate) fn key(label: &str) -> SecretKey {
    SecretKey::from_scalar(test_scalar(label)).unwrap()
}

pub(crate) fn g() -> G1Projective {
    G1Projective::from(G1Affine::generator())
}

/// The messaging register M_S = (h_S, [x_m]h_S) of `key_label`'s
/// [`own_handle`]: what a writer writes to, and a register of the messaging
/// key `key(key_label)`.
pub(crate) fn handle(key_label: &str, generator_label: &str) -> Register {
    *own_handle(key_label, generator_label).register()
}

/// Opens an envelope with `key`, which must be its reader.
pub(crate) fn opened(key: &SecretKey, envelope: &[u8]) -> Opened {
    open(key, envelope).expect("addressed to this key")
}

/// A compressed encoding of `x`, with the compression flag set.
fn compressed_x(x: u64) -> [u8; 48] {
    let mut bytes = [0u8; 48];
    bytes[40..].copy_from_slice(&x.to_be_bytes());
    bytes[0] |= 0x80;
    bytes
}

/// A point on the curve outside the prime-order subgroup.
pub(crate) fn outside_g1() -> [u8; 48] {
    (1u64..)
        .map(compressed_x)
        .find(|bytes| {
            Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(bytes))
                .is_some_and(|p| bool::from(p.is_on_curve()) && !bool::from(p.is_torsion_free()))
        })
        .unwrap()
}

/// An x with no point on the curve.
pub(crate) fn off_curve() -> [u8; 48] {
    (1u64..)
        .map(compressed_x)
        .find(|bytes| {
            Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(bytes)).is_none()
        })
        .unwrap()
}

/// The identity, compressed.
pub(crate) fn identity() -> [u8; 48] {
    G1Affine::identity().to_compressed()
}

/// Advances a sending chain `k` messages without sending them: the chain key
/// steps with the counter, as if they were sent and lost.
pub(crate) fn skip_sends(conversation: &mut crate::session::conversation::Conversation, k: u32) {
    for _ in 0..k {
        conversation.ratchet.next_sending().unwrap();
    }
}
