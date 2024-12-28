use crate::schnorr::random_scalar;
use blstrs::Scalar;
use ff::PrimeField;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, AeadCore, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{password_hash::SaltString, Argon2};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand_core::OsRng;
use rpassword::read_password;

/// Data structure for storing wallet information
#[derive(Serialize, Deserialize)]
struct Wallet {
    private_key: String, // Store the scalar as a hex string
}

/// Data structure for storing wallet information
#[derive(Serialize, Deserialize)]
struct EncryptedData {
    salt: String,
    nonce: String,
    data: String,
}

/// Check if `.seedelf` exists, create it if it doesn't, and handle file logic
pub fn check_and_prepare_seedelf() {
    // this may only work on ubuntu
    let seedelf_path: PathBuf = Path::new("/home").join(whoami::username()).join(".seedelf");

    // Check if `.seedelf` exists
    if !seedelf_path.exists() {
        fs::create_dir_all(&seedelf_path).expect("Failed to create .seedelf directory");
    }

    // Check if there are any files in `.seedelf`
    let contents: Vec<fs::DirEntry> = fs::read_dir(&seedelf_path)
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
    println!("\nEnter a wallet name: ");
    io::stdout().flush().unwrap();
    io::stdin()
        .read_line(&mut wallet_name)
        .expect("Failed to read wallet name");
    wallet_name.trim().to_string()
}

/// Create a wallet file and save a random private key
fn create_wallet(wallet_path: &PathBuf) {
    // Generate a random private key
    let sk: Scalar = random_scalar(); // Requires `Field` trait in scope
    let private_key_bytes: [u8; 32] = sk.to_repr(); // Use `to_repr()` to get canonical bytes
    let private_key_hex: String = hex::encode(private_key_bytes);

    // Serialize the wallet
    let wallet: Wallet = Wallet {
        private_key: private_key_hex,
    };
    let wallet_data: String =
        serde_json::to_string_pretty(&wallet).expect("Failed to serialize wallet");

    // Prompt user for an encryption password
    println!("\nEnter a password to encrypt the wallet file:");
    let password: String = read_password().expect("Failed to read password");
    println!("Re-enter the password:");
    let password_copy: String = read_password().expect("Failed to read password");
    if password != password_copy {
        println!("Passwords do not match; try again!");
        create_wallet(wallet_path);
    }

    let salt: SaltString = SaltString::generate(&mut OsRng);
    let mut output_key_material: [u8; 32] = [0u8; 32]; // Can be any desired size
    let _ = Argon2::default().hash_password_into(
        password.as_bytes(),
        salt.to_string().as_bytes(),
        &mut output_key_material,
    );

    // let key: &Key<Aes256Gcm> = output_key_material.into();
    // let key = Key::from_slice(&output_key_material);
    let key = Key::<Aes256Gcm>::from_slice(&output_key_material);
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    // let nonce = Nonce::from_slice();
    let encrypted_data = cipher
        .encrypt(&nonce, wallet_data.as_bytes())
        .expect("Encryption failed");

    // Save encrypted data, salt, and nonce as JSON
    let output: EncryptedData = EncryptedData {
        salt: salt.as_str().to_string(),
        nonce: STANDARD.encode(nonce),
        data: STANDARD.encode(encrypted_data),
    };
    let output_data: String =
        serde_json::to_string_pretty(&output).expect("Failed to serialize wallet");

    // Save to file
    fs::write(wallet_path, output_data).expect("Failed to write wallet file");
    println!("Wallet created at: {}", wallet_path.display());
}

/// Load the wallet file and deserialize the private key into a Scalar
pub fn load_wallet() -> Scalar {
    // Default `.seedelf` directory path
    let seedelf_path: PathBuf = Path::new("/home").join(whoami::username()).join(".seedelf");

    // Get the list of files in `.seedelf`
    let contents: Vec<fs::DirEntry> = fs::read_dir(&seedelf_path)
        .expect("Failed to read .seedelf directory")
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();

    if contents.is_empty() {
        panic!("No wallet files found in .seedelf directory");
    }

    // Use the first file in the directory to build the wallet path
    let first_file: &fs::DirEntry = &contents[0];
    let wallet_path: PathBuf = first_file.path();

    // Read the wallet file
    let wallet_data: String = fs::read_to_string(&wallet_path).expect("Failed to read wallet file");

    // Deserialize the wallet JSON
    let encrypted_wallet: EncryptedData =
        serde_json::from_str(&wallet_data).expect("Failed to parse wallet JSON");

    // Prompt user for the decryption password
    println!("\nEnter the password to decrypt the wallet file:");
    let password: String = read_password().expect("Failed to read password");

    // Derive the decryption key using the provided salt
    let salt: SaltString =
        SaltString::from_b64(&encrypted_wallet.salt).expect("Invalid salt format");
    let mut output_key_material: [u8; 32] = [0u8; 32];
    let _ = Argon2::default().hash_password_into(
        password.as_bytes(),
        salt.to_string().as_bytes(),
        &mut output_key_material,
    );

    let key = Key::<Aes256Gcm>::from_slice(&output_key_material);
    let cipher = Aes256Gcm::new(&key);

    // Decode the nonce and encrypted data from base64
    let nonce_bytes = STANDARD
        .decode(&encrypted_wallet.nonce)
        .expect("Failed to decode nonce");
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted_bytes = STANDARD
        .decode(&encrypted_wallet.data)
        .expect("Failed to decode encrypted data");

    // Decrypt the wallet data
    match cipher.decrypt(nonce, encrypted_bytes.as_ref()) {
        Ok(decrypted_data) => {
            // Deserialize the decrypted wallet JSON
            let wallet: Wallet = serde_json::from_slice(&decrypted_data)
                .expect("Failed to parse decrypted wallet JSON");

            // Decode the hex string back into bytes
            let private_key_bytes: Vec<u8> =
                hex::decode(wallet.private_key).expect("Failed to decode private key hex");

            // Convert bytes to Scalar
            Scalar::from_repr(private_key_bytes.try_into().expect("Invalid key length"))
                .expect("Failed to reconstruct Scalar from bytes")
        }
        Err(_) => {
            println!("Failed to decrypt; try again!");
            load_wallet()
        }
    }
}
