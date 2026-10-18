//! Just enough of UPLC's flat encoding to apply `Data` parameters to a
//! script, as `aiken blueprint apply` (and the wallet's `uplc`) do: the
//! program `[[term p1] p2]`, each parameter a `Data` constant.
//!
//! An applied term isn't the old one's bits shifted along. Every byte string
//! in it (a constant's) starts on a byte boundary, padded to it, so moving a
//! term moves its pads. The term is read and written again, item by item,
//! with each byte string padded where it now falls. Nothing else changes.

use std::fmt;

/// The bytes aren't a flat program this reads: never so for the pinned templates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Malformed(&'static str);

impl fmt::Display for Malformed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "not a flat program: {}", self.0)
    }
}

impl std::error::Error for Malformed {}

type Result<T> = std::result::Result<T, Malformed>;

struct Reader<'a> {
    bytes: &'a [u8],
    /// In bits.
    at: usize,
}

impl Reader<'_> {
    fn bit(&mut self) -> Result<bool> {
        let byte = *self
            .bytes
            .get(self.at / 8)
            .ok_or(Malformed("it ends early"))?;
        let bit = (byte >> (7 - self.at % 8)) & 1 == 1;
        self.at += 1;
        Ok(bit)
    }

    fn bits(&mut self, n: usize) -> Result<u8> {
        let mut value = 0;
        for _ in 0..n {
            value = (value << 1) | u8::from(self.bit()?);
        }
        Ok(value)
    }
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
    /// In bits.
    len: usize,
}

impl Writer {
    fn bit(&mut self, bit: bool) {
        if self.len.is_multiple_of(8) {
            self.bytes.push(0);
        }
        if bit {
            *self.bytes.last_mut().expect("pushed above") |= 1 << (7 - self.len % 8);
        }
        self.len += 1;
    }

    fn bits(&mut self, n: usize, value: u8) {
        for i in (0..n).rev() {
            self.bit((value >> i) & 1 == 1);
        }
    }

    /// Zeros, then a one, ending on a byte boundary: a whole byte when on one already.
    fn filler(&mut self) {
        while self.len % 8 != 7 {
            self.bit(false);
        }
        self.bit(true);
    }

    /// A byte string: the filler, then chunks of at most 255 bytes, each after its length, then 0.
    fn byte_string(&mut self, bytes: &[u8]) {
        self.filler();
        for chunk in bytes.chunks(255) {
            self.bytes.push(chunk.len() as u8);
            self.bytes.extend_from_slice(chunk);
        }
        self.bytes.push(0);
        self.len = self.bytes.len() * 8;
    }
}

/// A natural: 7 bits a byte, low first, the top bit saying another follows.
fn word(r: &mut Reader, w: &mut Writer) -> Result<()> {
    loop {
        let group = r.bits(8)?;
        w.bits(8, group);
        if group & 0x80 == 0 {
            return Ok(());
        }
    }
}

/// A byte string, padded again where the writer is.
fn byte_string(r: &mut Reader, w: &mut Writer) -> Result<()> {
    while !r.bit()? {}
    if !r.at.is_multiple_of(8) {
        return Err(Malformed("a byte string's pad doesn't end on a byte"));
    }
    let mut bytes = Vec::new();
    loop {
        let n = r.bits(8)?;
        if n == 0 {
            break;
        }
        for _ in 0..n {
            bytes.push(r.bits(8)?);
        }
    }
    w.byte_string(&bytes);
    Ok(())
}

/// A list: each item after a one, then a zero.
fn list(
    r: &mut Reader,
    w: &mut Writer,
    mut item: impl FnMut(&mut Reader, &mut Writer) -> Result<()>,
) -> Result<()> {
    loop {
        let more = r.bit()?;
        w.bit(more);
        if !more {
            return Ok(());
        }
        item(r, w)?;
    }
}

/// A constant's type, from its list of 4-bit tags.
enum Type {
    Integer,
    Bytes,
    String,
    Unit,
    Bool,
    Data,
    List(Box<Type>),
    Pair(Box<Type>, Box<Type>),
}

fn type_of(tags: &[u8]) -> Result<(Type, &[u8])> {
    let (&tag, rest) = tags.split_first().ok_or(Malformed("a type without tags"))?;
    Ok(match tag {
        0 => (Type::Integer, rest),
        1 => (Type::Bytes, rest),
        2 => (Type::String, rest),
        3 => (Type::Unit, rest),
        4 => (Type::Bool, rest),
        8 => (Type::Data, rest),
        7 => match rest {
            [5, rest @ ..] => {
                let (item, rest) = type_of(rest)?;
                (Type::List(Box::new(item)), rest)
            }
            [7, 6, rest @ ..] => {
                let (a, rest) = type_of(rest)?;
                let (b, rest) = type_of(rest)?;
                (Type::Pair(Box::new(a), Box::new(b)), rest)
            }
            _ => return Err(Malformed("a type application it doesn't know")),
        },
        _ => return Err(Malformed("a constant type it doesn't know")),
    })
}

fn value(r: &mut Reader, w: &mut Writer, of: &Type) -> Result<()> {
    match of {
        // Zigzag, then a natural.
        Type::Integer => word(r, w),
        Type::Bytes | Type::String | Type::Data => byte_string(r, w),
        Type::Unit => Ok(()),
        Type::Bool => {
            let bit = r.bit()?;
            w.bit(bit);
            Ok(())
        }
        Type::List(item) => list(r, w, |r, w| value(r, w, item)),
        Type::Pair(a, b) => {
            value(r, w, a)?;
            value(r, w, b)
        }
    }
}

fn term(r: &mut Reader, w: &mut Writer) -> Result<()> {
    let tag = r.bits(4)?;
    w.bits(4, tag);
    match tag {
        // A variable's de Bruijn index.
        0 => word(r, w),
        // Delay, lambda (de Bruijn: no name), force.
        1 | 2 | 5 => term(r, w),
        3 => {
            term(r, w)?;
            term(r, w)
        }
        4 => {
            let mut tags = Vec::new();
            list(r, w, |r, w| {
                let tag = r.bits(4)?;
                w.bits(4, tag);
                tags.push(tag);
                Ok(())
            })?;
            let (of, rest) = type_of(&tags)?;
            if !rest.is_empty() {
                return Err(Malformed("a constant with more types than one"));
            }
            value(r, w, &of)
        }
        6 => Ok(()),
        7 => {
            let builtin = r.bits(7)?;
            w.bits(7, builtin);
            Ok(())
        }
        // Constr: its tag, then its fields. Case: its scrutinee, then its branches.
        8 => {
            word(r, w)?;
            list(r, w, term)
        }
        9 => {
            term(r, w)?;
            list(r, w, term)
        }
        _ => Err(Malformed("a term it doesn't know")),
    }
}

/// A script as a transaction carries it (the flat program in one CBOR byte
/// string) applied to `params`, each the CBOR of a `Data`, in order.
pub fn apply(script: &[u8], params: &[Vec<u8>]) -> Result<Vec<u8>> {
    let mut r = Reader {
        bytes: unwrap(script)?,
        at: 0,
    };
    let mut w = Writer::default();
    // The version: three naturals.
    for _ in 0..3 {
        word(&mut r, &mut w)?;
    }
    for _ in params {
        w.bits(4, 3);
    }
    term(&mut r, &mut w)?;
    for param in params {
        w.bits(4, 4);
        // The type list [data]: a one, data's tag 8, a zero.
        w.bit(true);
        w.bits(4, 8);
        w.bit(false);
        w.byte_string(param);
    }
    w.filler();
    Ok(wrap(&w.bytes))
}

/// The flat bytes inside a script's CBOR byte string.
fn unwrap(script: &[u8]) -> Result<&[u8]> {
    let (&first, rest) = script.split_first().ok_or(Malformed("no bytes"))?;
    if first >> 5 != 2 {
        return Err(Malformed("not a CBOR byte string"));
    }
    let (len, rest) = match first & 0x1f {
        n @ 0..=23 => (usize::from(n), rest),
        n @ 24..=27 => {
            let width = 1 << (n - 24);
            if rest.len() < width {
                return Err(Malformed("a cut length"));
            }
            let len = rest[..width]
                .iter()
                .fold(0usize, |len, b| (len << 8) | usize::from(*b));
            (len, &rest[width..])
        }
        _ => return Err(Malformed("an indefinite byte string")),
    };
    if rest.len() != len {
        return Err(Malformed("a length that isn't its bytes'"));
    }
    Ok(rest)
}

/// `flat` in one CBOR byte string, its length in the shortest form.
pub fn wrap(flat: &[u8]) -> Vec<u8> {
    let mut out = cbor_head(2, flat.len() as u64);
    out.extend_from_slice(flat);
    out
}

/// A CBOR head: `major` and the argument `n`, in its shortest form.
pub fn cbor_head(major: u8, n: u64) -> Vec<u8> {
    let m = major << 5;
    match n {
        0..=23 => vec![m | n as u8],
        24..=0xff => vec![m | 24, n as u8],
        0x100..=0xffff => [&[m | 25][..], &(n as u16).to_be_bytes()].concat(),
        0x1_0000..=0xffff_ffff => [&[m | 26][..], &(n as u32).to_be_bytes()].concat(),
        _ => [&[m | 27][..], &n.to_be_bytes()].concat(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A program read and written with no parameter is the same bytes.
    fn round_trip(script: &[u8]) -> Vec<u8> {
        apply(script, &[]).unwrap()
    }

    #[test]
    fn a_byte_string_is_padded_where_it_falls() {
        let mut w = Writer::default();
        w.bits(4, 0b1010);
        w.byte_string(&[0xab]);
        // Four bits, then 0001 to the boundary, then the chunk and the end.
        assert_eq!(w.bytes, [0b1010_0001, 1, 0xab, 0]);
        let mut aligned = Writer::default();
        aligned.byte_string(&[]);
        assert_eq!(aligned.bytes, [0b0000_0001, 0]);
    }

    #[test]
    fn a_long_byte_string_goes_in_chunks_of_255() {
        let mut w = Writer::default();
        w.byte_string(&[7; 300]);
        assert_eq!(w.bytes[..2], [1, 255]);
        assert_eq!(w.bytes[257], 45);
        assert_eq!(w.bytes.len(), 1 + 1 + 255 + 1 + 45 + 1);
    }

    #[test]
    fn cut_or_foreign_bytes_are_refused() {
        assert!(apply(&[], &[]).is_err());
        assert!(apply(&[0x43, 1, 1, 0], &[]).is_err());
        // A term tag past Case.
        assert!(apply(&[0x44, 1, 1, 0, 0xf1], &[]).is_err());
        // Its stated length isn't its bytes'.
        assert!(apply(&[0x45, 1, 1, 0], &[]).is_err());
    }

    #[test]
    fn the_templates_read_back_as_they_are() {
        for script in crate::lovejoin::templates::all() {
            assert_eq!(round_trip(&script), script);
        }
    }
}
