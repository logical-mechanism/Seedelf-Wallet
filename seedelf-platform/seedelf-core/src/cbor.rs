//! A depth check for CBOR from outside the wallet, such as a Koios row's datum.
//!
//! Pallas's and `uplc`'s decoders go one call deeper for each level of
//! nesting, so a datum nested a few thousand levels deep (a few kilobytes on
//! chain) overflows WebAssembly's stack. That's a trap, which kills the
//! instance. Untrusted CBOR is walked here first, one item at a time with no
//! recursion, and refused past [`MAX_DEPTH`].

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
