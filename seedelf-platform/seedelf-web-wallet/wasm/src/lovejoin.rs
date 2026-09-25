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
//!    token UTxOs, merged into the Seedelf UTxO the session's funding made
//!    (`api::merged_return`), or into fresh registers when that's spent.
//!
//! Mixing the wallet's boxes again (`again`) is the same chain with no
//! deposit: the session's ADA pays for the mixes of boxes that are in the
//! pool already.
//!
//! The boxes come back later, each on its own ([`withdraw`]), paid from
//! themselves with giveme.my's collateral: nothing ties them to the session.

use crate::api;
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
    /// Its ADA-only UTxOs, the collateral aside, and their rows.
    coins: Vec<(Coin, UtxoResponse)>,
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
            coins.push((Coin::from_row(row)?, row.clone()));
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
    /// Mixing the wallet's boxes again: no deposit, so no box to pay for.
    #[serde(default)]
    pub again: bool,
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
    let spare: u64 = held.coins.iter().map(|(c, _)| c.lovelace).sum();
    let boxes = if request.again {
        // The mixes pay from one UTxO, the largest ([`chain`]).
        let largest = held.coins.iter().map(|(c, _)| c.lovelace).max();
        lovejoin::again_affordable(largest.unwrap_or(0), request.depth)
    } else {
        lovejoin::boxes_affordable(spare, request.depth, protocol.denom)
    };
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
    /// The funding's Seedelf change the return merges into
    /// (`api::SessionReturnRequest::merge`).
    #[serde(default)]
    pub merge: Vec<UtxoResponse>,
    /// Mix the wallet's own boxes in `pool` again (at most `boxes` of them)
    /// rather than deposit new ones: the session's largest ADA UTxO pays the
    /// first mix, and its other ADA UTxOs come back with the return.
    #[serde(default)]
    pub again: bool,
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
    /// What the return brings back at once: the last change, the collateral
    /// and the token UTxOs' ADA, less its fee. A public account's chain has no
    /// return: this is the change that stays in the account.
    pub returned: String,
    /// The tokens it brings back with them.
    pub tokens: Vec<api::TokenAmount>,
    /// How many of the funding's Seedelf UTxOs the return merged into.
    pub merged: usize,
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
    let spare: u64 = held.coins.iter().map(|(c, _)| c.lovelace).sum();
    let (ours, pool): (Vec<PoolBox>, Vec<PoolBox>) = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .partition(|b| b.is_owned(&sk));
    let address = Address::from_bech32(&held.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let collateral = Coin::from_row(&held.collateral)?;

    // The ADA-only UTxOs the chain doesn't spend: they come back with the return.
    let mut unused: Vec<UtxoResponse> = Vec::new();
    let (built, boxes) = if request.again {
        let mut coins = held.coins.clone();
        coins.sort_by_key(|(c, _)| std::cmp::Reverse(c.lovelace));
        let mut coins = coins.into_iter();
        let (fee, _) = coins
            .next()
            .context("The session holds no ADA to pay for the mixes")?;
        unused.extend(coins.map(|(_, row)| row));
        let boxes = request
            .boxes
            .unwrap_or_else(|| lovejoin::again_affordable(fee.lovelace, request.depth))
            .min(ours.len());
        if boxes == 0 {
            bail!("None of this wallet's boxes is in Lovejoin's pool to mix again");
        }
        let payer = lovejoin::Payer {
            fee,
            collateral,
            address,
            signers: 1,
        };
        let built = lovejoin::again(
            &params,
            &protocol,
            &payer,
            &ours[..boxes],
            request.depth,
            &pool,
        )?;
        (built, boxes)
    } else {
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
        let funding = lovejoin::Funding {
            coins: held.coins.iter().map(|(c, _)| c.clone()).collect(),
            collateral,
            address,
            deposit_signers: 1,
            mix_signers: 1,
        };
        let built = lovejoin::chain(&params, &protocol, &funding, &owners, request.depth, &pool)?;
        (built, boxes)
    };

    // The return, last: the chain's change (not on chain yet), the
    // collateral, any ADA UTxOs the chain left alone and any token UTxOs.
    // Merged into the funding's change when it's still there, under the
    // collateral it spends too; into new registers otherwise.
    let mut rows = vec![UtxoResponse {
        tx_hash: hex::encode(built.change.utxo.tx_hash),
        tx_index: built.change.utxo.index,
        address: held.address.clone(),
        value: built.change.lovelace.to_string(),
        ..Default::default()
    }];
    rows.push(held.collateral.clone());
    rows.extend(unused);
    rows.extend(held.kept.iter().cloned());
    let (total, tokens) = seedelf_core::utxos::assets_of(rows.clone())?;
    let (back, back_fee) = if request.merge.is_empty() {
        let key = accounts.key_hash(Role::Receive, request.index)?;
        let config = get_config(VARIANT, network_flag)?;
        let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
        let base = Register::create(sk)?;
        let (tx, fee) = build::external_sweep(&params, &rows, &base, &wallet, key)?;
        (sign(tx, accounts, request.index)?, fee)
    } else {
        let chain = build::Chain {
            params: params.clone(),
            network_flag,
            config: get_config(VARIANT, network_flag)?,
        };
        let (signed, spend) = api::merged_return(
            accounts,
            sk,
            &chain,
            request.index,
            &rows,
            &held.collateral,
            &request.merge,
            std::slice::from_ref(&built.change.utxo),
        )?;
        (signed, spend.fee.total)
    };
    let returned: u64 = total - back_fee;

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
        tokens: tokens
            .items
            .iter()
            .map(|a| api::TokenAmount {
                policy_id: hex::encode(a.policy_id),
                asset_name: hex::encode(&a.token_name),
                quantity: a.amount.to_string(),
            })
            .collect(),
        merged: request.merge.len(),
        leaves: built.leaves.iter().map(OutRef::of_box).collect(),
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FundingRequest {
    pub network: String,
    pub boxes: usize,
    pub depth: u32,
    /// Mixing the wallet's boxes again: the mixes alone, no box to pay for.
    #[serde(default)]
    pub again: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FundingResult {
    /// What pays for the boxes and their chain: a one-time account is
    /// funded with this (and its own collateral besides).
    pub lovelace: String,
    pub mixes: usize,
    /// About what the mixes cost, all boxes together.
    pub mix_fees: String,
}

fn check_mix(boxes: usize, depth: u32) -> Result<()> {
    if boxes == 0 {
        bail!("Mix at least one box");
    }
    if !(1..=3).contains(&depth) {
        bail!("The fan-out is 1 to 3 waves deep");
    }
    Ok(())
}

/// What mixing `boxes` boxes at `depth` takes, before anything is built:
/// the boxes, every mix of their fan-out, and the deposit and its change; or,
/// `again`, every mix alone. What the mixes don't use comes back.
pub fn funding(request: FundingRequest) -> Result<FundingResult> {
    let protocol = Protocol::of(network_flag(&request.network)?)?;
    check_mix(request.boxes, request.depth)?;
    let mixes = request.boxes * lovejoin::mixes_per_box(request.depth);
    let lovelace = if request.again {
        lovejoin::again_funding(request.boxes, request.depth)
    } else {
        lovejoin::funding_for(request.boxes, request.depth, protocol.denom)
    };
    Ok(FundingResult {
        lovelace: lovelace.to_string(),
        mixes,
        mix_fees: (mixes as u64 * lovejoin::MIX_FEE_ESTIMATE).to_string(),
    })
}

/// A chain paid by the public account (the Lovejoin tile's "from your public
/// account"), as JSON from the extension.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountChainRequest {
    pub network: String,
    /// One row of Koios's `epoch_params`.
    pub params: serde_json::Value,
    /// The public account's spendable UTxOs, each with its key's path.
    pub utxos: Vec<api::PathedUtxo>,
    /// Its collateral, with its path: every mix puts it up.
    pub collateral: api::PathedUtxo,
    /// The boxes at `mix_box`, less any a sent transaction of ours spends.
    pub pool: Vec<UtxoResponse>,
    pub depth: u32,
    pub boxes: usize,
}

/// `boxes` boxes from the public account straight into Lovejoin: the
/// deposit from as few of its ADA-only UTxOs as pay for them (largest first),
/// then each box fanned out, every mix paid from the one before's change at
/// the account's `0/0` and put up against its collateral. The last change
/// stays in the public account (`returned`); there's no return. Signed here:
/// the deposit by its inputs' keys, each mix by the change's and the
/// collateral's.
pub fn chain_from_account(
    account: &CardanoAccount,
    sk: Scalar,
    request: AccountChainRequest,
) -> Result<ChainResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = Protocol::of(network_flag)?;
    check_mix(request.boxes, request.depth)?;
    let mut every = request.utxos.clone();
    every.push(request.collateral.clone());
    let paths = api::check_paths(account, network_flag, &every)?;
    let collateral_ref = (
        request.collateral.utxo.tx_hash.clone(),
        request.collateral.utxo.tx_index,
    );
    let collateral = Coin::from_row(&request.collateral.utxo)?;

    // As few ADA-only UTxOs as pay for the boxes, the largest first.
    let needed = lovejoin::funding_for(request.boxes, request.depth, protocol.denom);
    let lovelace = |p: &api::PathedUtxo| p.utxo.value.parse::<u64>().unwrap_or(0);
    let mut ada: Vec<&api::PathedUtxo> = request
        .utxos
        .iter()
        .filter(|p| p.utxo.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|p| (p.utxo.tx_hash.clone(), p.utxo.tx_index) != collateral_ref)
        .collect();
    ada.sort_by_key(|p| std::cmp::Reverse(lovelace(p)));
    let mut picked: Vec<&UtxoResponse> = Vec::new();
    let mut total = 0u64;
    for p in ada {
        if total >= needed {
            break;
        }
        total += lovelace(p);
        picked.push(&p.utxo);
    }
    if total < needed {
        bail!(
            "Your public account's ADA doesn't pay for {}: that takes {} ₳ in UTxOs of ADA alone, besides the collateral",
            if request.boxes == 1 {
                "a box of 10 ₳ and its mixes".to_string()
            } else {
                format!("{} boxes of 10 ₳ and their mixes", request.boxes)
            },
            needed.div_ceil(1_000_000)
        );
    }
    let coins = picked
        .iter()
        .map(|u| Coin::from_row(u))
        .collect::<Result<Vec<_>>>()?;
    let path_of = |u: &UtxoResponse| paths[&(u.tx_hash.clone(), u.tx_index)];
    let mut deposit_keys: Vec<(Role, u32)> = picked.iter().map(|u| path_of(u)).collect();
    deposit_keys.sort_by_key(|(role, index)| (*role as u32, *index));
    deposit_keys.dedup();
    let change_key = (Role::Receive, 0);
    let collateral_key = path_of(&request.collateral.utxo);
    let mut mix_keys = vec![change_key];
    if collateral_key != change_key {
        mix_keys.push(collateral_key);
    }

    let base = Register::create(sk)?;
    let owners = (0..request.boxes)
        .map(|_| base.clone().rerandomize())
        .collect::<Result<Vec<_>>>()?;
    let pool: Vec<PoolBox> = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .filter(|b| !b.is_owned(&sk))
        .collect();
    let funding = lovejoin::Funding {
        coins,
        collateral,
        address: account.base_address(network_flag, Role::Receive, 0)?,
        deposit_signers: deposit_keys.len(),
        mix_signers: mix_keys.len(),
    };
    let built = lovejoin::chain(&params, &protocol, &funding, &owners, request.depth, &pool)?;

    let sign_with = |tx: BuiltTransaction, keys: &[(Role, u32)]| -> Result<BuiltTransaction> {
        let mut signed = tx;
        for (role, index) in keys {
            signed = signed
                .sign(account.private_key(*role, *index)?.to_ed25519_private_key())
                .map_err(|e| anyhow!("failed to sign: {e:?}"))?;
        }
        Ok(signed)
    };
    let mut txs = Vec::with_capacity(built.txs.len());
    let mut fees = 0u64;
    for step in built.txs {
        fees += step.fee;
        let keys = if step.kind == "deposit" {
            &deposit_keys
        } else {
            &mix_keys
        };
        let signed = sign_with(step.tx, keys)?;
        txs.push(ChainTxOut {
            kind: step.kind.to_string(),
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            fee: step.fee.to_string(),
        });
    }
    Ok(ChainResult {
        txs,
        boxes: request.boxes,
        depth: request.depth,
        fees: fees.to_string(),
        returned: built.change.lovelace.to_string(),
        tokens: Vec::new(),
        merged: 0,
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
