use blstrs::Scalar;
use reqwest::Error;
use seedelf_cli::display;
use crate::setup;

pub async fn run(network_flag: bool) -> Result<(), Error> {
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    let scalar: Scalar = setup::load_wallet();
    display::all_seedelfs(scalar, network_flag).await;

    Ok(())
}
