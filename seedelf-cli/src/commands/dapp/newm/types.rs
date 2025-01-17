use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct Wallet {
    pub pkh: String,
    pub sc: String,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct Token {
    pub pid: String,
    pub tkn: String,
    pub amt: u64,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct SaleDatum {
    pub owner: Wallet,
    pub bundle: Token,
    pub cost: Token,
    pub max_bundle_size: u64
}