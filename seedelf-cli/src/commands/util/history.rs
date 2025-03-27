use blstrs::Scalar;
use colored::Colorize;
use pallas_addresses::Address;
use seedelf_cli::address;
use seedelf_cli::display::preprod_text;
use seedelf_cli::koios::TxResponse;
use seedelf_cli::koios::address_transactions;
use seedelf_cli::setup;

pub async fn run(network_flag: bool, variant: u64) -> Result<(), String> {
    preprod_text(network_flag);

    let scalar: Scalar = setup::load_wallet();

    println!("\n{}\n", "Getting History..".bright_blue(),);
    let wallet_addr: Address = address::wallet_contract(network_flag, variant);
    let txs: Vec<TxResponse> = address_transactions(network_flag, wallet_addr.to_string())
        .await
        .map_err(|e| e.to_string())?;
    // println!("{:?}", txs);
    for tx in &txs {
        let input_match = tx.input_registers.iter().any(|r| r.is_owned(scalar));
        let output_match = tx.output_registers.iter().any(|r| r.is_owned(scalar));

        if input_match {
            println!(
                "Spend: {}, block height: {}",
                tx.tx_hash.bright_cyan(),
                tx.block_height.to_string().bright_white()
            );
            continue;
        }
        if output_match {
            println!(
                "Receive: {}, block height: {}",
                tx.tx_hash.bright_yellow(),
                tx.block_height.to_string().bright_white()
            );
        }
    }
    Ok(())
}
