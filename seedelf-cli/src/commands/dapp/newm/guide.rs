use colored::Colorize;
use seedelf_cli::display;

pub fn run(network_flag: bool) {
    display::preprod_text(network_flag);
    println!(
        "{}",
        "\nQuick How-To Guide For The NEWM dApp".bright_white(),
    );
    println!("\n 😀\n");
    let url = if network_flag {"https://fan.square.newm.io/"} else {"https://marketplace.newm.io/"};
    let flag = if network_flag {"--preprod"} else {""};
    println!("View The Marketplace: {}", url.bright_cyan());
    println!("\n{}", "Select which steaming tokens you wish to purchase. Locate the Pointer Asset Name in the information box near the bottom of the the song page and copy that text. The pointer asset name is used as the locator token for the create command.".bright_blue());
    println!("\nRun: {} {}", "seedelf-cli dapp newm create -p POINTER_ASSET_NAME_HERE -a STREAM_TOKEN_AMOUNT_HERE".bright_magenta(), flag.bright_magenta());
    println!("\n{}", "This will create an order for the stream tokens.".bright_green());
}
