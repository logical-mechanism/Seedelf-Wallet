use crate::setup;
use blstrs::Scalar;
use colored::Colorize;

pub fn run() {
    println!(
        "\n{}\n",
        "Exposing Your Secret Key, Use With Caution!".bright_red()
    );
    println!(
        "\n{}\n",
        "This command will display your secret key. Press Crtl-C To Exit.".bright_yellow()
    );
    let scalar: Scalar = setup::unlock_wallet_interactive();
    println!("\n{scalar}\n");
}
