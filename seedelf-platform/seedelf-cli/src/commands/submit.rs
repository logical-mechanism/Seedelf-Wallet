//! How the CLI sends a signed transaction through Koios. Its id is printed
//! first, so a submit Koios doesn't confirm can be looked up before anything
//! is run again (chunk 51, r4#4).

use anyhow::{Result, bail};
use colored::Colorize;
use seedelf_core::build;
use seedelf_koios::koios::{SubmitError, submit_tx};

/// Where a transaction is shown on Cardanoscan.
fn cardanoscan(id: &str, network_flag: bool) -> String {
    let network = if network_flag { "preprod." } else { "" };
    format!("https://{network}cardanoscan.io/transaction/{id}")
}

/// Submits the signed transaction `tx`, after printing its id.
///
/// A submit Koios doesn't confirm (no answer in time, a server error, an
/// answer that isn't the id) may have gone through all the same, and running
/// the command again builds and pays again: the error says so, with the id to
/// look up first. One refused for an input already spent says that an
/// earlier run's may be why.
pub(crate) async fn submit(tx: &[u8], network_flag: bool) -> Result<()> {
    let id = hex::encode(build::tx_id(tx)?);
    let link = cardanoscan(&id, network_flag);
    println!("\nTx Hash: {}", id.bright_cyan());

    let Err(err) = submit_tx(hex::encode(tx), network_flag).await else {
        println!("\nTransaction Successfully Submitted!");
        println!("{}", format!("\n{link}").bright_purple());
        return Ok(());
    };
    match err.downcast_ref::<SubmitError>() {
        Some(SubmitError::MaybeSent(why)) => bail!(
            "Transaction {id} may have gone through: Koios didn't confirm it ({why}). Look it up at {link} before you run this again"
        ),
        Some(SubmitError::Spent(why)) => bail!(
            "Transaction {id} was refused: an input it spends is already spent, maybe by an earlier run's transaction. Look that one up before you run this again ({why})"
        ),
        _ => Err(err),
    }
}
