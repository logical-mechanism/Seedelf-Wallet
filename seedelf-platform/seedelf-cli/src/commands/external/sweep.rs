use crate::commands::{rows, submit};
use crate::setup;
use anyhow::Result;
use blstrs::Scalar;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_txbuilder::BuiltTransaction;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::{address, build, utxos};
use seedelf_crypto::convert;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, epoch_params};

pub async fn run(network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);
    println!("\n{}", "Sweeping All External UTxOs".bright_blue(),);

    let config: Config = get_config(variant, network_flag)?;
    let params = epoch_params(network_flag).await?;

    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    let scalar: Scalar = setup::unlock_wallet_interactive();

    let vkey: String = convert::secret_key_to_public_key(scalar);
    let addr: Address = address::dapp_address(vkey.clone(), network_flag)?;
    let addr_bech32: String = addr
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode address: {e}"))?;

    let all_utxos: Vec<UtxoResponse> = utxos::get_address_utxos(&addr_bech32, network_flag).await?;
    let signer = pallas_crypto::hash::Hash::new(
        hex::decode(&vkey)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("The dApp key hash must be 28 bytes"))?,
    );
    let owner: Register = Register::create(scalar)?;

    // Anyone can pay this address, so the sweep takes what one transaction
    // can, and the rest stays for the next (chunk 51, r4#1).
    let deposit = |tokens: &Assets| build::minimum_deposit(&params, tokens);
    let mut stayed = Vec::new();
    let rows = rows::sweepable(
        rows::by_worth(all_utxos, &deposit)?,
        0,
        usize::MAX,
        &mut stayed,
    )?;
    let swept = rows::most_that_fit(rows, &deposit, &mut stayed, |rows| {
        build::external_sweep(&params, rows, &owner, &wallet_addr, signer)
    });
    rows::print_stayed(&stayed, "external sweep");
    let (tx, tx_fee): (BuiltTransaction, u64) = swept?;
    println!(
        "{} {}",
        "\nTx Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    let signed_tx_cbor: BuiltTransaction =
        tx.sign(convert::secret_key_to_private_key(scalar)).unwrap();

    println!(
        "\nTx Cbor: {}",
        hex::encode(signed_tx_cbor.tx_bytes.clone()).white()
    );

    submit::submit(signed_tx_cbor.tx_bytes.as_ref(), network_flag).await
}
