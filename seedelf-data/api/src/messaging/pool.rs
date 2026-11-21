//! One network's pool of envelopes (docs/protocol.md §17): bytes and when
//! they came, in the order they came, for 36 hours.
//!
//! **Cursors.** Each envelope kept gets the next number, starting from the
//! Unix time in microseconds when the pool was loaded, so a pool that lost
//! what it held (a crash between snapshots, a deleted file) still numbers
//! above every cursor it gave out. A reader asks for what follows its
//! cursor. `forgotten` is the highest number the pool no longer has, or
//! may never have saved: a cursor below it may have missed something, and
//! the page says so (its `gap` flag). That's all a number says: no time.

use std::collections::{HashMap, VecDeque};

use axum::body::Bytes;

/// How long an envelope is kept: 36 hours.
pub const KEPT_FOR: i64 = 36 * 3600;

/// A page holds whole envelopes up to this many bytes.
pub const PAGE_BYTES: usize = 256 * 1024;

/// The page's format version.
pub const PAGE_VERSION: u8 = 1;
/// Flags: another page follows now.
pub const MORE: u8 = 1;
/// Flags: something after the reader's cursor is gone (expired, or lost to a
/// crash), or the cursor isn't one this pool gave out.
pub const GAP: u8 = 2;

/// The snapshot's format version.
const SNAPSHOT_VERSION: u8 = 1;

struct Entry {
    number: u64,
    /// Unix seconds.
    came: i64,
    digest: [u8; 32],
    bytes: Bytes,
}

/// What a post did.
#[derive(Debug, PartialEq, Eq)]
pub enum Kept {
    /// Kept now, until this Unix time.
    New { expires: i64 },
    /// Already held, until this Unix time.
    Already { expires: i64 },
}

/// Not kept: the pool holds its most. Try again in this many seconds.
#[derive(Debug, PartialEq, Eq)]
pub struct Full(pub u64);

/// What follows a cursor.
#[derive(Debug, PartialEq, Eq)]
pub struct Page {
    pub flags: u8,
    /// The cursor to ask from next.
    pub cursor: u64,
    pub envelopes: Vec<Bytes>,
}

pub struct Held {
    entries: VecDeque<Entry>,
    by_digest: HashMap<[u8; 32], u64>,
    bytes: usize,
    next: u64,
    forgotten: u64,
    /// Changed since the last snapshot.
    pub changed: bool,
}

impl Held {
    /// An empty pool, numbering from `now_micros`. Every cursor given out
    /// before is below it, so each one's reader is told of a gap.
    pub fn new(now_micros: u64) -> Self {
        let next = now_micros.max(1);
        Held {
            entries: VecDeque::new(),
            by_digest: HashMap::new(),
            bytes: 0,
            next,
            forgotten: next - 1,
            changed: false,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// Drops what's been held 36 hours.
    pub fn expire(&mut self, now: i64) {
        while let Some(entry) = self.entries.front() {
            if entry.came + KEPT_FOR > now {
                break;
            }
            let entry = self.entries.pop_front().expect("a front entry");
            self.by_digest.remove(&entry.digest);
            self.bytes -= entry.bytes.len();
            self.forgotten = self.forgotten.max(entry.number);
            self.changed = true;
        }
    }

    /// When the envelope with this digest expires, if it's held.
    pub fn already(&self, digest: &[u8; 32]) -> Option<i64> {
        let number = *self.by_digest.get(digest)?;
        let at = self.entries.partition_point(|e| e.number < number);
        self.entries.get(at).map(|entry| entry.came + KEPT_FOR)
    }

    /// Keeps an envelope whose checks have passed, unless it's held already
    /// or `cap` bytes would be passed.
    pub fn insert(
        &mut self,
        digest: [u8; 32],
        bytes: Bytes,
        now: i64,
        cap: usize,
    ) -> Result<Kept, Full> {
        self.expire(now);
        if let Some(expires) = self.already(&digest) {
            return Ok(Kept::Already { expires });
        }
        if self.bytes + bytes.len() > cap {
            // Room comes when the oldest expires; ask again within the hour.
            let oldest = self.entries.front().map_or(now, |e| e.came);
            return Err(Full((oldest + KEPT_FOR - now).clamp(60, 3600) as u64));
        }
        let number = self.next;
        self.next += 1;
        self.bytes += bytes.len();
        self.by_digest.insert(digest, number);
        self.entries.push_back(Entry {
            number,
            came: now,
            digest,
            bytes,
        });
        self.changed = true;
        Ok(Kept::New {
            expires: now + KEPT_FOR,
        })
    }

    /// Whole envelopes after `after` (from the oldest without one), at most
    /// `limit` bytes but always one, and the cursor to ask from next.
    pub fn page(&mut self, after: Option<u64>, limit: usize, now: i64) -> Page {
        self.expire(now);
        let last_given = self.next - 1;
        let (start, mut flags) = match after {
            None => (0, 0),
            // Not a cursor this pool gave: what it holds, from the oldest.
            Some(after) if after > last_given => (0, GAP),
            Some(after) => (
                self.entries.partition_point(|e| e.number <= after),
                if after < self.forgotten { GAP } else { 0 },
            ),
        };
        let mut envelopes = Vec::new();
        let mut size = 0;
        let mut cursor = last_given;
        for entry in self.entries.iter().skip(start) {
            if !envelopes.is_empty() && size + entry.bytes.len() > limit {
                flags |= MORE;
                break;
            }
            size += entry.bytes.len();
            cursor = entry.number;
            envelopes.push(entry.bytes.clone());
        }
        Page {
            flags,
            cursor,
            envelopes,
        }
    }

    /// The snapshot: `version (1) | next (8) | forgotten (8) | count (4) |
    /// count × (number (8) | came (8) | length (4) | envelope)`, big-endian.
    /// Its parts are copied out under the lock (the envelopes are shared,
    /// not copied); the bytes are made after.
    pub fn snapshot(&mut self) -> Snapshot {
        self.changed = false;
        Snapshot {
            next: self.next,
            forgotten: self.forgotten,
            entries: self
                .entries
                .iter()
                .map(|e| (e.number, e.came, e.bytes.clone()))
                .collect(),
        }
    }

    /// The pool a snapshot held, for `pool`, as of `now`. A snapshot from a
    /// clean shutdown held everything; any other may have missed the
    /// envelopes kept after it was made, so every cursor given out before
    /// is told of a gap. Numbering goes on from the later of the snapshot's
    /// and `now_micros`.
    pub fn restore(snapshot: Snapshot, clean: bool, pool: &str, now: i64, now_micros: u64) -> Self {
        let next = snapshot.next.max(now_micros).max(1);
        let mut held = Held {
            entries: VecDeque::with_capacity(snapshot.entries.len()),
            by_digest: HashMap::with_capacity(snapshot.entries.len()),
            bytes: 0,
            next,
            forgotten: if clean { snapshot.forgotten } else { next - 1 },
            changed: false,
        };
        for (number, came, bytes) in snapshot.entries {
            let digest = super::check::stamp_digest(pool, &bytes);
            held.bytes += bytes.len();
            held.by_digest.insert(digest, number);
            held.entries.push_back(Entry {
                number,
                came,
                digest,
                bytes,
            });
        }
        held.expire(now);
        held
    }
}

/// What a snapshot holds.
pub struct Snapshot {
    next: u64,
    forgotten: u64,
    entries: Vec<(u64, i64, Bytes)>,
}

impl Snapshot {
    pub fn encode(&self) -> Vec<u8> {
        let size: usize = self.entries.iter().map(|(_, _, b)| 20 + b.len()).sum();
        let mut out = Vec::with_capacity(21 + size);
        out.push(SNAPSHOT_VERSION);
        out.extend_from_slice(&self.next.to_be_bytes());
        out.extend_from_slice(&self.forgotten.to_be_bytes());
        out.extend_from_slice(&(self.entries.len() as u32).to_be_bytes());
        for (number, came, bytes) in &self.entries {
            out.extend_from_slice(&number.to_be_bytes());
            out.extend_from_slice(&came.to_be_bytes());
            out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            out.extend_from_slice(bytes);
        }
        out
    }

    /// A snapshot from its bytes, or nothing if they aren't one: numbers in
    /// order and below `next`, every envelope one of the four sizes, and no
    /// byte left over.
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
            let came = u64_(take(8)?) as i64;
            let len = u32::from_be_bytes(take(4)?.try_into().ok()?) as usize;
            if !super::check::SIZES.contains(&len)
                || number >= next
                || last.is_some_and(|last| number <= last)
            {
                return None;
            }
            last = Some(number);
            entries.push((number, came, Bytes::copy_from_slice(take(len)?)));
        }
        if !at.is_empty() || forgotten >= next {
            return None;
        }
        Some(Snapshot {
            next,
            forgotten,
            entries,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;
    const MICROS: u64 = 1_800_000_000_000_000;
    const CAP: usize = 1 << 20;

    /// A distinct 512-byte "envelope": the pool doesn't look inside.
    fn envelope(i: u32) -> (Vec<u8>, [u8; 32]) {
        let mut bytes = vec![1u8; 512];
        bytes[1..5].copy_from_slice(&i.to_be_bytes());
        let digest = crate::messaging::check::stamp_digest("mainnet", &bytes);
        (bytes, digest)
    }

    fn keep(held: &mut Held, i: u32, now: i64) -> Kept {
        let (bytes, digest) = envelope(i);
        held.insert(digest, Bytes::from(bytes), now, CAP).unwrap()
    }

    fn ids(page: &Page) -> Vec<u32> {
        page.envelopes
            .iter()
            .map(|e| u32::from_be_bytes(e[1..5].try_into().unwrap()))
            .collect()
    }

    #[test]
    fn a_pool_keeps_each_envelope_once() {
        let mut held = Held::new(MICROS);
        assert_eq!(
            keep(&mut held, 1, NOW),
            Kept::New {
                expires: NOW + KEPT_FOR
            }
        );
        assert_eq!(
            keep(&mut held, 1, NOW + 5),
            Kept::Already {
                expires: NOW + KEPT_FOR
            }
        );
        assert_eq!((held.len(), held.bytes()), (1, 512));
        assert_eq!(held.already(&envelope(1).1), Some(NOW + KEPT_FOR));
        assert_eq!(held.already(&envelope(2).1), None);
    }

    #[test]
    fn a_reader_pages_through_in_order_and_keeps_up() {
        let mut held = Held::new(MICROS);
        // 600 short envelopes: 300 KiB, more than a page.
        for i in 0..600 {
            keep(&mut held, i, NOW);
        }
        let first = held.page(None, PAGE_BYTES, NOW);
        assert_eq!(first.flags, MORE);
        assert_eq!(ids(&first), (0..512).collect::<Vec<_>>());
        let second = held.page(Some(first.cursor), PAGE_BYTES, NOW);
        assert_eq!(second.flags, 0);
        assert_eq!(ids(&second), (512..600).collect::<Vec<_>>());
        // Caught up: nothing, and the same cursor.
        let third = held.page(Some(second.cursor), PAGE_BYTES, NOW);
        assert_eq!((third.flags, third.cursor), (0, second.cursor));
        assert!(third.envelopes.is_empty());
        // Then only what's new.
        keep(&mut held, 600, NOW + 60);
        let fourth = held.page(Some(third.cursor), PAGE_BYTES, NOW + 60);
        assert_eq!((fourth.flags, ids(&fourth)), (0, vec![600]));
    }

    #[test]
    fn a_page_holds_at_least_one_whole_envelope() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        keep(&mut held, 2, NOW);
        let page = held.page(None, 100, NOW);
        assert_eq!((page.flags, ids(&page)), (MORE, vec![1]));
    }

    #[test]
    fn an_empty_pools_cursor_is_where_it_starts() {
        let mut held = Held::new(MICROS);
        let page = held.page(None, PAGE_BYTES, NOW);
        assert_eq!((page.flags, page.cursor), (0, MICROS - 1));
        keep(&mut held, 1, NOW);
        let page = held.page(Some(page.cursor), PAGE_BYTES, NOW);
        assert_eq!((page.flags, ids(&page)), (0, vec![1]));
    }

    #[test]
    fn envelopes_go_after_36_hours_and_a_late_reader_is_told() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        let cursor = held.page(None, PAGE_BYTES, NOW).cursor;
        let start = Held::new(MICROS).page(None, PAGE_BYTES, NOW).cursor;
        keep(&mut held, 2, NOW + 60);
        // Kept until 36 hours have passed, gone at 36 hours.
        let page = held.page(Some(start), PAGE_BYTES, NOW + KEPT_FOR - 1);
        assert_eq!((page.flags, ids(&page)), (0, vec![1, 2]));
        let page = held.page(Some(start), PAGE_BYTES, NOW + KEPT_FOR);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![2]));
        assert_eq!((held.len(), held.bytes()), (1, 512));
        // A reader who had read the first misses nothing.
        let page = held.page(Some(cursor), PAGE_BYTES, NOW + KEPT_FOR);
        assert_eq!((page.flags, ids(&page)), (0, vec![2]));
        // Its digest is free again: a re-post after 36 hours is new.
        assert!(matches!(
            keep(&mut held, 1, NOW + KEPT_FOR),
            Kept::New { .. }
        ));
    }

    #[test]
    fn a_cursor_the_pool_never_gave_reads_everything_with_a_gap() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        let page = held.page(Some(MICROS + 1_000_000), PAGE_BYTES, NOW);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![1]));
        assert_eq!(page.cursor, MICROS);
    }

    #[test]
    fn a_full_pool_refuses_until_room_comes() {
        let mut held = Held::new(MICROS);
        let (bytes, digest) = envelope(1);
        held.insert(digest, Bytes::from(bytes), NOW, 1024).unwrap();
        let (bytes, digest) = envelope(2);
        held.insert(digest, Bytes::from(bytes), NOW, 1024).unwrap();
        let (bytes, digest) = envelope(3);
        assert_eq!(
            held.insert(digest, Bytes::from(bytes.clone()), NOW, 1024),
            Err(Full(3600))
        );
        // A held one is still "already", full or not.
        let (held_bytes, held_digest) = envelope(1);
        assert!(matches!(
            held.insert(held_digest, Bytes::from(held_bytes), NOW, 1024),
            Ok(Kept::Already { .. })
        ));
        // Near the oldest's 36 hours, the wait is what's left of them.
        assert_eq!(
            held.insert(
                digest,
                Bytes::from(bytes.clone()),
                NOW + KEPT_FOR - 120,
                1024
            ),
            Err(Full(120))
        );
        assert!(
            held.insert(digest, Bytes::from(bytes), NOW + KEPT_FOR, 1024)
                .is_ok()
        );
    }

    #[test]
    fn a_clean_snapshot_restores_everything_and_no_gap() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        keep(&mut held, 2, NOW + 10);
        let cursor = held.page(None, PAGE_BYTES, NOW).cursor;
        let bytes = held.snapshot().encode();
        assert!(!held.changed);
        let snapshot = Snapshot::decode(&bytes).unwrap();
        let mut back = Held::restore(snapshot, true, "mainnet", NOW + 20, MICROS + 20_000_000);
        assert_eq!((back.len(), back.bytes()), (2, 1024));
        assert!(back.already(&envelope(2).1).is_some());
        let page = back.page(Some(cursor), PAGE_BYTES, NOW + 20);
        assert_eq!((page.flags, ids(&page)), (0, Vec::<u32>::new()));
        // Numbering goes on above everything given out.
        keep(&mut back, 3, NOW + 20);
        let page = back.page(Some(cursor), PAGE_BYTES, NOW + 20);
        assert_eq!((page.flags, ids(&page)), (0, vec![3]));
        assert!(page.cursor >= MICROS + 20_000_000);
    }

    #[test]
    fn after_a_crash_every_earlier_cursor_is_told_and_nothing_is_skipped() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        let bytes = held.snapshot().encode();
        // Kept after the snapshot, then lost with the process.
        keep(&mut held, 2, NOW + 30);
        let lost_cursor = held.page(None, PAGE_BYTES, NOW + 30).cursor;
        let snapshot = Snapshot::decode(&bytes).unwrap();
        let mut back = Held::restore(snapshot, false, "mainnet", NOW + 40, MICROS + 40_000_000);
        keep(&mut back, 3, NOW + 40);
        // The reader who saw envelope 2 still gets 3, told of a gap.
        let page = back.page(Some(lost_cursor), PAGE_BYTES, NOW + 40);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![3]));
        // A reader who starts now is told of none.
        let page = back.page(None, PAGE_BYTES, NOW + 40);
        assert_eq!((page.flags, ids(&page)), (0, vec![1, 3]));
    }

    #[test]
    fn a_restore_drops_what_expired_while_down() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        keep(&mut held, 2, NOW + 3600);
        let snapshot = Snapshot::decode(&held.snapshot().encode()).unwrap();
        let back = Held::restore(snapshot, true, "mainnet", NOW + KEPT_FOR, MICROS);
        assert_eq!(back.len(), 1);
    }

    #[test]
    fn a_snapshot_that_isnt_one_is_refused() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        keep(&mut held, 2, NOW);
        let good = held.snapshot().encode();
        assert!(Snapshot::decode(&good).is_some());
        assert!(Snapshot::decode(&[]).is_none());
        // Every truncation, and a byte too many.
        for len in 0..good.len() {
            assert!(Snapshot::decode(&good[..len]).is_none(), "{len}");
        }
        let mut longer = good.clone();
        longer.push(0);
        assert!(Snapshot::decode(&longer).is_none());
        // Another version.
        let mut version = good.clone();
        version[0] = 2;
        assert!(Snapshot::decode(&version).is_none());
        // Numbers out of order: swap the two entries' numbers.
        let first = 21;
        let second = first + 20 + 512;
        let mut swapped = good.clone();
        let (a, b) = (
            good[first..first + 8].to_vec(),
            good[second..second + 8].to_vec(),
        );
        swapped[first..first + 8].copy_from_slice(&b);
        swapped[second..second + 8].copy_from_slice(&a);
        assert!(Snapshot::decode(&swapped).is_none());
        // A length that isn't one of the sizes.
        let mut length = good.clone();
        length[first + 16..first + 20].copy_from_slice(&511u32.to_be_bytes());
        assert!(Snapshot::decode(&length).is_none());
        // A count far past what's there doesn't allocate it.
        let mut count = good;
        count[17..21].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(Snapshot::decode(&count).is_none());
    }
}
