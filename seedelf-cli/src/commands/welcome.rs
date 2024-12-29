use colored::Colorize;

pub fn run() {
    println!("\n{} 🌱🧝\n{}", "\nWelcome to seedelf-cli!".bright_white(), "A command line interface for the Seedelf stealth wallet protocol.".bright_yellow());
    println!("{}", "\nThe Seedelf wallet is a stealth wallet protocol that hides the receiver and spender using a non-interactive variant of Schnorr's Σ-protocol for the Discrete Logarithm Relation.".bright_green());
    println!("\n 😀\n");
    println!("{} {}", "Start your journey by creating a Seedelf with the cli command:".bright_purple(), "create".bright_cyan());
    println!("\nYour wallet file will be stored in your home directory in the .seedelf folder.");
}
