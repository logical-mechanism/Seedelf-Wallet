//! Property tests of the session layer through its public API: out-of-order
//! delivery, loss, duplicates and replays, storage at any point, both sides
//! writing first, a reset with `replaces`, and skipped keys past 48 hours.
//! Finite random testing shows the code does what docs/protocol.md says on
//! the schedules tried; it proves nothing about secrecy.

use std::collections::BTreeMap;

use proptest::prelude::*;

use seedelf_messaging::SecretKey;
use seedelf_messaging::session::{
    Continues, Conversation, ConversationId, Inbox, Received, Requests, SKIPPED_KEY_LIFETIME,
    Tombstones, open,
};

const T: u64 = 1_800_000_000;

fn config(cases: u32) -> ProptestConfig {
    ProptestConfig {
        cases,
        ..ProptestConfig::default()
    }
}

/// An envelope in flight, with what the test knows of it.
#[derive(Clone, Debug)]
struct Message {
    envelope: Vec<u8>,
    text: Vec<u8>,
    /// The sender's ratchet key in its header: the chain.
    chain: [u8; 48],
    n: u32,
}

/// One wallet in the driver.
struct Side {
    key: SecretKey,
    inbox: Inbox,
    /// Sent to this side, not yet delivered, in sending order.
    in_flight: Vec<Message>,
    delivered: Vec<Message>,
    /// The other side's sending chains, in the order it used them.
    their_chains: Vec<[u8; 48]>,
    sent_in: BTreeMap<[u8; 48], u32>,
}

impl Side {
    fn new(key: SecretKey) -> Self {
        Self {
            key,
            inbox: Inbox::new(),
            in_flight: Vec::new(),
            delivered: Vec::new(),
            their_chains: Vec::new(),
            sent_in: BTreeMap::new(),
        }
    }

    /// Rebuilds the inbox from its stored parts, as a restarted worker does.
    fn restore(&mut self) {
        let conversations = self
            .inbox
            .conversations()
            .map(|c| Conversation::from_bytes(&c.to_bytes()).unwrap())
            .collect();
        let requests = Requests::from_bytes(&self.inbox.requests().to_bytes()).unwrap();
        let tombstones = Tombstones::from_bytes(&self.inbox.tombstones().to_bytes()).unwrap();
        self.inbox = Inbox::from_parts(conversations, requests, tombstones).unwrap();
    }

    /// What `missing` must be once everything not lost has arrived: every
    /// key the reader derived and didn't use. Each chain before the latest
    /// one it saw was skipped to its end, by the next chain's PN; the latest
    /// up to the highest number it read.
    fn expected_missing(&self) -> u64 {
        let seen: Vec<_> = self
            .their_chains
            .iter()
            .filter(|chain| self.delivered.iter().any(|m| m.chain == **chain))
            .collect();
        let mut missing = 0u64;
        for (i, chain) in seen.iter().enumerate() {
            let read = self.delivered.iter().filter(|m| m.chain == **chain).count() as u64;
            let derived = if i + 1 < seen.len() {
                u64::from(self.sent_in[*chain])
            } else {
                self.delivered
                    .iter()
                    .filter(|m| m.chain == **chain)
                    .map(|m| u64::from(m.n) + 1)
                    .max()
                    .unwrap()
            };
            missing += derived - read;
        }
        missing
    }
}

/// Sends from `from` to `to` in conversation `cid`, and records it.
fn send(from: &mut Side, to: &mut Side, cid: ConversationId, text: Vec<u8>) {
    let envelope = from.inbox.send(cid, &text).unwrap();
    let header = *open(&to.key, &envelope).unwrap().header();
    let chain = header.ratchet_key_bytes();
    if !to.their_chains.contains(&chain) {
        to.their_chains.push(chain);
    }
    *to.sent_in.entry(chain).or_default() += 1;
    to.in_flight.push(Message {
        envelope,
        text,
        chain,
        n: header.number(),
    });
}

/// Delivers in-flight message `i` to `to`: it must read exactly its text.
fn deliver(to: &mut Side, cid: ConversationId, i: usize, now: u64) -> Result<(), TestCaseError> {
    let message = to.in_flight.remove(i);
    let received = to.inbox.receive(&to.key, &message.envelope, now);
    prop_assert_eq!(
        received,
        Ok(Received::Message {
            cid,
            plaintext: message.text.clone()
        })
    );
    to.delivered.push(message);
    Ok(())
}

/// Alice writes to Bob's handle; Bob accepts and replies; Alice reads it.
fn established() -> (Side, Side, ConversationId) {
    let (mut alice, mut bob) = (
        Side::new(SecretKey::generate()),
        Side::new(SecretKey::generate()),
    );
    let cid = alice
        .inbox
        .start(&alice.key, &bob.key.register(), b"", T)
        .unwrap();
    send(&mut alice, &mut bob, cid, b"first".to_vec());
    let first = bob.in_flight.remove(0);
    assert!(matches!(
        bob.inbox.receive(&bob.key, &first.envelope, T),
        Ok(Received::Request { .. })
    ));
    bob.delivered.push(first);
    bob.inbox.accept(&bob.key, cid).unwrap();
    send(&mut bob, &mut alice, cid, b"reply".to_vec());
    deliver(&mut alice, cid, 0, T).unwrap();
    (alice, bob, cid)
}

#[derive(Clone, Debug)]
enum Op {
    /// A message from Alice (true) or Bob.
    Send(bool),
    /// Deliver one in-flight message to Alice (true) or Bob, chosen by index.
    Deliver(bool, usize),
    /// Deliver an already delivered message again.
    Duplicate(bool, usize),
    /// Lose an in-flight message for good.
    Lose(bool, usize),
    /// Store and restore a side's inbox.
    Restore(bool),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => any::<bool>().prop_map(Op::Send),
        4 => (any::<bool>(), any::<usize>()).prop_map(|(a, i)| Op::Deliver(a, i)),
        1 => (any::<bool>(), any::<usize>()).prop_map(|(a, i)| Op::Duplicate(a, i)),
        1 => (any::<bool>(), any::<usize>()).prop_map(|(a, i)| Op::Lose(a, i)),
        1 => any::<bool>().prop_map(Op::Restore),
    ]
}

proptest! {
    #![proptest_config(config(48))]

    /// Any schedule of sends, out-of-order deliveries, duplicates, losses
    /// and restarts: each delivery reads exactly its text once, a duplicate
    /// changes nothing, and once the rest arrives, `missing` counts exactly
    /// the lost messages the reader had to skip.
    #[test]
    fn any_schedule_reads_each_message_once(ops in prop::collection::vec(op(), 1..60)) {
        let (mut alice, mut bob, cid) = established();
        let mut count = 0u32;
        for op in ops {
            match op {
                Op::Send(from_alice) => {
                    count += 1;
                    let text = format!("message {count}").into_bytes();
                    if from_alice {
                        send(&mut alice, &mut bob, cid, text);
                    } else {
                        send(&mut bob, &mut alice, cid, text);
                    }
                }
                Op::Deliver(to_alice, i) => {
                    let to = if to_alice { &mut alice } else { &mut bob };
                    if !to.in_flight.is_empty() {
                        let i = i % to.in_flight.len();
                        deliver(to, cid, i, T)?;
                    }
                }
                Op::Duplicate(to_alice, i) => {
                    let to = if to_alice { &mut alice } else { &mut bob };
                    if !to.delivered.is_empty() {
                        let message = to.delivered[i % to.delivered.len()].clone();
                        let before = to.inbox.conversation(cid).unwrap().to_bytes();
                        prop_assert!(to.inbox.receive(&to.key, &message.envelope, T).is_err());
                        prop_assert_eq!(&*to.inbox.conversation(cid).unwrap().to_bytes(), &*before);
                    }
                }
                Op::Lose(to_alice, i) => {
                    let to = if to_alice { &mut alice } else { &mut bob };
                    if !to.in_flight.is_empty() {
                        let i = i % to.in_flight.len();
                        to.in_flight.remove(i);
                    }
                }
                Op::Restore(alice_side) => {
                    if alice_side { alice.restore() } else { bob.restore() }
                }
            }
        }
        for side in [&mut alice, &mut bob] {
            while !side.in_flight.is_empty() {
                deliver(side, cid, 0, T)?;
            }
            prop_assert_eq!(
                side.inbox.conversation(cid).unwrap().missing(),
                side.expected_missing()
            );
        }
    }

    /// Both sides write first at once, any number of times each, delivered
    /// in any interleaving: two conversations, each reading its own.
    #[test]
    fn both_sides_writing_first_make_two_conversations(
        from_alice in 1usize..5,
        from_bob in 1usize..5,
        order in any::<u64>(),
    ) {
        let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
        let (mut a, mut b) = (Inbox::new(), Inbox::new());
        let ab = a.start(&alice, &bob.register(), b"", T).unwrap();
        let ba = b.start(&bob, &alice.register(), b"", T).unwrap();
        let mut to_bob: Vec<_> = (0..from_alice).map(|i| (ab, a.send(ab, &[i as u8]).unwrap(), i)).collect();
        let mut to_alice: Vec<_> = (0..from_bob).map(|i| (ba, b.send(ba, &[i as u8]).unwrap(), i)).collect();
        let mut bits = order;
        while !to_bob.is_empty() || !to_alice.is_empty() {
            let pick_bob = to_alice.is_empty() || (!to_bob.is_empty() && bits & 1 == 0);
            bits = bits.rotate_right(1);
            let (inbox, key, queue) = if pick_bob { (&mut b, &bob, &mut to_bob) } else { (&mut a, &alice, &mut to_alice) };
            let i = (bits as usize) % queue.len();
            let (cid, envelope, text) = queue.remove(i);
            let Ok(Received::Request { cid: got, plaintext, .. }) = inbox.receive(key, &envelope, T) else {
                return Err(TestCaseError::fail("a request"));
            };
            prop_assert_eq!(got, cid);
            prop_assert_eq!(plaintext, vec![text as u8]);
        }
        prop_assert_ne!(ab, ba);
        prop_assert_eq!(b.requests().get(ab).unwrap().message_count(), from_alice);
        prop_assert_eq!(a.requests().get(ba).unwrap().message_count(), from_bob);
        b.accept(&bob, ab).unwrap();
        a.accept(&alice, ba).unwrap();
        let reply = b.send(ab, b"r").unwrap();
        prop_assert_eq!(a.receive(&alice, &reply, T).unwrap(), Received::Message { cid: ab, plaintext: b"r".to_vec() });
        let reply = a.send(ba, b"r").unwrap();
        prop_assert_eq!(b.receive(&bob, &reply, T).unwrap(), Received::Message { cid: ba, plaintext: b"r".to_vec() });
    }

    /// After any number of exchanges, either side restarts the conversation
    /// with `replaces`: the other side sees a verified continuation, the new
    /// conversation works both ways, and the old one still does.
    #[test]
    fn a_reset_with_replaces_is_verified_from_either_side(rounds in 0usize..4, by_alice in any::<bool>()) {
        let (mut alice, mut bob, old) = established();
        for i in 0..rounds {
            send(&mut alice, &mut bob, old, vec![i as u8]);
            deliver(&mut bob, old, 0, T)?;
            send(&mut bob, &mut alice, old, vec![i as u8]);
            deliver(&mut alice, old, 0, T)?;
        }
        let (writer, reader) = if by_alice { (&mut alice, &mut bob) } else { (&mut bob, &mut alice) };
        let new = writer.inbox.start_continuing(&writer.key, old, b"", T + 60).unwrap();
        let envelope = writer.inbox.send(new, b"again").unwrap();
        let received = reader.inbox.receive(&reader.key, &envelope, T + 60);
        prop_assert!(matches!(received, Ok(Received::Request { .. })), "a request");
        prop_assert_eq!(
            reader.inbox.requests().get(new).unwrap().continues(),
            Some(Continues::Verified(old))
        );
        reader.inbox.accept(&reader.key, new).unwrap();
        let back = reader.inbox.send(new, b"back").unwrap();
        prop_assert_eq!(
            writer.inbox.receive(&writer.key, &back, T + 61).unwrap(),
            Received::Message { cid: new, plaintext: b"back".to_vec() }
        );
        let old_again = writer.inbox.send(old, b"old").unwrap();
        prop_assert_eq!(
            reader.inbox.receive(&reader.key, &old_again, T + 62).unwrap(),
            Received::Message { cid: old, plaintext: b"old".to_vec() }
        );
    }

    /// A message whose key was skipped reads until 48 hours after the skip,
    /// and not a second later, when it stays missing.
    #[test]
    fn a_skipped_key_lives_48_hours(gap in 1u32..20, delay in (SKIPPED_KEY_LIFETIME - 100)..(SKIPPED_KEY_LIFETIME + 100)) {
        let (mut alice, mut bob, cid) = established();
        for i in 0..=gap {
            send(&mut alice, &mut bob, cid, vec![i as u8]);
        }
        deliver(&mut bob, cid, gap as usize, T)?;
        prop_assert_eq!(bob.inbox.conversation(cid).unwrap().missing(), u64::from(gap));
        let early = bob.in_flight.remove(0);
        let result = bob.inbox.receive(&bob.key, &early.envelope, T + delay);
        if delay <= SKIPPED_KEY_LIFETIME {
            prop_assert_eq!(result, Ok(Received::Message { cid, plaintext: early.text }));
            prop_assert_eq!(bob.inbox.conversation(cid).unwrap().missing(), u64::from(gap) - 1);
        } else {
            prop_assert!(result.is_err());
            bob.inbox.expire(T + delay);
            prop_assert_eq!(bob.inbox.conversation(cid).unwrap().missing(), u64::from(gap));
        }
    }
}
