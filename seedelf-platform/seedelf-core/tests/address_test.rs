use pallas_addresses::Address;
use seedelf_core::address;
use seedelf_core::constants::{Config, get_config};

#[test]
fn test_preprod_wallet_contract() {
    let config: Config = get_config(1, true).unwrap();
    let addr = address::wallet_contract(true, config.contract.wallet_contract_hash);
    assert_eq!(
        addr.to_bech32().unwrap(),
        "addr_test1wz2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6g7mzn9f"
    )
}

#[test]
fn test_preprod_collateral_address() {
    let addr = address::collateral_address(true);
    assert_eq!(
        addr.to_bech32().unwrap(),
        "addr_test1vqgs3wtl9cve6k9qcp5h6f2p958mznf4fhxnje2tn6cdajqte3tcn"
    )
}

#[test]
fn mainnet_wallet_contract_differs_from_preprod() {
    let config: Config = get_config(1, true).unwrap();
    let testnet = address::wallet_contract(true, config.contract.wallet_contract_hash);
    let mainnet = address::wallet_contract(false, config.contract.wallet_contract_hash);
    assert_ne!(testnet.to_bech32().unwrap(), mainnet.to_bech32().unwrap());
    assert!(mainnet.to_bech32().unwrap().starts_with("addr1"));
    assert!(testnet.to_bech32().unwrap().starts_with("addr_test1"));
}

#[test]
fn is_on_correct_network_matches_only_its_own_network() {
    let config: Config = get_config(1, true).unwrap();
    let testnet = address::wallet_contract(true, config.contract.wallet_contract_hash);
    let mainnet = address::wallet_contract(false, config.contract.wallet_contract_hash);
    assert!(address::is_on_correct_network(testnet.clone(), true));
    assert!(!address::is_on_correct_network(testnet, false));
    assert!(address::is_on_correct_network(mainnet.clone(), false));
    assert!(!address::is_on_correct_network(mainnet, true));
}

#[test]
fn is_not_a_script_distinguishes_key_from_script_address() {
    let config: Config = get_config(1, true).unwrap();
    let script_addr = address::wallet_contract(true, config.contract.wallet_contract_hash);
    assert!(
        !address::is_not_a_script(script_addr),
        "wallet_contract should produce a script address"
    );

    // collateral_address is built from a payment-key hash.
    let key_addr = address::collateral_address(true);
    assert!(
        address::is_not_a_script(key_addr),
        "collateral_address should produce a key address"
    );
}

#[test]
fn dapp_address_builds_key_address_on_each_network() {
    let pkh = "0102030405060708091011121314151617181920212223242526";
    // 26 hex chars = 13 bytes; PaymentKeyHash wants 28 bytes (56 hex chars).
    // Pad with a known suffix so we have a valid input.
    let pkh = format!("{}{}", pkh, "0".repeat(56 - pkh.len()));

    let testnet = address::dapp_address(pkh.clone(), true).unwrap();
    let mainnet = address::dapp_address(pkh, false).unwrap();
    assert!(address::is_on_correct_network(testnet.clone(), true));
    assert!(address::is_on_correct_network(mainnet.clone(), false));
    assert!(address::is_not_a_script(testnet));
    assert!(address::is_not_a_script(mainnet));
}

#[test]
fn dapp_address_rejects_bad_hex() {
    assert!(address::dapp_address("not-hex".to_string(), true).is_err());
}

#[test]
fn dapp_address_rejects_wrong_length() {
    // 4 hex chars = 2 bytes, too short for the 28-byte PaymentKeyHash.
    assert!(address::dapp_address("aabb".to_string(), true).is_err());
}

#[test]
fn stake_key_differs_per_network() {
    let preprod = address::stake_key(true);
    let mainnet = address::stake_key(false);
    assert_ne!(preprod, mainnet);
    // both should be 28-byte (56 hex char) hashes
    assert_eq!(preprod.len(), 56);
    assert_eq!(mainnet.len(), 56);
}

#[test]
fn wallet_contract_round_trips_through_bech32() {
    let config: Config = get_config(1, true).unwrap();
    let addr = address::wallet_contract(true, config.contract.wallet_contract_hash);
    let bech32 = addr.to_bech32().unwrap();
    let parsed = Address::from_bech32(&bech32).unwrap();
    assert_eq!(parsed.to_bech32().unwrap(), bech32);
}
