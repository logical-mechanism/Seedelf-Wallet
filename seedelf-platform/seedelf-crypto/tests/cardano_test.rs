use seedelf_crypto::cardano::{CardanoAccount, HARDENED, Role};
use seedelf_crypto::derivation::{phrase_to_entropy, seedelf_key_v1};

fn vectors() -> Vec<serde_json::Value> {
    let raw = include_str!("vectors/cardano_account.json");
    let doc: serde_json::Value = serde_json::from_str(raw).unwrap();
    assert_eq!(doc["spec"], "cardano-account-cip1852");
    doc["vectors"].as_array().unwrap().clone()
}

fn bech32(address: anyhow::Result<pallas_addresses::Address>) -> String {
    address.unwrap().to_bech32().unwrap()
}

#[test]
fn addresses_match_cardano_sdk() {
    let vectors = vectors();
    assert_eq!(vectors.len(), 8);
    for v in vectors {
        let phrase = v["phrase"].as_str().unwrap();
        let account = v["account"].as_u64().unwrap() as u32;
        let acct = CardanoAccount::from_phrase(phrase, account).unwrap();
        let label = format!("{} / {account}", phrase.split(' ').next().unwrap());

        assert_eq!(
            hex::encode(acct.account_public_key().as_bytes()),
            v["account_public_key"],
            "account key: {label}"
        );
        for (net, flag) in [("preprod", true), ("mainnet", false)] {
            let want = &v[net];
            assert_eq!(
                bech32(acct.base_address(flag, Role::Receive, 0)),
                want["receive_0"],
                "{net} receive_0: {label}"
            );
            assert_eq!(
                bech32(acct.base_address(flag, Role::Receive, 1)),
                want["receive_1"],
                "{net} receive_1: {label}"
            );
            assert_eq!(
                bech32(acct.base_address(flag, Role::Change, 0)),
                want["change_0"],
                "{net} change_0: {label}"
            );
            assert_eq!(
                bech32(acct.stake_address(flag)),
                want["stake"],
                "{net} stake: {label}"
            );
        }
    }
}

#[test]
fn network_prefixes() {
    let phrase = vectors()[0]["phrase"].as_str().unwrap().to_string();
    let acct = CardanoAccount::from_phrase(&phrase, 0).unwrap();
    assert!(bech32(acct.base_address(true, Role::Receive, 0)).starts_with("addr_test1q"));
    assert!(bech32(acct.base_address(false, Role::Receive, 0)).starts_with("addr1q"));
    assert!(bech32(acct.stake_address(true)).starts_with("stake_test1u"));
    assert!(bech32(acct.stake_address(false)).starts_with("stake1u"));
}

#[test]
fn rejects_bad_input() {
    let phrase = vectors()[0]["phrase"].as_str().unwrap().to_string();
    assert!(CardanoAccount::from_phrase(&phrase, HARDENED).is_err());
    assert!(CardanoAccount::from_phrase("abandon abandon", 0).is_err());

    let acct = CardanoAccount::from_phrase(&phrase, 0).unwrap();
    assert!(acct.base_address(true, Role::Staking, 0).is_err());
    assert!(acct.base_address(true, Role::Receive, HARDENED).is_err());
}

#[test]
fn cardano_keys_are_independent_of_the_seedelf_key() {
    // Same phrase, two domains: the Seedelf scalar must not equal any of the
    // Cardano private-key halves it could be confused with.
    let phrase = vectors()[0]["phrase"].as_str().unwrap().to_string();
    let seedelf = seedelf_key_v1(&phrase, 0).unwrap().to_bytes_be();
    let acct = CardanoAccount::from_phrase(&phrase, 0).unwrap();
    for role in [Role::Receive, Role::Change, Role::Staking] {
        let key = acct.private_key(role, 0).unwrap().as_bytes();
        assert!(key.windows(32).all(|w| w != seedelf));
    }
}

#[test]
fn master_key_is_pallas_icarus_key() {
    // The master key is made from the entropy in a wiped buffer, not by
    // pallas from a phrase String: every key must be the one pallas gives.
    use pallas_wallet::hd::Bip32PrivateKey;
    for v in vectors() {
        let phrase = v["phrase"].as_str().unwrap();
        let account = v["account"].as_u64().unwrap() as u32;
        let pallas = Bip32PrivateKey::from_bip39_mnenomic(phrase.to_string(), String::new())
            .unwrap()
            .derive(HARDENED | 1852)
            .derive(HARDENED | 1815)
            .derive(HARDENED | account);
        let acct = CardanoAccount::from_phrase(phrase, account).unwrap();
        for role in [Role::Receive, Role::Change, Role::Staking] {
            assert_eq!(
                acct.private_key(role, 0).unwrap().as_bytes(),
                pallas.derive(role as u32).derive(0).as_bytes()
            );
        }
    }
}

#[test]
fn accounts_from_entropy_match_cardano_sdk() {
    // unlock derives from the vault's entropy without writing the phrase out
    for v in vectors() {
        let phrase = v["phrase"].as_str().unwrap();
        let account = v["account"].as_u64().unwrap() as u32;
        let entropy = phrase_to_entropy(phrase).unwrap();
        let acct = CardanoAccount::from_entropy(&entropy, account).unwrap();
        assert_eq!(
            hex::encode(acct.account_public_key().as_bytes()),
            v["account_public_key"]
        );
        assert_eq!(
            bech32(acct.base_address(false, Role::Receive, 0)),
            v["mainnet"]["receive_0"]
        );
    }
    let entropy = phrase_to_entropy(vectors()[0]["phrase"].as_str().unwrap()).unwrap();
    assert!(CardanoAccount::from_entropy(&entropy, HARDENED).is_err());
    for len in [0, 15, 24, 64] {
        assert!(CardanoAccount::from_entropy(&vec![0u8; len], 0).is_err());
    }
}
