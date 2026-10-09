//! Cursors: the points the private index answers "what changed since" from.
//!
//! The server only hands out **stable** cursors: a block at least
//! [`CONFIRM`] below the tip, at a height that's a multiple of [`QUANT`].
//! Being deep, one is almost never rolled back. Being quantised, everyone who
//! read within the same ten blocks holds the same one, so their answers are
//! shared, and a request shows when its wallet last read only roughly.

use std::fmt;
use std::str::FromStr;

/// How many blocks below the tip a cursor sits: deeper than the forks mainnet sees.
pub const CONFIRM: i64 = 10;

/// Cursors fall on heights that are a multiple of this.
pub const QUANT: i64 = 10;

/// A block height and its header hash, written `<height>.<hash>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cursor {
    pub height: i64,
    pub hash: String,
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.height, self.hash)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum CursorError {
    /// Not `<height>.<64 hex characters>`.
    Malformed,
    /// A height this server would never have handed out.
    NotQuantised,
}

impl FromStr for Cursor {
    type Err = CursorError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (height, hash) = s.split_once('.').ok_or(CursorError::Malformed)?;
        let height: i64 = height.parse().map_err(|_| CursorError::Malformed)?;
        let hex = |c: char| c.is_ascii_digit() || ('a'..='f').contains(&c);
        if height < 0 || hash.len() != 64 || !hash.chars().all(hex) {
            return Err(CursorError::Malformed);
        }
        if height % QUANT != 0 {
            return Err(CursorError::NotQuantised);
        }
        Ok(Cursor {
            height,
            hash: hash.to_string(),
        })
    }
}

/// The height of the stable cursor for a tip at `tip`.
pub fn stable_height(tip: i64) -> i64 {
    ((tip - CONFIRM).max(0) / QUANT) * QUANT
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "af5f8c02581c857a39218fcfab037817d470e8f4ca347ae04ffb328c16e7d11b";

    #[test]
    fn a_cursor_reads_back_as_written() {
        let cursor: Cursor = format!("14044070.{HASH}").parse().unwrap();
        assert_eq!(cursor.height, 14044070);
        assert_eq!(cursor.to_string(), format!("14044070.{HASH}"));
    }

    #[test]
    fn malformed_cursors_are_refused() {
        for bad in [
            "",
            "14044070",
            "x.hash",
            &format!("-10.{HASH}"),
            &format!("14044070.{}", &HASH[..63]),
            &format!("14044070.{}", HASH.to_uppercase()),
        ] {
            assert_eq!(bad.parse::<Cursor>(), Err(CursorError::Malformed), "{bad}");
        }
    }

    #[test]
    fn only_quantised_heights_are_cursors() {
        assert_eq!(
            format!("14044071.{HASH}").parse::<Cursor>(),
            Err(CursorError::NotQuantised)
        );
    }

    #[test]
    fn the_stable_cursor_is_deep_and_quantised() {
        assert_eq!(stable_height(14044089), 14044070);
        assert_eq!(stable_height(14044090), 14044080);
        assert_eq!(stable_height(14044080), 14044070);
        assert_eq!(stable_height(5), 0);
        for tip in 14044000..14044100 {
            let stable = stable_height(tip);
            assert_eq!(stable % QUANT, 0);
            assert!(tip - stable >= CONFIRM && tip - stable < CONFIRM + QUANT);
        }
    }
}
