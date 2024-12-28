use blstrs::Scalar;
use reqwest::Error;
use seedelf_cli::display;
use seedelf_cli::koios::UtxoResponse;
use seedelf_cli::setup;
use seedelf_cli::utxos;

pub async fn run(network_flag: bool) -> Result<(), Error> {
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    println!("\nSeedelf Wallet Information");
    
    let scalar: Scalar = setup::load_wallet();
    
    display::all_seedelfs(scalar, network_flag).await;

    let all_utxos: Vec<UtxoResponse> = utxos::collect_all_wallet_utxos(scalar, network_flag).await;
    let (total_lovelace, tokens) = utxos::assets_of(all_utxos.clone());

    println!("\nWallet Has {} UTxOs", all_utxos.len());
    println!("\nBalance: {:.6} ₳", total_lovelace as f64 / 1_000_000.0);

    if tokens.items.len() > 0 {
        println!("\nTokens:\n");
        for asset in tokens.items.clone() {
            println!("{} {}.{}", asset.amount, hex::encode(asset.policy_id.as_ref()), hex::encode(asset.token_name));
        }
    }

    Ok(())
}
