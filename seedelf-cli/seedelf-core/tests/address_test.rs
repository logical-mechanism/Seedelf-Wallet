use seedelf_core::address;

#[test]
fn test_preprod_wallet_contract() {
    let addr = address::wallet_contract(true, 1);
    assert_eq!(
        addr.to_bech32().unwrap(),
        "addr_test1zz2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6vxca55rx42vu7fv0dqfe94htjy34ysut82eypvhqhymfmq8hmezx"
    )
}

#[test]
fn test_preprod_collateral_address() {
    let addr = address::collateral_address(true);
    assert_eq!(
        addr.to_bech32().unwrap(),
        "addr_test1vp7zfs3drhp995clvq307gkvequv92ur53s3wttu9khxraqvfs7zk"
    )
}
