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
}

pub fn string_to_u64(input: String) -> Result<u64, String> {
    match input.parse::<u64>() {
        Ok(value) => Ok(value),
        Err(e) => Err(format!("Failed to convert: {}", e)),
    }
}