use aes_gcm::aead::{Aead, AeadCore, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Argon2, password_hash::SaltString};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blstrs::Scalar;
use colored::Colorize;
use dirs::home_dir;
use ff::PrimeField;
use rand_core::OsRng;
use rpassword::read_password;
use seedelf_crypto::schnorr::random_scalar;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

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

pub fn seedelf_home_path() -> PathBuf {
    let home: PathBuf = home_dir().expect("Failed to get home directory");
    let seedelf_path: PathBuf = home.join(".seedelf");
    seedelf_path
}

/// Check if `.seedelf` exists, create it if it doesn't, and handle file logic
pub fn check_and_prepare_seedelf() -> Option<String> {
    let seedelf_path: PathBuf = seedelf_home_path();

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
        None
    } else {
        for entry in &contents {
            if let Ok(file_name) = entry.file_name().into_string() {
                return Some(file_name);
            }
        }
        None
    }
}

/// Prompt the user to enter a wallet name
pub fn prompt_wallet_name() -> String {
    let mut wallet_name: String = String::new();
    println!("{}", "\nEnter A Wallet Name:".bright_purple());
    io::stdout().flush().unwrap();
    io::stdin()
        .read_line(&mut wallet_name)
        .expect("Failed to read wallet name");
    let final_name: String = wallet_name
        .split_whitespace() // breaks on any whitespace sequence
        .collect::<Vec<_>>() // collect the pieces
        .join("_");
    if final_name.is_empty() {
        println!("{}", "Wallet Must Not Have Empty Name.".red());
        return prompt_wallet_name();
    }
    final_name
}

pub fn enter_password() -> String {
    println!(
        "{}",
        "\nEnter A Password To Encrypt The Wallet:".bright_purple()
    );
    let password: String = read_password().expect("Failed to read password");
    password
}

pub fn is_valid_password() -> String {
    let password: String = enter_password();
    if !password_complexity_check(password.clone()) {
        println!(
            "{}",
            "Passwords Must Contain The Following:\n
                  Minimum Length: At Least 14 Characters.
                  Uppercase Letter: Requires At Least One Uppercase Character.
                  Lowercase Letter: Requires At Least One Lowercase Character.
                  Number: Requires At Least One Digit.
                  Special Character: Requires At Least One Special Symbol.\n"
                .red()
        );
        return is_valid_password();
    }
    let password_copy: String = enter_password();

    if password != password_copy {
        println!("{}", "Passwords Do Not Match; Try Again!".red());
        return is_valid_password();
    }
    password
}

/// Create a wallet file and save a random private key
pub fn create_wallet(wallet_name: String, password: String) {
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

    let salt: SaltString = SaltString::generate(&mut OsRng);
    let mut output_key_material: [u8; 32] = [0u8; 32];
    let _ = Argon2::default().hash_password_into(
        password.as_bytes(),
        salt.to_string().as_bytes(),
        &mut output_key_material,
    );

    let key = Key::<Aes256Gcm>::from_slice(&output_key_material);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

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

    let seedelf_path: PathBuf = seedelf_home_path();
    let wallet_path = seedelf_path.join(format!("{wallet_name}.wallet"));

    // Save to file
    fs::write(wallet_path.clone(), output_data).expect("Failed to write wallet file");
}

/// Load the wallet file and deserialize the private key into a Scalar
pub fn load_wallet(password: String) -> Result<Scalar, String> {
    let seedelf_path: PathBuf = seedelf_home_path();

    // Get the list of files in `.seedelf`
    let contents: Vec<fs::DirEntry> = fs::read_dir(&seedelf_path)
        .map_err(|_| "Failed to read .seedelf directory")?
        .filter_map(|entry| entry.ok())
        .collect::<Vec<_>>();

    if contents.is_empty() {
        return Err("No wallet files found in .seedelf directory".into());
    }

    // Use the first file in the directory to build the wallet path
    let first_file: &fs::DirEntry = &contents[0];
    let wallet_path: PathBuf = first_file.path();

    // Read the wallet file
    let wallet_data: String =
        fs::read_to_string(&wallet_path).map_err(|_| "Failed to read wallet file")?;

    // Deserialize the wallet JSON
    let encrypted_wallet: EncryptedData =
        serde_json::from_str(&wallet_data).map_err(|_| "Failed to parse wallet JSON")?;

    // Derive the decryption key using the provided salt
    let salt: SaltString =
        SaltString::from_b64(&encrypted_wallet.salt).map_err(|_| "Invalid salt format")?;
    let mut output_key_material: [u8; 32] = [0u8; 32];
    let _ = Argon2::default().hash_password_into(
        password.as_bytes(),
        salt.to_string().as_bytes(),
        &mut output_key_material,
    );

    let key = Key::<Aes256Gcm>::from_slice(&output_key_material);
    let cipher = Aes256Gcm::new(key);

    // Decode the nonce and encrypted data from base64
    let nonce_bytes = STANDARD
        .decode(&encrypted_wallet.nonce)
        .map_err(|_| "Failed to decode nonce")?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted_bytes = STANDARD
        .decode(&encrypted_wallet.data)
        .map_err(|_| "Failed to decode encrypted data")?;

    /* ---- decrypt ---- */
    let decrypted_data = cipher
        .decrypt(nonce, encrypted_bytes.as_ref())
        .map_err(|_| "Failed to decrypt")?;

    /* ---- deserialize inner JSON ---- */
    let wallet: Wallet =
        serde_json::from_slice(&decrypted_data).map_err(|_| "Failed to parse decrypted JSON")?;

    /* ---- bytes -> Scalar ---- */
    let key_bytes =
        hex::decode(wallet.private_key).map_err(|_| "Failed to decode private key hex")?;

    Scalar::from_repr(key_bytes.try_into().map_err(|_| "Invalid key length")?)
        .into_option()
        .ok_or("Failed to reconstruct Scalar from bytes".into())
}

pub fn unlock_wallet_interactive() -> Scalar {
    loop {
        let password: String = enter_password();

        match load_wallet(password) {
            Ok(scalar) => break scalar,
            Err(e) => {
                eprintln!("Error: {e}\nPlease Try Again");
            }
        }
    }
}

pub fn password_complexity_check(password: String) -> bool {
    // length check, 14 for now
    if password.len() < 14 {
        return false;
    }

    // must contain uppercase
    if !password.chars().any(|c| c.is_uppercase()) {
        return false;
    }

    // must contain lowercase
    if !password.chars().any(|c| c.is_lowercase()) {
        return false;
    }

    // must contain number
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }

    // must contain special character
    if !password
        .chars()
        .any(|c| r#"~!@#$%^&*()_-+=<>?/|{}[]:;"'.,"#.contains(c))
    {
        return false;
    }
    true
}
