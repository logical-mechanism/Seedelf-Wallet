use pallas_crypto::hash::Hash;
use serde::{Deserialize, Serialize};

// An Asset is a non-lovelace value
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone)]
pub struct Asset {
    pub policy_id: Hash<28>,
    pub token_name: Vec<u8>,
    pub amount: u64,
}

impl Asset {
    pub fn new(policy_id: String, token_name: String, amount: u64) -> Self {
        Self {
            policy_id: Hash::new(
                hex::decode(policy_id)
                    .unwrap()
                    .try_into()
                    .expect("Incorrect Length"),
            ),
            token_name: hex::decode(token_name).unwrap(),
            amount: amount,
        }
    }

    pub fn add(&self, other: &Asset) -> Result<Self, String> {
        if self.policy_id != other.policy_id || self.token_name != other.token_name {
            return Err(format!(
                "Assets must have the same policy_id and token_name to be subtracted"
            ));
        }
        Ok(Self {
            policy_id: self.policy_id.clone(),
            token_name: self.token_name.clone(),
            amount: self.amount + other.amount,
        })
    }

    pub fn sub(&self, other: &Asset) -> Result<Self, String> {
        if self.policy_id != other.policy_id || self.token_name != other.token_name {
            return Err(format!(
                "Assets must have the same policy_id and token_name to be subtracted"
            ));
        }
        Ok(Self {
            policy_id: self.policy_id.clone(),
            token_name: self.token_name.clone(),
            amount: self.amount - other.amount,
        })
    }

    pub fn compare(&self, other: Asset) -> bool {
        if self.policy_id != other.policy_id || self.token_name != other.token_name {
            false
        } else {
            self.amount >= other.amount
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone)]
pub struct Assets {
    pub items: Vec<Asset>,
}

impl Assets {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

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

    pub fn remove_zero_amounts(&self) -> Self {
        let filtered_items: Vec<Asset> = self
            .items
            .iter()
            .cloned()
            .filter(|asset| asset.amount > 0)
            .collect();
        Self {
            items: filtered_items,
        }
    }

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
                return false
            }
        }
        // we found all the other tokens
        true
    }

    pub fn any(&self, other: Assets) -> bool {
        if other.items.is_empty() {
            return true
        }
        // search all other tokens and make sure they exist in these assets
        for other_token in other.items {
            // lets check all the assets in these assets
            for token in self.items.clone() {
                // if its greater than or equal then break
                if token.policy_id == other_token.policy_id && token.token_name == other_token.token_name {
                    return true
                }
            }
        }
        // we found nothing
        false
    }

    pub fn merge(&self, other: Assets) -> Self {
        let mut merged = self.clone(); // Clone the current `Assets` as a starting point
    
        for other_asset in other.items {
            merged = merged.add(other_asset); // Use `add` to handle merging logic
        }
    
        merged
    }
}

pub fn string_to_u64(input: String) -> Result<u64, String> {
    match input.parse::<u64>() {
        Ok(value) => Ok(value),
        Err(e) => Err(format!("Failed to convert: {}", e)),
    }
}