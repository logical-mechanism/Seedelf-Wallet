use clap::Args;
use pallas_addresses::Address;
use seedelf_cli::address;


/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct SweepArgs {
    /// address that receives the funds
    #[arg(long, help = "The address receiving funds.")]
    address: String,

    /// The amount of ADA to send
    #[arg(long, help = "The amount of ADA being sent.")]
    amount: u64,
}

pub async fn run(args: SweepArgs, network_flag: bool) -> Result<(), String>  {
    if network_flag {
        println!("Running In Preprod Environment");
    }

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    Ok(())
}