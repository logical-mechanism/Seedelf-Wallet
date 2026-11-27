//! One network's list of certificates (docs/protocol.md §21.7; web wallet
//! chunk 55's 55c), beside its pool of envelopes: the certificates posted
//! to it, in the order it took them, and a removal for each it no longer
//! holds. Every wallet reads it whole, never by name, so no read tells the
//! relay whom a wallet will write to.
//!
//! **Never an eviction.** A certificate is never pushed out, by age or by a
//! fuller list: a full list refuses the next one instead (`Unlisted::Full`).
//! One leaves the list only for a removal entry (kind 2, its listing
//! digest): withdrawn by its own messaging key (`withdraw`, §21.7's
//! withdrawals), or no longer good on the relay's view of the chain
//! (`judge`: mainnet's sweep, preprod's slow re-check).
//!
//! **Removals stay a whole week** (`compact`): one goes once 7 whole days
//! have passed since the day it was made, so between 7 and 8 days after it
//! came. A reader who read the list in that time has read each one; one
//! away longer reads the list again (a gap). So removals never pile up
//! against the cap. Each removal keeps the day it was made, Unix days, for
//! this and nothing else.
//!
//! **A withdrawal lasts** (§21.7, check 3′): each withdrawn digest is kept,
//! with the Seedelf and register its certificate named, so those bytes are
//! never listed again while that register stands. At most
//! [`MOST_WITHDRAWN`] for one Seedelf at one register: a certificate is
//! listed for it there only while its withdrawn and its listed together are
//! fewer (`Unlisted::TooOften`), until it moves, so a loop of posting and
//! withdrawing can't fill the list. They go once the relay's view of the
//! chain has found the Seedelf elsewhere [`ABSENT_TO_FORGET`] times in a
//! row, each on a view that's changed since the last (a new tip, a new
//! answer), so one passing view forgets nothing however often it's read.
//!
//! **Cursors** are the pool's (pool.rs): each entry gets the next number,
//! starting from the Unix time in microseconds when the list was loaded, so
//! a number says nothing of when its entry came; a page's cursor is its last
//! entry's while another page follows, and the last number given out once
//! none does. A cursor below `forgotten` may have missed entries (lost to a
//! crash between saves, or removals compacted), and one above the last
//! number given isn't the list's: either is a gap, and since its reader
//! drops its copy and reads the list again (§21.7), the page then starts
//! from the oldest entry. So a compaction and a restore after a crash
//! number every entry again (`renumber`), in order, from above a new
//! `forgotten` that's above every number given out: each cursor from before
//! is a gap once, and the read that follows it gets cursors above
//! `forgotten`, so it reads on to the end. (Kept numbers below `forgotten`
//! made every page of that read a gap again, its reader stuck on the
//! first: 55c's review, H1.)
//!
//! **No times but a removal's day,** and no address: a certificate's entry
//! is its bytes and its number.
//!
//! **Keyed by hashes:** what the list knows a certificate by, its Seedelf
//! (N and its register) and its listing (those and m_S), is SHA-256 of
//! those bytes, which stands for them as the pool's stamp digest stands for
//! an envelope's.

use std::collections::{HashMap, HashSet, VecDeque};

use axum::body::Bytes;
use sha2::{Digest, Sha256};

use super::certificate::{self, Shape};
use super::pool::{GAP, MORE};

/// A page holds whole entries up to this many bytes, their kinds and
/// lengths aside, as the pool's 256 KiB counts envelopes alone [choice].
pub const PAGE_BYTES: usize = 64 * 1024;

/// A page's bytes before its entries: version, flags, cursor, price and
/// count.
pub const PAGE_HEADER: usize = 1 + 1 + 8 + 1 + 2;

/// And before each entry: its kind and its length.
pub const FRAME_LEN: usize = 1 + 2;

/// The page's format version.
pub const PAGE_VERSION: u8 = 1;

/// An entry's kind: a certificate, 273 to 304 bytes.
pub const CERTIFICATE: u8 = 0x01;

/// An entry's kind: a removal, the 32-byte listing digest of a certificate
/// the list no longer holds.
pub const REMOVAL: u8 = 0x02;

/// A listing digest's bytes.
pub const DIGEST_LEN: usize = 32;

/// A datum register's bytes, `g_S ‖ u_S`.
const REGISTER_LEN: usize = 96;

/// At most this many certificates name one Seedelf at one register, each
/// with its own m_S (§21.7's check 6): two good ones already mean two
/// holders of x, and a writer takes neither (§21.5).
pub const MOST_FOR_A_SEEDELF: usize = 2;

/// A removal stays at least this many whole days [choice]: it goes once
/// more than this many Unix days separate today from its own, so between 7
/// and 8 days after it came, never fewer. A wallet that reads the list
/// within them reads it, and one away longer reads the list again.
pub const REMOVALS_KEPT_DAYS: u32 = 7;

/// At most this many withdrawn digests for one Seedelf at one register
/// [choice]: a certificate is listed for it there only while its withdrawn
/// and its listed together are fewer, so two listed at 127 withdrawn never
/// make 129; past them, none is listed for it there until it moves. A
/// wallet withdraws at a switch off, so 128 are 128 turns off.
pub const MOST_WITHDRAWN: usize = 128;

/// A Seedelf found elsewhere this many checks in a row, each on a view of
/// the chain that's changed since the last, has its withdrawn digests
/// forgotten [choice]: one view that passes (a rollback, a source that's
/// behind) forgets nothing, however often it's read.
pub const ABSENT_TO_FORGET: u8 = 3;

/// The snapshot's format version.
const SNAPSHOT_VERSION: u8 = 1;

/// More numbers than a list gives out between two saves, many times over:
/// mainnet's cap holds about 2^21 entries at most, and a save comes every
/// minute. After a crash the numbering goes on this far above the last
/// save's `next`, so it stays above every cursor given out since, whatever
/// the clock says (as pool.rs's).
const UNSAVED: u64 = 1 << 32;

/// What an entry holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Item {
    Certificate(Bytes),
    Removal([u8; DIGEST_LEN]),
}

impl Item {
    pub fn kind(&self) -> u8 {
        match self {
            Item::Certificate(_) => CERTIFICATE,
            Item::Removal(_) => REMOVAL,
        }
    }

    pub fn bytes(&self) -> &[u8] {
        match self {
            Item::Certificate(bytes) => bytes,
            Item::Removal(digest) => digest,
        }
    }
}

struct Entry {
    number: u64,
    item: Item,
    /// A removal's day, Unix days: when it goes (`compact`). 0 for a
    /// certificate, which keeps none.
    day: u32,
}

/// What the list knows a certificate by (see the module).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Key {
    /// Its Seedelf: `len(N) ‖ N ‖ g_S ‖ u_S`.
    pub seedelf: [u8; 32],
    /// Its listing: the same, and m_S.
    pub listing: [u8; 32],
}

impl Key {
    pub fn of(shape: &Shape) -> Self {
        Key {
            seedelf: Sha256::digest(shape.seedelf()).into(),
            listing: Sha256::digest(shape.listing()).into(),
        }
    }
}

/// `Key::seedelf` for the Seedelf `name` at `register`, `g_S ‖ u_S`.
pub fn seedelf_key(name: &[u8], register: &[u8]) -> [u8; 32] {
    Sha256::new()
        .chain_update([name.len() as u8])
        .chain_update(name)
        .chain_update(register)
        .finalize()
        .into()
}

/// The listings held for one Seedelf at its register, with their entries'
/// numbers: one or two, inline, so a Seedelf costs the list no allocation
/// of its own.
#[derive(Debug, Clone, Copy, Default)]
struct Listings([Option<([u8; 32], u64)>; MOST_FOR_A_SEEDELF]);

impl Listings {
    fn count(&self) -> usize {
        self.0.iter().flatten().count()
    }

    fn holds(&self, listing: &[u8; 32]) -> bool {
        self.0.iter().flatten().any(|(held, _)| held == listing)
    }

    /// Adds one, where `count` is below two.
    fn add(&mut self, listing: [u8; 32], number: u64) {
        if let Some(free) = self.0.iter_mut().find(|held| held.is_none()) {
            *free = Some((listing, number));
        }
    }

    /// Takes one off: whether any is left.
    fn remove(&mut self, listing: &[u8; 32]) -> bool {
        for held in &mut self.0 {
            if held.is_some_and(|(l, _)| l == *listing) {
                *held = None;
            }
        }
        self.count() > 0
    }

    fn numbers(&self) -> impl Iterator<Item = u64> + '_ {
        self.0.iter().flatten().map(|(_, number)| *number)
    }
}

/// A Seedelf at a register some of whose certificates were withdrawn.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Withdrawn {
    name: Vec<u8>,
    register: [u8; REGISTER_LEN],
    digests: Vec<[u8; DIGEST_LEN]>,
    /// Checks in a row that found the Seedelf elsewhere: in memory alone.
    absent: u8,
    /// The view of the chain the last of them was counted on (`judge`'s
    /// `view`), 0 for none: the same view again counts nothing.
    counted: u64,
}

/// Where preprod's slow re-check stands (`Relay::recheck_step`), saved with
/// the list, so a restart neither starts a round again before its day nor
/// loses its place in one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Recheck {
    /// When the round began, Unix seconds: 0 for none yet.
    pub began: i64,
    pub at: RoundAt,
}

/// A round's place: it walks the Seedelfs the list knows by key, smallest
/// first (`List::seedelf_after`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RoundAt {
    /// Over, or none yet: the next begins a day after this one began.
    #[default]
    Done,
    /// Begun, none asked about yet.
    Start,
    /// Asked about every Seedelf up to this key.
    After([u8; 32]),
}

/// What a post did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Listed {
    New,
    /// A certificate for the same Seedelf, register and m_S was held.
    Already,
}

/// Why a certificate isn't listed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unlisted {
    /// Its Seedelf, at its register, has two certificates already.
    Two,
    /// The list holds its most.
    Full,
    /// A withdrawal took these bytes down (§21.7's check 3′).
    Withdrawn,
    /// Its Seedelf, at its register, has [`MOST_WITHDRAWN`] withdrawn.
    TooOften,
}

/// What follows a cursor.
#[derive(Debug, PartialEq, Eq)]
pub struct Page {
    pub flags: u8,
    /// The cursor to ask from next.
    pub cursor: u64,
    pub entries: Vec<Item>,
}

pub struct List {
    entries: VecDeque<Entry>,
    /// The listings held for each Seedelf at its register: at most two.
    seedelfs: HashMap<[u8; 32], Listings>,
    /// Each certificate held, by its listing digest: its number, so a
    /// removal finds it.
    by_digest: HashMap<[u8; DIGEST_LEN], u64>,
    /// Each Seedelf at a register whose certificates were withdrawn, by its
    /// key, and each withdrawn digest's Seedelf: check 3′'s.
    withdrawn: HashMap<[u8; 32], Withdrawn>,
    withdrawn_digests: HashMap<[u8; DIGEST_LEN], [u8; 32]>,
    /// Its entries' bytes and 32 for each withdrawn digest: what the cap
    /// counts.
    bytes: usize,
    next: u64,
    forgotten: u64,
    /// Preprod's re-check's place, saved with the list.
    recheck: Recheck,
    /// Changed since the last snapshot.
    pub changed: bool,
    /// How many times `take_out` has rebuilt the entries: a test's.
    #[cfg(test)]
    passes: usize,
}

impl List {
    /// An empty list, numbering from `now_micros`. Every cursor given out
    /// before is below it, so each one's reader is told of a gap.
    pub fn new(now_micros: u64) -> Self {
        let next = now_micros.max(1);
        List {
            entries: VecDeque::new(),
            seedelfs: HashMap::new(),
            by_digest: HashMap::new(),
            withdrawn: HashMap::new(),
            withdrawn_digests: HashMap::new(),
            bytes: 0,
            next,
            forgotten: next - 1,
            recheck: Recheck::default(),
            changed: false,
            #[cfg(test)]
            passes: 0,
        }
    }

    /// Whether a withdrawal took down the certificate with this listing
    /// digest: its bytes are never listed again (§21.7's check 3′).
    pub fn withdrawn(&self, digest: &[u8; DIGEST_LEN]) -> bool {
        self.withdrawn_digests.contains_key(digest)
    }

    /// Whether this Seedelf, at its register (`Key::seedelf`), has
    /// [`MOST_WITHDRAWN`] certificates withdrawn and listed together: no
    /// more is listed for it there until it moves, so every one listed can
    /// be withdrawn and its withdrawn never pass [`MOST_WITHDRAWN`].
    pub fn too_often(&self, seedelf: &[u8; 32]) -> bool {
        let withdrawn = self.withdrawn.get(seedelf).map_or(0, |w| w.digests.len());
        let listed = self.seedelfs.get(seedelf).map_or(0, Listings::count);
        withdrawn + listed >= MOST_WITHDRAWN
    }

    /// The withdrawn digests it keeps.
    pub fn withdrawals(&self) -> usize {
        self.withdrawn_digests.len()
    }

    /// The certificates it holds.
    pub fn certificates(&self) -> usize {
        self.by_digest.len()
    }

    /// Its entries: certificates and removals.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Its entries' bytes, certificates' and removals', framing aside, and
    /// 32 for each withdrawn digest: what the cap counts.
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// Whether a certificate for this Seedelf, register and m_S is held.
    pub fn already(&self, key: &Key) -> bool {
        self.seedelfs
            .get(&key.seedelf)
            .is_some_and(|held| held.holds(&key.listing))
    }

    /// Whether a new certificate of `size` bytes for `key` fits: fewer than
    /// two held for its Seedelf at its register, then `size` more bytes
    /// under `cap`.
    pub fn room(&self, key: &Key, size: usize, cap: usize) -> Result<(), Unlisted> {
        let held = self.seedelfs.get(&key.seedelf).map_or(0, Listings::count);
        if held >= MOST_FOR_A_SEEDELF {
            return Err(Unlisted::Two);
        }
        if self.bytes + size > cap {
            return Err(Unlisted::Full);
        }
        Ok(())
    }

    /// Lists a certificate whose checks have passed, unless one for the
    /// same key is held, its bytes were withdrawn, its Seedelf was withdrawn
    /// too often at its register, or it has no room. Never pushes one out.
    ///
    /// What's kept is a copy with an allocation of its own, as the pool's
    /// is (`Held::insert`), never a view of the request's buffer.
    pub fn insert(
        &mut self,
        digest: [u8; DIGEST_LEN],
        key: Key,
        bytes: &[u8],
        cap: usize,
    ) -> Result<Listed, Unlisted> {
        if self.already(&key) {
            return Ok(Listed::Already);
        }
        if self.withdrawn(&digest) {
            return Err(Unlisted::Withdrawn);
        }
        if self.too_often(&key.seedelf) {
            return Err(Unlisted::TooOften);
        }
        self.room(&key, bytes.len(), cap)?;
        let number = self.next;
        self.next += 1;
        self.index(number, digest, key, bytes.len());
        self.entries.push_back(Entry {
            number,
            item: Item::Certificate(Bytes::copy_from_slice(bytes)),
            day: 0,
        });
        self.changed = true;
        Ok(Listed::New)
    }

    fn index(&mut self, number: u64, digest: [u8; DIGEST_LEN], key: Key, size: usize) {
        self.seedelfs
            .entry(key.seedelf)
            .or_default()
            .add(key.listing, number);
        self.by_digest.insert(digest, number);
        self.bytes += size;
    }

    fn entry(&self, number: u64) -> Option<&Entry> {
        let at = self.entries.partition_point(|e| e.number < number);
        self.entries.get(at).filter(|e| e.number == number)
    }

    /// The certificate held for this Seedelf, register and m_S, if any: an
    /// `already` answer names it by its listing digest, since the poster's
    /// bytes may be another posting's (a fresh aux) and a withdrawal must
    /// name the bytes held.
    pub fn held(&self, key: &Key) -> Option<Bytes> {
        let listings = self.seedelfs.get(&key.seedelf)?;
        let (_, number) = listings
            .0
            .iter()
            .flatten()
            .find(|(listing, _)| *listing == key.listing)?;
        match &self.entry(*number)?.item {
            Item::Certificate(bytes) => Some(bytes.clone()),
            Item::Removal(_) => None,
        }
    }

    /// The certificate held under this listing digest, if any: what a
    /// withdrawal of it is checked against.
    pub fn certificate(&self, digest: &[u8; DIGEST_LEN]) -> Option<Bytes> {
        match self.entry(*self.by_digest.get(digest)?)? {
            Entry {
                item: Item::Certificate(bytes),
                ..
            } => Some(bytes.clone()),
            _ => None,
        }
    }

    /// A withdrawal (§21.7) on `today`, Unix days: takes the certificate
    /// with this listing digest off the list, for a removal entry naming it,
    /// at the next number, so its readers drop their copies and its Seedelf
    /// has room for another; and keeps the digest, 32 bytes in the cap's
    /// count, with its Seedelf and register, so the same bytes are never
    /// listed again. Whether it was held.
    pub fn withdraw(&mut self, digest: &[u8; DIGEST_LEN], today: u32) -> bool {
        let Some(bytes) = self.certificate(digest) else {
            return false;
        };
        let number = self.by_digest[digest];
        let shape = listed_shape(&bytes);
        let seedelf = Key::of(&shape).seedelf;
        let register: [u8; REGISTER_LEN] = shape.register().try_into().expect("96 bytes");
        let withdrawn = self.withdrawn.entry(seedelf).or_insert_with(|| Withdrawn {
            name: shape.name().to_vec(),
            register,
            digests: Vec::new(),
            absent: 0,
            counted: 0,
        });
        if self.withdrawn_digests.insert(*digest, seedelf).is_none() {
            withdrawn.digests.push(*digest);
            self.bytes += DIGEST_LEN;
        }
        self.take_out(vec![(number, *digest)], today);
        true
    }

    /// Puts back a certificate a withdrawal took whose save then failed, so
    /// its answer is a 503 (§21.7's withdrawals): its digest no longer
    /// kept, and its bytes, `certificate` under `pool`, listed again at the
    /// next number, after the removal, so a reader who read the removal
    /// reads it again, and one who reads from the oldest holds it in the
    /// end. Whether it's back: not if its listing is held again (a fresh
    /// posting), or its Seedelf has two again, which only its owner's x can
    /// have done meanwhile; the withdrawal then stands, saved with the next
    /// save.
    pub fn unwithdraw(&mut self, pool: &str, certificate: &Bytes) -> bool {
        let shape = listed_shape(certificate);
        let key = Key::of(&shape);
        let held = self.seedelfs.get(&key.seedelf).map_or(0, Listings::count);
        if self.already(&key) || held >= MOST_FOR_A_SEEDELF {
            return false;
        }
        let digest = certificate::listing_digest(pool, certificate);
        if let Some(seedelf) = self.withdrawn_digests.remove(&digest) {
            self.bytes -= DIGEST_LEN;
            if let Some(withdrawn) = self.withdrawn.get_mut(&seedelf) {
                withdrawn.digests.retain(|kept| *kept != digest);
                if withdrawn.digests.is_empty() {
                    self.withdrawn.remove(&seedelf);
                }
            }
        }
        let number = self.next;
        self.next += 1;
        self.index(number, digest, key, certificate.len());
        self.entries.push_back(Entry {
            number,
            item: Item::Certificate(certificate.clone()),
            day: 0,
        });
        self.changed = true;
        true
    }

    /// Every Seedelf at a register the list knows, listed or withdrawn, by
    /// its key: what the relay's view of the chain checks (`judge`).
    pub fn seedelfs(&self) -> Vec<[u8; 32]> {
        let mut keys: Vec<[u8; 32]> = self.seedelfs.keys().copied().collect();
        keys.extend(
            self.withdrawn
                .keys()
                .filter(|key| !self.seedelfs.contains_key(*key)),
        );
        keys
    }

    /// The name and register of a Seedelf the list knows, by its key.
    pub fn seedelf(&self, key: &[u8; 32]) -> Option<(Vec<u8>, [u8; REGISTER_LEN])> {
        if let Some(withdrawn) = self.withdrawn.get(key) {
            return Some((withdrawn.name.clone(), withdrawn.register));
        }
        let number = self.seedelfs.get(key)?.numbers().next()?;
        let Item::Certificate(bytes) = &self.entry(number)?.item else {
            return None;
        };
        let shape = listed_shape(bytes);
        Some((
            shape.name().to_vec(),
            shape.register().try_into().expect("96 bytes"),
        ))
    }

    /// The smallest key of a Seedelf the list knows, listed or withdrawn,
    /// above `after` (from the smallest without one): preprod's re-check
    /// walks them so, its place saved with the list (`Recheck`).
    pub fn seedelf_after(&self, after: Option<&[u8; 32]>) -> Option<[u8; 32]> {
        self.seedelfs
            .keys()
            .chain(self.withdrawn.keys())
            .filter(|key| after.is_none_or(|after| *key > after))
            .min()
            .copied()
    }

    /// Where preprod's re-check stands.
    pub fn recheck(&self) -> Recheck {
        self.recheck
    }

    /// Its new place, saved with the list.
    pub fn set_recheck(&mut self, recheck: Recheck) {
        if self.recheck != recheck {
            self.recheck = recheck;
            self.changed = true;
        }
    }

    /// What the relay's view of the chain, `view`, found of the Seedelf
    /// `key`: `present` if it's at the register still. Not, its listed
    /// certificates go for removal entries (each named under `pool`, on
    /// `today`), and its withdrawn digests once it's been found elsewhere
    /// [`ABSENT_TO_FORGET`] times in a row, each counted only on a view
    /// other than the last one counted; present, that count starts again.
    /// How many certificates went.
    pub fn judge(
        &mut self,
        pool: &str,
        key: &[u8; 32],
        present: bool,
        today: u32,
        view: u64,
    ) -> usize {
        let gone = self.judged(pool, key, present, view);
        let count = gone.len();
        if count > 0 {
            self.take_out(gone, today);
        }
        count
    }

    /// `judge`, but the certificates that go are only named, by number and
    /// digest: `sweep` takes them all out at once.
    fn judged(
        &mut self,
        pool: &str,
        key: &[u8; 32],
        present: bool,
        view: u64,
    ) -> Vec<(u64, [u8; DIGEST_LEN])> {
        if present {
            if let Some(withdrawn) = self.withdrawn.get_mut(key) {
                withdrawn.absent = 0;
                withdrawn.counted = 0;
            }
            return Vec::new();
        }
        if let Some(withdrawn) = self.withdrawn.get_mut(key)
            && withdrawn.counted != view
        {
            withdrawn.absent = withdrawn.absent.saturating_add(1);
            withdrawn.counted = view;
            if withdrawn.absent >= ABSENT_TO_FORGET {
                let withdrawn = self.withdrawn.remove(key).expect("just found");
                for digest in &withdrawn.digests {
                    self.withdrawn_digests.remove(digest);
                }
                self.bytes -= withdrawn.digests.len() * DIGEST_LEN;
                self.changed = true;
            }
        }
        let numbers: Vec<u64> = self
            .seedelfs
            .get(key)
            .map(|held| held.numbers().collect())
            .unwrap_or_default();
        numbers
            .into_iter()
            .filter_map(|number| match &self.entry(number)?.item {
                Item::Certificate(bytes) => {
                    Some((number, certificate::listing_digest(pool, bytes)))
                }
                Item::Removal(_) => None,
            })
            .collect()
    }

    /// Every Seedelf the list knows judged at once on the view `view`,
    /// `present` saying for each name and register whether it's there
    /// still: the mainnet sweep's. What goes is taken out in one pass, so a
    /// sweep that drops many rebuilds the list once. How many certificates
    /// went.
    pub fn sweep(
        &mut self,
        pool: &str,
        today: u32,
        view: u64,
        mut present: impl FnMut(&[u8], &[u8; REGISTER_LEN]) -> bool,
    ) -> usize {
        let mut gone = Vec::new();
        for key in self.seedelfs() {
            if let Some((name, register)) = self.seedelf(&key) {
                let here = present(&name, &register);
                gone.extend(self.judged(pool, &key, here, view));
            }
        }
        let count = gone.len();
        if count > 0 {
            self.take_out(gone, today);
        }
        count
    }

    /// Drops every removal made more than [`REMOVALS_KEPT_DAYS`] Unix days
    /// before `today`, so each has stayed at least that many whole days,
    /// and numbers what's left again (`renumber`): a cursor from before is
    /// a gap, and its reader reads the list again, once. How many went.
    pub fn compact(&mut self, today: u32) -> usize {
        let before = self.entries.len();
        self.entries.retain(|entry| {
            !(matches!(entry.item, Item::Removal(_))
                && today.saturating_sub(entry.day) > REMOVALS_KEPT_DAYS)
        });
        let gone = before - self.entries.len();
        if gone > 0 {
            self.bytes -= gone * DIGEST_LEN;
            self.renumber();
        }
        gone
    }

    /// Numbers every entry again, in order, from just above a new
    /// `forgotten` that's the next number not given out: every cursor
    /// given out so far is below it, a gap, and every one given from now on
    /// is above it, so the read a gap starts goes on to the end. Each
    /// certificate's index follows its entry. A compaction's and a restore
    /// after a crash's (see the module).
    fn renumber(&mut self) {
        self.forgotten = self.next;
        let first = self.next + 1;
        let old: Vec<u64> = self.entries.iter().map(|entry| entry.number).collect();
        let new = |number: &mut u64| {
            *number = first + old.binary_search(number).expect("an entry's number") as u64;
        };
        for number in self.by_digest.values_mut() {
            new(number);
        }
        for listings in self.seedelfs.values_mut() {
            for (_, number) in listings.0.iter_mut().flatten() {
                new(number);
            }
        }
        for (at, entry) in self.entries.iter_mut().enumerate() {
            entry.number = first + at as u64;
        }
        self.next = first + self.entries.len() as u64;
        self.changed = true;
    }

    /// Takes these certificates' entries out, by number, their indexes and
    /// bytes with them, and puts a removal entry for each at the end, in
    /// order, made on `today`. A removal is a removal's bytes in the cap's
    /// count, as every reader downloads it, until it goes (`compact`).
    fn take_out(&mut self, gone: Vec<(u64, [u8; DIGEST_LEN])>, today: u32) {
        #[cfg(test)]
        {
            self.passes += 1;
        }
        let numbers: HashSet<u64> = gone.iter().map(|(n, _)| *n).collect();
        let mut kept = VecDeque::with_capacity(self.entries.len());
        for entry in self.entries.drain(..) {
            if !numbers.contains(&entry.number) {
                kept.push_back(entry);
                continue;
            }
            let Item::Certificate(bytes) = &entry.item else {
                continue;
            };
            self.bytes -= bytes.len();
            let key = Key::of(&listed_shape(bytes));
            if let Some(held) = self.seedelfs.get_mut(&key.seedelf)
                && !held.remove(&key.listing)
            {
                self.seedelfs.remove(&key.seedelf);
            }
        }
        self.entries = kept;
        for (_, digest) in gone {
            self.by_digest.remove(&digest);
            let number = self.next;
            self.next += 1;
            self.bytes += DIGEST_LEN;
            self.entries.push_back(Entry {
                number,
                item: Item::Removal(digest),
                day: today,
            });
        }
        self.changed = true;
    }

    /// Whole entries after `after` (from the oldest without one, or after a
    /// gap), at most `limit` bytes of them but always one, and the cursor
    /// to ask from next.
    pub fn page(&self, after: Option<u64>, limit: usize) -> Page {
        self.page_while(after, |count, bytes| count == 1 || bytes <= limit)
    }

    /// [`List::page`] whose encoding, [`PAGE_HEADER`] bytes and [`FRAME_LEN`]
    /// before each entry, is at most `most` bytes: messaging's reserve
    /// (`edge::Reserved`), as the pool's `Held::page_within`. An entry is at
    /// most 307 bytes framed, so any reserve's page holds one.
    pub fn page_within(&self, after: Option<u64>, most: usize) -> Page {
        self.page_while(after, |count, bytes| {
            count == 1 || (bytes <= PAGE_BYTES && PAGE_HEADER + count * FRAME_LEN + bytes <= most)
        })
    }

    fn page_while(&self, after: Option<u64>, fits: impl Fn(usize, usize) -> bool) -> Page {
        let last_given = self.next - 1;
        let (start, mut flags) = match after {
            None => (0, 0),
            // A cursor this list didn't give, or one that may have missed
            // entries: the reader starts again, from the oldest.
            Some(after) if after > last_given || after < self.forgotten => (0, GAP),
            Some(after) => (self.entries.partition_point(|e| e.number <= after), 0),
        };
        let mut entries = Vec::new();
        let mut size = 0;
        let mut cursor = last_given;
        for entry in self.entries.iter().skip(start) {
            let len = entry.item.bytes().len();
            if !fits(entries.len() + 1, size + len) {
                flags |= MORE;
                break;
            }
            size += len;
            cursor = entry.number;
            entries.push(entry.item.clone());
        }
        // Nothing follows: the last number given out, as an empty page's
        // cursor (pool.rs, the 1.10.0 gate's FI-8).
        if flags & MORE == 0 {
            cursor = last_given;
        }
        Page {
            flags,
            cursor,
            entries,
        }
    }

    /// The snapshot: `version (1) | next (8) | forgotten (8) | count (4) |
    /// count × (number (8) | kind (1) | length (2) | entry) | withdrawn (4)
    /// | withdrawn × (len(N) (1) | N | register (96) | digests (1) |
    /// digests × digest (32)) | began (8) | at (1) | key (32, when at is
    /// 2)`, big-endian, a removal's entry its digest and its day (4), and
    /// the last three the re-check's place (`Recheck`: at 0 done, 1 begun,
    /// 2 after the key). Its parts are copied out under the lock (the
    /// certificates are shared, not copied); the bytes are made after.
    pub fn snapshot(&mut self) -> Snapshot {
        self.changed = false;
        let mut withdrawn: Vec<SavedWithdrawn> = self
            .withdrawn
            .values()
            .map(|w| (w.name.clone(), w.register, w.digests.clone()))
            .collect();
        withdrawn.sort();
        Snapshot {
            next: self.next,
            forgotten: self.forgotten,
            entries: self
                .entries
                .iter()
                .map(|e| (e.number, e.item.clone(), e.day))
                .collect(),
            withdrawn,
            recheck: self.recheck,
        }
    }

    /// The list a snapshot held, for the pool `pool` whose certificates
    /// name `network`, as pool.rs's `Held::restore`: a snapshot from a
    /// clean shutdown held everything; any other may have missed the
    /// entries taken after it, so the numbers given out since are taken to
    /// run up to [`UNSAVED`] past its `next`, and every entry is numbered
    /// again above them (`renumber`): every cursor given out before is told
    /// of a gap, once. Not clean, the list is changed from the start, so
    /// the first save writes where its numbering now stands.
    ///
    /// Each certificate's shape is read again, to index it, but not its
    /// proof: the file is the relay's own, written from certificates it
    /// checked, and some 200,000 proofs would hold a start for minutes.
    /// Nothing, if the snapshot isn't one this list could have written: a
    /// certificate whose shape isn't this pool's, one held twice, a third
    /// for one Seedelf, or a withdrawn digest twice. Never cut to the cap:
    /// one lowered since refuses new certificates, and pushes out none.
    pub fn restore(
        snapshot: Snapshot,
        clean: bool,
        pool: &str,
        network: u8,
        now_micros: u64,
    ) -> Option<Self> {
        let saved = if clean {
            snapshot.next
        } else {
            snapshot.next.saturating_add(UNSAVED)
        };
        let next = saved.max(now_micros).max(1);
        let mut list = List {
            entries: VecDeque::with_capacity(snapshot.entries.len()),
            seedelfs: HashMap::new(),
            by_digest: HashMap::new(),
            withdrawn: HashMap::with_capacity(snapshot.withdrawn.len()),
            withdrawn_digests: HashMap::new(),
            bytes: 0,
            next,
            forgotten: snapshot.forgotten,
            recheck: snapshot.recheck,
            changed: !clean,
            #[cfg(test)]
            passes: 0,
        };
        for (name, register, digests) in snapshot.withdrawn {
            let seedelf = seedelf_key(&name, &register);
            if digests.is_empty() || list.withdrawn.contains_key(&seedelf) {
                return None;
            }
            for digest in &digests {
                if list.withdrawn_digests.insert(*digest, seedelf).is_some() {
                    return None;
                }
            }
            list.bytes += digests.len() * DIGEST_LEN;
            list.withdrawn.insert(
                seedelf,
                Withdrawn {
                    name,
                    register,
                    digests,
                    absent: 0,
                    counted: 0,
                },
            );
        }
        for (number, item, day) in snapshot.entries {
            match &item {
                Item::Certificate(bytes) => {
                    let shape =
                        certificate::check_shape(bytes, network, &certificate::POLICY).ok()?;
                    let key = Key::of(&shape);
                    if list.already(&key) || list.room(&key, 0, usize::MAX).is_err() {
                        return None;
                    }
                    let digest = certificate::listing_digest(pool, bytes);
                    list.index(number, digest, key, bytes.len());
                }
                Item::Removal(_) => list.bytes += DIGEST_LEN,
            }
            list.entries.push_back(Entry { number, item, day });
        }
        if !clean {
            list.renumber();
        }
        Some(list)
    }
}

/// A listed certificate's shape, read again: it was checked under its own
/// network byte and the policy as it was listed.
fn listed_shape(bytes: &[u8]) -> Shape<'_> {
    certificate::check_shape(bytes, bytes[1], &certificate::POLICY)
        .expect("a listed certificate's shape")
}

/// A page's bytes, big-endian (§21.7):
///
/// ```text
/// version (1) = 1 | flags (1) | cursor (8) | price (1) | count (2)
///   | count × (kind (1) | length (2) | entry)
/// ```
///
/// Flags: 1, another page follows now; 2, a gap, after which the page
/// starts from the oldest entry. Price: the bits a certificate post from
/// the reader's address would be asked now; 0, refused for now.
pub fn encode(page: &Page, price: u8) -> Vec<u8> {
    let size: usize = page
        .entries
        .iter()
        .map(|e| FRAME_LEN + e.bytes().len())
        .sum();
    let mut out = Vec::with_capacity(PAGE_HEADER + size);
    out.push(PAGE_VERSION);
    out.push(page.flags);
    out.extend_from_slice(&page.cursor.to_be_bytes());
    out.push(price);
    // At most 2,048 entries fit a page: 64 KiB of removals.
    out.extend_from_slice(&(page.entries.len() as u16).to_be_bytes());
    for entry in &page.entries {
        out.push(entry.kind());
        // At most 304 bytes.
        out.extend_from_slice(&(entry.bytes().len() as u16).to_be_bytes());
        out.extend_from_slice(entry.bytes());
    }
    out
}

/// A withdrawn Seedelf as a snapshot holds it: its name, its register and
/// its withdrawn digests.
type SavedWithdrawn = (Vec<u8>, [u8; REGISTER_LEN], Vec<[u8; DIGEST_LEN]>);

/// What a snapshot holds.
pub struct Snapshot {
    next: u64,
    forgotten: u64,
    /// Each entry, and a removal's day.
    entries: Vec<(u64, Item, u32)>,
    /// Each withdrawn Seedelf's name, register and digests.
    withdrawn: Vec<SavedWithdrawn>,
    recheck: Recheck,
}

/// A removal's entry in a snapshot: its digest, then its day.
const SAVED_REMOVAL_LEN: usize = DIGEST_LEN + 4;

impl Snapshot {
    pub fn encode(&self) -> Vec<u8> {
        let size: usize = self
            .entries
            .iter()
            .map(|(_, item, _)| 8 + FRAME_LEN + item.bytes().len() + 4)
            .sum();
        let mut out = Vec::with_capacity(25 + size);
        out.push(SNAPSHOT_VERSION);
        out.extend_from_slice(&self.next.to_be_bytes());
        out.extend_from_slice(&self.forgotten.to_be_bytes());
        out.extend_from_slice(&(self.entries.len() as u32).to_be_bytes());
        for (number, item, day) in &self.entries {
            out.extend_from_slice(&number.to_be_bytes());
            out.push(item.kind());
            match item {
                Item::Certificate(bytes) => {
                    out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
                    out.extend_from_slice(bytes);
                }
                Item::Removal(digest) => {
                    out.extend_from_slice(&(SAVED_REMOVAL_LEN as u16).to_be_bytes());
                    out.extend_from_slice(digest);
                    out.extend_from_slice(&day.to_be_bytes());
                }
            }
        }
        out.extend_from_slice(&(self.withdrawn.len() as u32).to_be_bytes());
        for (name, register, digests) in &self.withdrawn {
            out.push(name.len() as u8);
            out.extend_from_slice(name);
            out.extend_from_slice(register);
            out.push(digests.len() as u8);
            for digest in digests {
                out.extend_from_slice(digest);
            }
        }
        out.extend_from_slice(&self.recheck.began.to_be_bytes());
        match self.recheck.at {
            RoundAt::Done => out.push(0),
            RoundAt::Start => out.push(1),
            RoundAt::After(key) => {
                out.push(2);
                out.extend_from_slice(&key);
            }
        }
        out
    }

    /// A snapshot from its bytes, or nothing if they aren't one: numbers in
    /// order and below `next`, every entry a certificate of 273 to 304
    /// bytes or a removal of a digest and a day, each withdrawn Seedelf a
    /// name of 1 to 32 bytes, a register and at least one digest, the
    /// re-check's place one of its three, and no byte left over. The
    /// certificates' shapes are `List::restore`'s to read.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        let mut at = bytes;
        let mut take = |n: usize| -> Option<&[u8]> {
            let (head, rest) = at.split_at_checked(n)?;
            at = rest;
            Some(head)
        };
        let u64_ = |b: &[u8]| u64::from_be_bytes(b.try_into().expect("8 bytes"));
        if take(1)? != [SNAPSHOT_VERSION] {
            return None;
        }
        let next = u64_(take(8)?);
        let forgotten = u64_(take(8)?);
        let count = u32::from_be_bytes(take(4)?.try_into().ok()?) as usize;
        let mut entries = Vec::with_capacity(count.min(1 << 16));
        let mut last = None;
        for _ in 0..count {
            let number = u64_(take(8)?);
            let kind = take(1)?[0];
            let len = usize::from(u16::from_be_bytes(take(2)?.try_into().ok()?));
            if number >= next || last.is_some_and(|last| number <= last) {
                return None;
            }
            last = Some(number);
            let entry = match kind {
                CERTIFICATE if (certificate::MIN_LEN..=certificate::MAX_LEN).contains(&len) => {
                    (Item::Certificate(Bytes::copy_from_slice(take(len)?)), 0)
                }
                REMOVAL if len == SAVED_REMOVAL_LEN => {
                    let digest = take(DIGEST_LEN)?.try_into().ok()?;
                    let day = u32::from_be_bytes(take(4)?.try_into().ok()?);
                    (Item::Removal(digest), day)
                }
                _ => return None,
            };
            entries.push((number, entry.0, entry.1));
        }
        let count = u32::from_be_bytes(take(4)?.try_into().ok()?) as usize;
        let mut withdrawn = Vec::with_capacity(count.min(1 << 16));
        for _ in 0..count {
            let len = usize::from(take(1)?[0]);
            if !(1..=certificate::MAX_NAME_LEN).contains(&len) {
                return None;
            }
            let name = take(len)?.to_vec();
            let register: [u8; REGISTER_LEN] = take(REGISTER_LEN)?.try_into().ok()?;
            let digests = usize::from(take(1)?[0]);
            let digests = (0..digests)
                .map(|_| take(DIGEST_LEN)?.try_into().ok())
                .collect::<Option<Vec<[u8; DIGEST_LEN]>>>()?;
            withdrawn.push((name, register, digests));
        }
        let began = i64::from_be_bytes(take(8)?.try_into().ok()?);
        let round = match take(1)?[0] {
            0 => RoundAt::Done,
            1 => RoundAt::Start,
            2 => RoundAt::After(take(32)?.try_into().ok()?),
            _ => return None,
        };
        if !at.is_empty() || forgotten >= next {
            return None;
        }
        Some(Snapshot {
            next,
            forgotten,
            entries,
            withdrawn,
            recheck: Recheck { began, at: round },
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::messaging::certificate::{MIN_LEN, NETWORK_PREPROD, POLICY, check_shape};

    const MICROS: u64 = 1_800_000_000_000_000;
    const CAP: usize = 1 << 20;
    /// A day, in Unix days.
    const DAY: u32 = 20_833;

    /// A certificate's shape, for preprod, with a 1-byte name: what the list
    /// reads of one. Its points and proof are garbage, which the list never
    /// looks at: the route checks them before it lists one. `seedelf` picks
    /// the name and register, `value` m_S, and `proof` the rest.
    pub(crate) fn shaped(seedelf: u32, value: u32, proof: u32) -> Vec<u8> {
        let mut bytes = vec![0u8; MIN_LEN];
        bytes[0] = certificate::VERSION;
        bytes[1] = NETWORK_PREPROD;
        bytes[2] = certificate::GENERATION;
        bytes[3..31].copy_from_slice(&POLICY);
        bytes[31] = 1;
        bytes[32] = 0x5e;
        // g_S at 33, u_S at 81, m_S at 129, c at 177.
        bytes[33..37].copy_from_slice(&seedelf.to_be_bytes());
        bytes[129..133].copy_from_slice(&value.to_be_bytes());
        bytes[177..181].copy_from_slice(&proof.to_be_bytes());
        bytes
    }

    pub(crate) fn listed(list: &mut List, bytes: &[u8], cap: usize) -> Result<Listed, Unlisted> {
        let shape = check_shape(bytes, NETWORK_PREPROD, &POLICY).unwrap();
        let digest = certificate::listing_digest("preprod", bytes);
        list.insert(digest, Key::of(&shape), bytes, cap)
    }

    fn keep(list: &mut List, seedelf: u32, value: u32) -> Listed {
        listed(list, &shaped(seedelf, value, 0), CAP).unwrap()
    }

    /// Which (Seedelf, m_S) a page's certificates are, and its removals'
    /// digests.
    fn ids(page: &Page) -> Vec<(u32, u32)> {
        page.entries
            .iter()
            .filter_map(|item| match item {
                Item::Certificate(bytes) => Some((
                    u32::from_be_bytes(bytes[33..37].try_into().unwrap()),
                    u32::from_be_bytes(bytes[129..133].try_into().unwrap()),
                )),
                Item::Removal(_) => None,
            })
            .collect()
    }

    fn removals(page: &Page) -> Vec<[u8; 32]> {
        page.entries
            .iter()
            .filter_map(|item| match item {
                Item::Removal(digest) => Some(*digest),
                Item::Certificate(_) => None,
            })
            .collect()
    }

    #[test]
    fn a_certificate_is_listed_once_by_its_seedelf_register_and_value() {
        let mut list = List::new(MICROS);
        assert_eq!(keep(&mut list, 1, 1), Listed::New);
        // The same key with another proof: other bytes, the same listing.
        let again = shaped(1, 1, 9);
        assert_eq!(listed(&mut list, &again, CAP), Ok(Listed::Already));
        assert_eq!((list.certificates(), list.len(), list.bytes()), (1, 1, 273));
        // Another m_S for the same Seedelf: its second.
        assert_eq!(keep(&mut list, 1, 2), Listed::New);
        assert_eq!(list.certificates(), 2);
    }

    #[test]
    fn a_seedelf_has_at_most_two_values_and_the_rest_wait_for_room() {
        let mut list = List::new(MICROS);
        keep(&mut list, 1, 1);
        keep(&mut list, 1, 2);
        // A third m_S is refused, whatever room the list has...
        assert_eq!(listed(&mut list, &shaped(1, 3, 0), CAP), Err(Unlisted::Two));
        // ...while either held one is still "already".
        assert_eq!(
            listed(&mut list, &shaped(1, 2, 7), CAP),
            Ok(Listed::Already)
        );
        // Another Seedelf has room of its own.
        assert_eq!(keep(&mut list, 2, 3), Listed::New);
        assert_eq!(list.certificates(), 3);
    }

    /// The cap refuses the next certificate, never pushes out a held one:
    /// what's held stays, in order, however many posts are refused.
    #[test]
    fn a_full_list_refuses_and_pushes_out_nothing() {
        let mut list = List::new(MICROS);
        let cap = 3 * 273;
        for i in 0..3 {
            assert_eq!(listed(&mut list, &shaped(i, 0, 0), cap), Ok(Listed::New));
        }
        for i in 3..100 {
            assert_eq!(
                listed(&mut list, &shaped(i, 0, 0), cap),
                Err(Unlisted::Full)
            );
        }
        let page = list.page(None, PAGE_BYTES);
        assert_eq!(ids(&page), vec![(0, 0), (1, 0), (2, 0)]);
        assert_eq!(list.bytes(), cap);
        // Held ones are still "already" when the list is full.
        assert_eq!(
            listed(&mut list, &shaped(2, 0, 5), cap),
            Ok(Listed::Already)
        );
        // A Seedelf's two is said before the cap.
        let mut two = List::new(MICROS);
        keep(&mut two, 1, 1);
        keep(&mut two, 1, 2);
        assert_eq!(listed(&mut two, &shaped(1, 3, 0), 0), Err(Unlisted::Two));
    }

    #[test]
    fn a_reader_pages_through_in_order_and_keeps_up() {
        let mut list = List::new(MICROS);
        // 300 certificates of 273 bytes: 81,900, more than a page.
        for i in 0..300 {
            keep(&mut list, i, 0);
        }
        let first = list.page(None, PAGE_BYTES);
        assert_eq!(first.flags, MORE);
        let per_page = PAGE_BYTES / 273;
        assert_eq!(first.entries.len(), per_page);
        assert_eq!(first.cursor, MICROS + per_page as u64 - 1);
        let second = list.page(Some(first.cursor), PAGE_BYTES);
        assert_eq!(second.flags, 0);
        let both: Vec<_> = ids(&first).into_iter().chain(ids(&second)).collect();
        assert_eq!(both, (0..300).map(|i| (i, 0)).collect::<Vec<_>>());
        // Caught up: nothing, and the same cursor.
        let third = list.page(Some(second.cursor), PAGE_BYTES);
        assert_eq!((third.flags, third.cursor), (0, second.cursor));
        assert!(third.entries.is_empty());
        // Then only what's new.
        keep(&mut list, 300, 0);
        let fourth = list.page(Some(third.cursor), PAGE_BYTES);
        assert_eq!((fourth.flags, ids(&fourth)), (0, vec![(300, 0)]));
        // A page holds at least one entry, however small its limit.
        let one = list.page(None, 1);
        assert_eq!((one.flags, one.entries.len()), (MORE, 1));
    }

    #[test]
    fn an_empty_lists_cursor_is_where_it_starts_and_a_strange_one_is_a_gap() {
        let mut list = List::new(MICROS);
        let page = list.page(None, PAGE_BYTES);
        assert_eq!((page.flags, page.cursor), (0, MICROS - 1));
        keep(&mut list, 1, 0);
        keep(&mut list, 2, 0);
        let page = list.page(Some(MICROS - 1), PAGE_BYTES);
        assert_eq!((page.flags, ids(&page)), (0, vec![(1, 0), (2, 0)]));
        // A cursor the list never gave: everything, from the oldest, a gap.
        let page = list.page(Some(MICROS + 1_000_000), PAGE_BYTES);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![(1, 0), (2, 0)]));
        // One from before the list was loaded: the same.
        let page = list.page(Some(MICROS - 2), PAGE_BYTES);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![(1, 0), (2, 0)]));
    }

    /// A removal entry, through the test-only drop: it comes at the next
    /// number, so a reader who read the certificate is told to drop it; one
    /// who didn't read it no longer gets it; its Seedelf has room again;
    /// and the cap counts the removal's 32 bytes in its place.
    #[test]
    fn a_dropped_certificate_leaves_a_removal_that_every_reader_after_it_reads() {
        let mut list = List::new(MICROS);
        keep(&mut list, 1, 1);
        keep(&mut list, 1, 2);
        keep(&mut list, 2, 0);
        let read = list.page(None, PAGE_BYTES).cursor;
        let second = shaped(1, 2, 0);
        let digest = certificate::listing_digest("preprod", &second);
        assert!(list.withdraw(&digest, DAY));
        assert!(!list.withdraw(&digest, DAY));
        assert!(list.withdrawn(&digest) && list.withdrawals() == 1);
        // Its removal's 32 bytes, and the withdrawn digest's.
        assert_eq!(
            (list.certificates(), list.len(), list.bytes()),
            (2, 3, 2 * 273 + 32 + 32)
        );
        // The reader who held it is told to drop it, and nothing more.
        let page = list.page(Some(read), PAGE_BYTES);
        assert_eq!(
            (page.flags, ids(&page), removals(&page)),
            (0, vec![], vec![digest])
        );
        // A fresh reader never sees it: the certificates held, then the
        // removal, which names nothing it holds.
        let fresh = list.page(None, PAGE_BYTES);
        assert_eq!(ids(&fresh), vec![(1, 1), (2, 0)]);
        assert_eq!(removals(&fresh), vec![digest]);
        assert_eq!(fresh.entries.last().unwrap().kind(), REMOVAL);
        // Its Seedelf has room for another m_S, and the same one again is new.
        assert_eq!(keep(&mut list, 1, 3), Listed::New);
        assert_eq!(listed(&mut list, &shaped(1, 4, 0), CAP), Err(Unlisted::Two));
        // Its exact bytes are never listed again; the same listing made with
        // a fresh aux, other bytes, is.
        let mut again = List::new(MICROS);
        keep(&mut again, 1, 2);
        assert!(again.withdraw(&digest, DAY));
        assert_eq!(listed(&mut again, &second, CAP), Err(Unlisted::Withdrawn));
        assert_eq!(listed(&mut again, &shaped(1, 2, 1), CAP), Ok(Listed::New));
        let page = again.page(None, PAGE_BYTES);
        assert_eq!(
            page.entries.iter().map(Item::kind).collect::<Vec<_>>(),
            [REMOVAL, CERTIFICATE]
        );
    }

    #[test]
    fn a_clean_snapshot_restores_everything_and_no_gap() {
        let mut list = List::new(MICROS);
        keep(&mut list, 1, 1);
        keep(&mut list, 1, 2);
        keep(&mut list, 2, 0);
        let digest = certificate::listing_digest("preprod", &shaped(2, 0, 0));
        list.withdraw(&digest, DAY);
        let cursor = list.page(None, PAGE_BYTES).cursor;
        let bytes = list.snapshot().encode();
        assert!(!list.changed);
        let snapshot = Snapshot::decode(&bytes).unwrap();
        let mut back = List::restore(
            snapshot,
            true,
            "preprod",
            NETWORK_PREPROD,
            MICROS + 20_000_000,
        )
        .unwrap();
        assert!(!back.changed);
        // The removal's 32 bytes and the withdrawn digest's.
        assert_eq!(
            (back.certificates(), back.len(), back.bytes()),
            (2, 3, 2 * 273 + 64)
        );
        // The withdrawal lasts across it.
        assert!(back.withdrawn(&digest));
        assert_eq!(
            listed(&mut back, &shaped(2, 0, 0), CAP),
            Err(Unlisted::Withdrawn)
        );
        // The same entries, and numbering on from the later of the file's
        // and the clock, as a pool's.
        let (old, new) = (list.page(None, PAGE_BYTES), back.page(None, PAGE_BYTES));
        assert_eq!((new.flags, &new.entries), (old.flags, &old.entries));
        assert_eq!(new.cursor, MICROS + 20_000_000 - 1);
        // Held across: "already", and the Seedelf at its two.
        assert_eq!(keep(&mut back, 1, 1), Listed::Already);
        assert_eq!(listed(&mut back, &shaped(1, 3, 0), CAP), Err(Unlisted::Two));
        let page = back.page(Some(cursor), PAGE_BYTES);
        assert_eq!((page.flags, page.entries.len()), (0, 0));
        // Numbering goes on above everything given out.
        keep(&mut back, 3, 0);
        let page = back.page(Some(cursor), PAGE_BYTES);
        assert_eq!((page.flags, ids(&page)), (0, vec![(3, 0)]));
        assert!(page.cursor >= MICROS + 20_000_000);
        // The same bytes again.
        assert_eq!(back.snapshot().encode().len(), bytes.len() + 8 + 3 + 273);
    }

    /// After a crash, a reader who read what the last save missed is told
    /// of a gap, and its page starts from the oldest entry, since it drops
    /// its copy and reads the list again; a reader who starts now is told
    /// of none.
    #[test]
    fn after_a_crash_every_earlier_cursor_reads_the_list_again() {
        let mut list = List::new(MICROS);
        keep(&mut list, 1, 0);
        keep(&mut list, 2, 0);
        let saved_cursor = list.page(None, PAGE_BYTES).cursor;
        let bytes = list.snapshot().encode();
        keep(&mut list, 3, 0);
        let lost_cursor = list.page(None, PAGE_BYTES).cursor;
        let snapshot = Snapshot::decode(&bytes).unwrap();
        let mut back = List::restore(
            snapshot,
            false,
            "preprod",
            NETWORK_PREPROD,
            MICROS + 40_000_000,
        )
        .unwrap();
        assert!(back.changed);
        keep(&mut back, 4, 0);
        for cursor in [saved_cursor, lost_cursor] {
            let page = back.page(Some(cursor), PAGE_BYTES);
            assert_eq!(
                (page.flags, ids(&page)),
                (GAP, vec![(1, 0), (2, 0), (4, 0)])
            );
            assert!(page.cursor > lost_cursor);
            // Read on from it: no gap again.
            let on = back.page(Some(page.cursor), PAGE_BYTES);
            assert_eq!((on.flags, on.entries.len()), (0, 0));
        }
        let page = back.page(None, PAGE_BYTES);
        assert_eq!(page.flags, 0);
        // The lost one is new again.
        assert_eq!(keep(&mut back, 3, 0), Listed::New);
    }

    #[test]
    fn a_snapshot_that_isnt_one_is_refused() {
        let mut list = List::new(MICROS);
        keep(&mut list, 1, 0);
        keep(&mut list, 2, 0);
        list.withdraw(
            &certificate::listing_digest("preprod", &shaped(1, 0, 0)),
            DAY,
        );
        let good = list.snapshot().encode();
        assert!(Snapshot::decode(&good).is_some());
        assert!(Snapshot::decode(&[]).is_none());
        for len in 0..good.len() {
            assert!(Snapshot::decode(&good[..len]).is_none(), "{len}");
        }
        let mut longer = good.clone();
        longer.push(0);
        assert!(Snapshot::decode(&longer).is_none());
        let mut version = good.clone();
        version[0] = 2;
        assert!(Snapshot::decode(&version).is_none());
        // The certificate at 21, the removal after it.
        let first = 21;
        let second = first + 11 + 273;
        // A removal's day cut, or a byte more: not one.
        let mut short_removal = good.clone();
        short_removal[second + 9..second + 11].copy_from_slice(&32u16.to_be_bytes());
        assert!(Snapshot::decode(&short_removal).is_none());
        // The re-check's place last: none yet, its time and a 0. Any other
        // place than its three isn't one, nor a key cut short.
        let place = good.len() - 1;
        assert_eq!(&good[place - 8..], &[0; 9]);
        let mut round = good.clone();
        round[place] = 3;
        assert!(Snapshot::decode(&round).is_none());
        round[place] = 2;
        assert!(Snapshot::decode(&round).is_none());
        round.extend_from_slice(&[7; 31]);
        assert!(Snapshot::decode(&round).is_none());
        round.push(7);
        assert!(Snapshot::decode(&round).is_some());
        // A withdrawn Seedelf with no name, or none of its digests.
        let tail = place - 8 - (4 + 1 + 1 + 96 + 1 + 32);
        let mut nameless = good.clone();
        nameless[tail + 4] = 0;
        assert!(Snapshot::decode(&nameless).is_none());
        let mut none = good.clone();
        none[tail + 4 + 1 + 1 + 96] = 0;
        none.drain(tail + 4 + 1 + 1 + 96 + 1..place - 8);
        let none = Snapshot::decode(&none).unwrap();
        assert!(List::restore(none, true, "preprod", NETWORK_PREPROD, MICROS).is_none());
        let mut kind = good.clone();
        kind[first + 8] = 3;
        assert!(Snapshot::decode(&kind).is_none());
        let mut swapped = good.clone();
        swapped[first + 8] = REMOVAL;
        assert!(Snapshot::decode(&swapped).is_none());
        let mut order = good.clone();
        let (a, b) = (
            good[first..first + 8].to_vec(),
            good[second..second + 8].to_vec(),
        );
        order[first..first + 8].copy_from_slice(&b);
        order[second..second + 8].copy_from_slice(&a);
        assert!(Snapshot::decode(&order).is_none());
        let mut count = good.clone();
        count[17..21].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(Snapshot::decode(&count).is_none());
        // A certificate whose shape isn't this pool's, read back: nothing.
        let snapshot = Snapshot::decode(&good).unwrap();
        assert!(List::restore(snapshot, true, "mainnet", 0x01, MICROS).is_none());
        // One held twice, or a third for one Seedelf: never a save's.
        let twice = Snapshot {
            next: MICROS + 2,
            forgotten: MICROS - 1,
            entries: vec![
                (MICROS, Item::Certificate(shaped(1, 0, 0).into()), 0),
                (MICROS + 1, Item::Certificate(shaped(1, 0, 1).into()), 0),
            ],
            withdrawn: vec![],
            recheck: Recheck::default(),
        };
        assert!(List::restore(twice, true, "preprod", NETWORK_PREPROD, MICROS).is_none());
        let three = Snapshot {
            next: MICROS + 3,
            forgotten: MICROS - 1,
            entries: (0..3)
                .map(|i| {
                    (
                        MICROS + i,
                        Item::Certificate(shaped(1, i as u32, 0).into()),
                        0,
                    )
                })
                .collect(),
            withdrawn: vec![],
            recheck: Recheck::default(),
        };
        assert!(List::restore(three, true, "preprod", NETWORK_PREPROD, MICROS).is_none());
    }

    fn seedelf_of(bytes: &[u8]) -> [u8; 32] {
        Key::of(&check_shape(bytes, NETWORK_PREPROD, &POLICY).unwrap()).seedelf
    }

    fn digest(bytes: &[u8]) -> [u8; 32] {
        certificate::listing_digest("preprod", bytes)
    }

    /// Withdrawn digests count 32 bytes each against the cap, as removals
    /// do, and survive a snapshot with the Seedelf and register they name;
    /// `judge` forgets them only once the Seedelf has been found elsewhere
    /// three times in a row, a time it's found there starting the count
    /// again, and gives their bytes back.
    #[test]
    fn withdrawn_digests_count_against_the_cap_last_and_go_after_three_absences() {
        let mut list = List::new(MICROS);
        let (a, b) = (shaped(1, 1, 0), shaped(2, 1, 0));
        for bytes in [&a, &b] {
            listed(&mut list, bytes, CAP).unwrap();
        }
        assert!(list.withdraw(&digest(&a), DAY));
        assert_eq!(list.bytes(), 273 + 32 + 32);
        // A cap of what's held now: no room for one more.
        let cap = list.bytes() + 272;
        assert_eq!(
            listed(&mut list, &shaped(3, 1, 0), cap),
            Err(Unlisted::Full)
        );
        let snapshot = Snapshot::decode(&list.snapshot().encode()).unwrap();
        let mut back = List::restore(snapshot, true, "preprod", NETWORK_PREPROD, MICROS).unwrap();
        assert_eq!((back.withdrawals(), back.bytes()), (1, 273 + 64));
        assert_eq!(listed(&mut back, &a, CAP), Err(Unlisted::Withdrawn));
        // The withdrawn Seedelf is known by name and register, listed or not.
        let here = seedelf_of(&a);
        assert!(back.seedelfs().contains(&here));
        let (name, register) = back.seedelf(&here).unwrap();
        assert_eq!((name, &register[..]), (vec![0x5e], &a[33..129]));
        // Found elsewhere twice, then there: kept, the count starts again.
        for (view, present) in [false, false, true, false, false].into_iter().enumerate() {
            assert_eq!(
                back.judge("preprod", &here, present, DAY, view as u64 + 1),
                0
            );
            assert!(back.withdrawn(&digest(&a)), "{present}");
        }
        // A third time in a row: forgotten, its 32 bytes back.
        back.changed = false;
        assert_eq!(back.judge("preprod", &here, false, DAY, 6), 0);
        assert!(!back.withdrawn(&digest(&a)) && back.changed);
        assert_eq!(back.bytes(), 273 + 32);
        assert!(!back.seedelfs().contains(&here));
        // A listed certificate found elsewhere goes at once, for a removal,
        // and keeps no withdrawn digest: those bytes are the chain check's.
        assert_eq!(back.judge("preprod", &seedelf_of(&b), false, DAY, 7), 1);
        assert_eq!((back.withdrawals(), back.certificates()), (0, 0));
        assert_eq!(listed(&mut back, &b, CAP), Ok(Listed::New));
    }

    /// At most 128 withdrawn for one Seedelf at one register: then no
    /// certificate is listed for it there, whatever its m_S or bytes, and
    /// every withdrawn one stays refused; another Seedelf, or the same at
    /// another register, is listed as ever.
    #[test]
    fn a_seedelf_withdrawn_too_often_at_its_register_takes_no_more() {
        let mut list = List::new(MICROS);
        for i in 0..MOST_WITHDRAWN as u32 {
            let bytes = shaped(1, i, 0);
            assert_eq!(listed(&mut list, &bytes, CAP), Ok(Listed::New), "{i}");
            assert!(list.withdraw(&digest(&bytes), DAY));
        }
        assert!(list.too_often(&seedelf_of(&shaped(1, 0, 0))));
        assert_eq!(list.withdrawals(), MOST_WITHDRAWN);
        for bytes in [shaped(1, 999, 0), shaped(1, 0, 0), shaped(1, 0, 7)] {
            let refused = listed(&mut list, &bytes, CAP).unwrap_err();
            assert!(matches!(refused, Unlisted::TooOften | Unlisted::Withdrawn));
        }
        assert_eq!(
            listed(&mut list, &shaped(1, 999, 0), CAP),
            Err(Unlisted::TooOften)
        );
        assert_eq!(listed(&mut list, &shaped(2, 0, 0), CAP), Ok(Listed::New));
        // Each loop leaves a removal and a digest: 128 of each, then no more.
        assert_eq!(list.bytes(), 273 + MOST_WITHDRAWN * 64);
        // Forgotten after three absences: the Seedelf at that register is
        // new again, as when it's moved.
        let key = seedelf_of(&shaped(1, 0, 0));
        for view in 0..ABSENT_TO_FORGET {
            list.judge("preprod", &key, false, DAY, u64::from(view) + 1);
        }
        assert!(!list.too_often(&key));
        assert_eq!(listed(&mut list, &shaped(1, 999, 0), CAP), Ok(Listed::New));
    }

    /// Removals stay a whole week: one made on a day goes on the eighth
    /// day after it, never the seventh, from the oldest, giving its bytes
    /// back; what's left is numbered again, so every cursor from before is
    /// one gap, whose reader reads the list again from the oldest and then
    /// reads on with none. Their days survive a snapshot.
    #[test]
    fn removals_stay_a_whole_week_and_every_older_cursor_is_then_one_gap() {
        let mut list = List::new(MICROS);
        for i in 0..4 {
            keep(&mut list, i, 0);
        }
        let before = list.page(None, PAGE_BYTES).cursor;
        list.withdraw(&digest(&shaped(0, 0, 0)), DAY);
        let between = list.page(Some(before), PAGE_BYTES).cursor;
        list.withdraw(&digest(&shaped(1, 0, 0)), DAY + 3);
        let after = list.page(Some(between), PAGE_BYTES).cursor;
        let snapshot = Snapshot::decode(&list.snapshot().encode()).unwrap();
        let mut list = List::restore(snapshot, true, "preprod", NETWORK_PREPROD, MICROS).unwrap();
        let bytes = list.bytes();
        // Seven days on, nothing goes: one made late on its day has stayed
        // only six whole days and a bit.
        assert_eq!(list.compact(DAY + 7), 0);
        assert_eq!(list.page(Some(before), PAGE_BYTES).flags, 0);
        // The eighth: the first goes.
        assert_eq!(list.compact(DAY + 8), 1);
        assert_eq!(list.bytes(), bytes - 32);
        for cursor in [before, between, after] {
            let page = list.page(Some(cursor), PAGE_BYTES);
            assert_eq!(
                (page.flags, ids(&page), removals(&page)),
                (GAP, vec![(2, 0), (3, 0)], vec![digest(&shaped(1, 0, 0))])
            );
            let on = list.page(Some(page.cursor), PAGE_BYTES);
            assert_eq!((on.flags, on.entries.len()), (0, 0));
        }
        // The second, a week and a day after its own.
        assert_eq!(list.compact(DAY + 3 + 7), 0);
        assert_eq!(list.compact(DAY + 3 + 8), 1);
        assert_eq!(list.certificates(), 2);
        assert_eq!(list.compact(DAY + 100), 0);
        assert!(removals(&list.page(None, PAGE_BYTES)).is_empty());
    }

    /// A wallet's read from `after`: page after page until none follows, its
    /// copy dropped at each gap, each removal taking out what it names,
    /// within `most` bytes a page when given (messaging's reserve). What it
    /// holds then, by (Seedelf, m_S) in the order read, the gaps it met, and
    /// the cursor it ends on. A read that takes more pages than the list
    /// could fill is stuck.
    fn read_through(
        list: &List,
        after: Option<u64>,
        most: Option<usize>,
    ) -> (Vec<(u32, u32)>, usize, u64) {
        let (mut after, mut held, mut gaps) = (after, Vec::<([u8; 32], (u32, u32))>::new(), 0);
        for _ in 0..=list.len() {
            let page = match most {
                Some(most) => list.page_within(after, most),
                None => list.page(after, PAGE_BYTES),
            };
            if page.flags & GAP != 0 {
                held.clear();
                gaps += 1;
            }
            for item in &page.entries {
                match item {
                    Item::Certificate(bytes) => held.push((
                        digest(bytes),
                        (
                            u32::from_be_bytes(bytes[33..37].try_into().unwrap()),
                            u32::from_be_bytes(bytes[129..133].try_into().unwrap()),
                        ),
                    )),
                    Item::Removal(gone) => held.retain(|(digest, _)| digest != gone),
                }
            }
            after = Some(page.cursor);
            if page.flags & MORE == 0 {
                return (
                    held.into_iter().map(|(_, id)| id).collect(),
                    gaps,
                    page.cursor,
                );
            }
        }
        panic!("a read from {after:?} is stuck");
    }

    /// 55c's review, H1: a list of many pages, compacted, or restored after
    /// a crash, is read from any cursor given out before, whole pages or
    /// the reserve's, to its end: one gap, then every page on, holding what
    /// the list holds; a reader who read up to the moment it was numbered
    /// again meets one gap too, and nothing after it.
    #[test]
    fn after_a_compaction_or_a_crash_every_older_cursor_reads_a_long_list_to_its_end() {
        let mut list = List::new(MICROS);
        // 600 certificates: more than two pages.
        for i in 0..600 {
            keep(&mut list, i, 0);
        }
        let stale = Some(MICROS + 10);
        let before = read_through(&list, None, None).2;
        assert!(list.withdraw(&digest(&shaped(599, 0, 0)), DAY));
        // Up to the moment before it's numbered again.
        let (_, gaps, latest) = read_through(&list, Some(before), None);
        assert_eq!(gaps, 0);
        let want: Vec<(u32, u32)> = (0..599).map(|i| (i, 0)).collect();
        assert_eq!(list.compact(DAY + 8), 1);
        let readers = |list: &List, cursors: &[Option<u64>]| {
            for &cursor in cursors {
                for most in [None, Some(16 * 1024), Some(400)] {
                    let (held, gaps, end) = read_through(list, cursor, most);
                    assert_eq!(held, want, "{cursor:?} {most:?}");
                    assert_eq!(gaps, usize::from(cursor.is_some()), "{cursor:?} {most:?}");
                    let on = list.page(Some(end), PAGE_BYTES);
                    assert_eq!((on.flags, on.entries.len()), (0, 0));
                }
            }
        };
        readers(&list, &[None, stale, Some(before), Some(latest)]);
        // Read to its end since: the same after a crash.
        let since = read_through(&list, Some(latest), None).2;
        let snapshot = Snapshot::decode(&list.snapshot().encode()).unwrap();
        let back = List::restore(
            snapshot,
            false,
            "preprod",
            NETWORK_PREPROD,
            MICROS + 60_000_000,
        )
        .unwrap();
        readers(
            &back,
            &[None, stale, Some(before), Some(latest), Some(since)],
        );
        assert!(back.page(None, PAGE_BYTES).cursor > since);
        // A clean restore numbers nothing again: a reader who'd read to the
        // end reads nothing new.
        let snapshot = Snapshot::decode(&list.snapshot().encode()).unwrap();
        let clean = List::restore(snapshot, true, "preprod", NETWORK_PREPROD, MICROS).unwrap();
        let on = clean.page(Some(since), PAGE_BYTES);
        assert_eq!((on.flags, on.entries.len()), (0, 0));
        // And its index follows: a renumbered certificate is still found,
        // withdrawn, and its Seedelf's two counted.
        let mut back = back;
        assert!(back.withdraw(&digest(&shaped(5, 0, 0)), DAY + 8));
        assert_eq!(keep(&mut back, 6, 0), Listed::Already);
        assert_eq!(keep(&mut back, 6, 1), Listed::New);
        assert_eq!(listed(&mut back, &shaped(6, 2, 0), CAP), Err(Unlisted::Two));
    }

    /// 127 withdrawn: one more is listed, a second isn't, since it too
    /// could be withdrawn; so its withdrawn never pass 128.
    #[test]
    fn two_listed_at_127_withdrawn_never_make_129() {
        let mut list = List::new(MICROS);
        for i in 0..MOST_WITHDRAWN as u32 - 1 {
            let bytes = shaped(1, i, 0);
            assert_eq!(listed(&mut list, &bytes, CAP), Ok(Listed::New), "{i}");
            assert!(list.withdraw(&digest(&bytes), DAY));
        }
        let key = seedelf_of(&shaped(1, 0, 0));
        assert!(!list.too_often(&key));
        assert_eq!(listed(&mut list, &shaped(1, 500, 0), CAP), Ok(Listed::New));
        assert!(list.too_often(&key));
        assert_eq!(
            listed(&mut list, &shaped(1, 501, 0), CAP),
            Err(Unlisted::TooOften)
        );
        // Held, it's "already" still.
        assert_eq!(keep(&mut list, 1, 500), Listed::Already);
        assert!(list.withdraw(&digest(&shaped(1, 500, 0)), DAY));
        assert_eq!(list.withdrawals(), MOST_WITHDRAWN);
        assert_eq!(
            listed(&mut list, &shaped(1, 501, 0), CAP),
            Err(Unlisted::TooOften)
        );
    }

    /// An absence counts once a view: a view read again, the same tip's
    /// answer or a kept one, counts nothing more, so a source stuck on one
    /// tip forgets no withdrawn digest however often it's read.
    #[test]
    fn an_absence_counts_once_a_view_of_the_chain() {
        let mut list = List::new(MICROS);
        let a = shaped(1, 1, 0);
        listed(&mut list, &a, CAP).unwrap();
        assert!(list.withdraw(&digest(&a), DAY));
        let here = seedelf_of(&a);
        for _ in 0..10 {
            list.judge("preprod", &here, false, DAY, 7);
        }
        assert!(list.withdrawn(&digest(&a)));
        for _ in 0..10 {
            list.judge("preprod", &here, false, DAY, 8);
        }
        assert!(list.withdrawn(&digest(&a)));
        // Found there on another: the count starts again, and the view seen
        // before counts once more.
        list.judge("preprod", &here, true, DAY, 9);
        list.judge("preprod", &here, false, DAY, 8);
        list.judge("preprod", &here, false, DAY, 10);
        assert!(list.withdrawn(&digest(&a)));
        list.judge("preprod", &here, false, DAY, 11);
        assert!(!list.withdrawn(&digest(&a)));
        // The sweep's views count so too.
        let b = shaped(2, 1, 0);
        listed(&mut list, &b, CAP).unwrap();
        assert!(list.withdraw(&digest(&b), DAY));
        for view in [20, 20, 20, 21, 21] {
            list.sweep("preprod", DAY, view, |_, _| false);
        }
        assert!(list.withdrawn(&digest(&b)));
        list.sweep("preprod", DAY, 22, |_, _| false);
        assert!(!list.withdrawn(&digest(&b)));
    }

    /// A withdrawal whose save failed is put back: its digest no longer
    /// kept, and its certificate listed again after the removal, so a reader
    /// who read the removal reads it again and one from the oldest holds
    /// it. Not when its Seedelf has two again.
    #[test]
    fn a_withdrawal_put_back_lists_its_certificate_again_after_its_removal() {
        let mut list = List::new(MICROS);
        keep(&mut list, 1, 1);
        keep(&mut list, 2, 0);
        let read = list.page(None, PAGE_BYTES).cursor;
        let bytes = Bytes::from(shaped(1, 1, 0));
        let gone = digest(&bytes);
        assert!(list.withdraw(&gone, DAY));
        let removal = list.page(Some(read), PAGE_BYTES);
        assert_eq!(removals(&removal), vec![gone]);
        assert!(list.unwithdraw("preprod", &bytes));
        assert!(!list.withdrawn(&gone));
        assert_eq!(list.certificate(&gone), Some(bytes.clone()));
        // Its removal's bytes stay until it goes.
        assert_eq!(list.bytes(), 2 * 273 + 32);
        let page = list.page(Some(removal.cursor), PAGE_BYTES);
        assert_eq!((page.flags, ids(&page)), (0, vec![(1, 1)]));
        assert_eq!(
            list.page(Some(read), PAGE_BYTES)
                .entries
                .iter()
                .map(Item::kind)
                .collect::<Vec<_>>(),
            [REMOVAL, CERTIFICATE]
        );
        assert_eq!(read_through(&list, None, None).0, vec![(2, 0), (1, 1)]);
        assert_eq!(keep(&mut list, 1, 1), Listed::Already);
        // Withdrawn again; then its Seedelf lists two more, and it can't
        // come back: the withdrawal stands.
        assert!(list.withdraw(&gone, DAY));
        keep(&mut list, 1, 2);
        keep(&mut list, 1, 3);
        assert!(!list.unwithdraw("preprod", &bytes));
        assert!(list.withdrawn(&gone) && list.certificate(&gone).is_none());
    }

    /// The re-check walks the Seedelfs the list knows by key, smallest
    /// first, and its place is saved with the list, clean or not.
    #[test]
    fn the_rechecks_place_is_saved_with_the_list() {
        let mut list = List::new(MICROS);
        for i in 0..3 {
            keep(&mut list, i, 0);
        }
        let mut keys: Vec<[u8; 32]> = (0..3).map(|i| seedelf_of(&shaped(i, 0, 0))).collect();
        keys.sort();
        assert_eq!(list.seedelf_after(None), Some(keys[0]));
        assert_eq!(list.seedelf_after(Some(&keys[0])), Some(keys[1]));
        assert_eq!(list.seedelf_after(Some(&keys[2])), None);
        // A withdrawn Seedelf, listed no more, is walked too.
        let mut walked = vec![];
        let withdrawn = shaped(9, 0, 0);
        listed(&mut list, &withdrawn, CAP).unwrap();
        list.withdraw(&digest(&withdrawn), DAY);
        let mut at = None;
        while let Some(key) = list.seedelf_after(at.as_ref()) {
            walked.push(key);
            at = Some(key);
        }
        assert_eq!(walked.len(), 4);
        assert!(walked.contains(&seedelf_of(&withdrawn)));
        for place in [
            Recheck::default(),
            Recheck {
                began: 1_800_000_000,
                at: RoundAt::Start,
            },
            Recheck {
                began: 1_800_000_000,
                at: RoundAt::After(keys[1]),
            },
        ] {
            list.changed = false;
            list.set_recheck(place);
            assert_eq!(list.changed, place != Recheck::default());
            let bytes = list.snapshot().encode();
            for clean in [true, false] {
                let snapshot = Snapshot::decode(&bytes).unwrap();
                let back =
                    List::restore(snapshot, clean, "preprod", NETWORK_PREPROD, MICROS).unwrap();
                assert_eq!(back.recheck(), place);
            }
        }
    }

    /// The sweep judges every Seedelf the list knows at once: what isn't
    /// there goes, each for a removal entry in the list's order, and the
    /// rest stay.
    #[test]
    fn the_sweep_drops_what_isnt_there_for_removals_in_order() {
        let mut list = List::new(MICROS);
        for i in 0..6 {
            keep(&mut list, i, 0);
        }
        let read = list.page(None, PAGE_BYTES).cursor;
        let odd = |register: &[u8; 96]| register[3] % 2 == 1;
        let passes = list.passes;
        assert_eq!(
            list.sweep("preprod", DAY, 1, |_, register| !odd(register)),
            3
        );
        // Taken out in one pass, however many go.
        assert_eq!(list.passes, passes + 1);
        assert_eq!(list.certificates(), 3);
        let page = list.page(Some(read), PAGE_BYTES);
        let mut gone = removals(&page);
        gone.sort();
        let mut expected: Vec<[u8; 32]> = [1, 3, 5].map(|i| digest(&shaped(i, 0, 0))).to_vec();
        expected.sort();
        assert_eq!((ids(&page), gone), (vec![], expected));
        assert_eq!(
            ids(&list.page(None, PAGE_BYTES)),
            vec![(0, 0), (2, 0), (4, 0)]
        );
        assert_eq!(list.sweep("preprod", DAY, 2, |_, _| true), 0);
        assert_eq!(list.passes, passes + 1);
    }

    /// An `already` names the bytes held: another posting of the same
    /// listing, a fresh aux, is other bytes.
    #[test]
    fn the_certificate_held_for_a_listing_is_found_by_its_key() {
        let mut list = List::new(MICROS);
        let (first, fresh) = (shaped(1, 1, 0), shaped(1, 1, 9));
        listed(&mut list, &first, CAP).unwrap();
        let key = Key::of(&check_shape(&fresh, NETWORK_PREPROD, &POLICY).unwrap());
        assert_eq!(list.held(&key).unwrap(), first);
        assert!(
            list.held(&Key::of(
                &check_shape(&shaped(1, 2, 0), NETWORK_PREPROD, &POLICY).unwrap()
            ))
            .is_none()
        );
    }

    /// A restore never cuts a list to its cap: a cap lowered since refuses
    /// what comes next, and pushes out nothing held.
    #[test]
    fn a_restore_past_the_cap_keeps_everything_and_refuses_the_next() {
        let mut list = List::new(MICROS);
        for i in 0..4 {
            keep(&mut list, i, 0);
        }
        let snapshot = Snapshot::decode(&list.snapshot().encode()).unwrap();
        let mut back = List::restore(snapshot, true, "preprod", NETWORK_PREPROD, MICROS).unwrap();
        assert_eq!(back.certificates(), 4);
        assert_eq!(
            listed(&mut back, &shaped(9, 0, 0), 273),
            Err(Unlisted::Full)
        );
        assert_eq!(back.certificates(), 4);
    }

    #[test]
    fn a_page_is_its_header_then_its_entries() {
        let page = Page {
            flags: MORE | GAP,
            cursor: 0x0102_0304_0506_0708,
            entries: vec![
                Item::Certificate(Bytes::from_static(&[9; 3])),
                Item::Removal([7; 32]),
            ],
        };
        let bytes = encode(&page, 16);
        assert_eq!(
            bytes,
            [
                &[1, 3, 1, 2, 3, 4, 5, 6, 7, 8, 16, 0, 2][..],
                &[1, 0, 3, 9, 9, 9],
                &[2, 0, 32],
                &[7; 32],
            ]
            .concat()
        );
        assert_eq!(bytes.len(), PAGE_HEADER + 2 * FRAME_LEN + 3 + 32);
        let empty = Page {
            flags: 0,
            cursor: 0,
            entries: vec![],
        };
        assert_eq!(encode(&empty, 0).len(), PAGE_HEADER);
    }

    /// In messaging's reserve, a page is never longer than the reserve
    /// sends, its framing counted, and the pages hold every entry once.
    #[test]
    fn a_page_in_the_reserve_is_never_longer_than_the_reserve_sends() {
        let mut list = List::new(MICROS);
        for i in 0..300 {
            keep(&mut list, i, 0);
        }
        for most in [400, 1024, 16 * 1024, 64 * 1024, 70 * 1024, 1 << 20] {
            let page = list.page_within(None, most);
            let len = encode(&page, 0).len();
            assert!(
                len <= most.max(PAGE_HEADER + FRAME_LEN + 273),
                "{most}: {len}"
            );
            assert_eq!(page.flags, MORE, "{most}");
            assert!(page.entries.len() * 273 <= PAGE_BYTES, "{most}");
        }
        let (mut after, mut seen) = (None, vec![]);
        loop {
            let page = list.page_within(after, 16 * 1024);
            assert!(encode(&page, 0).len() <= 16 * 1024);
            seen.extend(ids(&page));
            after = Some(page.cursor);
            if page.flags & MORE == 0 {
                break;
            }
        }
        assert_eq!(seen, (0..300).map(|i| (i, 0)).collect::<Vec<_>>());
    }
}
