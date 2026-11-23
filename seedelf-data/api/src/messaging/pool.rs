//! One network's pool of envelopes (docs/protocol.md §17): bytes and when
//! they came, in the order they came, for 36 hours.
//!
//! **Cursors.** Each envelope kept gets the next number, starting from the
//! Unix time in microseconds when the pool was loaded, so a pool that lost
//! what it held (a crash between snapshots, a deleted file) still numbers
//! above every cursor it gave out; after a crash, also far above its last
//! save's, should the clock have gone back. A reader asks for what follows its
//! cursor. `forgotten` is the highest number the pool no longer has, or
//! may never have saved: a cursor below it may have missed something, and
//! the page says so (its `gap` flag). That's all a number says: no time.

use std::collections::{HashMap, VecDeque};

use axum::body::Bytes;

/// How long an envelope is kept: 36 hours.
pub const KEPT_FOR: i64 = 36 * 3600;

/// A page holds whole envelopes up to this many bytes.
pub const PAGE_BYTES: usize = 256 * 1024;

/// A page's bytes before its envelopes, as `messaging::encode` writes them:
/// version, flags, cursor, prices and count.
pub const PAGE_HEADER: usize = 1 + 1 + 8 + 4 + 2;
/// And before each envelope, its length.
pub const LENGTH_LEN: usize = 4;

/// The page's format version.
pub const PAGE_VERSION: u8 = 1;
/// Flags: another page follows now.
pub const MORE: u8 = 1;
/// Flags: something after the reader's cursor is gone (expired, or lost to a
/// crash), or the cursor isn't one this pool gave out.
pub const GAP: u8 = 2;

/// The snapshot's format version.
const SNAPSHOT_VERSION: u8 = 1;

/// More numbers than a pool gives out between two saves, many times over:
/// mainnet's cap holds 2^17 of the shortest envelopes, and a save comes
/// every minute. After a crash the numbering goes on this far above the
/// last save's `next`, so it stays above every cursor given out since,
/// whatever the clock says.
const UNSAVED: u64 = 1 << 32;

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

    /// Drops what's been held 36 hours, from the oldest.
    pub fn expire(&mut self, now: i64) {
        // The newest came last, unless the clock has gone back since. A
        // second's slack: a request reads the clock before it takes the
        // lock, so behind an insert its `now` can be a second stale, which
        // isn't the clock going back (the gate review's relay nit).
        if self
            .entries
            .back()
            .is_some_and(|entry| entry.came > now.saturating_add(1))
        {
            self.settle(now);
        }
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

    /// Makes every entry's time at most `now` and none earlier than the one
    /// before it, so the times run in the numbers' order, which `expire`
    /// takes from the oldest. A time ahead of the clock (an envelope kept
    /// while the clock ran ahead) counts as now: one bad reading keeps its
    /// envelope at most 36 hours from the first look after the clock is
    /// right, and holds back nothing that came after it.
    fn settle(&mut self, now: i64) {
        let mut latest = i64::MIN;
        for entry in &mut self.entries {
            let came = entry.came.min(now).max(latest);
            if came != entry.came {
                entry.came = came;
                self.changed = true;
            }
            latest = came;
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
    ///
    /// What's kept is a copy with an allocation of its own, made here, so
    /// the cap counts what the pool holds in memory. The bytes come as a
    /// slice so that no caller can hand over a view of a larger buffer to
    /// keep: a request's body is one of hyper's read buffer, 8 to 400 KiB,
    /// which a kept view would pin for the envelope's 36 hours.
    pub fn insert(
        &mut self,
        digest: [u8; 32],
        bytes: &[u8],
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
            bytes: Bytes::copy_from_slice(bytes),
        });
        self.changed = true;
        Ok(Kept::New {
            expires: now + KEPT_FOR,
        })
    }

    /// Whole envelopes after `after` (from the oldest without one), at most
    /// `limit` bytes but always one, and the cursor to ask from next.
    pub fn page(&mut self, after: Option<u64>, limit: usize, now: i64) -> Page {
        self.page_while(after, now, |count, bytes| count == 1 || bytes <= limit)
    }

    /// [`Held::page`] whose encoding, [`PAGE_HEADER`] bytes and
    /// [`LENGTH_LEN`] before each envelope, is at most `most` bytes: as many
    /// whole envelopes as fit, with `MORE` when any are left. None when the
    /// first alone doesn't fit: a page holds whole envelopes, and an empty
    /// one's cursor would step over it.
    pub fn page_within(&mut self, after: Option<u64>, most: usize, now: i64) -> Option<Page> {
        let page = self.page_while(after, now, |count, bytes| {
            (count == 1 || bytes <= PAGE_BYTES) && PAGE_HEADER + count * LENGTH_LEN + bytes <= most
        });
        let cut_before_any = page.envelopes.is_empty() && page.flags & MORE != 0;
        (!cut_before_any).then_some(page)
    }

    /// Whole envelopes after `after` for as long as `fits` (how many they'd
    /// be, and their bytes) says the next one may join them.
    fn page_while(
        &mut self,
        after: Option<u64>,
        now: i64,
        fits: impl Fn(usize, usize) -> bool,
    ) -> Page {
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
            if !fits(envelopes.len() + 1, size + entry.bytes.len()) {
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
    /// is told of a gap, and the numbers given out since are taken to run
    /// up to [`UNSAVED`] past the snapshot's `next`. Numbering goes on from
    /// the later of that (the snapshot's `next` itself, if it's clean) and
    /// `now_micros`.
    ///
    /// Not clean, the pool is changed from the start, so the first save
    /// (`messaging::keep`'s, at once) writes where its numbering now
    /// stands. Kept in memory alone, a second crash before a save numbered
    /// from the same place again, handing out numbers a reader already held,
    /// and a clean stop after a quiet run left its cursors above the file's
    /// (the gate review of the relay's fixes, its medium and a low).
    ///
    /// Each envelope whose own 36 hours are over is dropped, wherever it
    /// is, and the rest are put in order (`settle`), so a file written while
    /// the clock was wrong holds nothing past its time.
    pub fn restore(snapshot: Snapshot, clean: bool, pool: &str, now: i64, now_micros: u64) -> Self {
        let saved = if clean {
            snapshot.next
        } else {
            snapshot.next.saturating_add(UNSAVED)
        };
        let next = saved.max(now_micros).max(1);
        let mut held = Held {
            entries: VecDeque::with_capacity(snapshot.entries.len()),
            by_digest: HashMap::with_capacity(snapshot.entries.len()),
            bytes: 0,
            next,
            forgotten: if clean { snapshot.forgotten } else { next - 1 },
            changed: !clean,
        };
        for (number, came, bytes) in snapshot.entries {
            if came.saturating_add(KEPT_FOR) <= now {
                held.forgotten = held.forgotten.max(number);
                held.changed = true;
                continue;
            }
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
        held.settle(now);
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
        held.insert(digest, &bytes, now, CAP).unwrap()
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
        held.insert(digest, &bytes, NOW, 1024).unwrap();
        let (bytes, digest) = envelope(2);
        held.insert(digest, &bytes, NOW, 1024).unwrap();
        let (bytes, digest) = envelope(3);
        assert_eq!(held.insert(digest, &bytes, NOW, 1024), Err(Full(3600)));
        // A held one is still "already", full or not.
        let (held_bytes, held_digest) = envelope(1);
        assert!(matches!(
            held.insert(held_digest, &held_bytes, NOW, 1024),
            Ok(Kept::Already { .. })
        ));
        // Near the oldest's 36 hours, the wait is what's left of them.
        assert_eq!(
            held.insert(digest, &bytes, NOW + KEPT_FOR - 120, 1024),
            Err(Full(120))
        );
        assert!(held.insert(digest, &bytes, NOW + KEPT_FOR, 1024).is_ok());
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

    /// The gate review's relay-server#6: the clock ran ten days ahead while
    /// one envelope was kept, then was put right. Expiry looks at the
    /// oldest alone, so that one envelope held every later one in the pool
    /// for its ten days and a half, and the pool filled.
    #[test]
    fn an_envelope_kept_while_the_clock_ran_ahead_holds_nothing_back() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW + 10 * 86_400);
        // The first look with the clock right counts its time as now...
        keep(&mut held, 2, NOW);
        assert_eq!(held.already(&envelope(1).1), Some(NOW + KEPT_FOR));
        keep(&mut held, 3, NOW + 3600);
        // ...so it goes 36 hours on, with what came beside it, and what came
        // after goes on time.
        let page = held.page(None, PAGE_BYTES, NOW + KEPT_FOR);
        assert_eq!(ids(&page), vec![3]);
        let page = held.page(None, PAGE_BYTES, NOW + KEPT_FOR + 3600);
        assert!(page.envelopes.is_empty());
        assert_eq!((held.len(), held.bytes()), (0, 0));
    }

    /// The relay review's nit (gate 54g): a request reads the clock before
    /// it takes the pool's lock, so behind an insert it can hold a `now` a
    /// second stale. That isn't the clock gone back: the newest envelope
    /// keeps its time, and no walk of the pool runs for it.
    #[test]
    fn a_now_a_second_stale_moves_no_envelopes_time() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW + 1);
        let page = held.page(None, PAGE_BYTES, NOW);
        assert_eq!(ids(&page), vec![1]);
        assert_eq!(held.already(&envelope(1).1), Some(NOW + 1 + KEPT_FOR));
        // One kept on that stale `now` keeps it, and goes with the one
        // before it, a second late at most.
        keep(&mut held, 2, NOW);
        assert_eq!(held.already(&envelope(2).1), Some(NOW + KEPT_FOR));
        let page = held.page(None, PAGE_BYTES, NOW + KEPT_FOR);
        assert_eq!(ids(&page), vec![1, 2]);
        let page = held.page(None, PAGE_BYTES, NOW + 1 + KEPT_FOR);
        assert!(page.envelopes.is_empty());
        // More than a second behind is the clock gone back: as before, the
        // time ahead counts as now.
        keep(&mut held, 3, NOW + KEPT_FOR + 10);
        held.page(None, PAGE_BYTES, NOW + KEPT_FOR + 8);
        assert_eq!(held.already(&envelope(3).1), Some(NOW + 2 * KEPT_FOR + 8));
    }

    /// The same in a file, written while the clock ran ahead (by a build
    /// before this one): the second envelope "came" ten days before the
    /// first. Read 37 hours after the second came, the second's 36 hours
    /// are over, and the first's time counts from the read.
    #[test]
    fn a_file_whose_times_run_backwards_is_read_in_order() {
        let (one, _) = envelope(1);
        let (two, _) = envelope(2);
        let snapshot = Snapshot {
            next: MICROS + 2,
            forgotten: MICROS - 1,
            entries: vec![
                (MICROS, NOW + 10 * 86_400, Bytes::from(one)),
                (MICROS + 1, NOW, Bytes::from(two)),
            ],
        };
        let start = MICROS - 1;
        let read = NOW + KEPT_FOR + 3600;
        let snapshot = Snapshot::decode(&snapshot.encode()).unwrap();
        let mut back = Held::restore(snapshot, true, "mainnet", read, MICROS + 10);
        // The second is gone, so a reader from before it is told of a gap.
        let page = back.page(Some(start), PAGE_BYTES, read);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![1]));
        assert_eq!(back.already(&envelope(1).1), Some(read + KEPT_FOR));
        assert!(back.changed);
        assert!(
            back.page(None, PAGE_BYTES, read + KEPT_FOR)
                .envelopes
                .is_empty()
        );
    }

    /// The rest of relay-server#6: after a crash, with the clock behind
    /// where it was, the pool numbered new envelopes from its last save's
    /// `next`, at or below the cursors it gave out after that save, and a
    /// reader holding one of those skipped them, told of no gap.
    #[test]
    fn after_a_crash_with_the_clock_behind_new_numbers_stay_above_every_cursor() {
        let mut held = Held::new(MICROS);
        keep(&mut held, 1, NOW);
        let bytes = held.snapshot().encode();
        // Kept after the save, read, then lost with the process.
        keep(&mut held, 2, NOW + 30);
        keep(&mut held, 3, NOW + 30);
        let lost_cursor = held.page(None, PAGE_BYTES, NOW + 30).cursor;
        // Started again with the clock a minute before the pool was loaded.
        let behind = MICROS - 60_000_000;
        let snapshot = Snapshot::decode(&bytes).unwrap();
        let mut back = Held::restore(snapshot, false, "mainnet", NOW + 40, behind);
        keep(&mut back, 4, NOW + 40);
        keep(&mut back, 5, NOW + 40);
        let page = back.page(Some(lost_cursor), PAGE_BYTES, NOW + 40);
        assert_eq!((page.flags, ids(&page)), (GAP, vec![4, 5]));
        assert!(page.cursor > lost_cursor);
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
