//! The web wallet's Cardano account: standard CIP-1852 HD keys from the
//! recovery phrase, so the same phrase restores the same account in Lace,
//! Eternl or Yoroi.
//!
//! ```text
//! master  = Icarus master key (CIP-3): PBKDF2-HMAC-SHA512(password = "",
//!           salt = BIP39 entropy, 4096 rounds, 96 bytes), clamped
//! account = master / 1852' / 1815' / account'
//! keys    = account / role / index     role 0 = receive, 1 = change, 2 = staking
//! ```
//!
//! v1 of the web wallet uses account 0 only, but everything here takes the
//! account index so more accounts can be added later. This is independent
//! of the Seedelf key in [`crate::derivation`], which comes from the BIP39
//! seed through its own HKDF domain.

use crate::derivation::parse_phrase;
use anyhow::{Result, bail};
use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart, StakeAddress,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_wallet::hd::{Bip32PrivateKey, Bip32PublicKey};

/// CIP-1852 purpose.
pub const PURPOSE: u32 = 1852;
/// Cardano's SLIP-44 coin type.
pub const COIN_TYPE: u32 = 1815;
/// Hardened-derivation offset.
pub const HARDENED: u32 = 0x8000_0000;

/// The CIP-1852 key roles the wallet uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// External chain: addresses shown for receiving.
    Receive = 0,
    /// Internal chain: change addresses.
    Change = 1,
    /// Staking key; the wallet only ever uses index 0.
    Staking = 2,
}

/// The account-level private key `m/1852'/1815'/account'`.
pub struct CardanoAccount {
    account_key: Bip32PrivateKey,
}

impl CardanoAccount {
    /// Derives account `account` from a recovery phrase (12, 15 or 24 words,
    /// same rules as [`parse_phrase`]) with an empty BIP39 passphrase.
    pub fn from_phrase(phrase: &str, account: u32) -> Result<Self> {
        if account >= HARDENED {
            bail!("account index must be below 2^31, got {account}");
        }
        let mnemonic = parse_phrase(phrase)?;
        let master = Bip32PrivateKey::from_bip39_mnenomic(mnemonic.to_string(), String::new())
            .map_err(|e| anyhow::anyhow!("failed to derive the master key: {e:?}"))?;
        let account_key = master
            .derive(HARDENED | PURPOSE)
            .derive(HARDENED | COIN_TYPE)
            .derive(HARDENED | account);
        Ok(Self { account_key })
    }

    /// The account-level public key (xpub); enough to derive every address.
    pub fn account_public_key(&self) -> Bip32PublicKey {
        self.account_key.to_public()
    }

    /// The private key at `role/index` under this account.
    pub fn private_key(&self, role: Role, index: u32) -> Result<Bip32PrivateKey> {
        if index >= HARDENED {
            bail!("address index must be below 2^31, got {index}");
        }
        Ok(self.account_key.derive(role as u32).derive(index))
    }

    /// The blake2b-224 hash of the public key at `role/index`.
    pub fn key_hash(&self, role: Role, index: u32) -> Result<Hash<28>> {
        let public = self.private_key(role, index)?.to_public();
        Ok(Hasher::<224>::hash(public.to_ed25519_pubkey().as_ref()))
    }

    /// The base address for payment key `role/index` (receive or change)
    /// delegated to this account's staking key `2/0`. `network_flag` is
    /// `true` for preprod, as in the CLI.
    pub fn base_address(&self, network_flag: bool, role: Role, index: u32) -> Result<Address> {
        if role == Role::Staking {
            bail!("a base address needs a receive or change key, not the staking key");
        }
        Ok(ShelleyAddress::new(
            network(network_flag),
            ShelleyPaymentPart::key_hash(self.key_hash(role, index)?),
            ShelleyDelegationPart::key_hash(self.key_hash(Role::Staking, 0)?),
        )
        .into())
    }

    /// The reward (stake) address of this account's staking key `2/0`.
    pub fn stake_address(&self, network_flag: bool) -> Result<Address> {
        let base = ShelleyAddress::new(
            network(network_flag),
            ShelleyPaymentPart::key_hash(self.key_hash(Role::Receive, 0)?),
            ShelleyDelegationPart::key_hash(self.key_hash(Role::Staking, 0)?),
        );
        StakeAddress::try_from(base)
            .map(Address::from)
            .map_err(|e| anyhow::anyhow!("failed to build the stake address: {e}"))
    }
}

fn network(network_flag: bool) -> Network {
    if network_flag {
        Network::Testnet
    } else {
        Network::Mainnet
    }
}
