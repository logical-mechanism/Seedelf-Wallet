use blstrs::Scalar;
use ff::PrimeField;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use seedelf_cli::schnorr::random_scaler;

/// Data structure for storing wallet information
#[derive(Serialize, Deserialize)]
struct Wallet {
    private_key: String, // Store the scalar as a hex string
}

/// Check if `.seedelf` exists, create it if it doesn't, and handle file logic
pub fn check_and_prepare_seedelf() {
    let seedelf_path = Path::new("/home").join(whoami::username()).join(".seedelf");

    // Check if `.seedelf` exists
    if !seedelf_path.exists() {
        fs::create_dir_all(&seedelf_path).expect("Failed to create .seedelf directory");
    }

    // Check if there are any files in `.seedelf`
    let contents = fs::read_dir(&seedelf_path)
        .expect("Failed to read .seedelf directory")
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();

    if contents.is_empty() {
        // Prompt the user for a wallet name
        let wallet_name = prompt_wallet_name();
        let wallet_file_path = seedelf_path.join(format!("{}.wallet", wallet_name));
        create_wallet(&wallet_file_path);
    } else {
        for entry in &contents {
            if let Ok(file_name) = entry.file_name().into_string() {
                println!("Loading Wallet: {}", file_name);
            }
        }
    }
}

/// Prompt the user to enter a wallet name
fn prompt_wallet_name() -> String {
    let mut wallet_name = String::new();
    print!("Enter a wallet name: ");
    io::stdout().flush().unwrap();
    io::stdin()
        .read_line(&mut wallet_name)
        .expect("Failed to read wallet name");
    wallet_name.trim().to_string()
}

/// Create a wallet file and save a random private key
fn create_wallet(wallet_path: &PathBuf) {
    // Generate a random private key
    let sk = random_scaler(); // Requires `Field` trait in scope
    let private_key_bytes = sk.to_repr(); // Use `to_repr()` to get canonical bytes
    let private_key_hex = hex::encode(private_key_bytes);

    // Serialize the wallet
    let wallet = Wallet {
        private_key: private_key_hex,
    };
    let wallet_data = serde_json::to_string_pretty(&wallet).expect("Failed to serialize wallet");

    // Save to file
    fs::write(wallet_path, wallet_data).expect("Failed to write wallet file");
    println!("Wallet created at: {}", wallet_path.display());
}


/// Load the wallet file and deserialize the private key into a Scalar
pub fn load_wallet() -> Scalar {
    // Default `.seedelf` directory path
    let seedelf_path = Path::new("/home").join(whoami::username()).join(".seedelf");

    // Get the list of files in `.seedelf`
    let contents = fs::read_dir(&seedelf_path)
        .expect("Failed to read .seedelf directory")
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();

    if contents.is_empty() {
        panic!("No wallet files found in .seedelf directory");
    }

    // Use the first file in the directory to build the wallet path
    let first_file = &contents[0];
    let wallet_path = first_file.path();

    // Read the wallet file
    let wallet_data = fs::read_to_string(&wallet_path).expect("Failed to read wallet file");

    // Deserialize the wallet JSON
    let wallet: Wallet = serde_json::from_str(&wallet_data).expect("Failed to parse wallet JSON");

    // Decode the hex string back into bytes
    let private_key_bytes =
        hex::decode(wallet.private_key).expect("Failed to decode private key hex");

    // Convert bytes to Scalar
    Scalar::from_repr(private_key_bytes.try_into().expect("Invalid key length"))
        .expect("Failed to reconstruct Scalar from bytes")
}
