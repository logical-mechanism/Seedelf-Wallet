use colored::Colorize;
use self_update::{cargo_crate_version, Status};
use self_update::backends::github::UpdateBuilder;
use std::env;
use tokio::task::spawn_blocking;

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    println!("\n{} 🌱🧝\n", "Updating the seedelf-cli!".bright_white());
    println!("Current Version: {}\n", cargo_crate_version!().bright_purple());

    // Perform the update using GitHub releases in a blocking task
    let result: Status = spawn_blocking(move || {
        UpdateBuilder::new()
            .repo_owner("logical-mechanism") // Replace with your GitHub repo owner
            .repo_name("Seedelf-Wallet")  // Replace with your GitHub repo name
            .bin_name("seedelf-cli")
            .current_version(cargo_crate_version!())
            .show_download_progress(true)
            .build()?
            .update()
    })
    .await??; // Await the blocking task

    if result.updated() {
        println!("{}", "\nApplication successfully updated!".bright_green());
    } else {
        println!("{}", "\n\nAlready up-to-date.".bright_yellow());
    }

    Ok(())
}
