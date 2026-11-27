//! Seedelf Messaging's session layer: one-to-one conversations with the
//! Double Ratchet inside v1 envelopes (docs/protocol.md §3 to §6), and the
//! verified reveal of a Seedelf inside one (§19).
//!
//! Plain Rust with no network, no storage and no clock: the caller passes
//! `now`, in Unix seconds by the reader's clock, and stores the bytes each
//! state gives. Unaudited.
//!
//! ```
//! use seedelf_messaging::SecretKey;
//! use seedelf_messaging::relay::find_stamp;
//! use seedelf_messaging::session::{Certificate, Chain, Inbox, NETWORK_PREPROD, Received, Seedelf};
//!
//! // Each side's messaging key; Bob's Seedelf key holds his Seedelf.
//! let (alice, bob, bob_seedelf_key) = (SecretKey::generate(), SecretKey::generate(), SecretKey::generate());
//! let now = 1_800_000_000;
//! let chain = Chain::new(NETWORK_PREPROD, [0x84; 28])?;
//! // Bob's Seedelf, at his Seedelf key's register, and his certificate for
//! // it, as Alice reads it from the relay's list (protocol.md §21).
//! let bobs = Seedelf::new(chain, b"bob", bob_seedelf_key.register())?;
//! let posted = Certificate::make(&bob_seedelf_key, &bob, &bobs)?.to_bytes();
//! let certificate = Certificate::from_bytes(&chain, &posted)?;
//! assert!(certificate.is_for(&bobs));
//!
//! // Alice writes to it, after solving the first-contact stamp. Readers ask
//! // FIRST_CONTACT_STAMP_BITS; this example asks 8, to run fast.
//! let mut alice_inbox = Inbox::new();
//! let cid = alice_inbox.start(&alice, certificate.handle(), now)?;
//! let digest = alice_inbox.stamp_digest(cid)?;
//! alice_inbox.set_stamp(cid, find_stamp(&digest, 8, 0, u64::MAX).unwrap())?;
//! let envelope = alice_inbox.send(cid, b"hello Bob")?;
//!
//! // Bob's scan finds it; it's a request until he replies.
//! let mut bob_inbox = Inbox::new();
//! bob_inbox.set_first_contact_bits(8);
//! let handles = [bobs.handle(&bob)?];
//! let Received::Request { plaintext, .. } = bob_inbox.receive(&bob, &handles, &envelope, now)? else {
//!     unreachable!()
//! };
//! assert_eq!(plaintext, b"hello Bob");
//! bob_inbox.accept(&bob, cid)?;
//! let reply = bob_inbox.send(cid, b"hello")?;
//!
//! let received = alice_inbox.receive(&alice, &[], &reply, now + 60)?;
//! assert_eq!(received, Received::Message { cid, plaintext: b"hello".to_vec() });
//! # Ok::<(), seedelf_messaging::Error>(())
//! ```

mod certificate;
mod conversation;
mod draw;
mod first_contact;
mod inbox;
mod ratchet;
mod reveal;
mod secret;
mod seedelf;
mod wire;

#[cfg(test)]
mod tests;

pub use certificate::{
    CERTIFICATE_GENERATION, CERTIFICATE_MAX_LEN, CERTIFICATE_MIN_LEN, CERTIFICATE_PROOF_LEN,
    CERTIFICATE_VERSION, Certificate, WITHDRAWAL_LEN, WITHDRAWAL_VERSION, Withdrawal,
};
pub use conversation::{Conversation, Role, STATE_VERSION};
pub use first_contact::{
    BASE_PROOF_LEN, CID_LEN, ConversationId, FIRST_CONTACT_MAX_AGE, FIRST_CONTACT_MAX_AHEAD,
    FIRST_CONTACT_MAX_LEN, FIRST_CONTACT_MIN_LEN, FIRST_CONTACT_STAMP_BITS, FirstContact,
    MAX_TO_LEN, STAMP_LEN, within_window,
};
pub use inbox::{
    Continues, Inbox, MAX_ONE_REQUEST_BYTES, MAX_REQUEST_BYTES, MAX_REQUEST_MESSAGES, MAX_REQUESTS,
    REQUESTS_VERSION, Received, Request, Requests, TOMBSTONE_AFTER_START, TOMBSTONE_MARGIN,
    TOMBSTONES_VERSION, Tombstones,
};
pub use ratchet::{
    Header, MAX_AUTH_STEPS, MAX_SKIP, MAX_STORED_SKIPPED, RATCHET_HEADER_LEN, RATCHET_OVERHEAD,
    RATCHET_SALT_LEN, SKIPPED_KEY_LIFETIME,
};
pub use reveal::{REVEAL_MAX_LEN, REVEAL_MIN_LEN, REVEAL_PROOF_LEN, Reveal};
pub use seedelf::{
    Chain, HANDLE_BASE_DST, Handle, NETWORK_MAINNET, NETWORK_PREPROD, POLICY_LEN, Seedelf,
};
pub use wire::{
    ENVELOPE_SIZES, FIRST_CONTACT_TYPE, MAX_ENVELOPE_LEN, Opened, SESSION_OVERHEAD, SESSION_TYPE,
    inner_capacity, open,
};
