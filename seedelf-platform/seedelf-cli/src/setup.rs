use aes_gcm::aead::{Aead, AeadCore, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{Result, anyhow, bail};
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
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

/// Data structure for storing wallet information. The decoded hex private
/// key lives in `private_key`; `ZeroizeOnDrop` wipes it when this struct
/// goes out of scope so the hex never lingers in memory.
#[derive(Serialize, Deserialize, ZeroizeOnDrop)]
struct Wallet {
    private_key: String,
}

/// Data structure for storing wallet information
#[derive(Serialize, Deserialize)]
struct EncryptedData {
    salt: String,
    nonce: String,
    data: String,
}

fn seedelf_home_path() -> PathBuf {
    let home: PathBuf = home_dir().expect("Failed to get home directory");
    let seedelf_path: PathBuf = home.join(".seedelf");
    seedelf_path
}

/// Restrict a path to owner-only permissions on Unix. No-op elsewhere.
#[cfg(unix)]
fn restrict_permissions(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let perms = fs::Permissions::from_mode(mode);
    fs::set_permissions(path, perms).map_err(|e| anyhow!("Failed to chmod {path:?}: {e}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path, _mode: u32) -> Result<()> {
    Ok(())
}

/// Return the sorted list of `*.wallet` files in `.seedelf`.
fn list_wallet_files(seedelf_path: &Path) -> Result<Vec<PathBuf>> {
    let mut wallets: Vec<PathBuf> = fs::read_dir(seedelf_path)
        .map_err(|e| anyhow!("Failed to read .seedelf directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("wallet"))
        .collect();
    wallets.sort();
    Ok(wallets)
}

/// Check if `.seedelf` exists, create it if it doesn't, and return the wallet
/// file name if exactly one `*.wallet` file is present.
pub(crate) fn check_and_prepare_seedelf() -> Result<Option<String>> {
    let seedelf_path: PathBuf = seedelf_home_path();

    if !seedelf_path.exists() {
        fs::create_dir_all(&seedelf_path)
            .map_err(|e| anyhow!("Failed to create .seedelf directory: {e}"))?;
        restrict_permissions(&seedelf_path, 0o700)?;
    }

    let wallets = list_wallet_files(&seedelf_path)?;
    match wallets.len() {
        0 => Ok(None),
        1 => Ok(wallets[0]
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())),
        n => bail!("Found {n} wallet files in .seedelf; expected exactly one"),
    }
}

/// Prompt the user to enter a wallet name
pub(crate) fn prompt_wallet_name() -> String {
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

fn enter_password() -> String {
    println!(
        "{}",
        "\nEnter A Password To Encrypt The Wallet:".bright_purple()
    );
    let password: String = read_password().expect("Failed to read password");
    password
}

pub(crate) fn is_valid_password() -> String {
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
pub(crate) fn create_wallet(wallet_name: String, password: String) -> Result<()> {
    // Treat the password as one-shot — wipe on scope exit.
    let password = Zeroizing::new(password);

    // Generate a random private key
    let sk: Scalar = random_scalar();
    let mut private_key_bytes: [u8; 32] = sk.to_repr();
    let wallet: Wallet = Wallet {
        private_key: hex::encode(private_key_bytes),
    };
    private_key_bytes.zeroize();

    let wallet_data: Zeroizing<String> = Zeroizing::new(
        serde_json::to_string_pretty(&wallet)
            .map_err(|e| anyhow!("Failed to serialize wallet: {e}"))?,
    );

    let salt: SaltString = SaltString::generate(&mut OsRng);
    let mut output_key_material: Zeroizing<[u8; 32]> = Zeroizing::new([0u8; 32]);
    Argon2::default()
        .hash_password_into(
            password.as_bytes(),
            salt.to_string().as_bytes(),
            output_key_material.as_mut_slice(),
        )
        .map_err(|e| anyhow!("Argon2 key derivation failed: {e}"))?;

    let key = Key::<Aes256Gcm>::from_slice(output_key_material.as_slice());
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let encrypted_data = cipher
        .encrypt(&nonce, wallet_data.as_bytes())
        .map_err(|e| anyhow!("Encryption failed: {e}"))?;

    // Save encrypted data, salt, and nonce as JSON
    let output: EncryptedData = EncryptedData {
        salt: salt.as_str().to_string(),
        nonce: STANDARD.encode(nonce),
        data: STANDARD.encode(encrypted_data),
    };
    let output_data: String = serde_json::to_string_pretty(&output)
        .map_err(|e| anyhow!("Failed to serialize wallet: {e}"))?;

    let seedelf_path: PathBuf = seedelf_home_path();
    let wallet_path = seedelf_path.join(format!("{wallet_name}.wallet"));

    fs::write(&wallet_path, output_data)
        .map_err(|e| anyhow!("Failed to write wallet file: {e}"))?;
    restrict_permissions(&wallet_path, 0o600)?;
    Ok(())
}

/// Load the wallet file and deserialize the private key into a Scalar
fn load_wallet(password: String) -> Result<Scalar> {
    let password = Zeroizing::new(password);

    let seedelf_path: PathBuf = seedelf_home_path();
    let wallets = list_wallet_files(&seedelf_path)?;
    let wallet_path: PathBuf = match wallets.len() {
        0 => bail!("No wallet files found in .seedelf directory"),
        1 => wallets.into_iter().next().unwrap(),
        n => bail!("Found {n} wallet files in .seedelf; expected exactly one"),
    };

    let wallet_data: String =
        fs::read_to_string(&wallet_path).map_err(|e| anyhow!("Failed to read wallet file: {e}"))?;

    let encrypted_wallet: EncryptedData = serde_json::from_str(&wallet_data)
        .map_err(|e| anyhow!("Failed to parse wallet JSON: {e}"))?;

    let salt: SaltString = SaltString::from_b64(&encrypted_wallet.salt)
        .map_err(|e| anyhow!("Invalid salt format: {e}"))?;
    let mut output_key_material: Zeroizing<[u8; 32]> = Zeroizing::new([0u8; 32]);
    Argon2::default()
        .hash_password_into(
            password.as_bytes(),
            salt.to_string().as_bytes(),
            output_key_material.as_mut_slice(),
        )
        .map_err(|e| anyhow!("Argon2 key derivation failed: {e}"))?;

    let key = Key::<Aes256Gcm>::from_slice(output_key_material.as_slice());
    let cipher = Aes256Gcm::new(key);

    let nonce_bytes = STANDARD
        .decode(&encrypted_wallet.nonce)
        .map_err(|e| anyhow!("Failed to decode nonce: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted_bytes = STANDARD
        .decode(&encrypted_wallet.data)
        .map_err(|e| anyhow!("Failed to decode encrypted data: {e}"))?;

    let decrypted_data: Zeroizing<Vec<u8>> = Zeroizing::new(
        cipher
            .decrypt(nonce, encrypted_bytes.as_ref())
            .map_err(|_| anyhow!("Failed to decrypt — wrong password?"))?,
    );

    let wallet: Wallet = serde_json::from_slice(decrypted_data.as_slice())
        .map_err(|e| anyhow!("Failed to parse decrypted JSON: {e}"))?;

    let key_bytes: Zeroizing<Vec<u8>> = Zeroizing::new(
        hex::decode(&wallet.private_key)
            .map_err(|e| anyhow!("Failed to decode private key hex: {e}"))?,
    );

    let mut repr_bytes: Zeroizing<[u8; 32]> = Zeroizing::new(
        key_bytes
            .as_slice()
            .try_into()
            .map_err(|_| anyhow!("Invalid key length"))?,
    );
    let scalar = Scalar::from_repr(*repr_bytes)
        .into_option()
        .ok_or_else(|| anyhow!("Failed to reconstruct Scalar from bytes"))?;
    repr_bytes.zeroize();
    Ok(scalar)
}

pub(crate) fn unlock_wallet_interactive() -> Scalar {
    loop {
        let password: String = enter_password();

        match load_wallet(password) {
            Ok(scalar) => break scalar,
            Err(e) => {
                eprintln!("Error: {e:#}\nPlease Try Again");
            }
        }
    }
}

fn password_complexity_check(password: String) -> bool {
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

#[cfg(test)]
mod tests {
    use super::password_complexity_check;

    #[test]
    fn test_short_password() {
        assert!(!password_complexity_check("i@G37xzM".to_string()));
    }

    #[test]
    fn test_no_lowercase() {
        assert!(!password_complexity_check("I@G37XZM@QCGK3G".to_string()));
    }

    #[test]
    fn test_no_uppercase() {
        assert!(!password_complexity_check("i@g37xzm@qcgk3g".to_string()));
    }

    #[test]
    fn test_no_special() {
        assert!(!password_complexity_check("iaG37xzMaqcgk3g".to_string()));
    }

    #[test]
    fn test_good_password() {
        assert!(password_complexity_check("i@G37xzM@qcgk3g".to_string()));
    }
}
