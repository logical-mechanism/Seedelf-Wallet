use colored::Colorize;
use seedelf_cli::display::preprod_text;


pub async fn run(network_flag: bool) -> Result<(), String> {
    preprod_text(network_flag);
    println!(
        "\n{}",
        "Sweeping All dApp UTxOs".bright_blue(),
    );
    Ok(())
}
