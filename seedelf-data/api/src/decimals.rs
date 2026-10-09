//! Tokens' decimals, which Koios puts in every `asset_list` and db-sync
//! doesn't hold: Koios reads them from the Cardano token registry. The wallet
//! takes its bundled list's first (`tokens.ts`), and these for any other token.
//!
//! The file (`MAINNET_TOKEN_DECIMALS`) is `{"<policy hex><name hex>": decimals}`
//! for every registered token whose decimals aren't 0, made from a checkout of
//! the registry by `seedelf-data/scripts/token-decimals.py`. Every other token
//! is 0, as Koios gives it. Without the file, every token is 0.

use std::collections::HashMap;

use anyhow::{Context, Result};

#[derive(Default)]
pub struct Decimals(HashMap<String, u8>);

impl Decimals {
    pub fn load(path: &str) -> Result<Decimals> {
        let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
        Decimals::parse(&text).with_context(|| format!("reading {path}"))
    }

    pub fn parse(text: &str) -> Result<Decimals> {
        let map: HashMap<String, u8> = serde_json::from_str(text)?;
        Ok(Decimals(map))
    }

    /// A token's decimals: the registry's, or 0.
    pub fn of(&self, policy: &str, name: &str) -> u8 {
        if self.0.is_empty() {
            return 0;
        }
        self.0.get(&format!("{policy}{name}")).copied().unwrap_or(0)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_registered_token_has_its_decimals_and_any_other_none() {
        let decimals = Decimals::parse(r#"{"aabb0011": 6}"#).unwrap();
        assert_eq!(decimals.of("aabb", "0011"), 6);
        assert_eq!(decimals.of("aabb", "0012"), 0);
        assert_eq!(Decimals::default().of("aabb", "0011"), 0);
        assert!(Decimals::parse(r#"{"aabb": 300}"#).is_err());
    }
}
