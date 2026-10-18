//! How much ADA a pool's box must hold (S0d, the owner's ask of 2026-10-13:
//! "a provable test showing what exactly it has to be for this flow"), proven
//! by building every step of a box's way back, never estimated. It lived in
//! its test (`lovejoin_box_value_test.rs`) until chunk 34's 34d, which moved
//! it here: the launch form suggests a box value from it, and a launch is
//! held to it under the parameters live then (session 1, 14).
//!
//! A box comes back on its own: a withdraw into a Seedelf that the box pays
//! for itself. What comes back is then spent like any other Seedelf UTxO, and
//! on its own, since spending it with another would tie the two histories
//! together and undo the mixing. So a box's ADA must pay for, in turn:
//!
//! 1. the withdraw, its fee and its Seedelf output (a register, and the
//!    token in a token pool);
//! 2. from what came back alone, a payment of part of it (half the token, or
//!    in an ADA pool the least a payment may be), to a Seedelf or to an
//!    address, with the change and the fee;
//! 3. or all of it, to a Seedelf or to an address.
//!
//! Each is built and measured by the wallet's own builders. The step that
//! binds is always part of the token paid to a Seedelf from what came back
//! alone (2026-10-17's table, in the test).

use super::pool::{ReferenceDatum, holder_address, pool_of};
use super::templates::{self, Derived, NFT_NAME};
use super::value::{BoxToken, BoxValue};
use super::{PoolBox, Protocol, mix_datum, withdraw};
use crate::address::wallet_contract;
use crate::assets::{Asset, Assets};
use crate::build::{self, Chain, Payment};
use crate::constants::{VARIANT, get_config};
use crate::eval::Resolved;
use anyhow::{Context, Result, anyhow, bail};
use blstrs::{G1Projective, Scalar};
use group::Group;
use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::Fragment;
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{Output, ScriptKind};
use rand_core::OsRng;
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::json;

/// What the wallet adds to a token's least box value before it rounds up
/// ([`suggested_box_lovelace`]): room for the price of a byte to rise. With
/// the rounding, every token S0d measured comes to 4.5 ₳, which covers the
/// worst a launch can name with its scripts by reference at a byte price
/// about 8% over 2026-10-17's.
pub const BOX_MARGIN: u64 = 250_000;

/// The suggested box value is a whole number of these: 0.5 ₳.
pub const BOX_STEP: u64 = 500_000;

/// The most ADA a token pool's box may hold (chunk 34's round three, 27).
/// An ADA pool's box is its amount, with no upper limit.
pub const MAX_TOKEN_BOX_LOVELACE: u64 = 9_000_000;

/// The search's bounds, in lovelace: no box this small comes back, and every
/// box this large does.
const SEARCH_LOW: u64 = 1_000_000;
const SEARCH_HIGH: u64 = 20_000_000;

/// The search's step: 0.01 ₳.
const SEARCH_STEP: u64 = 10_000;

/// A box's way back, as [`way_back`] built it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WayBack {
    /// The withdraw's fee, which the box pays.
    pub withdraw_fee: u64,
    /// What comes back into the Seedelf, its token aside.
    pub back: u64,
}

/// A pool to try box values in: its scripts derived once from a seed made up
/// for the purpose, by reference at the holder or carried in every
/// transaction. Only the reference UTxO's datum changes with the value.
pub struct Probe {
    network_flag: bool,
    seed: ([u8; 32], u64),
    derived: Derived,
    by_reference: bool,
}

impl Probe {
    /// `by_reference`: the pool's scripts at the holder, as every launch the
    /// wallet makes publishes them.
    pub fn new(network_flag: bool, by_reference: bool) -> Result<Self> {
        let seed = ([0x5e; 32], 1);
        Ok(Probe {
            network_flag,
            seed,
            derived: templates::derive(&seed.0, seed.1)?,
            by_reference,
        })
    }

    /// The pool whose every box holds `value`.
    fn pool(&self, value: &BoxValue) -> Result<Protocol> {
        let datum = ReferenceDatum {
            box_value: value.clone(),
            max_fee: 1_500_000.min(value.lovelace.saturating_sub(1)).max(1),
            mix_box_hash: self.derived.mix_box.hash,
            mix_logic_hash: self.derived.mix_logic.hash,
            fee_hash: self.derived.fee_contract.hash,
        };
        let holder = holder_address(self.network_flag);
        let at_holder = |first: u8, output: Output| -> Result<Resolved> {
            Ok(Resolved {
                tx_hash: [first; 32],
                index: 0,
                output: output
                    .build_babbage_raw()
                    .context("An output can't be built")?
                    .encode_fragment()
                    .map_err(|e| anyhow!("An output can't be encoded: {e}"))?,
            })
        };
        let reference = at_holder(
            0x71,
            Output::new(holder.clone(), 2_000_000)
                .add_asset(Hash::new(self.derived.policy()), NFT_NAME.to_vec(), 1)?
                .set_inline_datum(datum.encode()),
        )?;
        let scripts = if self.by_reference {
            [
                (0x72, &self.derived.mix_box),
                (0x73, &self.derived.mix_logic),
            ]
            .into_iter()
            .map(|(first, s)| {
                at_holder(
                    first,
                    Output::new(holder.clone(), 20_000_000)
                        .set_inline_script(ScriptKind::PlutusV3, s.cbor.clone()),
                )
            })
            .collect::<Result<Vec<_>>>()?
        } else {
            Vec::new()
        };
        Ok(pool_of(
            self.network_flag,
            &reference,
            self.seed,
            &datum,
            &self.derived,
            &scripts,
        ))
    }
}

/// A box of `pool`'s that `sk` owns, made up for the purpose.
fn own_box(pool: &Protocol, sk: &Scalar) -> Result<PoolBox> {
    let a = G1Projective::generator() * Scalar::from(987_654_321u64);
    let b = a * sk;
    let (a, b) = (crypto::point_to_bytes(&a), crypto::point_to_bytes(&b));
    let utxo = Resolved {
        tx_hash: [0x30; 32],
        index: 0,
        output: pool
            .box_value()
            .output(pool.mix_box_address())?
            .set_inline_datum(mix_datum(&a, &b))
            .build_babbage_raw()
            .context("A box can't be built")?
            .encode_fragment()
            .map_err(|e| anyhow!("A box can't be encoded: {e}"))?,
    };
    PoolBox::from_resolved(utxo, pool).context("A box made up for the purpose isn't the pool's")
}

fn assets_of(token: &BoxToken, quantity: u64) -> Result<Assets> {
    Assets::new().add(Asset::new(
        hex::encode(token.policy),
        hex::encode(&token.name),
        quantity,
    )?)
}

/// What came back, as the wallet reads it from Koios: a row at the wallet
/// contract under the withdraw's register.
fn came_back(
    network_flag: bool,
    tx: &[u8],
    register: &Register,
    token: Option<&BoxToken>,
) -> Result<UtxoResponse> {
    let decoded = MultiEraTx::decode(tx).map_err(|e| anyhow!("The withdraw can't be read: {e}"))?;
    let output = decoded
        .outputs()
        .first()
        .cloned()
        .context("The withdraw has no output")?;
    let config = get_config(VARIANT, network_flag)?;
    let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
    let assets: Vec<serde_json::Value> = match token {
        None => Vec::new(),
        Some(t) => {
            let quantity = output
                .value()
                .assets()
                .first()
                .and_then(|p| p.assets().first().and_then(|a| a.output_coin()))
                .context("The withdraw's output holds no token")?;
            vec![json!({
                "policy_id": hex::encode(t.policy), "asset_name": hex::encode(&t.name),
                "quantity": quantity.to_string(), "decimals": 0, "fingerprint": "",
            })]
        }
    };
    Ok(serde_json::from_value(json!({
        "tx_hash": hex::encode(*decoded.hash()), "tx_index": 0,
        "address": wallet.to_bech32().map_err(|e| anyhow!("{e}"))?,
        "value": output.value().coin().to_string(),
        "stake_address": null,
        "payment_cred": hex::encode(config.contract.wallet_contract_hash),
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": {
            "bytes": hex::encode(register.to_vec()?),
            "value": { "constructor": 0, "fields": [
                { "bytes": register.generator }, { "bytes": register.public_value },
            ]},
        },
        "reference_script": null,
        "asset_list": assets,
        "is_spent": false,
    }))?)
}

/// Every step of a box's way back, at `value` in `probe`'s pool under
/// `params`: what the withdraw costs and brings back, or the first step that
/// can't be built, in words.
pub fn way_back(
    probe: &Probe,
    params: &ProtocolParameters,
    value: &BoxValue,
) -> Result<WayBack, String> {
    let network_flag = probe.network_flag;
    let pool = probe.pool(value).map_err(|e| format!("the pool: {e}"))?;
    let token = value.token.as_ref();
    let sk = Scalar::from(4_242_424u64);
    let owner = Register::create(sk).map_err(|e| format!("a register: {e}"))?;
    let destination = owner
        .clone()
        .rerandomize()
        .map_err(|e| format!("a register: {e}"))?;
    let boxed = own_box(&pool, &sk).map_err(|e| format!("the box: {e}"))?;
    let back = withdraw(params, &pool, &[boxed], &sk, destination.clone())
        .map_err(|e| format!("the withdraw: {e}"))?;

    let chain = Chain {
        params: params.clone(),
        network_flag,
        config: get_config(VARIANT, network_flag).map_err(|e| format!("{e}"))?,
    };
    let row = came_back(network_flag, &back.tx.tx_bytes.0, &destination, token)
        .map_err(|e| format!("what came back: {e}"))?;
    let signer = Hasher::<224>::hash(SecretKey::new(OsRng).public_key().as_ref());
    let other = Register::create(Scalar::from(31_337u64)).map_err(|e| format!("{e}"))?;
    let mut address_bytes = vec![if network_flag { 0x60 } else { 0x61 }];
    address_bytes.extend([0x44; 28]);
    let address = Address::from_bytes(&address_bytes).map_err(|e| format!("{e}"))?;
    let (part, all) = match token {
        Some(t) => (
            assets_of(t, t.quantity / 2).map_err(|e| format!("{e}"))?,
            assets_of(t, t.quantity).map_err(|e| format!("{e}"))?,
        ),
        None => (Assets::new(), Assets::new()),
    };
    let measured = |what: &str, spend: Result<build::ScriptSpend>| -> Result<(), String> {
        spend
            .and_then(|s| {
                s.proven(|register, vkh| {
                    schnorr::create_proof(register.clone(), sk, vkh.to_string())
                })
            })
            .and_then(|s| s.measure_locally(&[]))
            .map(|_| ())
            .map_err(|e| format!("{what}: {e}"))
    };
    let inputs = std::slice::from_ref(&row);
    let seedelf_part = build::minimum_seedelf_payment(params, &part).map_err(|e| format!("{e}"))?;
    measured(
        "part of it to a Seedelf",
        build::transfer_from(
            &chain,
            inputs,
            &[Payment {
                register: other.clone(),
                lovelace: seedelf_part,
                tokens: part.clone(),
            }],
            &owner,
            signer,
        ),
    )?;
    let address_part =
        build::minimum_address_payment(params, &address, &part).map_err(|e| format!("{e}"))?;
    measured(
        "part of it to an address",
        build::sweep_from(
            &chain,
            inputs,
            &address,
            address_part,
            &part,
            &owner,
            signer,
        ),
    )?;
    measured(
        "all of it to a Seedelf",
        build::transfer_most(&chain, inputs, &other, &all, &owner, signer),
    )?;
    measured(
        "all of it to an address",
        build::sweep_all(&chain, inputs, &address, &owner, signer),
    )?;
    Ok(WayBack {
        withdraw_fee: back.fee,
        back: back.lovelace,
    })
}

/// The least box value, to 0.01 ₳, at which every step of a box's way back
/// builds under `params`, for `token` (none: an ADA pool) in `probe`'s pool.
/// About a dozen ways back are built.
pub fn least_box_lovelace(
    probe: &Probe,
    params: &ProtocolParameters,
    token: Option<&BoxToken>,
) -> Result<u64> {
    let at = |lovelace: u64| {
        way_back(
            probe,
            params,
            &BoxValue {
                lovelace,
                token: token.cloned(),
            },
        )
    };
    if let Err(why) = at(SEARCH_HIGH) {
        bail!("Even a box of 20 ₳ can't come back under today's parameters: {why}");
    }
    let (mut low, mut high) = (SEARCH_LOW / SEARCH_STEP, SEARCH_HIGH / SEARCH_STEP);
    if at(low * SEARCH_STEP).is_ok() {
        return Ok(low * SEARCH_STEP);
    }
    while high - low > 1 {
        let mid = (low + high) / 2;
        if at(mid * SEARCH_STEP).is_ok() {
            high = mid;
        } else {
            low = mid;
        }
    }
    Ok(high * SEARCH_STEP)
}

/// The box value the launch form suggests for a token whose least is
/// `least` ([`least_box_lovelace`]): that, with [`BOX_MARGIN`], rounded up to
/// a [`BOX_STEP`].
pub fn suggested_box_lovelace(least: u64) -> u64 {
    least.saturating_add(BOX_MARGIN).div_ceil(BOX_STEP) * BOX_STEP
}
