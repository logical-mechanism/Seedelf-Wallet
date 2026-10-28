//! Made-up UTxOs for building the wallet's transactions offline: key-address
//! coins, Seedelf UTxOs under a register, and pool boxes. Only the scripts'
//! references are real (bundled in core, or a launch's own outputs).

use anyhow::Result;
use pallas_addresses::{Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart};
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use rand_core::{OsRng, RngCore};
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::eval::Resolved;
use seedelf_core::lovejoin::{self, Coin, PoolBox, Protocol};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;
use serde_json::{Value, json};

/// A random transaction hash.
pub fn tx_hash() -> [u8; 32] {
    let mut h = [0u8; 32];
    OsRng.fill_bytes(&mut h);
    h
}

/// A testnet enterprise address under `key` (Musashi's addresses are
/// testnet's, network id 0).
pub fn key_address(key: Hash<28>) -> Address {
    ShelleyAddress::new(Network::Testnet, ShelleyPaymentPart::Key(key), ShelleyDelegationPart::Null).into()
}

/// A random key hash, for an account nobody signs for offline.
pub fn key() -> Hash<28> {
    let mut k = [0u8; 32];
    OsRng.fill_bytes(&mut k);
    Hasher::<224>::hash(&k)
}

/// A UTxO as Koios lists it.
pub fn row(tx_hash: [u8; 32], index: u64, address: &Address, lovelace: u64, inline: Option<Value>) -> UtxoResponse {
    serde_json::from_value(json!({
        "tx_hash": hex::encode(tx_hash), "tx_index": index,
        "address": address.to_bech32().unwrap(), "value": lovelace.to_string(),
        "stake_address": null, "payment_cred": "", "epoch_no": 0, "block_height": 0,
        "block_time": 0, "datum_hash": null, "inline_datum": inline,
        "reference_script": null, "asset_list": [], "is_spent": false,
    }))
    .expect("a well-formed row")
}

/// A register as an inline datum, as Koios shows one.
pub fn register_datum(register: &Register) -> Result<Value> {
    Ok(json!({
        "bytes": hex::encode(register.to_vec()?),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    }))
}

/// A wallet-contract UTxO under `register`.
pub fn seedelf_row(tx_hash: [u8; 32], index: u64, lovelace: u64, register: &Register) -> Result<UtxoResponse> {
    let hash = get_config(VARIANT, true)?.contract.wallet_contract_hash;
    let address = wallet_contract(true, hash);
    Ok(row(tx_hash, index, &address, lovelace, Some(register_datum(register)?)))
}

/// An ADA-only coin at `address`.
pub fn coin(address: &Address, lovelace: u64) -> Result<Coin> {
    Coin::from_row(&row(tx_hash(), 0, address, lovelace, None))
}

/// A box in `protocol`'s pool (an ADA pool's: its box value is ADA alone)
/// under a fresh register nobody here owns.
pub fn pool_box(protocol: &Protocol) -> Result<PoolBox> {
    let owner = Register::create(seedelf_crypto::schnorr::random_scalar())?;
    let a: [u8; 48] = hex::decode(&owner.generator)?.try_into().expect("48 bytes");
    let b: [u8; 48] = hex::decode(&owner.public_value)?.try_into().expect("48 bytes");
    let datum = lovejoin::mix_datum(&a, &b);
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(3)?;
    e.u8(0)?.bytes(&protocol.mix_box_address().to_vec())?;
    e.u8(1)?.u64(protocol.denom)?;
    e.u8(2)?.array(2)?.u8(1)?.tag(minicbor::data::Tag::new(24))?.bytes(&datum)?;
    let utxo = Resolved {
        tx_hash: tx_hash(),
        index: 0,
        output: e.into_writer(),
    };
    PoolBox::from_resolved(utxo, protocol).ok_or_else(|| anyhow::anyhow!("not a box of the pool"))
}
