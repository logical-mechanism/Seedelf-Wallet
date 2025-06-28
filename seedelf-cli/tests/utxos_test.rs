use seedelf_cli::assets::{Asset, Assets, string_to_u64};
use seedelf_cli::utxos;

#[tokio::test]
async fn find_first_large_utxo() {
    let addr: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let utxo_vector = utxos::collect_address_utxos(addr, true).await;
    let selected_utxos = utxos::select(utxo_vector, 4_446_456, Assets::new());
    for utxo in selected_utxos {
        println!("large {:?}", string_to_u64(utxo.value));
    }
}

#[tokio::test]
async fn find_many_utxos() {
    let addr: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let utxo_vector = utxos::collect_address_utxos(addr, true).await;
    let selected_utxos = utxos::select(utxo_vector, 2_000_000_000, Assets::new());
    for utxo in selected_utxos {
        println!("many {:?}", string_to_u64(utxo.value));
    }
}

#[tokio::test]
async fn find_nft_and_ada() {
    let addr: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let utxo_vector = utxos::collect_address_utxos(addr, true).await;
    let tokens: Assets = Assets::new().add(Asset::new(
        "b0cbd7cde289d6aa694214fcd95a39e7f3ef52fc94d1171664210677".to_string(),
        "acab".to_string(),
        1,
    ));
    let selected_utxos = utxos::select(utxo_vector, 5_000_000, tokens);

    for utxo in selected_utxos {
        println!("nft {:?}", string_to_u64(utxo.value));
    }
}

#[test]
fn parse_utxos_correct() {
    let inputs = vec![
        "f33b03d7230e333fb8f26a09b428ab1b3cb6074b1432e773aac353574f29e888#2".to_string(),
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#0".to_string(),
    ];
    let parsed = utxos::parse_tx_utxos(inputs).unwrap();
    println!("{parsed:?}");

    assert_eq!(parsed.len(), 2)
}
