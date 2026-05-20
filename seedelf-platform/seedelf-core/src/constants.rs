use hex_literal::hex;
use serde::{Deserialize, Serialize};

/// The current variant of Seedelf
pub const VARIANT: u64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contract {
    pub wallet_contract_hash: [u8; 28],
    pub seedelf_policy_id: String,
    pub wallet_contract_size: u64,
    pub seedelf_contract_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reference {
    pub wallet_reference_utxo: [u8; 32],
    pub seedelf_reference_utxo: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub contract: Contract,
    pub reference: Reference,
}

/// We can store all variants of the contracts inside this function then call it whenever we need it.
pub fn get_config(variant: u64, network: bool) -> Option<Config> {
    match variant {
        1 => {
            let reference: Reference = if network {
                Reference {
                    wallet_reference_utxo: hex!(
                        "96fbddac63c55284fbbaa3c216ef1c0f460019e8643a889a189d5b5f7ddd71d6"
                    ),
                    seedelf_reference_utxo: hex!(
                        "f620a4e949bfbefbf2892d39d0777439f3acfbf850eae9b007c6558ba8ef4db4"
                    ),
                }
            } else {
                Reference {
                    wallet_reference_utxo: hex!(
                        "51f12c1a5c2b0558a284628d81b06dee50b27693242fe35618c5f921730c0527"
                    ),
                    seedelf_reference_utxo: hex!(
                        "f3955f42f660fae8b3e4dcf664011876cf769d87aa8450dc73171b4f6b5f520b"
                    ),
                }
            };
            let contract: Contract = Contract {
                wallet_contract_hash: hex!(
                    "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469"
                ),
                seedelf_policy_id: "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255"
                    .to_string(),
                wallet_contract_size: 629,
                seedelf_contract_size: 519,
            };
            Some(Config {
                contract,
                reference,
            })
        }
        _ => None, // unsupported variant
    }
}

// support the [LOGIC] stakepool
pub const PREPROD_STAKE_HASH: [u8; 28] =
    hex!("86c769419aaa673c963da04e4b5bae448d490e2ceac902cb82e4da76");
pub const MAINNET_STAKE_HASH: [u8; 28] =
    hex!("fcfc7701b1df42061202efa9c96968a481bbd6a0676efb7afa87ebf1");

// collateral info for giveme.my
pub const COLLATERAL_HASH: [u8; 28] =
    hex!("1108b97f2e199d58a0c0697d25412d0fb14d354dcd39654b9eb0dec8");
pub const COLLATERAL_PUBLIC_KEY: [u8; 32] =
    hex!("754c1db51aaee2e939b05b529ff5e210d8469afebcd2e487dae6f125fd500356");

pub const PREPROD_COLLATERAL_UTXO: [u8; 32] =
    hex!("ef18e00c412c06b74606c5e68901693c3974b2073dbec1dfd8b74f01af3102a1");
pub const MAINNET_COLLATERAL_UTXO: [u8; 32] =
    hex!("1c2fbce4e3974f721b27226645c7a35d648698c77f62bc337b40bc2cd294e9cd");

// ADA Handle Policy Ids
pub const ADA_HANDLE_POLICY_ID: &str = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";

// these maximums are estimated
pub const MAXIMUM_WALLET_UTXOS: u64 = 20;
pub const MAXIMUM_TOKENS_PER_UTXO: u64 = 20;

// Spec-defined byte overhead used in the minUTxO formula. Network-independent.
pub const OVERHEAD_COST: u64 = 160;
