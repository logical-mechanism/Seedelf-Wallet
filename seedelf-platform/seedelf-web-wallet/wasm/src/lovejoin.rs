//! Lovejoin in the web wallet: a private session's spare ADA through the
//! mixer on its way back, and the boxes' later withdraws into Seedelf.
//! `seedelf_core::lovejoin` builds and measures the transactions; this signs
//! them with the session's key and gives the worker JSON.
//!
//! A session's chain, built here in one call and sent by the worker in
//! order, each transaction on the one before's change:
//!
//! 1. the deposit: as many 10 ₳ boxes as its ADA-only UTxOs pay for, each
//!    owned by the Seedelf key;
//! 2. the mixes: each box fanned out `depth` waves deep, three wide, with
//!    fresh boxes from the pool;
//! 3. the return: the last change, the collateral (spent here, last) and any
//!    token UTxOs, into fresh registers.
//!
//! The boxes come back later, each on its own ([`withdraw`]), paid from
//! themselves with giveme.my's collateral: nothing ties them to the session.

use anyhow::{Context, Result, anyhow, bail};
use blstrs::Scalar;
use pallas_addresses::{Address, ShelleyPaymentPart};
use pallas_crypto::hash::Hash;
use pallas_crypto::key::ed25519::{PublicKey, Signature};
use pallas_txbuilder::BuiltTransaction;
use seedelf_core::address::wallet_contract;
use seedelf_core::build;
use seedelf_core::constants::{COLLATERAL_PUBLIC_KEY, VARIANT, get_config};
use seedelf_core::lovejoin::{self, Coin, PoolBox, Protocol};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde::{Deserialize, Serialize};

fn network_flag(network: &str) -> Result<bool> {
    match network {
        "preprod" => Ok(true),
        "mainnet" => Ok(false),
        other => bail!("unknown network {other}"),
    }
}

fn payment_key(address: &str) -> Option<Hash<28>> {
    match Address::from_bech32(address).ok()? {
        Address::Shelley(s) => match s.payment() {
            ShelleyPaymentPart::Key(k) => Some(*k),
            ShelleyPaymentPart::Script(_) => None,
        },
        _ => None,
    }
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutRef {
    pub tx_hash: String,
    pub tx_index: u64,
}

impl OutRef {
    fn is(&self, row: &UtxoResponse) -> bool {
        self.tx_hash == row.tx_hash && self.tx_index == row.tx_index
    }

    fn of_box(b: &PoolBox) -> Self {
        OutRef {
            tx_hash: hex::encode(b.utxo.tx_hash),
            tx_index: b.utxo.index,
        }
    }
}

/// What a session holds, split for its chain.
struct Holdings {
    address: String,
    coins: Vec<Coin>,
    collateral: UtxoResponse,
    kept: Vec<UtxoResponse>,
}

fn holdings(
    accounts: &CardanoAccount,
    index: u32,
    utxos: &[UtxoResponse],
    collateral: &OutRef,
) -> Result<Holdings> {
    let key = accounts.key_hash(Role::Receive, index)?;
    let mut coins = Vec::new();
    let mut kept = Vec::new();
    let mut found = None;
    for row in utxos {
        if payment_key(&row.address) != Some(key) {
            bail!(
                "UTxO {}#{} isn't at session {index}'s account",
                row.tx_hash,
                row.tx_index
            );
        }
        if collateral.is(row) {
            found = Some(row.clone());
        } else if row.asset_list.as_ref().is_none_or(|a| a.is_empty()) {
            coins.push(Coin::from_row(row)?);
        } else {
            kept.push(row.clone());
        }
    }
    let collateral = found.context("The session's collateral isn't among its UTxOs")?;
    Ok(Holdings {
        address: collateral.address.clone(),
        coins,
        collateral,
        kept,
    })
}

/// What the review shows before anything is built.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    pub network: String,
    pub index: u32,
    pub utxos: Vec<UtxoResponse>,
    pub collateral: OutRef,
    pub depth: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanResult {
    /// Boxes the spare ADA pays for: none means a plain return.
    pub boxes: usize,
    /// The ADA-only UTxOs' lovelace, the collateral aside.
    pub spare: String,
    pub mixes: usize,
    /// About what the mixes cost, all boxes together.
    pub mix_fees: String,
}

pub fn plan(accounts: &CardanoAccount, request: PlanRequest) -> Result<PlanResult> {
    let protocol = Protocol::of(network_flag(&request.network)?)?;
    let held = holdings(accounts, request.index, &request.utxos, &request.collateral)?;
    let spare: u64 = held.coins.iter().map(|c| c.lovelace).sum();
    let boxes = lovejoin::boxes_affordable(spare, request.depth, protocol.denom);
    let mixes = boxes * lovejoin::mixes_per_box(request.depth);
    Ok(PlanResult {
        boxes,
        spare: spare.to_string(),
        mixes,
        mix_fees: (mixes as u64 * lovejoin::MIX_FEE_ESTIMATE).to_string(),
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChainRequest {
    pub network: String,
    /// One row of Koios's `epoch_params`.
    pub params: serde_json::Value,
    pub index: u32,
    /// Every UTxO at the session's account.
    pub utxos: Vec<UtxoResponse>,
    pub collateral: OutRef,
    /// The boxes at `mix_box` (Koios `credential_utxos`), minus any a sent
    /// transaction of ours already spends.
    pub pool: Vec<UtxoResponse>,
    pub depth: u32,
    /// How many boxes; the most the spare ADA pays for when absent.
    pub boxes: Option<usize>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChainTxOut {
    /// `deposit`, `mix` or `back`.
    pub kind: String,
    pub tx_cbor: String,
    pub tx_hash: String,
    pub fee: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChainResult {
    /// In the order they're sent, each signed.
    pub txs: Vec<ChainTxOut>,
    pub boxes: usize,
    pub depth: u32,
    pub fees: String,
    /// What the return brings back at once (the change and the collateral).
    pub returned: String,
    /// Where our boxes end up, to be withdrawn later.
    pub leaves: Vec<OutRef>,
}

fn sign(tx: BuiltTransaction, accounts: &CardanoAccount, index: u32) -> Result<BuiltTransaction> {
    tx.sign(
        accounts
            .private_key(Role::Receive, index)?
            .to_ed25519_private_key(),
    )
    .map_err(|e| anyhow!("failed to sign: {e:?}"))
}

pub fn chain(accounts: &CardanoAccount, sk: Scalar, request: ChainRequest) -> Result<ChainResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = Protocol::of(network_flag)?;
    let held = holdings(accounts, request.index, &request.utxos, &request.collateral)?;
    let spare: u64 = held.coins.iter().map(|c| c.lovelace).sum();
    let boxes = request
        .boxes
        .unwrap_or_else(|| lovejoin::boxes_affordable(spare, request.depth, protocol.denom));
    if boxes == 0 {
        bail!("The session's spare ADA doesn't pay for a Lovejoin box");
    }
    let base = Register::create(sk)?;
    let owners = (0..boxes)
        .map(|_| base.clone().rerandomize())
        .collect::<Result<Vec<_>>>()?;
    let pool: Vec<PoolBox> = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .filter(|b| !b.is_owned(&sk))
        .collect();
    let address = Address::from_bech32(&held.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let collateral = Coin::from_row(&held.collateral)?;

    let funding = lovejoin::Funding {
        coins: held.coins.clone(),
        collateral: collateral.clone(),
        address,
    };
    let built = lovejoin::chain(&params, &protocol, &funding, &owners, request.depth, &pool)?;

    // The return, last: the chain's change (not on chain yet), the
    // collateral, and any token UTxOs the chain left alone.
    let mut rows = vec![UtxoResponse {
        tx_hash: hex::encode(built.change.utxo.tx_hash),
        tx_index: built.change.utxo.index,
        address: held.address.clone(),
        value: built.change.lovelace.to_string(),
        ..Default::default()
    }];
    rows.push(held.collateral.clone());
    rows.extend(held.kept.iter().cloned());
    let key = accounts.key_hash(Role::Receive, request.index)?;
    let config = get_config(VARIANT, network_flag)?;
    let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
    let (back, back_fee) = build::external_sweep(&params, &rows, &base, &wallet, key)?;
    let returned: u64 = built.change.lovelace + collateral.lovelace - back_fee;

    let mut txs = Vec::with_capacity(built.txs.len() + 1);
    let mut fees = back_fee;
    for step in built.txs {
        fees += step.fee;
        let signed = sign(step.tx, accounts, request.index)?;
        txs.push(ChainTxOut {
            kind: step.kind.to_string(),
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            fee: step.fee.to_string(),
        });
    }
    let back = sign(back, accounts, request.index)?;
    txs.push(ChainTxOut {
        kind: "back".to_string(),
        tx_cbor: hex::encode(&back.tx_bytes.0),
        tx_hash: hex::encode(back.tx_hash.0),
        fee: back_fee.to_string(),
    });
    Ok(ChainResult {
        txs,
        boxes,
        depth: request.depth,
        fees: fees.to_string(),
        returned: returned.to_string(),
        leaves: built.leaves.iter().map(OutRef::of_box).collect(),
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OwnedRequest {
    pub network: String,
    pub pool: Vec<UtxoResponse>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OwnedResult {
    pub boxes: Vec<OutRef>,
    pub lovelace: String,
}

/// The wallet's boxes in the pool, wherever other people's mixes have moved
/// them: the Seedelf key's ownership check on each `{a, b}`.
pub fn owned(sk: Scalar, request: OwnedRequest) -> Result<OwnedResult> {
    let protocol = Protocol::of(network_flag(&request.network)?)?;
    let boxes: Vec<OutRef> = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .filter(|b| b.is_owned(&sk))
        .map(|b| OutRef::of_box(&b))
        .collect();
    Ok(OwnedResult {
        lovelace: (boxes.len() as u64 * protocol.denom).to_string(),
        boxes,
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawRequest {
    pub network: String,
    pub params: serde_json::Value,
    pub pool: Vec<UtxoResponse>,
    /// The box to take; the first of ours in the pool when absent.
    pub box_ref: Option<OutRef>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawResult {
    /// Unsigned: [`finish_withdraw`] adds giveme.my's signature.
    pub tx_cbor: String,
    pub tx_hash: String,
    pub fee: String,
    /// Into the new register.
    pub lovelace: String,
    pub box_ref: OutRef,
}

/// One of our boxes into a fresh register of the Seedelf key.
pub fn withdraw(sk: Scalar, request: WithdrawRequest) -> Result<WithdrawResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = Protocol::of(network_flag)?;
    let ours: Vec<PoolBox> = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .filter(|b| b.is_owned(&sk))
        .collect();
    let chosen = match &request.box_ref {
        Some(r) => ours
            .into_iter()
            .find(|b| OutRef::of_box(b) == *r)
            .context("That box isn't in the pool as this wallet's anymore")?,
        None => ours
            .into_iter()
            .next()
            .context("This wallet has no box in Lovejoin's pool")?,
    };
    let destination = Register::create(sk)?.rerandomize()?;
    let built = lovejoin::withdraw(
        &params,
        &protocol,
        std::slice::from_ref(&chosen),
        &sk,
        destination,
    )?;
    Ok(WithdrawResult {
        tx_cbor: hex::encode(&built.tx.tx_bytes.0),
        tx_hash: hex::encode(built.tx.tx_hash.0),
        fee: built.fee.to_string(),
        lovelace: built.lovelace.to_string(),
        box_ref: OutRef::of_box(&chosen),
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FinishRequest {
    pub tx_cbor: String,
    /// giveme.my's answer, `{ witness }`.
    pub collateral: serde_json::Value,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FinishResult {
    pub tx_cbor: String,
    pub tx_hash: String,
}

/// Adds giveme.my's collateral signature to a withdraw, after checking it
/// against giveme.my's key: the only witness a withdraw needs.
pub fn finish_withdraw(request: FinishRequest) -> Result<FinishResult> {
    finish_with_collateral_key(request, PublicKey::from(COLLATERAL_PUBLIC_KEY))
}

/// [`finish_withdraw`] against any collateral key, for tests.
pub fn finish_with_collateral_key(request: FinishRequest, key: PublicKey) -> Result<FinishResult> {
    let bytes =
        hex::decode(&request.tx_cbor).map_err(|e| anyhow!("the transaction isn't hex: {e}"))?;
    let hash = build::tx_id(&bytes)?;
    let signature = build::collateral_signature(&request.collateral)?;
    if !key.verify(hash, &Signature::from(signature)) {
        bail!("The collateral service's signature doesn't match this withdraw, so it wasn't sent");
    }
    let signed = build::add_witnesses(&bytes, &[(key, Signature::from(signature))])?;
    Ok(FinishResult {
        tx_cbor: hex::encode(signed),
        tx_hash: hex::encode(*hash),
    })
}
