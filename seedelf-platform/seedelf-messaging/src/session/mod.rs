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
//! use seedelf_messaging::session::{Handle, Inbox, Received};
//!
//! let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
//! let now = 1_800_000_000;
//! // Bob's handle: a Seedelf's name and register (here his root register).
//! let bob_handle = Handle::new(b"bob", bob.register())?;
//!
//! // Alice writes to it, after solving the first-contact stamp. Readers ask
//! // FIRST_CONTACT_STAMP_BITS; this example asks 8, to run fast.
//! let mut alice_inbox = Inbox::new();
//! let cid = alice_inbox.start(&alice, bob_handle.register(), bob_handle.name(), now)?;
//! let digest = alice_inbox.stamp_digest(cid)?;
//! alice_inbox.set_stamp(cid, find_stamp(&digest, 8, 0, u64::MAX).unwrap())?;
//! let envelope = alice_inbox.send(cid, b"hello Bob")?;
//!
//! // Bob's scan finds it; it's a request until he replies.
//! let mut bob_inbox = Inbox::new();
//! bob_inbox.set_first_contact_bits(8);
//! let handles = [bob_handle];
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

mod conversation;
mod draw;
mod first_contact;
mod inbox;
mod ratchet;
mod reveal;
mod secret;
mod wire;

#[cfg(test)]
mod tests;

pub use conversation::{Conversation, Role, STATE_VERSION};
pub use first_contact::{
    BASE_PROOF_LEN, CID_LEN, ConversationId, FIRST_CONTACT_MAX_AGE, FIRST_CONTACT_MAX_AHEAD,
    FIRST_CONTACT_MAX_LEN, FIRST_CONTACT_MIN_LEN, FIRST_CONTACT_STAMP_BITS, FirstContact, Handle,
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
pub use wire::{
    ENVELOPE_SIZES, FIRST_CONTACT_TYPE, MAX_ENVELOPE_LEN, Opened, SESSION_OVERHEAD, SESSION_TYPE,
    inner_capacity, open,
};
