use anyhow::{Result, bail};
use hex;
use pallas_crypto::hash::Hash;
use serde::{Deserialize, Serialize};
use std::num::ParseIntError;
/// Represents an asset in the Cardano blockchain.
///
/// An `Asset` is identified by a `policy_id` and a `token_name`, and it tracks
/// the amount of tokens associated with the asset.
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone)]
pub struct Asset {
    pub policy_id: Hash<28>,
    pub token_name: Vec<u8>,
    pub amount: u64,
}

impl Asset {
    /// Creates a new `Asset` instance.
    ///
    /// # Arguments
    ///
    /// * `policy_id` - A hex-encoded string representing the policy ID.
    /// * `token_name` - A hex-encoded string representing the token name.
    /// * `amount` - The amount of tokens for the asset.
    pub fn new(policy_id: String, token_name: String, amount: u64) -> Result<Self> {
        Ok(Self {
            policy_id: Hash::new(
                hex::decode(policy_id)?
                    .as_slice()
                    .try_into()
                    .map_err(|e| anyhow::anyhow!("{e}"))?,
            ),
            token_name: hex::decode(token_name).unwrap(),
            amount,
        })
    }

    /// Adds two assets together if they have the same `policy_id` and `token_name`.
    ///
    /// # Arguments
    ///
    /// * `other` - The other asset to add.
    ///
    /// # Returns
    ///
    /// * `Ok(Self)` - The resulting `Asset` with the combined amounts.
    /// * `Err(String)` - If the `policy_id` or `token_name` do not match.
    pub fn add(&self, other: &Asset) -> Result<Self> {
        if self.policy_id != other.policy_id || self.token_name != other.token_name {
            bail!("Assets must have the same policy_id and token_name to be subtracted")
        }
        Ok(Self {
            policy_id: self.policy_id,
            token_name: self.token_name.clone(),
            amount: self.amount + other.amount,
        })
    }

    /// Subtracts the amount of another asset if they have the same `policy_id` and `token_name`.
    ///
    /// # Arguments
    ///
    /// * `other` - The other asset to subtract.
    ///
    /// # Returns
    ///
    /// * `Ok(Self)` - The resulting `Asset` after subtraction.
    /// * `Err(String)` - If the `policy_id` or `token_name` do not match.
    pub fn sub(&self, other: &Asset) -> Result<Self> {
        if self.policy_id != other.policy_id || self.token_name != other.token_name {
            bail!("Assets must have the same policy_id and token_name to be subtracted")
        }
        Ok(Self {
            policy_id: self.policy_id,
            token_name: self.token_name.clone(),
            amount: self.amount - other.amount,
        })
    }

    /// Compares two assets for equivalence in `policy_id` and `token_name`,
    /// and checks if the amount is greater or equal.
    ///
    /// # Arguments
    ///
    /// * `other` - The other asset to compare against.
    ///
    /// # Returns
    ///
    /// * `true` if the `policy_id` and `token_name` match and the amount is greater or equal.
    /// * `false` otherwise.
    pub fn compare(&self, other: Asset) -> bool {
        if self.policy_id != other.policy_id || self.token_name != other.token_name {
            false
        } else {
            self.amount >= other.amount
        }
    }

    pub fn quantity_of(&self, policy_id: String, token_name: String) -> Result<Option<u64>> {
        let pid = Hash::new(
            hex::decode(policy_id)?
                .as_slice()
                .try_into()
                .map_err(|e| anyhow::anyhow!("{e}"))?,
        );
        let tkn = hex::decode(token_name).unwrap();
        if self.policy_id == pid && self.token_name == tkn {
            Ok(Some(self.amount))
        } else {
            Ok(None)
        }
    }
}

/// Represents a collection of `Asset` instances.
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone)]
pub struct Assets {
    pub items: Vec<Asset>,
}

impl Default for Assets {
    fn default() -> Self {
        Self::new()
    }
}

impl Assets {
    /// Creates a new, empty `Assets` instance.
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    /// Adds an asset to the collection, combining amounts if the asset already exists.
    ///
    /// # Arguments
    ///
    /// * `other` - The asset to add.
    ///
    /// # Returns
    ///
    /// * A new `Assets` instance with the updated list of assets.
    pub fn add(&self, other: Asset) -> Self {
        let mut new_items: Vec<Asset> = self.items.clone();
        if let Some(existing) = new_items.iter_mut().find(|existing| {
            existing.policy_id == other.policy_id && existing.token_name == other.token_name
        }) {
            *existing = existing.add(&other).unwrap();
        } else {
            new_items.push(other);
        }
        Self { items: new_items }
    }

    /// Subtracts an asset from the collection, removing it if the amount becomes zero.
    ///
    /// # Arguments
    ///
    /// * `other` - The asset to subtract.
    ///
    /// # Returns
    ///
    /// * A new `Assets` instance with updated asset amounts.
    pub fn sub(&self, other: Asset) -> Self {
        let mut new_items: Vec<Asset> = self.items.clone();
        if let Some(existing) = new_items.iter_mut().find(|existing| {
            existing.policy_id == other.policy_id && existing.token_name == other.token_name
        }) {
            *existing = existing.sub(&other).unwrap();
        } else {
            new_items.push(other);
        }
        Self { items: new_items }.remove_zero_amounts()
    }

    /// Removes assets with zero amounts from the collection.
    pub fn remove_zero_amounts(&self) -> Self {
        let filtered_items: Vec<Asset> = self
            .items
            .iter()
            .filter(|asset| asset.amount > 0)
            .cloned()
            .collect();
        Self {
            items: filtered_items,
        }
    }

    /// Checks if all assets in `other` are contained in this collection.
    pub fn contains(&self, other: Assets) -> bool {
        // search all other tokens and make sure they exist in these assets
        for other_token in other.items {
            // we assume we cant find it
            let mut found = false;
            // lets check all the assets in these assets
            for token in self.items.clone() {
                if token.compare(other_token.clone()) {
                    found = true;
                    break;
                }
            }
            // if we didnt find it then false
            if !found {
                return false;
            }
        }
        // we found all the other tokens
        true
    }

    pub fn quantity_of(&self, policy_id: String, token_name: String) -> Result<Option<u64>> {
        for this_asset in &self.items {
            match Asset::quantity_of(this_asset, policy_id.clone(), token_name.clone()) {
                Ok(Some(amount)) => return Ok(Some(amount)),
                _ => continue,
            }
        }
        Ok(None)
    }

    /// Checks if any asset in `other` exists in this collection.
    pub fn any(&self, other: Assets) -> bool {
        if other.items.is_empty() {
            return true;
        }
        // search all other tokens and make sure they exist in these assets
        for other_token in other.items {
            // lets check all the assets in these assets
            for token in self.items.clone() {
                // if its greater than or equal then break
                if token.policy_id == other_token.policy_id
                    && token.token_name == other_token.token_name
                {
                    return true;
                }
            }
        }
        // we found nothing
        false
    }

    /// Merges two collections of assets, combining amounts of matching assets.
    pub fn merge(&self, other: Assets) -> Self {
        let mut merged: Assets = self.clone(); // Clone the current `Assets` as a starting point

        for other_asset in other.items {
            merged = merged.add(other_asset); // Use `add` to handle merging logic
        }

        merged
    }

    /// Separates two collections of assets, subtracting amounts of matching assets.
    pub fn separate(&self, other: Assets) -> Self {
        let mut separated: Assets = self.clone(); // Clone the current `Assets` as a starting point

        for other_asset in other.items {
            separated = separated.sub(other_asset); // Use `add` to handle merging logic
        }

        separated
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn len(&self) -> u64 {
        self.items.len() as u64
    }

    pub fn split(&self, k: usize) -> Vec<Self> {
        self.items
            .chunks(k) // Divide the `items` into slices of at most `k` elements
            .map(|chunk| Assets {
                items: chunk.to_vec(),
            }) // Convert each slice into an `Assets` struct
            .collect()
    }
}

/// Converts a string into a `u64` value.
///
/// # Arguments
///
/// * `input` - The string to parse into a `u64`.
///
/// # Returns
///
/// * `Ok(u64)` - If the conversion is successful.
/// * `Err(String)` - If the conversion fails.
pub fn string_to_u64(input: String) -> Result<u64, ParseIntError> {
    input.parse::<u64>()
}

pub fn asset_id_to_asset(asset_id: String) -> Result<Asset> {
    // Assume NFT for now
    Asset::new(asset_id[..56].to_string(), asset_id[56..].to_string(), 1)
}
