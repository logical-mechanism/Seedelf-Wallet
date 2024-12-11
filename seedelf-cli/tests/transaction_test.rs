use seedelf_cli::transaction;

#[test]
fn test_seedelf_minimum_lovelace() {
    let minimum: u64 = transaction::seedelf_minimum_lovelace();
    assert_eq!(minimum, 1_629_180)
}

#[test]
fn test_wallet_minimum_lovelace() {
    let minimum: u64 = transaction::wallet_minimum_lovelace();
    assert_eq!(minimum, 1_336_100)
}