//! A depth check for CBOR from outside the wallet, such as a Koios row's datum.
//!
//! Pallas's and `uplc`'s decoders go one call deeper for each level of
//! nesting, so a datum nested a few thousand levels deep (a few kilobytes on
//! chain) overflows WebAssembly's stack. That's a trap, which kills the
//! instance. Untrusted CBOR is walked here first, one item at a time with no
//! recursion, and refused past [`MAX_DEPTH`]: one item with [`within_depth`],
//! a whole transaction, the CBOR its byte strings wrap included, with
//! [`check_nesting`].
//!
//! The same way, [`definite_pairs`] writes a datum's constructors in the
//! general form so that Pallas reads them as the node does.

use anyhow::{Result, bail};
use pallas_codec::minicbor::{Decoder, data::Type};

/// The deepest untrusted CBOR the wallet decodes, each array, map and tag
/// counting as a level. Real datums are far shallower: a Seedelf register or a
/// Lovejoin box is 2. It's about what serde_json let through when the same
/// datums were read as JSON, where each level takes two.
pub const MAX_DEPTH: usize = 128;

/// Whether `cbor` is one well-formed CBOR item, with nothing after it, nested
/// no deeper than `max`. Each array, map and tag counts as a level.
pub fn within_depth(cbor: &[u8], max: usize) -> bool {
    walk(cbor, max).is_some()
}

/// Whether `output`, a transaction output as the ledger encodes it, decodes
/// no deeper than `max`: the output itself, and each item it embeds. A
/// post-Alonzo output's inline datum and reference script each sit in a byte
/// string under a tag, one item to [`within_depth`], which a decoder of the
/// output decodes in turn; each is held to `max` on its own, as a Koios row's
/// datum is (`eval::unreadable_datum`).
pub fn output_within_depth(output: &[u8], max: usize) -> bool {
    within_depth(output, max)
        && embedded(output).is_some_and(|items| items.iter().all(|item| within_depth(item, max)))
}

/// What a post-Alonzo output (a map) embeds: its inline datum (field 2,
/// `[1, #6.24(bytes)]`) and its reference script (field 3, `#6.24(bytes)`).
/// Nothing for a legacy output (an array), which embeds none. `None` if it
/// isn't laid out as the ledger and the wallet write one. Only called on an
/// output [`within_depth`] passed, and `skip` doesn't recurse either.
fn embedded(output: &[u8]) -> Option<Vec<&[u8]>> {
    let mut d = Decoder::new(output);
    if matches!(d.datatype().ok()?, Type::Array | Type::ArrayIndef) {
        return Some(Vec::new());
    }
    let fields = d.map().ok()??;
    let mut items = Vec::new();
    for _ in 0..fields {
        match d.u8().ok()? {
            2 => {
                if d.array().ok()? != Some(2) {
                    return None;
                }
                if d.u8().ok()? == 1 {
                    d.tag().ok()?;
                    items.push(d.bytes().ok()?);
                } else {
                    d.skip().ok()?;
                }
            }
            3 => {
                d.tag().ok()?;
                items.push(d.bytes().ok()?);
            }
            _ => d.skip().ok()?,
        }
    }
    Some(items)
}

fn walk(cbor: &[u8], max: usize) -> Option<()> {
    let mut d = Decoder::new(cbor);
    // What's left of each open array, map and tag: how many items are still to
    // come, or `None` for an indefinite length, which a break ends.
    let mut open: Vec<Option<u64>> = Vec::new();
    loop {
        // `Some(items)` when this item opens an array, map or tag.
        let opens: Option<Option<u64>> = match d.datatype().ok()? {
            Type::Array | Type::ArrayIndef => Some(d.array().ok()?),
            Type::Map | Type::MapIndef => Some(match d.map().ok()? {
                Some(pairs) => Some(pairs.checked_mul(2)?),
                None => None,
            }),
            Type::Tag => {
                d.tag().ok()?;
                Some(Some(1))
            }
            Type::Break => {
                // Only an indefinite array or map ends with a break.
                if open.pop()?.is_some() {
                    return None;
                }
                d.set_position(d.position() + 1);
                None
            }
            Type::Unknown(_) => return None,
            // A number, a string, or a simple value: nothing nests in it.
            _ => {
                d.skip().ok()?;
                None
            }
        };
        if let Some(items) = opens {
            if open.len() == max {
                return None;
            }
            if items != Some(0) {
                open.push(items);
                continue;
            }
        }
        // An item is done: it counts toward each open one it finishes.
        loop {
            match open.last_mut() {
                None => return (d.position() == cbor.len()).then_some(()),
                Some(None) => break,
                Some(Some(left)) => {
                    *left -= 1;
                    if *left > 0 {
                        break;
                    }
                    open.pop();
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// A whole transaction from outside the wallet, before anything decodes it
// ---------------------------------------------------------------------------

/// Refuses a transaction from outside the wallet (a site's, a swap a DEX
/// built) that nests deeper than [`MAX_DEPTH`], before anything decodes it:
/// Pallas decodes its plutus data, metadata and native scripts recursively,
/// the inline datums and reference scripts in its outputs' tagged byte
/// strings too. Real transactions nest a few dozen levels at most.
pub fn check_nesting(bytes: &[u8]) -> Result<()> {
    if !nests_within(bytes, MAX_DEPTH) {
        bail!(
            "The wallet can't read this transaction: its data is nested more than {MAX_DEPTH} levels deep."
        );
    }
    Ok(())
}

/// One open level in [`nests_within`]'s walk.
enum Level {
    /// An array or a map (its keys and values each an item), with the items
    /// left to read: `None` until a break.
    Items(Option<u64>),
    /// A tag, before the one item it wraps.
    Tag,
    /// CBOR in a byte string a tag wraps, as an inline datum or a reference
    /// script is: Pallas decodes that too. It ends at `end`, inside bytes
    /// that end at `outer`.
    Wrapped { end: usize, outer: usize },
}

/// A CBOR item's head at `pos`: its major type, its argument (`None` for an
/// indefinite length), and where what follows the head starts.
fn cbor_head(bytes: &[u8], pos: usize) -> Option<(u8, Option<u64>, usize)> {
    let initial = *bytes.get(pos)?;
    let wide = |n: usize| -> Option<(u64, usize)> {
        let b = bytes.get(pos + 1..pos + 1 + n)?;
        Some((
            b.iter().fold(0u64, |a, x| (a << 8) | u64::from(*x)),
            pos + 1 + n,
        ))
    };
    let (argument, next) = match initial & 0x1f {
        n @ 0..=23 => (Some(u64::from(n)), pos + 1),
        24 => wide(1).map(|(a, p)| (Some(a), p))?,
        25 => wide(2).map(|(a, p)| (Some(a), p))?,
        26 => wide(4).map(|(a, p)| (Some(a), p))?,
        27 => wide(8).map(|(a, p)| (Some(a), p))?,
        31 => (None, pos + 1),
        // 28–30 are reserved.
        _ => return None,
    };
    Some((initial >> 5, argument, next))
}

/// Whether CBOR `bytes` stay within `max` levels: each array, map and tag is
/// one, and so is the CBOR a tag wraps in a byte string. It walks the bytes
/// without recursing, one head at a time.
///
/// What isn't well-formed ends the walk, as it ends any decoder there too.
/// Inside a wrapped byte string it only means those bytes aren't CBOR (a big
/// number's, say), and the walk goes on after them.
pub fn nests_within(bytes: &[u8], max: usize) -> bool {
    let mut levels = vec![Level::Items(Some(1))];
    let mut pos = 0;
    let mut limit = bytes.len();
    while let Some(level) = levels.last() {
        match *level {
            Level::Items(Some(0)) => {
                levels.pop();
                continue;
            }
            Level::Wrapped { end, outer } => {
                (pos, limit) = (end, outer);
                levels.pop();
                continue;
            }
            _ => {}
        }
        match cbor_step(bytes, pos, limit, &mut levels) {
            Some(next) => (pos, limit) = next,
            None => {
                let Some(i) = levels
                    .iter()
                    .rposition(|l| matches!(l, Level::Wrapped { .. }))
                else {
                    return true;
                };
                let Level::Wrapped { end, outer } = levels[i] else {
                    unreachable!("found as wrapped")
                };
                levels.truncate(i);
                (pos, limit) = (end, outer);
                continue;
            }
        }
        // The first level is the whole item's, not a nesting.
        if levels.len().saturating_sub(1) > max {
            return false;
        }
    }
    true
}

/// Reads the item at `pos` for the innermost open level, opening a level
/// for an array, a map, a tag or a wrapped byte string, whose bytes end at
/// `limit`. Where the walk goes next and where the bytes it's in end, or
/// `None` for bytes that aren't well-formed CBOR.
fn cbor_step(
    bytes: &[u8],
    pos: usize,
    limit: usize,
    levels: &mut Vec<Level>,
) -> Option<(usize, usize)> {
    let bytes = &bytes[..limit];
    if *bytes.get(pos)? == 0xff {
        // A break closes an indefinite array, map or string.
        return match levels.last() {
            Some(Level::Items(None)) => {
                levels.pop();
                Some((pos + 1, limit))
            }
            _ => None,
        };
    }
    let after_tag = matches!(levels.last(), Some(Level::Tag));
    match levels.last_mut() {
        Some(Level::Items(Some(n))) => *n -= 1,
        // The tag's level stays open until its item is read.
        Some(level @ Level::Tag) => *level = Level::Items(Some(0)),
        _ => {}
    }
    let (major, argument, next) = cbor_head(bytes, pos)?;
    let opened = match (major, argument) {
        (0 | 1 | 7, Some(_)) => None,
        (2 | 3, Some(length)) => {
            let end = usize::try_from(length)
                .ok()
                .and_then(|l| next.checked_add(l))
                .filter(|end| *end <= limit)?;
            if major == 2 && after_tag {
                levels.push(Level::Wrapped { end, outer: limit });
                levels.push(Level::Items(Some(1)));
                return Some((next, end));
            }
            return Some((end, limit));
        }
        // An indefinite string's chunks, until a break.
        (2 | 3, None) => Some(Level::Items(None)),
        (4, length) => Some(Level::Items(length)),
        (5, length) => Some(Level::Items(length.map(|n| n.saturating_mul(2)))),
        (6, Some(_)) => Some(Level::Tag),
        _ => return None,
    };
    levels.extend(opened);
    Some((next, limit))
}

// ---------------------------------------------------------------------------
// Constructors in the general form, written for Pallas to read
// ---------------------------------------------------------------------------

/// One open level in [`definite_pairs`]' walk.
enum Open {
    /// An array or a map (its keys and values each an item), with the items
    /// left to read: `None` until a break.
    Items(Option<u64>),
    /// A tag, before the one item it wraps: `true` for 102, a constructor's
    /// general form, whose item is its pair.
    Tag(bool),
    /// The general form's pair, written indefinite, with the items read so
    /// far. It's written definite, so its break is dropped.
    Pair(u64),
    /// A string of indefinite length, of this major type: its chunks, each a
    /// definite string of the same type, until a break.
    Chunks(u8),
}

/// `datum`, one Plutus data item, with each constructor in the general form
/// written with a definite pair: `102([_ i, fields])` as `102([i, fields])`,
/// its break dropped, every other byte as it was. `None` where the general
/// form's pair isn't exactly two items, which the node refuses, or the CBOR
/// isn't one well-formed item with nothing after it.
///
/// Pallas 0.35.1's decoder (1.4.0's too) reads the pair's head but never an
/// indefinite one's closing break (`Constr::decode`). At the top of a datum
/// that's harmless; nested, the break ends the list around the constructor
/// early, or fails the next read, though the node reads either pair as the
/// same data. Contracts read data, never bytes, so whoever writes a datum (an
/// order's executor, say) chooses (chunk 51, r3a#1's class). What this returns
/// is for reading alone: a datum's hash, and a transaction carrying it, are of
/// the bytes it was written in.
///
/// It walks token by token, one head at a time and never recursing, so a byte
/// string is passed over whole, whatever it holds. A decoder of what it
/// returns recurses: hold `datum` to [`within_depth`] first.
pub fn definite_pairs(datum: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(datum.len());
    let mut open: Vec<Open> = Vec::new();
    let mut pos = 0;
    loop {
        let start = pos;
        // The level this item opens, if it's an array, a map, a tag or a
        // string in chunks; otherwise the item is done here.
        let opens = if *datum.get(pos)? == 0xff {
            pos += 1;
            match open.pop()? {
                Open::Items(None) | Open::Chunks(_) => out.push(0xff),
                // Written definite, the pair has no break.
                Open::Pair(2) => {}
                _ => return None,
            }
            None
        } else {
            let (major, argument, next) = cbor_head(datum, pos)?;
            pos = next;
            if let Some(Open::Chunks(string)) = open.last()
                && (major != *string || argument.is_none())
            {
                return None;
            }
            let general = matches!(open.last(), Some(Open::Tag(true)));
            if !(general && major == 4 && argument.is_none()) {
                out.extend_from_slice(&datum[start..next]);
            }
            match (major, argument) {
                (4, None) if general => {
                    out.push(0x82);
                    Some(Open::Pair(0))
                }
                (4, Some(2)) if general => Some(Open::Items(Some(2))),
                _ if general => return None,
                (2 | 3, Some(length)) => {
                    let end = usize::try_from(length)
                        .ok()
                        .and_then(|l| next.checked_add(l))
                        .filter(|end| *end <= datum.len())?;
                    out.extend_from_slice(&datum[next..end]);
                    pos = end;
                    None
                }
                (2 | 3, None) => Some(Open::Chunks(major)),
                (4, Some(0)) | (5, Some(0)) => None,
                (4, items) => Some(Open::Items(items)),
                (5, Some(pairs)) => Some(Open::Items(Some(pairs.checked_mul(2)?))),
                (5, None) => Some(Open::Items(None)),
                (6, Some(tag)) => Some(Open::Tag(tag == 102)),
                (0 | 1 | 7, Some(_)) => None,
                _ => return None,
            }
        };
        if let Some(level) = opens {
            open.push(level);
            continue;
        }
        // An item is done: it counts toward each open level it finishes.
        loop {
            match open.last_mut() {
                None => return (pos == datum.len()).then_some(out),
                Some(Open::Items(Some(left))) => {
                    *left -= 1;
                    if *left > 0 {
                        break;
                    }
                    open.pop();
                }
                Some(Open::Items(None) | Open::Chunks(_)) => break,
                Some(Open::Pair(read)) => {
                    *read += 1;
                    if *read > 2 {
                        return None;
                    }
                    break;
                }
                Some(Open::Tag(_)) => {
                    open.pop();
                }
            }
        }
    }
}
