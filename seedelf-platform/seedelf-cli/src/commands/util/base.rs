use blstrs::Scalar;
use colored::Colorize;
use seedelf_cli::setup;
use seedelf_crypto::register::Register;

pub fn run() {
    println!("\n{}", "Register Base Element".bright_cyan());
    let password: String = setup::enter_password();
    let scalar: Scalar = setup::load_wallet(password);
    let base: Register = Register::create(scalar).unwrap();
    println!(
        "\n{} {}",
        "Generator:".bright_blue(),
        base.generator.bright_white()
    );
    println!(
        "\n{} {}",
        "Public Value:".bright_blue(),
        base.public_value.bright_white()
    );
}
