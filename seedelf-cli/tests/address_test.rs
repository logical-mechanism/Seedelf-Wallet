use seedelf_cli::address;

#[test]
fn test_preprod_wallet_contract() {
    let addr = address::wallet_contract(true);
    assert_eq!(addr.to_bech32().unwrap(), "addr_test1wp4rlm30ulytuz4j2jrj35ma9maram24kw43cnewphndzsqgdm9k0")
}

#[test]
fn test_preprod_collateral_address() {
    let addr = address::collateral_address(true);
    assert_eq!(addr.to_bech32().unwrap(), "addr_test1vp7zfs3drhp995clvq307gkvequv92ur53s3wttu9khxraqvfs7zk")
}