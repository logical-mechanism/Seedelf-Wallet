use colored::Colorize;
use self_update::cargo_crate_version;

pub fn run() {
    println!("\n{} 🌱🧝", "Updating the seedelf-cli!".bright_white());
    println!("Current Version: {}", cargo_crate_version!().bright_purple());
}
