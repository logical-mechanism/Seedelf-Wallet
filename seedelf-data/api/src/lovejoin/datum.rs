//! A pool's reference datum, read as strictly as `one_shot_mint` checks it
//! at the launch, and exactly as seedelf-core's `ReferenceDatum::decode`
//! reads it (the vectors in `lovejoin-pool-vectors.json` hold the two
//! together): `Constr 0` of eight fields, written as tag 121, its list
//! definite or not; integers in any width but never bignums; byte strings
//! whole or in chunks.
//!
//! `[box_lovelace, token_policy, token_name, token_quantity,
//!   max_fee_per_mix_lovelace, mix_script_hash, mix_logic_script_hash, fee_script_hash]`
//!
//! Constructor 0 has a second spelling the ledger reads as the same data: the
//! general form, `102([0, fields])`. A reference datum written so isn't read,
//! as core reads none: only its pool's own launch writes it, so it hides that
//! pool alone. A box's datum is read in either ([`is_mix_datum`]): whoever
//! builds a mix writes its boxes (chunk 51, r3a#1). It and core's box reader
//! are held to the node's own verdicts on a box's spellings,
//! `lovejoin-box-spellings.json` beside the vectors.

/// A token pool's token: its policy, its name (at most 32 bytes), and how many a box holds, Q.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Token {
    pub policy: [u8; 28],
    pub name: Vec<u8>,
    pub quantity: u64,
}

/// A reference datum, its ranges checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceDatum {
    pub box_lovelace: u64,
    /// None in an ADA pool.
    pub token: Option<Token>,
    pub max_fee: u64,
    pub mix_box: [u8; 28],
    pub mix_logic: [u8; 28],
    pub fee: [u8; 28],
}

/// One CBOR item of the few a reference datum holds.
enum Item {
    Int(i128),
    Bytes(Vec<u8>),
    Other,
}

struct Cbor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Cbor<'_> {
    fn byte(&mut self) -> Option<u8> {
        let b = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(b)
    }

    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let end = self.at.checked_add(n)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    /// A head: its major type, and its argument (`None` for an indefinite length).
    fn head(&mut self) -> Option<(u8, Option<u64>)> {
        let first = self.byte()?;
        let arg = match first & 0x1f {
            n @ 0..=23 => Some(u64::from(n)),
            n @ 24..=27 => Some(
                self.take(1 << (n - 24))?
                    .iter()
                    .fold(0u64, |v, b| (v << 8) | u64::from(*b)),
            ),
            31 => None,
            _ => return None,
        };
        Some((first >> 5, arg))
    }

    /// One item: an integer, a byte string, or anything else (whose bytes aren't read on).
    fn item(&mut self) -> Option<Item> {
        Some(match self.head()? {
            (0, Some(n)) => Item::Int(i128::from(n)),
            (1, Some(n)) => Item::Int(-1 - i128::from(n)),
            (2, Some(n)) => Item::Bytes(self.take(usize::try_from(n).ok()?)?.to_vec()),
            // Chunks, each a definite byte string, until the break.
            (2, None) => {
                let mut bytes = Vec::new();
                loop {
                    if self.bytes.get(self.at) == Some(&0xff) {
                        self.at += 1;
                        break Item::Bytes(bytes);
                    }
                    match self.head()? {
                        (2, Some(n)) => {
                            bytes.extend_from_slice(self.take(usize::try_from(n).ok()?)?)
                        }
                        _ => return None,
                    }
                }
            }
            _ => Item::Other,
        })
    }

    /// Skips a string after its head (`major` 2 for bytes, 3 for text): `len`
    /// bytes, or for an indefinite length definite chunks of its own kind
    /// until the break. Text is UTF-8, chunk by chunk, as minicbor reads it.
    fn string(&mut self, major: u8, len: Option<u64>) -> Option<()> {
        let Some(n) = len else {
            loop {
                if self.bytes.get(self.at) == Some(&0xff) {
                    self.at += 1;
                    return Some(());
                }
                match self.head()? {
                    (m, Some(n)) if m == major => self.chunk(major, n)?,
                    _ => return None,
                }
            }
        };
        self.chunk(major, n)
    }

    fn chunk(&mut self, major: u8, n: u64) -> Option<()> {
        let bytes = self.take(usize::try_from(n).ok()?)?;
        (major == 2 || std::str::from_utf8(bytes).is_ok()).then_some(())
    }

    /// A constructor's fields: a list of exactly `count` items, definite or
    /// not, its break read.
    fn fields(&mut self, count: usize) -> Result<Vec<Item>, Rejected> {
        let mut fields = Vec::new();
        match self.head() {
            Some((4, Some(n))) => {
                if n != count as u64 {
                    return Err("it doesn't have its fields");
                }
                for _ in 0..count {
                    fields.push(self.item().ok_or("it can't be read")?);
                }
            }
            Some((4, None)) => loop {
                if self.bytes.get(self.at) == Some(&0xff) {
                    self.at += 1;
                    break;
                }
                if fields.len() == count {
                    return Err("it doesn't have its fields");
                }
                fields.push(self.item().ok_or("it can't be read")?);
            },
            _ => return Err("it isn't constructor 0"),
        }
        if fields.len() != count {
            return Err("it doesn't have its fields");
        }
        Ok(fields)
    }
}

/// The deepest datum the wallet reads on a pool's script row, each array,
/// map and tag counting as a level: seedelf-core's `cbor::MAX_DEPTH`, which
/// it holds every datum from outside the wallet to.
pub const MAX_DEPTH: usize = 128;

/// Whether `cbor` is one well-formed CBOR item, with nothing after it, nested
/// no deeper than `max`, each array, map and tag a level: seedelf-core's
/// `cbor::within_depth`, walked the same way, an item at a time with no
/// recursion (the vectors' `scriptRowDatums` hold the two together). The
/// wallet takes a pool's script row only when its datum, if any, passes.
pub fn within_depth(cbor: &[u8], max: usize) -> bool {
    walk(cbor, max).is_some()
}

fn walk(cbor: &[u8], max: usize) -> Option<()> {
    let mut c = Cbor { bytes: cbor, at: 0 };
    // What's left of each open array, map and tag: how many items are still to
    // come, or `None` for an indefinite length, which a break ends.
    let mut open: Vec<Option<u64>> = Vec::new();
    loop {
        // `Some(items)` when this item opens an array, map or tag.
        let opens: Option<Option<u64>> = match c.head()? {
            (4, items) => Some(items),
            (5, Some(pairs)) => Some(Some(pairs.checked_mul(2)?)),
            (5, None) => Some(None),
            (6, Some(_)) => Some(Some(1)),
            // A break: only an indefinite array or map ends with one.
            (7, None) => {
                if open.pop()?.is_some() {
                    return None;
                }
                None
            }
            (major @ (2 | 3), len) => {
                c.string(major, len)?;
                None
            }
            // A number, a simple value or a float: nothing nests in it.
            (0 | 1 | 7, Some(_)) => None,
            // A number or a tag of indefinite length.
            _ => return None,
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
                None => return (c.at == cbor.len()).then_some(()),
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

/// Why a datum isn't a pool's.
pub type Rejected = &'static str;

/// The fields of a reference datum's `Constr 0`, written as tag 121 alone
/// (the module's note), exactly `count` of them, its list definite or not;
/// none if it isn't one.
fn constr0(datum: &[u8], count: usize) -> Result<Vec<Item>, Rejected> {
    let mut c = Cbor {
        bytes: datum,
        at: 0,
    };
    if c.head() != Some((6, Some(121))) {
        return Err("it isn't constructor 0");
    }
    c.fields(count)
}

/// A box's fields, `[a, b]` of `Constr 0 [a, b]`, in either of constructor
/// 0's spellings: tag 121, or the general form `102([0, [a, b]])`, its pair
/// exactly two items as the node reads it, definite or not, an indefinite
/// one's break right after them. One item, with nothing after it.
fn box_fields(datum: &[u8]) -> Option<Vec<Item>> {
    let mut c = Cbor {
        bytes: datum,
        at: 0,
    };
    let fields = match c.head()? {
        (6, Some(121)) => c.fields(2).ok()?,
        (6, Some(102)) => {
            let pair = c.head()?;
            if !matches!(pair, (4, Some(2) | None)) || c.head()? != (0, Some(0)) {
                return None;
            }
            let fields = c.fields(2).ok()?;
            if pair.1.is_none() && c.head()? != (7, None) {
                return None;
            }
            fields
        }
        _ => return None,
    };
    (c.at == datum.len()).then_some(fields)
}

/// Whether `datum` has a box's shape, `Constr 0 [a, b]` of two 48-byte
/// points, `a ≠ b`, as the wallet's `parse_mix_datum` reads any datum on
/// chain: in either of constructor 0's spellings (`box_fields`), its
/// fields' list definite or not, each point whole or in chunks, every head of
/// any width, since whoever builds a mix writes its boxes (chunk 51, r3a#1).
/// Exactly the spellings the node reads as a box: both readers are held to
/// its verdicts (seedelf-core's `tests/fixtures/lovejoin-box-spellings.json`).
/// Whether they're points of G1 is the wallet's to check: this crate has no
/// curve.
pub fn is_mix_datum(datum: &[u8]) -> bool {
    match box_fields(datum).as_deref() {
        Some([Item::Bytes(a), Item::Bytes(b)]) => a.len() == 48 && b.len() == 48 && a != b,
        _ => false,
    }
}

/// A Seedelf register, `g_S ‖ u_S`, from a contract UTxO's inline datum:
/// `Constr 0 [g, u]` of two 48-byte byte strings, in exactly the spellings
/// [`is_mix_datum`] reads a box in (a box's datum is a register), and as
/// seedelf-koios's `register_of_datum` reads one for the wallet and the CLI.
/// Both are held to the wallet's `register-spellings.json`. Unlike a box, a
/// register may have g = u. Whether they're points of G1 isn't asked: the
/// relay compares these bytes with a certificate's, whose points it checked
/// (messaging's check 8).
pub fn register_of(datum: &[u8]) -> Option<[u8; 96]> {
    match box_fields(datum).as_deref() {
        Some([Item::Bytes(g), Item::Bytes(u)]) if g.len() == 48 && u.len() == 48 => {
            let mut register = [0u8; 96];
            register[..48].copy_from_slice(g);
            register[48..].copy_from_slice(u);
            Some(register)
        }
        _ => None,
    }
}

/// Decodes a reference datum, or says why it isn't one.
pub fn decode(datum: &[u8]) -> Result<ReferenceDatum, Rejected> {
    let fields = constr0(datum, 8)?;
    let [
        lovelace,
        policy,
        name,
        quantity,
        max_fee,
        mix_box,
        mix_logic,
        fee,
    ]: [Item; 8] = fields
        .try_into()
        .map_err(|_| "it doesn't have its fields")?;
    let int = |item: Item, field: Rejected| match item {
        Item::Int(n) => Ok(n),
        _ => Err(field),
    };
    let bytes = |item: Item, field: Rejected| match item {
        Item::Bytes(b) => Ok(b),
        _ => Err(field),
    };
    let hash = |item: Item, field: Rejected| -> Result<[u8; 28], Rejected> {
        bytes(item, field)?.try_into().map_err(|_| field)
    };
    let box_lovelace = u64::try_from(int(lovelace, "box_lovelace isn't an integer")?)
        .ok()
        .filter(|l| *l > 0)
        .ok_or("box_lovelace is out of range")?;
    let max_fee = u64::try_from(int(max_fee, "max_fee_per_mix_lovelace isn't an integer")?)
        .ok()
        .filter(|f| *f > 0 && *f < box_lovelace)
        .ok_or("max_fee_per_mix_lovelace is out of range")?;
    let policy = bytes(policy, "token_policy isn't bytes")?;
    let name = bytes(name, "token_name isn't bytes")?;
    let quantity = int(quantity, "token_quantity isn't an integer")?;
    let token = if policy.is_empty() {
        if !name.is_empty() || quantity != 0 {
            return Err("an ADA pool's token fields aren't empty");
        }
        None
    } else {
        let policy: [u8; 28] = policy
            .try_into()
            .map_err(|_| "token_policy isn't 28 bytes")?;
        if name.len() > 32 {
            return Err("token_name is over 32 bytes");
        }
        let quantity = u64::try_from(quantity)
            .ok()
            .filter(|q| *q > 0)
            .ok_or("token_quantity is out of range")?;
        Some(Token {
            policy,
            name,
            quantity,
        })
    };
    Ok(ReferenceDatum {
        box_lovelace,
        token,
        max_fee,
        mix_box: hash(mix_box, "mix_script_hash isn't a 28-byte hash")?,
        mix_logic: hash(mix_logic, "mix_logic_script_hash isn't a 28-byte hash")?,
        fee: hash(fee, "fee_script_hash isn't a 28-byte hash")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::bytes;
    use serde_json::{Value, json};

    fn hex(b: &[u8]) -> String {
        b.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn view(d: &ReferenceDatum) -> Value {
        json!({
            "boxLovelace": d.box_lovelace.to_string(),
            "token": d.token.as_ref().map(|t| json!({
                "policy": hex(&t.policy),
                "name": hex(&t.name),
                "quantity": t.quantity.to_string(),
            })),
            "maxFee": d.max_fee.to_string(),
            "mixBox": hex(&d.mix_box),
            "mixLogic": hex(&d.mix_logic),
            "fee": hex(&d.fee),
        })
    }

    #[test]
    fn a_box_has_two_points() {
        let point = |b: u8| [vec![0x58, 0x30], vec![b; 48]].concat();
        let datum =
            |fields: Vec<Vec<u8>>| [vec![0xd8, 0x79, 0x9f], fields.concat(), vec![0xff]].concat();
        assert!(is_mix_datum(&datum(vec![point(1), point(2)])));
        // A definite list, as the wallet's own mix_datum writes none, still reads.
        assert!(is_mix_datum(
            &[vec![0xd8, 0x79, 0x82], point(1), point(2)].concat()
        ));
        assert!(!is_mix_datum(&datum(vec![point(1), point(1)])));
        assert!(!is_mix_datum(&datum(vec![point(1)])));
        assert!(!is_mix_datum(&datum(vec![point(1), point(2), point(3)])));
        assert!(!is_mix_datum(&datum(vec![
            point(1),
            [vec![0x58, 0x2f], vec![2; 47]].concat()
        ])));
        assert!(!is_mix_datum(&[]));
    }

    /// A head of major type `major`, its argument `arg` in `width` more bytes
    /// (1, 2, 4 or 8), or as short as it goes (0).
    fn head(major: u8, arg: u8, width: usize) -> Vec<u8> {
        match width {
            0 if arg < 24 => vec![(major << 5) | arg],
            0 => vec![(major << 5) | 24, arg],
            _ => [
                vec![(major << 5) | (24 + width.trailing_zeros() as u8)],
                vec![0; width - 1],
                vec![arg],
            ]
            .concat(),
        }
    }

    /// `items` as a list, definite (its length's head `width` wide) or not.
    fn list(items: &[Vec<u8>], indefinite: bool, width: usize) -> Vec<u8> {
        if indefinite {
            [vec![0x9f], items.concat(), vec![0xff]].concat()
        } else {
            [head(4, items.len() as u8, width), items.concat()].concat()
        }
    }

    /// `b` as a byte string, whole or in two chunks.
    fn byte_string(b: &[u8], chunks: bool, width: usize) -> Vec<u8> {
        let whole = |b: &[u8]| [head(2, b.len() as u8, width), b.to_vec()].concat();
        if chunks {
            let (x, y) = b.split_at(b.len() / 2);
            [vec![0x5f], whole(x), whole(y), vec![0xff]].concat()
        } else {
            whole(b)
        }
    }

    /// How constructor 0 is written: as tag 121 or as the general form
    /// `102([0, fields])`, its pair definite or not; its fields definite or
    /// not; a box's `a` and `b` whole or in chunks; every head `width` wide.
    #[derive(Clone, Copy, Debug)]
    struct Spelling {
        general: bool,
        pair_indefinite: bool,
        fields_indefinite: bool,
        chunks: (bool, bool),
        width: usize,
    }

    impl Spelling {
        /// Every spelling of these kinds: the ledger reads each as the same data.
        fn all() -> Vec<Spelling> {
            let mut all = Vec::new();
            for (general, pair_indefinite) in [(false, false), (true, false), (true, true)] {
                for fields_indefinite in [false, true] {
                    for chunks in [(false, false), (true, false), (false, true), (true, true)] {
                        for width in [0, 1, 2, 4, 8] {
                            all.push(Spelling {
                                general,
                                pair_indefinite,
                                fields_indefinite,
                                chunks,
                                width,
                            });
                        }
                    }
                }
            }
            all
        }

        /// Constructor 0 of `fields`, written so.
        fn constr0(&self, fields: &[Vec<u8>]) -> Vec<u8> {
            let w = self.width;
            let fields = list(fields, self.fields_indefinite, w);
            if self.general {
                let pair = list(&[head(0, 0, w), fields], self.pair_indefinite, w);
                [head(6, 102, w), pair].concat()
            } else {
                [head(6, 121, w), fields].concat()
            }
        }

        /// `a` and `b` as a box's fields, written so.
        fn points(&self, a: &[u8], b: &[u8]) -> [Vec<u8>; 2] {
            [
                byte_string(a, self.chunks.0, self.width),
                byte_string(b, self.chunks.1, self.width),
            ]
        }

        /// A box's datum, `Constr 0 [a, b]`, written so.
        fn of(&self, a: &[u8], b: &[u8]) -> Vec<u8> {
            self.constr0(&self.points(a, b))
        }
    }

    /// Chunk 51, r3a#1 (the data layer's copy): the ledger reads constructor 0
    /// as one value whether it's written as tag 121 or as the general form
    /// `102([0, fields])`, its pair and its fields definite or not, its byte
    /// strings whole or in chunks, its heads of any width. Whoever builds a mix
    /// writes its boxes, so a stranger can respell any box, and mix_logic reads
    /// it as the same box. Read in tag 121 alone, it dropped out of the crowd.
    #[test]
    fn a_box_in_constructor_0s_general_form_is_still_a_box() {
        let (a, b) = ([1; 48], [2; 48]);
        let spellings = Spelling::all();
        let missed: Vec<&Spelling> = spellings
            .iter()
            .filter(|s| !is_mix_datum(&s.of(&a, &b)))
            .collect();
        assert!(
            missed.is_empty(),
            "{} of the {} spellings of one box aren't read as a box ({} of them in the general form), \
             as {} ({:?})",
            missed.len(),
            spellings.len(),
            missed.iter().filter(|s| s.general).count(),
            hex(&missed[0].of(&a, &b)),
            missed[0]
        );
    }

    /// r3a#1's other half: in either spelling, a box is still constructor 0
    /// of two different 48-byte values and nothing else. The node wants the
    /// general form's pair of exactly two, its break read, and its index 0;
    /// seedelf-core's reader wants one item, with nothing after it.
    #[test]
    fn a_box_in_either_spelling_is_still_constructor_0_of_two_points_alone() {
        let (a, b) = ([1; 48], [2; 48]);
        let mut taken = Vec::new();
        for s in Spelling::all() {
            let w = s.width;
            let [pa, pb] = s.points(&a, &b);
            let fields = list(&[pa.clone(), pb.clone()], s.fields_indefinite, w);
            let datum = s.of(&a, &b);
            let mut wrong = vec![
                ("a = b", s.of(&a, &a)),
                ("a of 47 bytes", s.of(&a[..47], &b)),
                ("one field", s.constr0(std::slice::from_ref(&pa))),
                ("three fields", s.constr0(&[pa, pb.clone(), pb])),
                ("a byte after it", [datum.clone(), vec![0x00]].concat()),
                ("a break after it", [datum.clone(), vec![0xff]].concat()),
                ("its last byte cut", datum[..datum.len() - 1].to_vec()),
            ];
            if s.general {
                let pair = |items: &[Vec<u8>]| {
                    [head(6, 102, w), list(items, s.pair_indefinite, w)].concat()
                };
                wrong.extend([
                    ("constructor 1", pair(&[head(0, 1, w), fields.clone()])),
                    (
                        "a pair of three",
                        pair(&[head(0, 0, w), fields.clone(), head(0, 0, w)]),
                    ),
                    ("a pair of one", pair(&[head(0, 0, w)])),
                    ("a pair of its fields alone", pair(&[fields])),
                ]);
            } else {
                wrong.push(("constructor 1", [head(6, 122, w), fields].concat()));
            }
            for (why, datum) in wrong {
                if is_mix_datum(&datum) {
                    taken.push(format!("{why}, {s:?}: {}", hex(&datum)));
                }
            }
        }
        assert!(
            taken.is_empty(),
            "{} datums read as a box that isn't one, such as\n{}",
            taken.len(),
            taken[..taken.len().min(3)].join("\n")
        );
    }

    /// Chunk 51, r3a#1's class: one set of box spellings. A box's datum
    /// spelled 252 ways, each with what the node reads it as (seedelf-core's
    /// `tests/fixtures/lovejoin-box-spellings.json`, cardano-cli's verdicts):
    /// the crowd counts a box in exactly the spellings the node reads as
    /// `Constr 0 [a, b]`, reading its `a` and `b`, and in no other, as
    /// seedelf-core's `PoolBox::from_row` reads one. The spellings above are
    /// this module's own; these are the node's.
    #[test]
    fn a_box_is_read_in_exactly_the_spellings_the_node_reads_as_one() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-core/tests/fixtures/lovejoin-box-spellings.json"
        ))
        .unwrap();
        let the_box = Some((
            bytes(fixture["a"].as_str().unwrap()),
            bytes(fixture["b"].as_str().unwrap()),
        ));
        let points = |datum: &[u8]| match box_fields(datum).as_deref() {
            Some([Item::Bytes(a), Item::Bytes(b)]) => Some((a.clone(), b.clone())),
            _ => None,
        };
        let spellings = fixture["spellings"].as_array().unwrap();
        let wrong: Vec<String> = spellings
            .iter()
            .filter(|s| {
                let datum = bytes(s["hex"].as_str().unwrap());
                let node = s["node"] == "constr0_ab";
                is_mix_datum(&datum) != node || (node && points(&datum) != the_box)
            })
            .map(|s| format!("{} (the node's {})", s["name"], s["node"]))
            .collect();
        // Not vacuous: boxes, and spellings that aren't one.
        assert!(spellings.iter().any(|s| s["node"] == "constr0_ab"));
        assert!(spellings.iter().any(|s| s["node"] != "constr0_ab"));
        assert!(
            wrong.is_empty(),
            "{} read otherwise: {}",
            wrong.len(),
            wrong.join(", ")
        );
    }

    /// A Seedelf register is read in exactly the spellings the wallet's
    /// shared fixture says the ledger reads alike (the extension's
    /// `tests/fixtures/register-spellings.json`, which seedelf-koios's
    /// `register_of_datum` is held to as well), and in none of the others;
    /// and the node's box spellings read as the same register as a box.
    #[test]
    fn a_register_is_read_in_exactly_the_spellings_the_wallet_reads_as_one() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-web-wallet/extension/tests/fixtures/register-spellings.json"
        ))
        .unwrap();
        let register = [
            bytes(fixture["generator"].as_str().unwrap()),
            bytes(fixture["publicValue"].as_str().unwrap()),
        ]
        .concat();
        let spellings = fixture["spellings"].as_array().unwrap();
        assert!(spellings.len() >= 15);
        for spelling in spellings {
            let datum = bytes(spelling["datum"].as_str().unwrap());
            let read = register_of(&datum);
            match spelling["register"].as_bool().unwrap() {
                true => assert_eq!(
                    read.map(|r| r.to_vec()),
                    Some(register.clone()),
                    "{}",
                    spelling["name"]
                ),
                false => assert_eq!(read, None, "{}", spelling["name"]),
            }
        }
        // A register with g = u, which no box is.
        let same = [
            &[0xd8, 0x79, 0x82, 0x58, 0x30][..],
            &[7; 48],
            &[0x58, 0x30],
            &[7; 48],
        ]
        .concat();
        assert_eq!(register_of(&same), Some([7; 96]));
        assert!(!is_mix_datum(&same));
        // Fields of another length, and bytes after the datum.
        let short = [
            &[0xd8, 0x79, 0x82, 0x58, 0x2f][..],
            &[7; 47],
            &[0x58, 0x30],
            &[7; 48],
        ]
        .concat();
        assert_eq!(register_of(&short), None);
        let after = [&same[..], &[0]].concat();
        assert_eq!(register_of(&after), None);
        // The node's box spellings: a box is read as the same register.
        let boxes: Value = serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-core/tests/fixtures/lovejoin-box-spellings.json"
        ))
        .unwrap();
        let the_box = [
            bytes(boxes["a"].as_str().unwrap()),
            bytes(boxes["b"].as_str().unwrap()),
        ]
        .concat();
        for spelling in boxes["spellings"].as_array().unwrap() {
            let datum = bytes(spelling["hex"].as_str().unwrap());
            let read = register_of(&datum).map(|r| r.to_vec());
            if spelling["node"] == "constr0_ab" {
                assert_eq!(read, Some(the_box.clone()), "{}", spelling["name"]);
            } else {
                assert_ne!(read, Some(the_box.clone()), "{}", spelling["name"]);
            }
        }
    }

    /// r3a#1 widened the box's reader alone. A pool's reference datum is still
    /// read in tag 121 alone, as seedelf-core's `ReferenceDatum::decode` reads
    /// it on purpose (the vectors' "constructor 0 as tag 102"): only a pool's
    /// own launch writes it, and one written otherwise hides that pool alone.
    #[test]
    fn a_reference_datum_is_still_read_in_tag_121_alone() {
        let v = super::super::templates::tests::vectors();
        let pool = &v["datums"][0];
        let canonical = bytes(pool["cbor"].as_str().unwrap());
        assert_eq!(canonical[..3], [0xd8, 0x79, 0x9f], "{}", pool["about"]);
        assert!(decode(&canonical).is_ok(), "{}", pool["about"]);
        // The same fields, in the general form, its pair definite or not.
        let fields = &canonical[2..];
        for general in [
            [&[0xd8, 0x66, 0x82, 0x00][..], fields].concat(),
            [&[0xd8, 0x66, 0x9f, 0x00][..], fields, &[0xff][..]].concat(),
        ] {
            assert_eq!(decode(&general), Err("it isn't constructor 0"));
        }
    }

    #[test]
    fn every_datum_reads_as_seedelf_core_reads_it() {
        let v = super::super::templates::tests::vectors();
        let datums = v["datums"].as_array().unwrap();
        assert!(datums.len() >= 30);
        for d in datums {
            let got = decode(&bytes(d["cbor"].as_str().unwrap()))
                .map(|d| view(&d))
                .unwrap_or(json!("rejected"));
            assert_eq!(got, d["datum"], "{}", d["about"]);
        }
    }

    #[test]
    fn every_script_rows_datum_is_held_to_seedelf_cores_depth() {
        // 1.6.0's release review, 314-wasm#0: the wallet takes a pool's
        // script row only when its datum is within this depth, so the pools
        // listed here are the ones it shows.
        let v = super::super::templates::tests::vectors();
        let rule = &v["scriptRowDatums"];
        assert_eq!(rule["maxDepth"], MAX_DEPTH);
        let datums = rule["datums"].as_array().unwrap();
        assert!(datums.len() >= 25);
        for d in datums {
            let got = within_depth(&bytes(d["cbor"].as_str().unwrap()), MAX_DEPTH);
            assert_eq!(json!(got), d["readable"], "{}", d["about"]);
        }
        // The walk doesn't recurse: far deeper than any decoder could take.
        let deep = [vec![0x81; 100_000], vec![0x00]].concat();
        assert!(!within_depth(&deep, MAX_DEPTH));
        assert!(within_depth(&deep, usize::MAX));
    }
}
