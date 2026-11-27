//! What the two-key API refuses to compile (docs/protocol.md §21.3,
//! joint-security.md rule 1m): no API carries a base, so no caller makes
//! the messaging key answer on a point it chose. Compiled only for the
//! doctests (`cfg(doctest)`); tests/two_keys.rs holds the twin that
//! compiles, the same calls made as the API takes them.
//!
//! Stable rustdoc doesn't check a `compile_fail` block's error code, only
//! that it fails: a block that failed for another reason would pass too.
//! Each block's setup is the twin's, which compiles, and each code was
//! checked by compiling the same calls as a test (2026-11-26): the block
//! fails with that code and no other.
//!
//! A `Handle` has no public constructor, so its base is always the hash of
//! its Seedelf, which the crate computes:
//!
//! ```compile_fail,E0599
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::Handle;
//! let bob = SecretKey::generate();
//! let _ = Handle::new(b"bob", bob.register());
//! ```
//!
//! nor a struct literal, its fields being private,
//!
//! ```compile_fail,E0451
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::{Chain, Handle, NETWORK_PREPROD, Seedelf};
//! let bob = SecretKey::generate();
//! let chain = Chain::new(NETWORK_PREPROD, [0x84; 28]).unwrap();
//! let seedelf = Seedelf::new(chain, b"bob", bob.register()).unwrap();
//! let _ = Handle { seedelf, register: bob.register() };
//! ```
//!
//! and the crate's own constructor from a base and a value is the crate's:
//!
//! ```compile_fail,E0624
//! # use group::prime::PrimeCurveAffine;
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::{Chain, Handle, NETWORK_PREPROD, Seedelf};
//! let bob = SecretKey::generate();
//! let chain = Chain::new(NETWORK_PREPROD, [0x84; 28]).unwrap();
//! let seedelf = Seedelf::new(chain, b"bob", bob.register()).unwrap();
//! let g = blstrs::G1Affine::generator();
//! let _ = Handle::from_value(seedelf, g, g);
//! ```
//!
//! `Seedelf::handle` takes a key, never a base:
//!
//! ```compile_fail,E0061
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::{Chain, NETWORK_PREPROD, Seedelf};
//! let bob = SecretKey::generate();
//! let chain = Chain::new(NETWORK_PREPROD, [0x84; 28]).unwrap();
//! let seedelf = Seedelf::new(chain, b"bob", bob.register()).unwrap();
//! let base = bob.register();
//! let _ = seedelf.handle(&bob, &base);
//! ```
//!
//! `Conversation::start` takes a `Handle`: not a register and a name, as it
//! did before chunk 55,
//!
//! ```compile_fail,E0061
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::Conversation;
//! let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
//! let _ = Conversation::start(&alice, &bob.register(), b"bob", 1_800_000_000);
//! ```
//!
//! nor a register in a handle's place,
//!
//! ```compile_fail,E0308
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::Conversation;
//! let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
//! let _ = Conversation::start(&alice, &bob.register(), 1_800_000_000);
//! ```
//!
//! and nor does `Inbox::start`,
//!
//! ```compile_fail,E0308
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::Inbox;
//! let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
//! let _ = Inbox::new().start(&alice, &bob.register(), 1_800_000_000);
//! ```
//!
//! and the start on a bare register is the crate's tests' alone:
//!
//! ```compile_fail,E0599
//! # use seedelf_messaging::SecretKey;
//! # use seedelf_messaging::session::Conversation;
//! let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
//! let _ = Conversation::start_on(&alice, &bob.register(), b"bob", 1_800_000_000);
//! ```
//!
//! A reveal hands out no [`Handle`](crate::session::Handle): its messaging
//! value is uncertified, so it must never become something a writer starts
//! on (E0308).
//!
//! ```compile_fail,E0308
//! use seedelf_messaging::session::{Chain, Handle, NETWORK_PREPROD, Reveal};
//! let chain = Chain::new(NETWORK_PREPROD, [0x84; 28]).unwrap();
//! let reveal = Reveal::from_bytes(&chain, &[0u8; 274]).unwrap();
//! let _handle: &Handle = reveal.seedelf();
//! ```
