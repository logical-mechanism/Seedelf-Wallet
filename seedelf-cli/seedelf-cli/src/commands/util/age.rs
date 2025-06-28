use chrono::Utc;
use clap::Args;
use colored::Colorize;
use seedelf_cli::constants::{Config, get_config};
use seedelf_cli::display;
use seedelf_cli::koios::{History, asset_history};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct AgeArgs {
    /// seedelf to age check
    #[arg(
        short = 's',
        long,
        help = "The seedelf getting age checked.",
        display_order = 1
    )]
    seedelf: String,
}

fn format_duration(seconds: i64) -> String {
    // 365.256363004 * 24 * 60 * 60 -> seconds in year
    let years: i64 = seconds / 31_558_149;
    let weeks: i64 = (seconds % 31_558_149) / 604_800;
    let days: i64 = (seconds % 604_800) / 86_400;
    let hours: i64 = (seconds % 86_400) / 3_600;
    let minutes: i64 = (seconds % 3_600) / 60;
    let seconds: i64 = seconds % 60;

    let mut parts: Vec<String> = Vec::new();
    if years > 0 {
        parts.push(format!("{years} years"));
    }
    if weeks > 0 {
        parts.push(format!("{weeks} weeks"));
    }
    if days > 0 {
        parts.push(format!("{days} days"));
    }
    if hours > 0 {
        parts.push(format!("{hours} hours"));
    }
    if minutes > 0 {
        parts.push(format!("{minutes} mins"));
    }
    if seconds > 0 {
        parts.push(format!("{seconds} secs"));
    }

    if parts.is_empty() {
        "just now".to_string()
    } else {
        format!("{} ago", parts.join(", "))
    }
}

pub async fn run(args: AgeArgs, network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });
    println!(
        "\n{} {}",
        "Seedelf:".bright_blue(),
        args.seedelf.bright_green()
    );

    let seedelf_history: Vec<History> = asset_history(
        config.contract.seedelf_policy_id.to_string(),
        args.seedelf,
        network_flag,
        5,
    )
    .await
    .unwrap();

    if seedelf_history.is_empty() {
        return Err("Seedelf Not Found".to_string());
    }

    let time_stamp: i64 = seedelf_history[0].block_time;
    let current_time: i64 = Utc::now().timestamp();
    let time_diff: i64 = current_time - time_stamp;

    println!(
        "{} {}",
        "\nAge:".cyan(),
        format_duration(time_diff).bright_magenta()
    );
    Ok(())
}
