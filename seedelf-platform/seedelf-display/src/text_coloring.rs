use colored::Colorize;

/// Print a line of text in bright blue, prefixed by a blank line.
pub fn display_blue(text: &str) {
    println!("\n{}", text.bright_blue());
}

pub fn display_cyan(text: &str) {
    println!("\n{}", text.bright_cyan());
}

pub fn display_purple(text: &str) {
    println!("\n{}", text.bright_purple());
}

/// Print the UTxO & balance counts in a consistent, coloured style.
pub fn show_lovelace_and_utxos_counts(
    total_utxos: usize,
    total_lovelace: u64,
    total_seedelfs: u64,
) {
    // Balance in ₳
    let ada = total_lovelace as f64 / 1_000_000.0;
    let bal = format!("{ada:.6} ₳");
    println!(
        "\n{} {}",
        "Balance:".bold().bright_blue(),
        bal.bright_yellow(),
    );

    // UTxO count
    println!(
        "{} {} UTxOs",
        "Contract Has".bold().bright_blue(),
        total_utxos.to_string().bright_yellow()
    );

    // Seedelf count
    println!(
        "{} {} Seedelfs",
        "Contract Has".bold().bright_blue(),
        total_seedelfs.to_string().bright_yellow()
    );
}
