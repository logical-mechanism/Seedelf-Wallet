use crate::constants::{COLLATERAL_HASH, MAINNET_STAKE_HASH, PREPROD_STAKE_HASH};
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
/// It counts the stake part too (Pallas's `has_script`), so a key address
/// staked by a script reads as a script's here. Whether a key spends from an
/// address, or a payment there needs no datum, is its payment part's to say:
/// [`is_key_address`] and [`is_script_address`] (chunk 51, r2a#1).
///
/// # Arguments
///
/// * `addr` - A Cardano address to verify.
///
/// # Returns
///
/// * `true` if the address does not contain a script.
/// * `false` if the address contains a script.
#[deprecated(
    note = "counts the stake part too, so a key address staked by a script reads as a script's: use is_key_address or is_script_address"
)]
pub fn is_not_a_script(addr: Address) -> bool {
    !Address::has_script(&addr)
}

/// Whether a key spends from `addr`: a Shelley address whose payment part is
/// a key hash, whatever its stake part (a key's, a script's, a pointer or
/// none). A key address staked by a script (CIP-19's type 2, `addr1y…`) is
/// one: only its payment key spends what's there (chunk 51, r2a#1).
pub fn is_key_address(addr: &Address) -> bool {
    matches!(addr, Address::Shelley(s) if !s.payment().is_script())
}

/// Whether `addr` is a script's address: a Shelley address whose payment
/// part is a script (CIP-19's types 1, 3, 5 and 7: `addr1z…`, `addr1x…`,
/// `addr12…`, `addr1w…`), a multisig's or a contract's. The ledger takes a
/// payment there; one this crate builds carries no datum, which some scripts
/// can never spend and some let anyone take, the Seedelf contract's own
/// address among them (chunk 51, r2a#1).
pub fn is_script_address(addr: &Address) -> bool {
    matches!(addr, Address::Shelley(s) if s.payment().is_script())
}

/// Generates the wallet contract address for the specified Cardano network.
///
/// Returns the enterprise form of the script address (no delegation part).
/// New outputs go here; existing UTxOs at the older staked base form remain
/// spendable because Koios credential queries and input outpoints don't
/// depend on the delegation part.
pub fn wallet_contract(network_flag: bool, wallet_contract_hash: [u8; 28]) -> Address {
    let network = if network_flag {
        Network::Testnet
    } else {
        Network::Mainnet
    };
    let shelly_wallet_address: ShelleyAddress = ShelleyAddress::new(
        network,
        ShelleyPaymentPart::Script(ScriptHash::new(wallet_contract_hash)),
        ShelleyDelegationPart::Null,
    );
    Address::from(shelly_wallet_address)
}

pub fn dummy_base_address() -> Address {
    let shelly_wallet_address: ShelleyAddress = ShelleyAddress::new(
        Network::Mainnet,
        ShelleyPaymentPart::Script(ScriptHash::new(MAINNET_STAKE_HASH)),
        ShelleyDelegationPart::Key(StakeKeyHash::new(MAINNET_STAKE_HASH)),
    );
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
