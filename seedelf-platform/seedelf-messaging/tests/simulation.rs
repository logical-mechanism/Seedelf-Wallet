//! Two wallets messaging over an in-memory relay that keeps envelopes 36
//! hours (docs/protocol.md §4.2, §5, §6 and §10), and protocol-review.md
//! §E's cases 4 and 5.
//!
//! Each wallet keeps only bytes, as its sealed records will: a record per
//! conversation holding its state and its outbox together, the requests,
//! the tombstones and the scan's cursor. It follows §4.2: write the state
//! and the envelope, then post the stored bytes, then mark them posted;
//! receive, write, then advance the cursor. Crashes land between those
//! steps; locks last up to 60 hours, past the relay's 36.

use std::collections::BTreeMap;

use seedelf_messaging::session::{
    Conversation, ConversationId, FIRST_CONTACT_MAX_AGE, FirstContact, Inbox, Received, Requests,
    SKIPPED_KEY_LIFETIME, Tombstones, open,
};
use seedelf_messaging::{Error, SecretKey, matches_envelope};

const T: u64 = 1_800_000_000;
const RELAY_LIFETIME: u64 = 36 * 3600;

/// What the schedules made happen, so the simulation can show it reached
/// every case it claims to.
#[derive(Default, Debug)]
struct Seen {
    died_before_post: u64,
    died_before_mark: u64,
    died_before_cursor: u64,
    reread_after_a_death: u64,
    expired_on_the_relay: u64,
    outside_the_window: u64,
    skipped_key_too_old: u64,
    missing_at_the_end: u64,
    started_again: u64,
}

thread_local! {
    static SEEN: std::cell::RefCell<Seen> = std::cell::RefCell::new(Seen::default());
}

fn saw(count: impl FnOnce(&mut Seen)) {
    SEEN.with(|seen| count(&mut seen.borrow_mut()));
}

/// The relay: bytes, kept 36 hours, duplicates dropped, read after a cursor.
#[derive(Default)]
struct Relay {
    held: Vec<(u64, u64, Vec<u8>)>,
    next: u64,
}

impl Relay {
    /// Whether it took the envelope, or already held those bytes.
    fn post(&mut self, bytes: &[u8], now: u64) -> bool {
        if self.held.iter().any(|(_, _, held)| held == bytes) {
            return false;
        }
        self.next += 1;
        self.held.push((self.next, now, bytes.to_vec()));
        true
    }

    fn sweep(&mut self, now: u64) {
        self.held.retain(|(_, at, _)| now <= at + RELAY_LIFETIME);
    }

    fn after(&self, cursor: u64) -> Vec<(u64, Vec<u8>)> {
        self.held
            .iter()
            .filter(|(seq, _, _)| *seq > cursor)
            .map(|(seq, _, bytes)| (*seq, bytes.clone()))
            .collect()
    }

    fn copies(&self, bytes: &[u8]) -> usize {
        self.held
            .iter()
            .filter(|(_, _, held)| held == bytes)
            .count()
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
struct Outgoing {
    bytes: Vec<u8>,
    posted: bool,
}

/// One conversation's record: its state and its outbox, written together.
#[derive(Clone, PartialEq, Eq, Debug)]
struct Record {
    state: Vec<u8>,
    outbox: Vec<Outgoing>,
}

/// Everything a wallet stores, as bytes.
#[derive(Clone, PartialEq, Eq, Debug)]
struct Store {
    records: BTreeMap<ConversationId, Record>,
    requests: Vec<u8>,
    tombstones: Vec<u8>,
    cursor: u64,
}

/// What the test knows of every envelope sent, for its oracle.
#[derive(Clone, Debug)]
struct Sent {
    from: usize,
    cid: ConversationId,
    text: Vec<u8>,
    chain: [u8; 48],
    n: u32,
    /// F's t, for a first-contact message.
    first_contact_t: Option<u64>,
}

struct Wallet {
    key: SecretKey,
    store: Store,
    unlocked: bool,
    /// Texts the wallet showed, and when.
    shown: BTreeMap<Vec<u8>, u64>,
    /// When it read each (chain, n), for the oracle's skipped-key clock.
    read_at: Vec<([u8; 48], u32, u64)>,
}

impl Wallet {
    fn new(key: SecretKey) -> Self {
        Self {
            key,
            store: Store {
                records: BTreeMap::new(),
                requests: Requests::new().to_bytes(),
                tombstones: Tombstones::new().to_bytes(),
                cursor: 0,
            },
            unlocked: true,
            shown: BTreeMap::new(),
            read_at: Vec::new(),
        }
    }

    fn load(&self) -> Inbox {
        let conversations = self
            .store
            .records
            .values()
            .map(|record| Conversation::from_bytes(&record.state).unwrap())
            .collect();
        Inbox::from_parts(
            conversations,
            Requests::from_bytes(&self.store.requests).unwrap(),
            Tombstones::from_bytes(&self.store.tombstones).unwrap(),
        )
        .unwrap()
    }

    /// One write of everything the inbox holds, with a new envelope in its
    /// conversation's outbox if there is one: state and outbox move together.
    fn write(&mut self, inbox: &Inbox, outgoing: Option<(ConversationId, &[u8])>) {
        let mut records = BTreeMap::new();
        for conversation in inbox.conversations() {
            let cid = conversation.cid();
            let mut outbox = self
                .store
                .records
                .get(&cid)
                .map(|record| record.outbox.clone())
                .unwrap_or_default();
            if let Some((to, bytes)) = outgoing
                && to == cid
            {
                outbox.push(Outgoing {
                    bytes: bytes.to_vec(),
                    posted: false,
                });
            }
            records.insert(
                cid,
                Record {
                    state: conversation.to_bytes().to_vec(),
                    outbox,
                },
            );
        }
        self.store.records = records;
        self.store.requests = inbox.requests().to_bytes();
        self.store.tombstones = inbox.tombstones().to_bytes();
    }

    /// Queue step 1: advance the chain and store the state with the envelope.
    fn compose(&mut self, cid: ConversationId, text: &[u8]) -> Vec<u8> {
        let mut inbox = self.load();
        let envelope = inbox.send(cid, text).unwrap();
        self.write(&inbox, Some((cid, &envelope)));
        envelope
    }

    /// Steps 2 and 3 for one envelope just composed: post its stored bytes,
    /// then mark it posted, unless the worker dies between the two.
    fn post(&mut self, relay: &mut Relay, envelope: &[u8], now: u64, die_before_marking: bool) {
        for record in self.store.records.values_mut() {
            for outgoing in record.outbox.iter_mut().filter(|o| o.bytes == envelope) {
                relay.post(&outgoing.bytes, now);
                if die_before_marking {
                    saw(|s| s.died_before_mark += 1);
                } else {
                    outgoing.posted = true;
                }
            }
        }
    }

    /// After a restart: every pending envelope posted again, the same bytes,
    /// then marked.
    fn post_pending(&mut self, relay: &mut Relay, now: u64, die_before_marking: bool) {
        for record in self.store.records.values_mut() {
            for outgoing in record.outbox.iter_mut().filter(|o| !o.posted) {
                relay.post(&outgoing.bytes, now);
                if die_before_marking {
                    saw(|s| s.died_before_mark += 1);
                } else {
                    outgoing.posted = true;
                }
            }
        }
    }

    fn parts(inbox: &Inbox) -> (Vec<Vec<u8>>, Vec<u8>, Vec<u8>) {
        (
            inbox
                .conversations()
                .map(|c| c.to_bytes().to_vec())
                .collect(),
            inbox.requests().to_bytes(),
            inbox.tombstones().to_bytes(),
        )
    }

    /// Reads the relay after the cursor: each envelope that's the wallet's
    /// is received and written, a request accepted at once; the cursor moves
    /// after the page, unless the worker dies first.
    fn sync(&mut self, relay: &Relay, now: u64, die_before_cursor: bool, oracle: &Oracle) {
        let page = relay.after(self.store.cursor);
        for (_, bytes) in &page {
            if !matches_envelope(&self.key, bytes).unwrap() {
                continue;
            }
            let sent = &oracle.sent[bytes];
            let mut inbox = self.load();
            let before = Self::parts(&inbox);
            match inbox.receive(&self.key, bytes, now) {
                Ok(received) => {
                    let (cid, plaintext) = match received {
                        Received::Message { cid, plaintext } => (cid, plaintext),
                        Received::Request { cid, plaintext, .. } => {
                            inbox.accept(&self.key, cid).unwrap();
                            (cid, plaintext)
                        }
                    };
                    assert_eq!((cid, &plaintext), (sent.cid, &sent.text));
                    assert!(
                        self.shown.insert(plaintext, now).is_none(),
                        "a message shown twice"
                    );
                    self.read_at.push((sent.chain, sent.n, now));
                    self.write(&inbox, None);
                }
                Err(error) => {
                    assert_eq!(Self::parts(&inbox), before, "a refusal changed nothing");
                    if self.shown.contains_key(&sent.text) {
                        saw(|s| s.reread_after_a_death += 1);
                    } else {
                        oracle.explain(self, sent, error, now);
                    }
                }
            }
        }
        if die_before_cursor {
            saw(|s| s.died_before_cursor += 1);
        } else {
            if let Some((last, _)) = page.last() {
                self.store.cursor = *last;
            }
        }
    }

    fn conversation(&self, cid: ConversationId) -> Option<Conversation> {
        self.store
            .records
            .get(&cid)
            .map(|record| Conversation::from_bytes(&record.state).unwrap())
    }
}

/// The test's knowledge of every envelope, by its bytes.
#[derive(Default)]
struct Oracle {
    sent: BTreeMap<Vec<u8>, Sent>,
    /// Each sender's chains, in the order it used them, per conversation.
    chains: BTreeMap<(usize, ConversationId), Vec<[u8; 48]>>,
}

impl Oracle {
    fn record(
        &mut self,
        from: usize,
        to: &Wallet,
        cid: ConversationId,
        text: &[u8],
        envelope: &[u8],
    ) {
        let opened = open(&to.key, envelope).unwrap();
        let chain = opened.header().ratchet_key_bytes();
        let chains = self.chains.entry((from, cid)).or_default();
        if !chains.contains(&chain) {
            chains.push(chain);
        }
        let first_contact_t = opened.first_contact().map(FirstContact::started_at);
        // Never two envelopes for one message key.
        for other in self.sent.values() {
            assert!(
                !(other.from == from
                    && other.chain == chain
                    && other.n == opened.header().number()),
                "a message key used twice"
            );
        }
        self.sent.insert(
            envelope.to_vec(),
            Sent {
                from,
                cid,
                text: text.to_vec(),
                chain,
                n: opened.header().number(),
                first_contact_t,
            },
        );
    }

    /// A first reading may be refused only for a reason the schedule
    /// explains: a first message past its window, or a skipped key past its
    /// 48 hours.
    fn explain(&self, reader: &Wallet, sent: &Sent, error: Error, now: u64) {
        match error {
            Error::OutsideWindow => {
                let t = sent
                    .first_contact_t
                    .expect("only a first message has a window");
                assert!(now > t + FIRST_CONTACT_MAX_AGE, "refused inside its window");
                saw(|s| s.outside_the_window += 1);
            }
            Error::KeyUsedOrDeleted => {
                let chains = &self.chains[&(sent.from, sent.cid)];
                let position = chains.iter().position(|c| *c == sent.chain).unwrap();
                let skipped_at = reader
                    .read_at
                    .iter()
                    .filter(|(chain, n, _)| {
                        let later = chains.iter().position(|c| c == chain).unwrap();
                        (*chain == sent.chain && *n > sent.n) || later > position
                    })
                    .map(|(_, _, at)| *at)
                    .min()
                    .expect("a key is skipped only by a later message");
                assert!(
                    now > skipped_at + SKIPPED_KEY_LIFETIME,
                    "a live skipped key refused"
                );
                saw(|s| s.skipped_key_too_old += 1);
            }
            other => panic!("an unexplained refusal: {other:?}"),
        }
    }

    /// The missing count a reader must show once everything has been tried:
    /// every key it derived and didn't use (as in tests/session_properties.rs).
    fn expected_missing(&self, reader: &Wallet, from: usize, cid: ConversationId) -> u64 {
        let Some(chains) = self.chains.get(&(from, cid)) else {
            return 0;
        };
        let read =
            |chain: &[u8; 48]| reader.read_at.iter().filter(|(c, _, _)| c == chain).count() as u64;
        let seen: Vec<_> = chains.iter().filter(|chain| read(chain) > 0).collect();
        let mut missing = 0;
        for (i, chain) in seen.iter().enumerate() {
            let derived = if i + 1 < seen.len() {
                self.sent
                    .values()
                    .filter(|s| s.from == from && s.chain == **chain)
                    .count() as u64
            } else {
                reader
                    .read_at
                    .iter()
                    .filter(|(c, _, _)| c == *chain)
                    .map(|(_, n, _)| u64::from(*n) + 1)
                    .max()
                    .unwrap()
            };
            missing += derived - read(chain);
        }
        missing
    }
}

/// A small deterministic generator for the schedule.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
}

/// One run: Alice writes to Bob's handle, then 300 random steps of writing,
/// syncing, crashing, restarting, locking and time passing; then both unlock
/// and finish, and the oracle checks the outcome.
fn run(seed: u64) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let mut relay = Relay::default();
    let mut oracle = Oracle::default();
    let mut wallets = [
        Wallet::new(SecretKey::generate()),
        Wallet::new(SecretKey::generate()),
    ];
    let mut now = T;
    let bob_handle = wallets[1].key.register();
    let cid = {
        let alice = &mut wallets[0];
        let mut inbox = alice.load();
        let cid = inbox.start(&alice.key, &bob_handle, b"", now).unwrap();
        alice.write(&inbox, None);
        cid
    };
    let mut count = 0;
    let mut send = |wallets: &mut [Wallet; 2],
                    from: usize,
                    relay: &mut Relay,
                    oracle: &mut Oracle,
                    now: u64,
                    rng: &mut Rng| {
        count += 1;
        let text = format!("{from}:{count}").into_bytes();
        let envelope = wallets[from].compose(cid, &text);
        oracle.record(from, &wallets[1 - from], cid, &text, &envelope);
        // The worker may die after the write, before the post, or between
        // the post and the mark.
        if rng.chance(90) {
            let die = rng.chance(10);
            wallets[from].post(relay, &envelope, now, die);
        } else {
            saw(|s| s.died_before_post += 1);
        }
    };

    for _ in 0..300 {
        relay.sweep(now);
        let who = rng.below(2) as usize;
        match rng.below(100) {
            0..=34 => {
                let has = wallets[who].store.records.contains_key(&cid);
                if wallets[who].unlocked && has {
                    send(&mut wallets, who, &mut relay, &mut oracle, now, &mut rng);
                }
            }
            35..=74 => {
                if wallets[who].unlocked {
                    let die = rng.chance(10);
                    wallets[who].sync(&relay, now, die, &oracle);
                }
            }
            75..=84 => {
                // A restart: every pending envelope posted again, same bytes.
                if wallets[who].unlocked {
                    wallets[who].post_pending(&mut relay, now, false);
                }
            }
            _ => wallets[who].unlocked = !wallets[who].unlocked,
        }
        now += match rng.below(100) {
            0..=69 => 1 + rng.below(600),
            70..=94 => 3600 * (1 + rng.below(6)),
            _ => 3600 * (30 + rng.below(31)),
        };
    }

    // Both unlock, restart and read everything still on the relay.
    for wallet in &mut wallets {
        wallet.unlocked = true;
        wallet.post_pending(&mut relay, now, false);
    }
    for _ in 0..2 {
        for who in [1, 0] {
            wallets[who].sync(&relay, now, false, &oracle);
        }
    }
    // Messages the relay deleted before their reader looked.
    let expired = oracle
        .sent
        .values()
        .filter(|sent| !wallets[1 - sent.from].shown.contains_key(&sent.text))
        .count() as u64;
    saw(|s| s.expired_on_the_relay += expired);

    // Each reader's missing count is exactly the lost messages it skipped.
    for reader in [0usize, 1] {
        if let Some(conversation) = wallets[reader].conversation(cid) {
            let mut conversation = conversation;
            conversation.expire(now);
            assert_eq!(
                conversation.missing(),
                oracle.expected_missing(&wallets[reader], 1 - reader, cid),
                "seed {seed}, reader {reader}"
            );
            saw(|s| s.missing_at_the_end += conversation.missing());
        }
    }

    // Still live: a fresh exchange works both ways. If Bob never got a first
    // message inside its window, Alice starts again.
    let cid = if wallets[1].store.records.contains_key(&cid) {
        cid
    } else {
        saw(|s| s.started_again += 1);
        let alice = &mut wallets[0];
        let mut inbox = alice.load();
        let fresh = inbox.start(&alice.key, &bob_handle, b"", now).unwrap();
        alice.write(&inbox, None);
        fresh
    };
    for from in [0usize, 1] {
        let text = format!("final {from}").into_bytes();
        let envelope = wallets[from].compose(cid, &text);
        oracle.record(from, &wallets[1 - from], cid, &text, &envelope);
        wallets[from].post_pending(&mut relay, now, false);
        let reader = &mut wallets[1 - from];
        reader.sync(&relay, now + 60, false, &oracle);
        assert!(
            reader.shown.contains_key(&text),
            "seed {seed}: final {from} not read"
        );
        now += 120;
    }
}

#[test]
fn two_wallets_over_a_36_hour_relay() {
    let seeds: u64 = std::env::var("SIMULATION_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(24);
    for seed in 1..=seeds {
        run(seed);
    }
    SEEN.with(|seen| {
        let seen = seen.borrow();
        println!("{seen:#?}");
        if seeds >= 24 {
            assert!(seen.died_before_post > 0 && seen.died_before_mark > 0);
            assert!(seen.died_before_cursor > 0 && seen.reread_after_a_death > 0);
            assert!(seen.expired_on_the_relay > 0 && seen.missing_at_the_end > 0);
            assert!(seen.outside_the_window > 0 && seen.skipped_key_too_old > 0);
        }
    });
}

/// Case 4. The worker dies after the write and before the post, then after
/// the post and before the mark. Each restart posts the same bytes, the
/// relay keeps one copy, and the reader gets one message.
#[test]
fn case_04_killed_between_write_post_and_mark() {
    let mut relay = Relay::default();
    let mut oracle = Oracle::default();
    let (mut alice, mut bob) = (
        Wallet::new(SecretKey::generate()),
        Wallet::new(SecretKey::generate()),
    );
    let mut inbox = alice.load();
    let cid = inbox
        .start(&alice.key, &bob.key.register(), b"", T)
        .unwrap();
    alice.write(&inbox, None);

    // Dies after the write: nothing posted.
    let first = alice.compose(cid, b"one");
    oracle.record(0, &bob, cid, b"one", &first);
    assert_eq!(relay.copies(&first), 0);
    let stored = alice.store.records[&cid].outbox[0].clone();
    assert_eq!(
        (stored.bytes.as_slice(), stored.posted),
        (first.as_slice(), false)
    );
    alice.post_pending(&mut relay, T + 10, false);
    assert_eq!(relay.copies(&first), 1);

    // Dies after the post, before the mark: the restart posts it again.
    let second = alice.compose(cid, b"two");
    oracle.record(0, &bob, cid, b"two", &second);
    alice.post_pending(&mut relay, T + 20, true);
    assert!(!alice.store.records[&cid].outbox[1].posted);
    assert!(!relay.post(&second, T + 30), "the relay already holds it");
    alice.post_pending(&mut relay, T + 30, false);
    assert_eq!(relay.copies(&second), 1);
    assert!(alice.store.records[&cid].outbox.iter().all(|o| o.posted));

    bob.sync(&relay, T + 40, false, &oracle);
    bob.sync(&relay, T + 50, false, &oracle);
    assert_eq!(bob.shown.len(), 2);
    assert_eq!(relay.held.len(), 2);
}

/// Case 5. Receiving dies between writing the record and moving the cursor.
/// The next sync reads the same page again: no message shows twice and no
/// record changes.
#[test]
fn case_05_killed_between_the_write_and_the_cursor() {
    let mut relay = Relay::default();
    let mut oracle = Oracle::default();
    let (mut alice, mut bob) = (
        Wallet::new(SecretKey::generate()),
        Wallet::new(SecretKey::generate()),
    );
    let mut inbox = alice.load();
    let cid = inbox
        .start(&alice.key, &bob.key.register(), b"", T)
        .unwrap();
    alice.write(&inbox, None);
    for text in [&b"one"[..], b"two"] {
        let envelope = alice.compose(cid, text);
        oracle.record(0, &bob, cid, text, &envelope);
    }
    alice.post_pending(&mut relay, T, false);

    bob.sync(&relay, T + 10, true, &oracle);
    assert_eq!(bob.store.cursor, 0, "died before the cursor");
    assert_eq!(bob.shown.len(), 2);
    let records = bob.store.records.clone();
    let requests = bob.store.requests.clone();
    bob.sync(&relay, T + 20, false, &oracle);
    assert_eq!(bob.shown.len(), 2);
    assert_eq!(bob.store.records, records);
    assert_eq!(bob.store.requests, requests);
    assert_eq!(bob.store.cursor, 2);

    // Replying works after it, and Alice reads the reply once.
    let reply = bob.compose(cid, b"reply");
    oracle.record(1, &alice, cid, b"reply", &reply);
    bob.post_pending(&mut relay, T + 30, false);
    alice.sync(&relay, T + 40, true, &oracle);
    alice.sync(&relay, T + 50, false, &oracle);
    assert_eq!(alice.shown.len(), 1);
}
