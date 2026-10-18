//! A pool's reference datum, read as strictly as `one_shot_mint` checks it
//! at the launch, and exactly as seedelf-core's `ReferenceDatum::decode`
//! reads it (the vectors in `lovejoin-pool-vectors.json` hold the two
//! together): `Constr 0` (tag 121) of eight fields, its list definite or
//! not; integers in any width but never bignums; byte strings whole or in
//! chunks.
//!
//! `[box_lovelace, token_policy, token_name, token_quantity,
//!   max_fee_per_mix_lovelace, mix_script_hash, mix_logic_script_hash, fee_script_hash]`

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
}

/// Why a datum isn't a pool's.
pub type Rejected = &'static str;

/// The fields of a `Constr 0` (tag 121) of exactly `count` of them, its
/// list definite or not; none if it isn't one.
fn constr0(datum: &[u8], count: usize) -> Result<Vec<Item>, Rejected> {
    let mut c = Cbor {
        bytes: datum,
        at: 0,
    };
    if c.head() != Some((6, Some(121))) {
        return Err("it isn't constructor 0");
    }
    let mut fields = Vec::new();
    match c.head() {
        Some((4, Some(n))) => {
            if n != count as u64 {
                return Err("it doesn't have its fields");
            }
            for _ in 0..count {
                fields.push(c.item().ok_or("it can't be read")?);
            }
        }
        Some((4, None)) => loop {
            if c.bytes.get(c.at) == Some(&0xff) {
                break;
            }
            if fields.len() == count {
                return Err("it doesn't have its fields");
            }
            fields.push(c.item().ok_or("it can't be read")?);
        },
        _ => return Err("it isn't constructor 0"),
    }
    if fields.len() != count {
        return Err("it doesn't have its fields");
    }
    Ok(fields)
}

/// Whether `datum` has a box's shape, `Constr 0 [a, b]` of two 48-byte
/// points, `a ≠ b`, as the wallet's `parse_mix_datum` reads one. Whether
/// they're points of G1 is the wallet's to check: this crate has no curve.
pub fn is_mix_datum(datum: &[u8]) -> bool {
    match constr0(datum, 2).as_deref() {
        Ok([Item::Bytes(a), Item::Bytes(b)]) => a.len() == 48 && b.len() == 48 && a != b,
        _ => false,
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
}
