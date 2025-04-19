use colored::Colorize;
use seedelf_cli::display::is_their_an_update;

pub async fn run() {
    is_their_an_update().await;
    println!(
        "\n{} 🌱🧝\n{}",
        "\nWelcome to seedelf-cli!".bright_white(),
        "A command line interface for the Seedelf stealth wallet protocol.".bright_yellow()
    );
    println!("{}", "\nThe Seedelf wallet is a stealth wallet protocol that hides the receiver and spender using a non-interactive variant of Schnorr's Σ-protocol for the Discrete Logarithm Relation.".bright_green());
    println!("\n 😀\n");
    println!(
        "{}\n\n{}",
        "Start your journey by creating a Seedelf with the cli command:".bright_purple(),
        "seedelf-cli create --address <ADDRESS>".bright_cyan()
    );
    println!(
        "\n{} {}",
        "You can view all the available functions with:".bright_yellow(),
        "seedelf-cli help".bright_blue()
    );
    println!(
        "{}",
        "\nYou may find the wallet file in your home directory in the .seedelf folder.".white()
    );
}
