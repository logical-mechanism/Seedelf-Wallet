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
//!
//! A token pool (Lovejoin's PR #163) is named by a [`PoolRef`]: what the
//! worker found of it on chain. It's verified here on every call, from the
//! bundled templates ([`protocol_of`]); a request without one is the classic
//! pool, exactly as before.

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
use seedelf_core::lovejoin::{self, Coin, PoolBox, PoolShort, Protocol, Version};
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

/// A token pool as the worker found it on chain: its reference UTxO at the
/// holder (the NFT and the datum), the seed its launch spent, and any rows
/// at the holder that may carry its scripts as reference scripts.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PoolRef {
    pub reference: UtxoResponse,
    pub seed: OutRef,
    #[serde(default)]
    pub scripts: Vec<UtxoResponse>,
}

/// The classic pool, or the token pool `pool` names, which is trusted only
/// once its scripts are derived from its seed and match its datum
/// (`lovejoin::verify_pool`). A script row is taken only when its bytes are
/// a Plutus V3 script; `verify_pool` reads a script by reference only from
/// the holder, and only the one it derived.
pub fn protocol_of(network_flag: bool, pool: Option<&PoolRef>) -> Result<Protocol> {
    let Some(pool) = pool else {
        return Protocol::of(network_flag);
    };
    let reference = seedelf_core::eval::resolve_row(&pool.reference)?;
    let mut scripts = Vec::new();
    for row in &pool.scripts {
        let Some(script) = &row.reference_script else {
            continue;
        };
        let (Some("plutusV3"), Some(bytes)) = (script.kind.as_deref(), script.bytes.as_deref())
        else {
            continue;
        };
        let bytes = hex::decode(bytes).map_err(|e| {
            anyhow!(
                "UTxO {}#{}'s script isn't hex: {e}",
                row.tx_hash,
                row.tx_index
            )
        })?;
        scripts.push(seedelf_core::eval::resolve_reference(row, 3, &bytes)?);
    }
    let seed: [u8; 32] = hex::decode(&pool.seed.tx_hash)?
        .try_into()
        .map_err(|_| anyhow!("The seed's transaction hash isn't 32 bytes"))?;
    lovejoin::verify_pool(
        network_flag,
        &reference,
        (seed, pool.seed.tx_index),
        &scripts,
    )
    .map_err(|e| anyhow!("{e}"))
}

fn token_amount(token: &lovejoin::BoxToken, quantity: u64) -> api::TokenAmount {
    api::TokenAmount {
        policy_id: hex::encode(token.policy),
        asset_name: hex::encode(&token.name),
        quantity: quantity.to_string(),
    }
}

/// A pool, as the worker records and shows it.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PoolView {
    /// Its NFT's policy, P: the pool's id.
    pub id: String,
    /// `classic` or `tokenV1`.
    pub version: String,
    pub box_lovelace: String,
    /// What a box holds besides its ADA; absent in the classic pool.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
    pub max_fee: String,
    pub mix_box_hash: String,
    pub mix_logic_hash: String,
    pub fee_hash: String,
    /// How many of its two scripts every transaction carries, for want of a
    /// reference at the holder: they cost about 0.12 ₳ a transaction more.
    pub scripts_inline: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<OutRef>,
    /// Its reference UTxO.
    pub reference: OutRef,
}

impl PoolView {
    pub fn of(pool: &Protocol) -> Result<Self> {
        let reference = pool
            .references
            .first()
            .context("A pool without its reference UTxO")?;
        Ok(PoolView {
            id: hex::encode(pool.id),
            version: match pool.version {
                Version::Classic => "classic",
                Version::TokenV1 => "tokenV1",
            }
            .to_string(),
            box_lovelace: pool.denom.to_string(),
            token: pool.token.as_ref().map(|t| token_amount(t, t.quantity)),
            max_fee: pool.max_fee.to_string(),
            mix_box_hash: hex::encode(pool.mix_box_hash),
            mix_logic_hash: hex::encode(pool.mix_logic_hash),
            fee_hash: hex::encode(pool.fee_hash),
            scripts_inline: pool.inline_scripts.len(),
            seed: pool.seed.map(|(tx, index)| OutRef {
                tx_hash: hex::encode(tx),
                tx_index: index,
            }),
            reference: OutRef {
                tx_hash: hex::encode(reference.tx_hash),
                tx_index: reference.index,
            },
        })
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VerifyPoolRequest {
    pub network: String,
    pub pool: PoolRef,
}

/// A pool found on chain, verified: what it is, or why it isn't one the
/// wallet reads.
pub fn verify_pool(request: VerifyPoolRequest) -> Result<PoolView> {
    PoolView::of(&protocol_of(
        network_flag(&request.network)?,
        Some(&request.pool),
    )?)
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsableRequest {
    pub network: String,
    /// One row of Koios's `epoch_params`.
    pub params: serde_json::Value,
    /// The classic pool when absent.
    #[serde(default)]
    pub pool_ref: Option<PoolRef>,
    /// Whether the pool's `mix_logic` credential is registered (one
    /// `account_info` for every pool).
    pub registered: bool,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsableResult {
    pub usable: bool,
    /// Why not: `notRegistered`, `belowMinimum`, `cantComeBack` or
    /// `unchecked`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// What a box holds, and what the ledger asks, when that's why.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub box_minimum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub withdraw_fee: Option<String>,
    /// What a box brings back into the Seedelf, its token aside.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub back: Option<String>,
}

/// Whether a verified pool can take a new mix under today's parameters
/// (`lovejoin::usable`). A pool that can't is still read: its boxes stay in
/// view, and still come back.
pub fn usable(request: UsableRequest) -> Result<UsableResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let pool = protocol_of(network_flag, request.pool_ref.as_ref())?;
    Ok(match lovejoin::usable(&params, &pool, request.registered) {
        Ok(u) => UsableResult {
            usable: true,
            box_minimum: Some(u.box_minimum.to_string()),
            withdraw_fee: Some(u.withdraw_fee.to_string()),
            back: Some(u.back.to_string()),
            ..Default::default()
        },
        Err(why) => {
            let (kind, has, needs) = match &why {
                lovejoin::Unusable::NotRegistered => ("notRegistered", None, None),
                lovejoin::Unusable::BelowMinimum { has, needs } => {
                    ("belowMinimum", Some(*has), Some(*needs))
                }
                lovejoin::Unusable::CantComeBack { has, needs } => {
                    ("cantComeBack", Some(*has), Some(*needs))
                }
                lovejoin::Unusable::Unchecked(_) => ("unchecked", None, None),
            };
            UsableResult {
                usable: false,
                why: Some(kind.to_string()),
                has: has.map(|h| h.to_string()),
                needs: needs.map(|n| n.to_string()),
                detail: Some(why.to_string()),
                ..Default::default()
            }
        }
    })
}

/// What a session holds, split for its chain.
struct Holdings {
    address: String,
    /// Its ADA-only UTxOs, the collateral aside, and their rows.
    coins: Vec<(Coin, UtxoResponse)>,
    collateral: UtxoResponse,
    /// What comes back with the return: its token UTxOs, and any the
    /// evaluator can't take.
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
        // An ADA-only UTxO the evaluator can't take (a stranger's, carrying
        // a reference script) can't pay a mix: it comes back with the return.
        if collateral.is(row) {
            found = Some(row.clone());
        } else if row.asset_list.as_ref().is_none_or(|a| a.is_empty())
            && seedelf_core::eval::refusal(row).is_none()
        {
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
    /// The session's own transactions (`api::SessionReturnRequest::own`).
    #[serde(default)]
    pub own: Vec<String>,
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
    /// The session's UTxOs the return leaves at its account, for a later
    /// return (`api::SessionReturnResult::left_out`).
    pub left_out: Vec<api::LeftOut>,
    /// Why nothing was built: Lovejoin's pool has too few boxes to mix with
    /// (anyone can leave a UTxO at `mix_box` that isn't a box, and only boxes
    /// count). The return then comes back directly. Absent when built.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

impl ChainResult {
    /// A chain the pool can't supply: nothing built, and why.
    fn skipped(depth: u32, short: &PoolShort) -> Self {
        ChainResult {
            txs: Vec::new(),
            boxes: 0,
            depth,
            fees: "0".to_string(),
            returned: "0".to_string(),
            tokens: Vec::new(),
            merged: 0,
            leaves: Vec::new(),
            left_out: Vec::new(),
            skipped: Some(short.to_string()),
        }
    }
}

fn sign(tx: BuiltTransaction, accounts: &CardanoAccount, index: u32) -> Result<BuiltTransaction> {
    tx.sign(
        accounts
            .private_key(Role::Receive, index)?
            .to_ed25519_private_key(),
    )
    .map_err(|e| anyhow!("failed to sign: {e:?}"))
}

/// Session `request.index`'s chain through Lovejoin and its return, each
/// transaction signed. When the pool's boxes (only the rows `PoolBox::from_row`
/// takes) are too few for it, nothing is built: the result says why
/// (`skipped`), so the worker brings the session back directly.
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
    let fanned = if request.again {
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
            collateral: Some(collateral),
            address,
            signers: 1,
        };
        lovejoin::again(
            &params,
            &protocol,
            &payer,
            &ours[..boxes],
            request.depth,
            &pool,
        )
        .map(|built| (built, boxes))
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
            collateral: Some(collateral),
            address,
            deposit_signers: 1,
            mix_signers: 1,
        };
        lovejoin::chain(&params, &protocol, &funding, &owners, request.depth, &pool)
            .map(|built| (built, boxes))
    };
    let (built, boxes) = match fanned {
        Err(e) => match e.downcast_ref::<PoolShort>() {
            Some(short) => return Ok(ChainResult::skipped(request.depth, short)),
            None => return Err(e),
        },
        Ok(fanned) => fanned,
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
    // What the return takes by cost (independent review H1, H2): the chain's
    // change and the session's own and ADA-only UTxOs first, a stranger's
    // token UTxO only when it pays its own way. The rest waits for a later
    // return, or stays.
    let mut own = request.own.clone();
    own.push(rows[0].tx_hash.clone());
    let plan = api::plan_return(&params, &rows, &request.merge, &own)?;
    let ((back, back_fee), plan) = api::built_or_without_strangers(plan, |plan| {
        if !plan.merged {
            let key = accounts.key_hash(Role::Receive, request.index)?;
            let config = get_config(VARIANT, network_flag)?;
            let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
            let base = Register::create(sk)?;
            let (tx, fee) = build::external_sweep(&params, &plan.taken, &base, &wallet, key)?;
            Ok((sign(tx, accounts, request.index)?, fee))
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
                &plan.taken,
                &held.collateral,
                &request.merge,
                std::slice::from_ref(&built.change.utxo),
            )?;
            Ok((signed, spend.fee.total))
        }
    })?;
    let (total, tokens) = seedelf_core::utxos::assets_of(plan.taken.clone())?;
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
        merged: if plan.merged { request.merge.len() } else { 0 },
        leaves: built.leaves.iter().map(OutRef::of_box).collect(),
        left_out: plan.left_out,
        skipped: None,
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
    check_depth(boxes, depth, 1)
}

/// A chain that deposits may also be a seed (depth 0): the deposit alone,
/// with no mixes. It needs no other boxes, so it's the only thing that works
/// on an empty pool, and it hides nothing of its own. Mixing boxes already in
/// the pool has no deposit, so it still needs a wave at least.
fn check_deposit(boxes: usize, depth: u32) -> Result<()> {
    check_depth(boxes, depth, 0)
}

fn check_depth(boxes: usize, depth: u32, least: u32) -> Result<()> {
    if boxes == 0 {
        bail!("Mix at least one box");
    }
    if !(least..=3).contains(&depth) {
        bail!("The fan-out is {least} to 3 waves deep");
    }
    Ok(())
}

/// What mixing `boxes` boxes at `depth` takes, before anything is built:
/// the boxes, every mix of their fan-out, and the deposit and its change; or,
/// `again`, every mix alone. What the mixes don't use comes back.
pub fn funding(request: FundingRequest) -> Result<FundingResult> {
    let protocol = Protocol::of(network_flag(&request.network)?)?;
    if request.again {
        check_mix(request.boxes, request.depth)?;
    } else {
        check_deposit(request.boxes, request.depth)?;
    }
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
    /// Its collateral, with its path: every mix puts it up. A seed (depth 0)
    /// makes no mixes, so it spends no script and needs none.
    pub collateral: Option<api::PathedUtxo>,
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
    check_deposit(request.boxes, request.depth)?;
    // Only a mix puts collateral up. A seed is the deposit alone, which spends
    // no script, so it asks for none and spends the account as it is.
    if request.depth > 0 && request.collateral.is_none() {
        bail!("Lovejoin's mixes need the public account's collateral");
    }
    let mut every = request.utxos.clone();
    if let Some(c) = &request.collateral {
        every.push(c.clone());
    }
    let paths = api::check_paths(account, network_flag, &every)?;
    let collateral_ref = request
        .collateral
        .as_ref()
        .map(|c| (c.utxo.tx_hash.clone(), c.utxo.tx_index));

    // As few ADA-only UTxOs as pay for the boxes, the largest first.
    let needed = lovejoin::funding_for(request.boxes, request.depth, protocol.denom);
    let lovelace = |p: &api::PathedUtxo| p.utxo.value.parse::<u64>().unwrap_or(0);
    // Never one the evaluator can't take: one carrying a reference script.
    let mut ada: Vec<&api::PathedUtxo> = request
        .utxos
        .iter()
        .filter(|p| p.utxo.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|p| seedelf_core::eval::refusal(&p.utxo).is_none())
        .filter(|p| collateral_ref.as_ref() != Some(&(p.utxo.tx_hash.clone(), p.utxo.tx_index)))
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
    let mut mix_keys = vec![change_key];
    if let Some(c) = &request.collateral {
        let collateral_key = path_of(&c.utxo);
        if collateral_key != change_key {
            mix_keys.push(collateral_key);
        }
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
        // None only at depth 0, where `chain` makes no mixes and so never
        // reads it: `fan_out`'s loop doesn't run, and only `mix` puts it up.
        collateral: match &request.collateral {
            Some(c) => Some(Coin::from_row(&c.utxo)?),
            None => None,
        },
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
        left_out: Vec::new(),
        skipped: None,
    })
}

/// The wallet's boxes in `pool` mixed again, paid by the public account
/// (the Lovejoin page's "Mix again from my public account", privacy review
/// §2.10): for boxes a mix from the account put in, which it paid for in the
/// open already, so paying again ties nothing new, where the private
/// balance would tie itself to the account. The same chain as a mix
/// session's again ([`chain`]), with no deposit and no return: its first mix
/// spends the account's largest ADA-only UTxO (never the collateral, nor one
/// carrying a reference script) and takes `boxes` of the wallet's boxes in
/// `pool`'s order, each mix after it paid from the one before's change at
/// the account's `0/0`, all put up against its collateral. The last change
/// stays in the account (`returned`). Signed here: the first mix by the
/// paying UTxO's key and the collateral's, the rest by the change's and the
/// collateral's.
pub fn again_from_account(
    account: &CardanoAccount,
    sk: Scalar,
    request: AccountChainRequest,
) -> Result<ChainResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = Protocol::of(network_flag)?;
    check_mix(request.boxes, request.depth)?;
    // This one only ever mixes (no deposit), so it always needs collateral.
    let put_up = request
        .collateral
        .as_ref()
        .context("Lovejoin's mixes need the public account's collateral")?;
    let mut every = request.utxos.clone();
    every.push(put_up.clone());
    let paths = api::check_paths(account, network_flag, &every)?;
    let collateral_ref = (put_up.utxo.tx_hash.clone(), put_up.utxo.tx_index);
    let collateral = Coin::from_row(&put_up.utxo)?;
    let (ours, pool): (Vec<PoolBox>, Vec<PoolBox>) = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .partition(|b| b.is_owned(&sk));
    let boxes = request.boxes.min(ours.len());
    if boxes == 0 {
        bail!("None of this wallet's boxes is in Lovejoin's pool to mix again");
    }

    // One UTxO pays for every mix: the largest of ADA alone.
    let needed = lovejoin::again_funding(boxes, request.depth);
    let lovelace = |p: &api::PathedUtxo| p.utxo.value.parse::<u64>().unwrap_or(0);
    let paying = request
        .utxos
        .iter()
        .filter(|p| p.utxo.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|p| seedelf_core::eval::refusal(&p.utxo).is_none())
        .filter(|p| (p.utxo.tx_hash.clone(), p.utxo.tx_index) != collateral_ref)
        .max_by_key(|p| lovelace(p));
    let Some(paying) = paying.filter(|p| lovelace(p) >= needed) else {
        bail!(
            "Your public account's ADA doesn't pay for mixing {} again: that takes {} ₳ in one UTxO of ADA alone, besides the collateral",
            if boxes == 1 {
                "a box".to_string()
            } else {
                format!("{boxes} boxes")
            },
            needed.div_ceil(1_000_000)
        );
    };
    let path_of = |u: &UtxoResponse| paths[&(u.tx_hash.clone(), u.tx_index)];
    let collateral_key = path_of(&put_up.utxo);
    let keys = |first: (Role, u32)| {
        let mut keys = vec![first];
        if collateral_key != first {
            keys.push(collateral_key);
        }
        keys
    };
    let first_keys = keys(path_of(&paying.utxo));
    let mix_keys = keys((Role::Receive, 0));
    let payer = lovejoin::Payer {
        fee: Coin::from_row(&paying.utxo)?,
        collateral: Some(collateral),
        address: account.base_address(network_flag, Role::Receive, 0)?,
        signers: first_keys.len().max(mix_keys.len()),
    };
    let built = lovejoin::again(
        &params,
        &protocol,
        &payer,
        &ours[..boxes],
        request.depth,
        &pool,
    )?;

    let mut txs = Vec::with_capacity(built.txs.len());
    let mut fees = 0u64;
    for (i, step) in built.txs.into_iter().enumerate() {
        fees += step.fee;
        let mut signed = step.tx;
        for (role, index) in if i == 0 { &first_keys } else { &mix_keys } {
            signed = signed
                .sign(account.private_key(*role, *index)?.to_ed25519_private_key())
                .map_err(|e| anyhow!("failed to sign: {e:?}"))?;
        }
        txs.push(ChainTxOut {
            kind: step.kind.to_string(),
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            fee: step.fee.to_string(),
        });
    }
    Ok(ChainResult {
        txs,
        boxes,
        depth: request.depth,
        fees: fees.to_string(),
        returned: built.change.lovelace.to_string(),
        tokens: Vec::new(),
        merged: 0,
        leaves: built.leaves.iter().map(OutRef::of_box).collect(),
        left_out: Vec::new(),
        skipped: None,
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OwnedRequest {
    pub network: String,
    pub pool: Vec<UtxoResponse>,
}

/// The pool a request names beside its own fields, `poolRef`: the token
/// pool its rows are of, or the classic pool when absent. Read from the
/// request's JSON on its own, so the request itself is read as ever: serde's
/// `flatten` would buffer every field, a stranger's deeply nested datum too,
/// past serde_json's depth limit, where skipping it costs nothing.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PoolNamed {
    #[serde(default)]
    pub pool_ref: Option<PoolRef>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OwnedResult {
    pub boxes: Vec<OutRef>,
    pub lovelace: String,
    /// How many of the pool's boxes aren't ours: what a mix may take. Only
    /// rows that are boxes count (`PoolBox::from_row`), never what else sits
    /// at `mix_box`, so a count made from it matches what a chain can draw.
    pub others: usize,
    /// Those boxes.
    pub other_boxes: Vec<OutRef>,
    /// A token pool's token, all the wallet's boxes together.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
}

/// The wallet's boxes in the pool, wherever other people's mixes have moved
/// them: the Seedelf key's ownership check on each `{a, b}`. And the pool's
/// other boxes, the ones a mix may take.
pub fn owned(sk: Scalar, request: OwnedRequest) -> Result<OwnedResult> {
    owned_in(sk, request, None)
}

/// [`owned`] in the token pool `pool` names, or the classic pool.
pub fn owned_in(sk: Scalar, request: OwnedRequest, pool: Option<&PoolRef>) -> Result<OwnedResult> {
    let protocol = protocol_of(network_flag(&request.network)?, pool)?;
    let (ours, others): (Vec<PoolBox>, Vec<PoolBox>) = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .partition(|b| b.is_owned(&sk));
    let boxes: Vec<OutRef> = ours.iter().map(OutRef::of_box).collect();
    Ok(OwnedResult {
        lovelace: (boxes.len() as u64 * protocol.denom).to_string(),
        boxes,
        others: others.len(),
        other_boxes: others.iter().map(OutRef::of_box).collect(),
        token: protocol
            .box_value()
            .token_total(ours.len())?
            .map(|(t, q)| token_amount(&t, q)),
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
    /// A token pool's token, into the same register.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
}

/// One of our boxes into a fresh register of the Seedelf key.
pub fn withdraw(sk: Scalar, request: WithdrawRequest) -> Result<WithdrawResult> {
    withdraw_in(sk, request, None)
}

/// [`withdraw`] from the token pool `pool` names, or the classic pool.
pub fn withdraw_in(
    sk: Scalar,
    request: WithdrawRequest,
    pool: Option<&PoolRef>,
) -> Result<WithdrawResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = protocol_of(network_flag, pool)?;
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
        token: built.token.as_ref().map(|(t, q)| token_amount(t, *q)),
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
