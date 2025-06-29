use crate::constants::{
    COLLATERAL_HASH, Config, MAINNET_STAKE_HASH, PREPROD_STAKE_HASH, get_config,
};
use anyhow::{Context, Result};
use hex;
use pallas_addresses::{
    Address, Network, PaymentKeyHash, ScriptHash, ShelleyAddress, ShelleyDelegationPart,
    ShelleyPaymentPart, StakeKeyHash,
};

/// Returns the [LOGIC] stake used during address generation
///
/// /// # Arguments
///
/// * `network_flag` - A boolean flag indicating the expected network:
///    - `true` checks for Testnet.
///    - `false` checks for Mainnet.
///
/// /// # Returns
///
/// * `str` - The stake key in hex.
pub fn stake_key(network_flag: bool) -> String {
    if network_flag {
        hex::encode(PREPROD_STAKE_HASH)
    } else {
        hex::encode(MAINNET_STAKE_HASH)
    }
}

/// Determines whether the given address belongs to the correct Cardano network.
///
/// Checks if the provided address matches the expected network based on the `network_flag`.
///
/// # Arguments
///
/// * `addr` - A Cardano address to verify.
/// * `network_flag` - A boolean flag indicating the expected network:
///    - `true` checks for Testnet.
///    - `false` checks for Mainnet.
///
/// # Returns
///
/// * `true` if the address matches the expected network.
/// * `false` otherwise.
pub fn is_on_correct_network(addr: Address, network_flag: bool) -> bool {
    if network_flag {
        Address::network(&addr) == Some(Network::Testnet)
    } else {
        Address::network(&addr) == Some(Network::Mainnet)
    }
}

/// Determines whether the given address is not a script address.
///
/// This function checks if the provided Cardano address does not contain a script.
///
/// # Arguments
///
/// * `addr` - A Cardano address to verify.
///
/// # Returns
///
/// * `true` if the address does not contain a script.
/// * `false` if the address contains a script.
pub fn is_not_a_script(addr: Address) -> bool {
    !Address::has_script(&addr)
}

/// Generates the wallet contract address for the specified Cardano network.
///
/// This function constructs a Shelley address for the wallet contract based on the given `network_flag`.
/// If the flag indicates Testnet, the Testnet network and pre-production stake hash are used.
/// Otherwise, the Mainnet network and stake hash are used.
///
/// # Arguments
///
/// * `network_flag` - A boolean flag specifying the network:
///    - `true` for Testnet.
///    - `false` for Mainnet.
///
/// # Returns
///
/// * `Address` - The wallet contract address for the specified network.
pub fn wallet_contract(network_flag: bool, variant: u64) -> Address {
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        std::process::exit(1);
    });

    // Construct the Shelley wallet address based on the network flag.
    let shelly_wallet_address: ShelleyAddress = if network_flag {
        ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Script(ScriptHash::new(config.contract.wallet_contract_hash)),
            ShelleyDelegationPart::Key(StakeKeyHash::new(PREPROD_STAKE_HASH)),
        )
    } else {
        ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Script(ScriptHash::new(config.contract.wallet_contract_hash)),
            ShelleyDelegationPart::Key(StakeKeyHash::new(MAINNET_STAKE_HASH)),
        )
    };
    // we need this as the address type and not the shelley
    Address::from(shelly_wallet_address.clone())
}

/// Generates a collateral address for the specified Cardano network.
///
/// This function creates a Shelley address for collateral purposes. The address is not staked,
/// meaning it has a `Null` delegation part. The `network_flag` determines whether the address
/// is for the Testnet or Mainnet.
///
/// # Arguments
///
/// * `network_flag` - A boolean flag specifying the network:
///    - `true` for Testnet.
///    - `false` for Mainnet.
///
/// # Returns
///
/// * `Address` - The collateral address for the specified network.
pub fn collateral_address(network_flag: bool) -> Address {
    // Construct the Shelley wallet address based on the network flag.
    let shelly_wallet_address: ShelleyAddress = if network_flag {
        ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new(COLLATERAL_HASH)),
            ShelleyDelegationPart::Null,
        )
    } else {
        ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new(COLLATERAL_HASH)),
            ShelleyDelegationPart::Null,
        )
    };
    // Convert the Shelley address to the generic Address type.
    Address::from(shelly_wallet_address.clone())
}

pub fn dapp_address(public_key: String, network_flag: bool) -> Result<Address> {
    // Construct the Shelley wallet address based on the network flag.
    let shelly_wallet_address: ShelleyAddress = if network_flag {
        ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new(
                hex::decode(public_key)
                    .context("Incorrect Public Key Length")?
                    .as_slice()
                    .try_into()
                    .map_err(|e| anyhow::anyhow!("{e}"))?,
            )),
            ShelleyDelegationPart::Key(StakeKeyHash::new(PREPROD_STAKE_HASH)),
        )
    } else {
        ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new(
                hex::decode(public_key)
                    .context("Incorrect Public Key Length")?
                    .as_slice()
                    .try_into()
                    .map_err(|e| anyhow::anyhow!("{e}"))?,
            )),
            ShelleyDelegationPart::Key(StakeKeyHash::new(MAINNET_STAKE_HASH)),
        )
    };
    // we need this as the address type and not the shelley
    Ok(Address::from(shelly_wallet_address.clone()))
}
