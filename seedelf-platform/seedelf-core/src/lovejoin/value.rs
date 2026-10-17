//! What every box of a pool holds, exactly: `box_lovelace` ADA, and in a
//! token pool `Q` of one token besides. Every box of a pool is byte for byte
//! the same value, which is what keeps them alike: a box holding anything
//! else isn't one a mix may take (`mix_logic` makes every output exactly
//! this, and the wallet takes no input that isn't).

use anyhow::{Context, Result, bail};
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::Value;
use pallas_txbuilder::Output;
use seedelf_koios::koios::UtxoResponse;

/// A token pool's token: its policy, its name (at most 32 bytes), and how
/// many of it a box holds, `Q`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BoxToken {
    pub policy: [u8; 28],
    pub name: Vec<u8>,
    pub quantity: u64,
}

/// What a box holds.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BoxValue {
    pub lovelace: u64,
    /// None in an ADA pool.
    pub token: Option<BoxToken>,
}

impl BoxValue {
    /// An ADA pool's box: `lovelace` alone.
    pub fn ada(lovelace: u64) -> Self {
        BoxValue {
            lovelace,
            token: None,
        }
    }

    /// `serialise_data` of the value, as `mix_logic` hashes it into a mix's
    /// context once per output: definite maps, ADA's empty policy and name
    /// first, integers in their shortest form. An ADA box is
    /// `A1 40 A1 40 <lovelace>`, byte for byte the classic pool's; a token
    /// box is `A2 40 A1 40 <lovelace> 58 1C <policy> A1 <name> <Q>`.
    pub fn cbor(&self) -> Vec<u8> {
        let mut e = minicbor::Encoder::new(Vec::new());
        let encoded = e
            .map(1 + u64::from(self.token.is_some()))
            .and_then(|e| e.bytes(&[]))
            .and_then(|e| e.map(1))
            .and_then(|e| e.bytes(&[]))
            .and_then(|e| e.u64(self.lovelace));
        encoded.expect("encoding into a Vec doesn't fail");
        if let Some(token) = &self.token {
            e.bytes(&token.policy)
                .and_then(|e| e.map(1))
                .and_then(|e| e.bytes(&token.name))
                .and_then(|e| e.u64(token.quantity))
                .expect("encoding into a Vec doesn't fail");
        }
        e.into_writer()
    }

    /// Whether a Koios row holds exactly this, nothing more and nothing less.
    pub fn is_row(&self, row: &UtxoResponse) -> bool {
        if row.value != self.lovelace.to_string() {
            return false;
        }
        let assets = row.asset_list.as_deref().unwrap_or_default();
        match &self.token {
            None => assets.is_empty(),
            Some(token) => match assets {
                [asset] => {
                    asset.policy_id == hex::encode(token.policy)
                        && asset.asset_name == hex::encode(&token.name)
                        && asset.quantity == token.quantity.to_string()
                }
                _ => false,
            },
        }
    }

    /// Whether an output's value, as the ledger keeps it, is exactly this.
    pub fn is_value(&self, value: &Value) -> bool {
        match (value, &self.token) {
            (Value::Coin(lovelace), None) => *lovelace == self.lovelace,
            (Value::Multiasset(lovelace, assets), Some(token)) => {
                *lovelace == self.lovelace
                    && matches!(assets.as_slice(), [(policy, names)]
                        if **policy == token.policy
                            && matches!(names.as_slice(), [(name, quantity)]
                                if name.as_slice() == token.name.as_slice()
                                    && u64::from(quantity) == token.quantity))
            }
            _ => false,
        }
    }

    /// An output at `address` holding exactly this.
    pub fn output(&self, address: Address) -> Result<Output> {
        let output = Output::new(address, self.lovelace);
        match &self.token {
            None => Ok(output),
            Some(token) => output
                .add_asset(Hash::new(token.policy), token.name.clone(), token.quantity)
                .context("A box's token can't be added to its output"),
        }
    }

    /// How much of the token `boxes` boxes hold together: what a withdraw
    /// of them pays out. Refused past the ledger's limit for one asset in an
    /// output (`2^64 − 1`), so such a withdraw takes fewer boxes at once.
    pub fn token_total(&self, boxes: usize) -> Result<Option<(BoxToken, u64)>> {
        let Some(token) = &self.token else {
            return Ok(None);
        };
        let Some(total) = token.quantity.checked_mul(boxes as u64) else {
            bail!(
                "{boxes} boxes hold more of this token than one output can; bring them back fewer at a time"
            );
        };
        Ok(Some((token.clone(), total)))
    }
}
