//! Fixed randomness and small helpers for the session layer's unit tests.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use group::prime::PrimeCurveAffine;
use sha2::{Digest, Sha256};

use crate::SecretKey;
use crate::register::Register;
use crate::relay::find_stamp;
use crate::session::conversation::Conversation;
use crate::session::draw::Draw;
use crate::session::first_contact::Handle;
use crate::session::inbox::Inbox;
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

/// A reader's handles: each register under [`HANDLE_NAME`].
pub(crate) fn handles(registers: &[Register]) -> Vec<Handle> {
    registers
        .iter()
        .map(|register| Handle::new(HANDLE_NAME, *register).unwrap())
        .collect()
}

/// The handles of `key` among those the unit tests write to, under
/// [`HANDLE_NAME`]: what that reader passes.
pub(crate) fn own_handles(reader: &SecretKey) -> Vec<Handle> {
    let mut registers: Vec<Register> = [
        ("alice", "a"),
        ("alice", "alice's handle"),
        ("alice", "her handle"),
        ("bob", "b"),
        ("bob", "bob's handle"),
        ("bob", "h"),
        ("carol", "carol's handle"),
        ("mallory", "m"),
    ]
    .into_iter()
    .map(|(k, g)| handle(k, g))
    .collect();
    registers.extend(["alice", "bob", "carol", "dave"].map(|k| key(k).register()));
    registers.retain(|register| crate::matches_register(reader, register));
    handles(&registers)
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

/// Starts an inbox's conversation to `handle`, named [`HANDLE_NAME`], with
/// its stamp set.
pub(crate) fn inbox_start(
    inbox: &mut Inbox,
    key: &SecretKey,
    handle: &Register,
    now: u64,
) -> crate::session::ConversationId {
    let cid = inbox.start(key, handle, HANDLE_NAME, now).unwrap();
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
}

pub(crate) fn key(label: &str) -> SecretKey {
    SecretKey::from_scalar(test_scalar(label)).unwrap()
}

pub(crate) fn g() -> G1Projective {
    G1Projective::from(G1Affine::generator())
}

/// A handle as a Seedelf datum holds it: `([d]G, [x][d]G)`.
pub(crate) fn handle(key_label: &str, generator_label: &str) -> Register {
    let generator = g() * test_scalar(generator_label);
    let x = test_scalar(key_label);
    Register::from_checked(generator.to_affine(), (generator * x).to_affine())
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
