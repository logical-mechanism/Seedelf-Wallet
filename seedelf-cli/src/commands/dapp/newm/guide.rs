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
    println!("\n{}", "Select the steaming token you wish to purchase. Locate the `Pointer Asset Name` in the information box near the bottom of the the song page and copy that text. The token should have the prefix `ca11ab1e`. The pointer asset name is used in the create command as shown below.".bright_blue());
    println!("\nRun: {} {}", "seedelf-cli dapp newm create -p POINTER_ASSET_NAME_HERE -a STREAM_TOKEN_AMOUNT_HERE".bright_magenta(), flag.bright_magenta());
    println!("\n{}", "The value `POINTER_ASSET_NAME_HERE` is the pointer token from the information box and `STREAM_TOKEN_AMOUNT_HERE` is the number of streaming tokens to purchase.".bright_blue());
    println!("\nExample: {}", "seedelf-cli dapp newm create -p ca11ab1e01bd1ba0ce07a3b750ac0bbdab60ae9d32f92be05dec0fc8ff21f04e -a 123456789 --preprod".yellow());
    println!("\n{}", "This will create an order for the stream tokens.".bright_green());
}
