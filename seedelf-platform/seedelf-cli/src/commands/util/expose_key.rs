use blstrs::Scalar;
use colored::Colorize;
use seedelf_cli::setup;

pub fn run() {
    println!(
        "\n{}\n",
        "Exposing Your Secret Key, Use With Caution!".bright_red()
    );
    println!(
        "\n{}\n",
        "This command will display your secret key. Press Crtl-C To Exit.".bright_yellow()
    );
    let password: String = setup::enter_password();
    let scalar: Scalar = setup::load_wallet(password);
    println!("\n{scalar}\n");
}
