use crate::constants::{
    COLLATERAL_HASH, MAINNET_STAKE_HASH, PREPROD_STAKE_HASH, WALLET_CONTRACT_HASH,
};
use pallas_addresses::{
    Address, Network, PaymentKeyHash, ScriptHash, ShelleyAddress, ShelleyDelegationPart,
    ShelleyPaymentPart, StakeKeyHash,
};

pub fn is_on_correct_network(addr: Address, network_flag: bool) -> bool {
    if network_flag {
        pallas_addresses::Address::network(&addr) == Some(pallas_addresses::Network::Testnet)
    } else {
        pallas_addresses::Address::network(&addr) == Some(pallas_addresses::Network::Mainnet)
    }
}

pub fn is_not_a_script(addr: Address) -> bool {
    !pallas_addresses::Address::has_script(&addr)
}

/// Given a network flag produce the Address type for the wallet contract.
pub fn wallet_contract(network_flag: bool) -> Address {
    // wallet script address
    let shelly_wallet_address: ShelleyAddress = if network_flag {
        ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Script(ScriptHash::new(
                hex::decode(WALLET_CONTRACT_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Incorrect Length"),
            )),
            ShelleyDelegationPart::Key(StakeKeyHash::new(
                hex::decode(PREPROD_STAKE_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Incorrect Length"),
            )),
        )
    } else {
        ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Script(ScriptHash::new(
                hex::decode(WALLET_CONTRACT_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Incorrect Length"),
            )),
            ShelleyDelegationPart::Key(StakeKeyHash::new(
                hex::decode(MAINNET_STAKE_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Incorrect Length"),
            )),
        )
    };
    // we need this as the address type and not the shelley
    Address::from(shelly_wallet_address.clone())
}

// This addres is not staked
pub fn collateral_address(network_flag: bool) -> Address {
    // wallet script address
    let shelly_wallet_address: ShelleyAddress = if network_flag {
        ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new(
                hex::decode(COLLATERAL_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            )),
            ShelleyDelegationPart::Null,
        )
    } else {
        ShelleyAddress::new(
            Network::Mainnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new(
                hex::decode(COLLATERAL_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            )),
            ShelleyDelegationPart::Null,
        )
    };
    // we need this as the address type and not the shelley
    Address::from(shelly_wallet_address.clone())
}
