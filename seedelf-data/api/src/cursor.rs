//! Cursors: the points the private index answers "what changed since" from.
//!
//! A cursor is `<slot>.<hash>`: a slot that's a multiple of [`QUANT`], and
//! the header hash of the newest block at or before it. Both of the index's
//! sources, db-sync and Kupo, know every block by slot and hash, so a cursor
//! one hands out the other answers the same way.
//!
//! The server only hands out **stable** cursors, at least [`DEPTH`] slots
//! below the tip: about 10 blocks, deeper than the forks mainnet sees, so one
//! is almost never rolled back. Being quantised, everyone who read within the
//! same 200 slots holds the same one, so their answers are shared, and a
//! request shows when its wallet last read only roughly.

use std::fmt;
use std::str::FromStr;

/// How many slots below the tip a cursor sits at least: a block comes every 20 on average.
pub const DEPTH: i64 = 200;

/// Cursors fall on slots that are a multiple of this.
pub const QUANT: i64 = 200;

/// A grid slot and the hash of the newest block at or before it, written `<slot>.<hash>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cursor {
    pub slot: i64,
    pub hash: String,
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.slot, self.hash)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum CursorError {
    /// Not `<slot>.<64 hex characters>`.
    Malformed,
    /// A slot this server would never have handed out.
    NotQuantised,
}

impl FromStr for Cursor {
    type Err = CursorError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (slot, hash) = s.split_once('.').ok_or(CursorError::Malformed)?;
        let slot: i64 = slot.parse().map_err(|_| CursorError::Malformed)?;
        let hex = |c: char| c.is_ascii_digit() || ('a'..='f').contains(&c);
        if slot < 0 || hash.len() != 64 || !hash.chars().all(hex) {
            return Err(CursorError::Malformed);
        }
        if slot % QUANT != 0 {
            return Err(CursorError::NotQuantised);
        }
        Ok(Cursor {
            slot,
            hash: hash.to_string(),
        })
    }
}

/// The slot of the stable cursor for a tip at slot `tip`.
pub fn stable_slot(tip: i64) -> i64 {
    ((tip - DEPTH).max(0) / QUANT) * QUANT
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "af5f8c02581c857a39218fcfab037817d470e8f4ca347ae04ffb328c16e7d11b";

    #[test]
    fn a_cursor_reads_back_as_written() {
        let cursor: Cursor = format!("199952200.{HASH}").parse().unwrap();
        assert_eq!(cursor.slot, 199952200);
        assert_eq!(cursor.to_string(), format!("199952200.{HASH}"));
    }

    #[test]
    fn malformed_cursors_are_refused() {
        for bad in [
            "",
            "199952200",
            "x.hash",
            &format!("-200.{HASH}"),
            &format!("199952200.{}", &HASH[..63]),
            &format!("199952200.{}", HASH.to_uppercase()),
        ] {
            assert_eq!(bad.parse::<Cursor>(), Err(CursorError::Malformed), "{bad}");
        }
    }

    #[test]
    fn only_quantised_slots_are_cursors() {
        assert_eq!(
            format!("199952201.{HASH}").parse::<Cursor>(),
            Err(CursorError::NotQuantised)
        );
    }

    #[test]
    fn the_stable_cursor_is_deep_and_quantised() {
        assert_eq!(stable_slot(199952599), 199952200);
        assert_eq!(stable_slot(199952600), 199952400);
        assert_eq!(stable_slot(199952400), 199952200);
        assert_eq!(stable_slot(5), 0);
        for tip in 199952000..199953000 {
            let stable = stable_slot(tip);
            assert_eq!(stable % QUANT, 0);
            assert!(tip - stable >= DEPTH && tip - stable < DEPTH + QUANT);
        }
    }
}
