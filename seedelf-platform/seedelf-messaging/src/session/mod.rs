//! Seedelf Messaging's session layer: one-to-one conversations with the
//! Double Ratchet inside v1 envelopes (docs/protocol.md §3 to §6).
//!
//! Plain Rust with no network, no storage and no clock: the caller passes
//! `now`, in Unix seconds by the reader's clock, and stores the bytes each
//! state gives. Unaudited.
//!
//! ```
//! use seedelf_messaging::SecretKey;
//! use seedelf_messaging::session::{Inbox, Received};
//!
//! let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
//! let now = 1_800_000_000;
//!
//! // Alice writes to Bob's handle: here his root register.
//! let mut alice_inbox = Inbox::new();
//! let cid = alice_inbox.start(&alice, &bob.register(), b"", now)?;
//! let envelope = alice_inbox.send(cid, b"hello Bob")?;
//!
//! // Bob's scan finds it; it's a request until he replies.
//! let mut bob_inbox = Inbox::new();
//! let Received::Request { plaintext, .. } = bob_inbox.receive(&bob, &envelope, now)? else {
//!     unreachable!()
//! };
//! assert_eq!(plaintext, b"hello Bob");
//! bob_inbox.accept(&bob, cid)?;
//! let reply = bob_inbox.send(cid, b"hello")?;
//!
//! let received = alice_inbox.receive(&alice, &reply, now + 60)?;
//! assert_eq!(received, Received::Message { cid, plaintext: b"hello".to_vec() });
//! # Ok::<(), seedelf_messaging::Error>(())
//! ```

mod conversation;
mod draw;
mod first_contact;
mod inbox;
mod ratchet;
mod secret;
mod wire;

#[cfg(test)]
mod tests;

pub use conversation::{Conversation, Role, STATE_VERSION};
pub use first_contact::{
    CID_LEN, ConversationId, FIRST_CONTACT_MAX_AGE, FIRST_CONTACT_MAX_AHEAD, FIRST_CONTACT_MAX_LEN,
    FIRST_CONTACT_MIN_LEN, FirstContact, MAX_TO_LEN, within_window,
};
pub use inbox::{
    Continues, Inbox, MAX_REQUEST_BYTES, MAX_REQUESTS, RECORD_VERSION, Received, Request, Requests,
    TOMBSTONE_AFTER_START, Tombstones,
};
pub use ratchet::{
    Header, MAX_SKIP, MAX_STORED_SKIPPED, RATCHET_HEADER_LEN, RATCHET_OVERHEAD, RATCHET_SALT_LEN,
    SKIPPED_KEY_LIFETIME,
};
pub use wire::{
    ENVELOPE_SIZES, FIRST_CONTACT_TYPE, MAX_ENVELOPE_LEN, Opened, SESSION_OVERHEAD, SESSION_TYPE,
    inner_capacity, open,
};
