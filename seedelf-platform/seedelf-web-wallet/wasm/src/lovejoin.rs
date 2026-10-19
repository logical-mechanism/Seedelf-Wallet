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
use seedelf_core::lovejoin::{self, Coin, Holding, PoolBox, PoolShort, Protocol, Version};
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
    let seed: [u8; 32] = hex::decode(&pool.seed.tx_hash)?
        .try_into()
        .map_err(|_| anyhow!("The seed's transaction hash isn't 32 bytes"))?;
    let mut derived = None;
    let mut scripts = Vec::new();
    for row in &pool.scripts {
        let Some(script) = &row.reference_script else {
            continue;
        };
        let bytes = match (
            script.kind.as_deref(),
            script.bytes.as_deref(),
            script.hash.as_deref(),
        ) {
            (Some("plutusV3"), Some(bytes), _) => hex::decode(bytes).map_err(|e| {
                anyhow!(
                    "UTxO {}#{}'s script isn't hex: {e}",
                    row.tx_hash,
                    row.tx_index
                )
            })?,
            // Named by its hash alone, as the data layer's pool list names a
            // pool's scripts: the bytes are the ones derived here, if they
            // hash to it. `verify_pool` then checks them as any others.
            (Some("plutusV3") | None, None, Some(hash)) => {
                let derived = match &mut derived {
                    Some(d) => d,
                    none => none.insert(
                        lovejoin::templates::derive(&seed, pool.seed.tx_index)
                            .map_err(|e| anyhow!("{e}"))?,
                    ),
                };
                let Some(found) = [&derived.mix_box, &derived.mix_logic]
                    .into_iter()
                    .find(|s| hex::encode(s.hash) == hash)
                else {
                    continue;
                };
                found.cbor.clone()
            }
            _ => continue,
        };
        scripts.push(seedelf_core::eval::resolve_reference(row, 3, &bytes)?);
    }
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

/// Lovelace as ADA for a message: whole when it is ("10"), else with the
/// decimals it needs ("4.5").
fn format_ada(lovelace: u64) -> String {
    let whole = lovelace / 1_000_000;
    let rest = lovelace % 1_000_000;
    if rest == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{}", format!("{rest:06}").trim_end_matches('0'))
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
pub struct CandidateRequest {
    pub network: String,
    /// A row at the holder.
    pub reference: UtxoResponse,
}

/// What a candidate at the holder says it is, before anything proves it
/// (`lovejoin::candidate`): enough to tell whether its launch is worth
/// asking about, which costs a request.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CandidateView {
    /// Its NFT's policy: the pool's id, if it's genuine.
    pub id: String,
    pub box_lovelace: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
    /// The scripts its datum names, unproven: a standard launch puts both at
    /// the holder in its own transaction, which is checked before asking.
    pub mix_box_hash: String,
    pub mix_logic_hash: String,
}

/// The cheap checks of a candidate at the holder, offline: its shape and its
/// datum, and that it isn't a 10 ₳ ADA pool. Why not, if it fails them.
pub fn candidate(request: CandidateRequest) -> Result<CandidateView> {
    let reference = seedelf_core::eval::resolve_row(&request.reference)?;
    let (id, datum) = lovejoin::candidate(network_flag(&request.network)?, &reference)
        .map_err(|e| anyhow!("{e}"))?;
    Ok(CandidateView {
        id: hex::encode(id),
        box_lovelace: datum.box_value.lovelace.to_string(),
        token: datum
            .box_value
            .token
            .as_ref()
            .map(|t| token_amount(t, t.quantity)),
        mix_box_hash: hex::encode(datum.mix_box_hash),
        mix_logic_hash: hex::encode(datum.mix_logic_hash),
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCheckRequest {
    pub network: String,
    /// The candidate's row at the holder.
    pub reference: UtxoResponse,
    /// What the transaction that made it spent: one is its seed.
    pub inputs: Vec<OutRef>,
    /// That transaction's outputs at the holder.
    #[serde(default)]
    pub scripts: Vec<UtxoResponse>,
}

/// A genuine pool, and what its launch must have registered.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCheck {
    pub pool: PoolView,
    /// L's reward account (bech32): a standard launch registers it.
    pub mix_logic_stake: String,
}

/// A candidate checked against its launch: the seed found among its inputs,
/// its scripts derived and matched, those its outputs at the holder carry
/// read by reference (`PoolView::scripts_inline` says how many weren't).
/// Why not, if it isn't a genuine pool.
pub fn launch_check(request: LaunchCheckRequest) -> Result<LaunchCheck> {
    let flag = network_flag(&request.network)?;
    let reference = seedelf_core::eval::resolve_row(&request.reference)?;
    let (policy, _) = lovejoin::candidate(flag, &reference).map_err(|e| anyhow!("{e}"))?;
    let inputs = request
        .inputs
        .iter()
        .map(|i| {
            let tx: [u8; 32] = hex::decode(&i.tx_hash)?
                .try_into()
                .map_err(|_| anyhow!("An input's transaction hash isn't 32 bytes"))?;
            Ok((tx, i.tx_index))
        })
        .collect::<Result<Vec<_>>>()?;
    let (tx, index) = lovejoin::find_seed(&policy, &inputs)
        .context("None of its launch's inputs makes its NFT, so it can't be proven genuine")?;
    let pool = PoolRef {
        reference: request.reference,
        seed: OutRef {
            tx_hash: hex::encode(tx),
            tx_index: index,
        },
        scripts: request.scripts,
    };
    let protocol = protocol_of(flag, Some(&pool))?;
    let mut stake = vec![if flag { 0xf0 } else { 0xf1 }];
    stake.extend_from_slice(&protocol.mix_logic_hash);
    Ok(LaunchCheck {
        pool: PoolView::of(&protocol)?,
        mix_logic_stake: Address::from_bytes(&stake)?.to_bech32()?,
    })
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
    /// Only whether a box already there can pay its own way back
    /// (`lovejoin::comes_back`): the escape hatch's question, whatever a new
    /// box's minimum is now, and whatever the registration.
    #[serde(default)]
    pub back_only: bool,
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
    let measured = if request.back_only {
        lovejoin::comes_back(&params, &pool)
    } else {
        lovejoin::usable(&params, &pool, request.registered)
    };
    Ok(match measured {
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
    /// A token pool's chain: the session's own UTxOs holding the pool's
    /// token, which its deposit spends (chunk 34's 34d). A mix from the
    /// private balance funds one UTxO holding the boxes' ADA and their token
    /// together. Never a stranger's: what anyone else sent the session stays
    /// in `kept`, and comes back only if it pays its own way.
    tokens: Vec<(Holding, UtxoResponse)>,
    collateral: UtxoResponse,
    /// What comes back with the return: its token UTxOs, and any the
    /// evaluator can't take.
    kept: Vec<UtxoResponse>,
}

impl Holdings {
    /// The ADA a deposit can spend: the ADA-only UTxOs', and the token
    /// UTxOs' that a token pool's deposit spends too.
    fn spare(&self) -> u64 {
        self.coins.iter().map(|(c, _)| c.lovelace).sum::<u64>()
            + self.tokens.iter().map(|(h, _)| h.lovelace).sum::<u64>()
    }
}

/// How much of `token` (its policy and name) `tokens` hold.
fn held_of(tokens: &seedelf_core::assets::Assets, token: &lovejoin::BoxToken) -> Result<u64> {
    Ok(tokens
        .quantity_of(hex::encode(token.policy), hex::encode(&token.name))?
        .unwrap_or(0))
}

/// How many boxes of a pool whose box holds `token` the UTxOs `held` have
/// enough of it for: as many as the ADA allows when the pool has no token.
fn token_boxes(
    held: &[(Holding, UtxoResponse)],
    token: Option<&lovejoin::BoxToken>,
) -> Result<usize> {
    let Some(token) = token else {
        return Ok(usize::MAX);
    };
    let total = held.iter().try_fold(0u128, |sum, (h, _)| {
        held_of(&h.tokens, token).map(|q| sum + u128::from(q))
    })?;
    Ok(usize::try_from(total / u128::from(token.quantity.max(1))).unwrap_or(usize::MAX))
}

/// A UTxO the wallet built and holds the bytes of (a deposit's token
/// change), as Koios would list it at `address`: what a return takes it from.
fn row_of(held: &Holding, address: &str) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode(held.utxo.tx_hash),
        tx_index: held.utxo.index,
        address: address.to_string(),
        value: held.lovelace.to_string(),
        asset_list: Some(
            held.tokens
                .items
                .iter()
                .map(|a| seedelf_koios::koios::Asset {
                    decimals: 0,
                    quantity: a.amount.to_string(),
                    policy_id: hex::encode(a.policy_id),
                    asset_name: hex::encode(&a.token_name),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

/// Session `index`'s UTxOs, split for its chain: `token` is a token pool's,
/// whose UTxOs the session's own transactions (`own`) made go to its
/// deposit. Without one, as before token pools.
fn holdings(
    accounts: &CardanoAccount,
    index: u32,
    utxos: &[UtxoResponse],
    collateral: &OutRef,
    token: Option<&lovejoin::BoxToken>,
    own: &[String],
) -> Result<Holdings> {
    let tokens: Vec<&lovejoin::BoxToken> = token.into_iter().collect();
    holdings_of(accounts, index, utxos, collateral, &tokens, own)
}

/// [`holdings`] for a chain across pools: a UTxO the session's own
/// transactions (`own`) made goes to the deposit when it holds the token of
/// any of the chain's token pools (`tokens`).
fn holdings_of(
    accounts: &CardanoAccount,
    index: u32,
    utxos: &[UtxoResponse],
    collateral: &OutRef,
    tokens_wanted: &[&lovejoin::BoxToken],
    own: &[String],
) -> Result<Holdings> {
    let key = accounts.key_hash(Role::Receive, index)?;
    let mut coins = Vec::new();
    let mut tokens = Vec::new();
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
        let evaluable = seedelf_core::eval::refusal(row).is_none();
        // An ADA-only UTxO the evaluator can't take (a stranger's, carrying
        // a reference script) can't pay a mix: it comes back with the return.
        if collateral.is(row) {
            found = Some(row.clone());
        } else if row.asset_list.as_ref().is_none_or(|a| a.is_empty()) && evaluable {
            coins.push((Coin::from_row(row)?, row.clone()));
        } else if !tokens_wanted.is_empty() && evaluable && own.contains(&row.tx_hash) {
            let held = Holding::from_row(row)?;
            let mut wanted = false;
            for t in tokens_wanted {
                wanted |= held_of(&held.tokens, t)? > 0;
            }
            if wanted {
                tokens.push((held, row.clone()));
            } else {
                kept.push(row.clone());
            }
        } else {
            kept.push(row.clone());
        }
    }
    let collateral = found.context("The session's collateral isn't among its UTxOs")?;
    Ok(Holdings {
        address: collateral.address.clone(),
        coins,
        tokens,
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

/// What a plan's request names beside its own fields, read on its own as
/// `poolRef` is ([`PoolNamed`]): the session's own transactions, whose UTxOs
/// holding a token pool's token pay for its boxes too.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanOwn {
    #[serde(default)]
    pub own: Vec<String>,
}

/// One pool's part of a return's chain across pools (chunk 34's §6, §7): the
/// token pool it is, or the classic pool when none; its rows at `mix_box`, as
/// [`ChainRequest::pool`] has them (a plan reads none); and the most boxes
/// it may take (what its pool has room for, as the worker read it).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegRequest {
    #[serde(default)]
    pub pool_ref: Option<PoolRef>,
    #[serde(default)]
    pub pool: Vec<UtxoResponse>,
    #[serde(default)]
    pub most: Option<usize>,
}

/// What a return's plan or chain names to go across pools, read on its own as
/// `poolRef` is ([`PoolNamed`]). `legs`: the pools, the token pools first, so
/// their boxes are paid for before the ADA's; none, one pool as before.
/// `fills`: transactions beside the session's own whose UTxOs holding a leg's
/// token its deposit may spend (a swap's fill, whose proceeds are the user's
/// though a batcher made them). `params`: one row of Koios's `epoch_params`,
/// which a plan across pools reads for what a token change needs.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Across {
    #[serde(default)]
    pub legs: Vec<LegRequest>,
    #[serde(default)]
    pub fills: Vec<String>,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
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
    /// Across pools: each leg's boxes, in the request's order (`boxes` is
    /// their sum). Absent for one pool.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub legs: Vec<usize>,
}

/// How many boxes a request's mixes take (chunk 34's D3), read from its JSON
/// on its own, as `poolRef` is ([`PoolNamed`]): three when it names none, as
/// every request before it did.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Wide {
    #[serde(default)]
    pub width: Option<usize>,
}

impl Wide {
    /// The width named, checked; three when none is.
    pub fn width(&self) -> Result<usize> {
        let width = self.width.unwrap_or(3);
        lovejoin::check_width(width)?;
        Ok(width)
    }
}

/// What session `request.index`'s UTxOs pay for in the classic pool.
pub fn plan(accounts: &CardanoAccount, request: PlanRequest) -> Result<PlanResult> {
    plan_in(accounts, request, None, &[])
}

/// [`plan`] in the token pool `pool` names, or the classic pool: `own`, the
/// session's own transactions, whose UTxOs holding the pool's token pay for
/// its boxes too.
pub fn plan_in(
    accounts: &CardanoAccount,
    request: PlanRequest,
    pool: Option<&PoolRef>,
    own: &[String],
) -> Result<PlanResult> {
    plan_at(accounts, request, pool, own, 3)
}

/// [`plan_in`], `width` boxes a mix (chunk 34's D3).
pub fn plan_at(
    accounts: &CardanoAccount,
    request: PlanRequest,
    pool: Option<&PoolRef>,
    own: &[String],
    width: usize,
) -> Result<PlanResult> {
    lovejoin::check_width(width)?;
    let protocol = protocol_of(network_flag(&request.network)?, pool)?;
    let held = holdings(
        accounts,
        request.index,
        &request.utxos,
        &request.collateral,
        protocol.token.as_ref(),
        own,
    )?;
    let spare = held.spare();
    let boxes = if request.again {
        // The mixes pay from one UTxO, the largest ([`chain`]).
        let largest = held.coins.iter().map(|(c, _)| c.lovelace).max();
        lovejoin::again_affordable_in(largest.unwrap_or(0), &protocol, request.depth, width)
    } else {
        lovejoin::boxes_affordable_in(spare, &protocol, request.depth, width)
            .min(token_boxes(&held.tokens, protocol.token.as_ref())?)
    };
    let mixes = boxes * lovejoin::mixes_per_box_at(request.depth, width);
    Ok(PlanResult {
        boxes,
        spare: spare.to_string(),
        mixes,
        mix_fees: (mixes as u64 * lovejoin::mix_fee_estimate(&protocol, width)).to_string(),
        legs: Vec::new(),
    })
}

/// The pools `legs` name, each verified ([`protocol_of`]), and the tokens of
/// those that hold one. Never one pool twice, nor two of one token: a chain
/// takes a token into one pool.
fn protocols_of(network_flag: bool, legs: &[LegRequest]) -> Result<Vec<Protocol>> {
    let protocols = legs
        .iter()
        .map(|leg| protocol_of(network_flag, leg.pool_ref.as_ref()))
        .collect::<Result<Vec<_>>>()?;
    for (i, p) in protocols.iter().enumerate() {
        for q in &protocols[..i] {
            if p.id == q.id {
                bail!("A chain names one Lovejoin pool twice");
            }
            if p.token.is_some()
                && p.token.as_ref().map(|t| (t.policy, &t.name))
                    == q.token.as_ref().map(|t| (t.policy, &t.name))
            {
                bail!("A chain takes a token into one Lovejoin pool");
            }
        }
    }
    Ok(protocols)
}

/// Each leg's boxes for a return across pools: what [`lovejoin::plan_across`]
/// gives from the session's spare ADA and its own (or `fills`') UTxOs holding
/// the legs' tokens, each leg at most its `most`.
fn counts_across(
    params: &ProtocolParameters,
    held: &Holdings,
    protocols: &[Protocol],
    legs: &[LegRequest],
    depth: u32,
    width: usize,
) -> Result<Vec<usize>> {
    let address = Address::from_bech32(&held.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let tokens = held
        .tokens
        .iter()
        .try_fold(seedelf_core::assets::Assets::new(), |sum, (h, _)| {
            sum.merge(h.tokens.clone())
        })?;
    let plans = protocols
        .iter()
        .zip(legs)
        .map(|(protocol, leg)| {
            let held = match &protocol.token {
                None => 0,
                Some(t) => held.tokens.iter().try_fold(0u128, |sum, (h, _)| {
                    held_of(&h.tokens, t).map(|q| sum + u128::from(q))
                })?,
            };
            Ok(lovejoin::LegPlan {
                protocol,
                most: leg.most.unwrap_or(usize::MAX),
                held,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    lovejoin::plan_across(
        params,
        &address,
        held.spare(),
        &tokens,
        &plans,
        depth,
        width,
    )
}

/// The transactions whose UTxOs holding a leg's token a deposit across pools
/// may spend: the session's own, and `fills`.
fn own_and_fills(own: &[String], across: &Across) -> Vec<String> {
    own.iter().chain(&across.fills).cloned().collect()
}

/// [`plan`] for a return across pools ([`Across`]): each leg's boxes, the
/// token pools' paid for first. `own` as [`plan_in`]'s; `across.params` must
/// be given.
pub fn plan_across_pools(
    accounts: &CardanoAccount,
    request: PlanRequest,
    own: &[String],
    across: &Across,
    width: usize,
) -> Result<PlanResult> {
    if request.again {
        bail!("Mixing again goes into one Lovejoin pool");
    }
    lovejoin::check_width(width)?;
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(
        across
            .params
            .as_ref()
            .context("A plan across Lovejoin pools needs the protocol parameters")?,
    )?;
    let protocols = protocols_of(network_flag, &across.legs)?;
    let wanted: Vec<&lovejoin::BoxToken> =
        protocols.iter().filter_map(|p| p.token.as_ref()).collect();
    let held = holdings_of(
        accounts,
        request.index,
        &request.utxos,
        &request.collateral,
        &wanted,
        &own_and_fills(own, across),
    )?;
    let legs = counts_across(
        &params,
        &held,
        &protocols,
        &across.legs,
        request.depth,
        width,
    )?;
    let per_mix = |p: &Protocol| lovejoin::mix_fee_estimate(p, width);
    let mixes_each = lovejoin::mixes_per_box_at(request.depth, width);
    let mix_fees: u64 = protocols
        .iter()
        .zip(&legs)
        .map(|(p, n)| (*n * mixes_each) as u64 * per_mix(p))
        .sum();
    let boxes = legs.iter().sum::<usize>();
    Ok(PlanResult {
        boxes,
        spare: held.spare().to_string(),
        mixes: boxes * mixes_each,
        mix_fees: mix_fees.to_string(),
        legs,
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
    /// Across pools: each leg's boxes, in the request's order, a leg's leaves
    /// as many and in that order among `leaves`. Absent for one pool.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub legs: Vec<usize>,
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
            legs: Vec::new(),
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
    chain_in(accounts, sk, request, None)
}

/// [`chain`] into the token pool `pool_ref` names, or the classic pool. A
/// token pool's deposit spends the session's own UTxOs holding its token,
/// and the tokens its boxes don't take come back with the return.
pub fn chain_in(
    accounts: &CardanoAccount,
    sk: Scalar,
    request: ChainRequest,
    pool_ref: Option<&PoolRef>,
) -> Result<ChainResult> {
    chain_at(accounts, sk, request, pool_ref, 3)
}

/// [`chain_in`], `width` boxes a mix (chunk 34's D3).
pub fn chain_at(
    accounts: &CardanoAccount,
    sk: Scalar,
    request: ChainRequest,
    pool_ref: Option<&PoolRef>,
    width: usize,
) -> Result<ChainResult> {
    lovejoin::check_width(width)?;
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = protocol_of(network_flag, pool_ref)?;
    let held = holdings(
        accounts,
        request.index,
        &request.utxos,
        &request.collateral,
        protocol.token.as_ref(),
        &request.own,
    )?;
    let spare = held.spare();
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
        // Mixing again spends no token: what the session holds of it comes back.
        unused.extend(held.tokens.iter().map(|(_, row)| row.clone()));
        let boxes = request
            .boxes
            .unwrap_or_else(|| {
                lovejoin::again_affordable_in(fee.lovelace, &protocol, request.depth, width)
            })
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
        lovejoin::again_at(
            &params,
            &protocol,
            &payer,
            &ours[..boxes],
            request.depth,
            width,
            &pool,
        )
        .map(|built| (built, boxes))
    } else {
        let boxes = request
            .boxes
            .unwrap_or_else(|| {
                lovejoin::boxes_affordable_in(spare, &protocol, request.depth, width)
            })
            .min(token_boxes(&held.tokens, protocol.token.as_ref())?);
        if boxes == 0 {
            bail!(if protocol.token.is_some() {
                "The session's spare ADA and token don't pay for a box of this Lovejoin pool"
            } else {
                "The session's spare ADA doesn't pay for a Lovejoin box"
            });
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
        let tokens: Vec<lovejoin::Holding> = held.tokens.iter().map(|(h, _)| h.clone()).collect();
        let leg = lovejoin::Leg {
            protocol: &protocol,
            owners: &owners,
            pool: &pool,
        };
        lovejoin::chain_across(&params, &funding, &tokens, &[leg], request.depth, width)
            .map(|built| (built, boxes))
    };
    let (built, boxes) = match fanned {
        Err(e) => match e.downcast_ref::<PoolShort>() {
            Some(short) => return Ok(ChainResult::skipped(request.depth, short)),
            None => return Err(e),
        },
        Ok(fanned) => fanned,
    };
    with_return(
        accounts,
        sk,
        network_flag,
        &params,
        &request,
        &held,
        Fanned {
            built,
            boxes,
            unused,
            legs: Vec::new(),
        },
    )
}

/// A return's chain across pools ([`Across`], chunk 34's §6 and §7): one
/// deposit of each leg's boxes (the token pools' paid for first, from the
/// session's own UTxOs holding their tokens, or `fills`'), each leg's boxes
/// mixed in its own pool, then the return, as [`chain_in`]'s. Each leg takes
/// what [`lovejoin::plan_across`] gives it, at most its `most`; one that
/// takes none is left out of the chain, and [`ChainResult::legs`] says so.
pub fn chain_across_pools(
    accounts: &CardanoAccount,
    sk: Scalar,
    request: ChainRequest,
    across: &Across,
    width: usize,
) -> Result<ChainResult> {
    if request.again {
        bail!("Mixing again goes into one Lovejoin pool");
    }
    lovejoin::check_width(width)?;
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocols = protocols_of(network_flag, &across.legs)?;
    let wanted: Vec<&lovejoin::BoxToken> =
        protocols.iter().filter_map(|p| p.token.as_ref()).collect();
    let held = holdings_of(
        accounts,
        request.index,
        &request.utxos,
        &request.collateral,
        &wanted,
        &own_and_fills(&request.own, across),
    )?;
    let counts = counts_across(
        &params,
        &held,
        &protocols,
        &across.legs,
        request.depth,
        width,
    )?;
    let boxes: usize = counts.iter().sum();
    if boxes == 0 {
        bail!("The session's spare ADA doesn't pay for a Lovejoin box");
    }
    let address = Address::from_bech32(&held.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let base = Register::create(sk)?;
    let owners = counts
        .iter()
        .map(|n| {
            (0..*n)
                .map(|_| base.clone().rerandomize())
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()?;
    // Each pool's boxes a fan-out may draw from: never the wallet's own.
    let pools: Vec<Vec<PoolBox>> = protocols
        .iter()
        .zip(&across.legs)
        .map(|(protocol, leg)| {
            leg.pool
                .iter()
                .filter_map(|row| PoolBox::from_row(row, protocol))
                .filter(|b| !b.is_owned(&sk))
                .collect()
        })
        .collect();
    let legs: Vec<lovejoin::Leg> = protocols
        .iter()
        .zip(&owners)
        .zip(&pools)
        .filter(|((_, owners), _)| !owners.is_empty())
        .map(|((protocol, owners), pool)| lovejoin::Leg {
            protocol,
            owners,
            pool,
        })
        .collect();
    let funding = lovejoin::Funding {
        coins: held.coins.iter().map(|(c, _)| c.clone()).collect(),
        collateral: Some(Coin::from_row(&held.collateral)?),
        address,
        deposit_signers: 1,
        mix_signers: 1,
    };
    let tokens: Vec<lovejoin::Holding> = held.tokens.iter().map(|(h, _)| h.clone()).collect();
    let built =
        match lovejoin::chain_across(&params, &funding, &tokens, &legs, request.depth, width) {
            Err(e) => match e.downcast_ref::<PoolShort>() {
                Some(short) => return Ok(ChainResult::skipped(request.depth, short)),
                None => return Err(e),
            },
            Ok(built) => built,
        };
    with_return(
        accounts,
        sk,
        network_flag,
        &params,
        &request,
        &held,
        Fanned {
            built,
            boxes,
            unused: Vec::new(),
            legs: counts,
        },
    )
}

/// A session's chain, built, before its return: how many boxes it put in,
/// the ADA-only UTxOs it left alone, and, across pools, each leg's boxes.
struct Fanned {
    built: lovejoin::Chain,
    boxes: usize,
    unused: Vec<UtxoResponse>,
    legs: Vec<usize>,
}

/// The return at the end of a session's chain ([`chain_at`], [`chain_across_pools`]),
/// built after the chain, and the whole chain signed.
fn with_return(
    accounts: &CardanoAccount,
    sk: Scalar,
    network_flag: bool,
    params: &ProtocolParameters,
    request: &ChainRequest,
    held: &Holdings,
    fanned: Fanned,
) -> Result<ChainResult> {
    let Fanned {
        built,
        boxes,
        unused,
        legs,
    } = fanned;
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
    // A token pool's deposit: the tokens its boxes didn't take, back at the
    // session's account, made by the deposit, which is the session's own.
    rows.extend(built.token_change.iter().map(|h| row_of(h, &held.address)));
    // What the return takes by cost (independent review H1, H2): the chain's
    // change and the session's own and ADA-only UTxOs first, a stranger's
    // token UTxO only when it pays its own way. The rest waits for a later
    // return, or stays.
    let mut own = request.own.clone();
    own.push(rows[0].tx_hash.clone());
    if let Some(deposit) = built.token_change.first() {
        own.push(hex::encode(deposit.utxo.tx_hash));
    }
    // What the return spends that isn't on chain yet: the chain's change, and
    // the deposit's token change.
    let mut unsent = vec![built.change.utxo.clone()];
    unsent.extend(built.token_change.iter().map(|h| h.utxo.clone()));
    let plan = api::plan_return(params, &rows, &request.merge, &own)?;
    let ((back, back_fee), plan) = api::built_or_without_strangers(plan, |plan| {
        if !plan.merged {
            let key = accounts.key_hash(Role::Receive, request.index)?;
            let config = get_config(VARIANT, network_flag)?;
            let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
            let base = Register::create(sk)?;
            let (tx, fee) = build::external_sweep(params, &plan.taken, &base, &wallet, key)?;
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
                &unsent,
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
        legs,
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
    /// A token pool's: how much of its token the boxes take, which goes with
    /// the ADA. None when mixing again, which deposits nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
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
/// `again`, every mix alone. What the mixes don't use comes back. In the
/// classic pool, or the token pool `pool` names, whose boxes take its token
/// too.
pub fn funding(request: FundingRequest) -> Result<FundingResult> {
    funding_in(request, None)
}

/// [`funding`] in the token pool `pool` names, or the classic pool.
pub fn funding_in(request: FundingRequest, pool: Option<&PoolRef>) -> Result<FundingResult> {
    funding_at(request, pool, 3)
}

/// [`funding_in`], `width` boxes a mix (chunk 34's D3).
pub fn funding_at(
    request: FundingRequest,
    pool: Option<&PoolRef>,
    width: usize,
) -> Result<FundingResult> {
    lovejoin::check_width(width)?;
    let protocol = protocol_of(network_flag(&request.network)?, pool)?;
    if request.again {
        check_mix(request.boxes, request.depth)?;
    } else {
        check_deposit(request.boxes, request.depth)?;
    }
    let mixes = request.boxes * lovejoin::mixes_per_box_at(request.depth, width);
    let lovelace = if request.again {
        lovejoin::again_funding_in(request.boxes, &protocol, request.depth, width)
    } else {
        lovejoin::funding_for_in(request.boxes, &protocol, request.depth, width)
    };
    let token = if request.again {
        None
    } else {
        protocol
            .box_value()
            .token_total(request.boxes)?
            .map(|(t, q)| token_amount(&t, q))
    };
    Ok(FundingResult {
        lovelace: lovelace.to_string(),
        mixes,
        mix_fees: (mixes as u64 * lovejoin::mix_fee_estimate(&protocol, width)).to_string(),
        token,
    })
}

/// How many boxes a Bootstrap paid from the private balance may put in, as
/// JSON from the extension: in the classic pool, or the token pool `poolRef`
/// names ([`PoolNamed`]).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapMostRequest {
    pub network: String,
    /// One row of Koios's `epoch_params`.
    pub params: serde_json::Value,
    /// The most one deposit makes in this pool, whatever pays for it.
    pub most: usize,
}

/// The most boxes, of `request.most`, a Bootstrap paid from the private
/// balance puts into the pool under `request.params`: what its funding's
/// reserve pays the deposit's fee and change for
/// ([`lovejoin::bootstrap_most`], chunk 34's 34d review, 3).
pub fn bootstrap_most_in(request: BootstrapMostRequest, pool: Option<&PoolRef>) -> Result<usize> {
    let network_flag = network_flag(&request.network)?;
    let protocol = protocol_of(network_flag, pool)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    lovejoin::bootstrap_most(&params, &protocol, network_flag, request.most)
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
    chain_from_account_in(account, sk, request, None)
}

/// [`chain_from_account`] into the token pool `pool_ref` names, or the
/// classic pool: its deposit takes the pool's token from as few of the
/// account's UTxOs holding it as hold enough, the most first, and what the
/// boxes don't take comes back to the account's `0/0`.
pub fn chain_from_account_in(
    account: &CardanoAccount,
    sk: Scalar,
    request: AccountChainRequest,
    pool_ref: Option<&PoolRef>,
) -> Result<ChainResult> {
    chain_from_account_at(account, sk, request, pool_ref, 3)
}

/// [`chain_from_account_in`], `width` boxes a mix (chunk 34's D3).
pub fn chain_from_account_at(
    account: &CardanoAccount,
    sk: Scalar,
    request: AccountChainRequest,
    pool_ref: Option<&PoolRef>,
    width: usize,
) -> Result<ChainResult> {
    lovejoin::check_width(width)?;
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = protocol_of(network_flag, pool_ref)?;
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
    let not_collateral = |p: &&api::PathedUtxo| {
        collateral_ref.as_ref() != Some(&(p.utxo.tx_hash.clone(), p.utxo.tx_index))
    };

    let mut needed = lovejoin::funding_for_in(request.boxes, &protocol, request.depth, width);
    let lovelace = |p: &api::PathedUtxo| p.utxo.value.parse::<u64>().unwrap_or(0);
    let mut picked: Vec<&UtxoResponse> = Vec::new();
    let mut total = 0u64;
    let address = account.base_address(network_flag, Role::Receive, 0)?;
    // A token pool's boxes take its token first: as few of the account's UTxOs
    // holding it as hold enough, the most first, their ADA counted too. Never
    // one the evaluator can't take.
    let mut tokens: Vec<lovejoin::Holding> = Vec::new();
    if let Some((token, wanted)) = protocol.box_value().token_total(request.boxes)? {
        let mut holding: Vec<(&api::PathedUtxo, lovejoin::Holding, u64)> = request
            .utxos
            .iter()
            .filter(not_collateral)
            .filter(|p| seedelf_core::eval::refusal(&p.utxo).is_none())
            .filter_map(|p| {
                let held = lovejoin::Holding::from_row(&p.utxo).ok()?;
                let quantity = held_of(&held.tokens, &token).ok()?;
                (quantity > 0).then_some((p, held, quantity))
            })
            .collect();
        holding.sort_by_key(|(_, _, q)| std::cmp::Reverse(*q));
        let mut have = 0u64;
        for (p, held, quantity) in holding {
            if have >= wanted {
                break;
            }
            have = have.saturating_add(quantity);
            total += held.lovelace;
            picked.push(&p.utxo);
            tokens.push(held);
        }
        if have < wanted {
            bail!(
                "Your public account doesn't hold enough of this pool's token for {}",
                if request.boxes == 1 {
                    "a box".to_string()
                } else {
                    format!("{} boxes", request.boxes)
                }
            );
        }
        // What the boxes don't take of those UTxOs' tokens comes back to the account in an output of its own, whose
        // least ADA the funding must cover too (the deposit's reserve is for its fee and the ADA change).
        let held = tokens
            .iter()
            .try_fold(seedelf_core::assets::Assets::new(), |sum, h| {
                sum.merge(h.tokens.clone())
            })?;
        let kept = held.separate(seedelf_core::assets::Assets::new().add(
            seedelf_core::assets::Asset::new(
                hex::encode(token.policy),
                hex::encode(&token.name),
                wanted,
            )?,
        )?)?;
        if !kept.is_empty() {
            needed += build::minimum_address_payment(&params, &address, &kept)?;
        }
    }
    // Then as few ADA-only UTxOs as pay for the rest, the largest first.
    // Never one the evaluator can't take: one carrying a reference script.
    let mut ada: Vec<&api::PathedUtxo> = request
        .utxos
        .iter()
        .filter(|p| p.utxo.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|p| seedelf_core::eval::refusal(&p.utxo).is_none())
        .filter(not_collateral)
        .collect();
    ada.sort_by_key(|p| std::cmp::Reverse(lovelace(p)));
    let mut rest = ada.into_iter();
    let mut coin_rows: Vec<&UtxoResponse> = Vec::new();
    while total < needed {
        let Some(p) = rest.next() else { break };
        total += lovelace(p);
        coin_rows.push(&p.utxo);
    }
    if total < needed {
        let ada = format_ada(protocol.denom);
        bail!(
            "Your public account's ADA doesn't pay for {}: that takes {} ₳ in UTxOs of ADA alone, besides the collateral",
            if request.boxes == 1 {
                format!("a box of {ada} ₳ and its mixes")
            } else {
                format!("{} boxes of {ada} ₳ and their mixes", request.boxes)
            },
            needed
                .saturating_sub(tokens.iter().map(|h| h.lovelace).sum::<u64>())
                .div_ceil(1_000_000)
        );
    }
    let path_of = |u: &UtxoResponse| paths[&(u.tx_hash.clone(), u.tx_index)];
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
    let leg = lovejoin::Leg {
        protocol: &protocol,
        owners: &owners,
        pool: &pool,
    };
    // `needed` plans the deposit's fee and its change on a 1.5 ₳ reserve,
    // which a large deposit outgrows: 64 token boxes' fee is about 0.8 ₳, and
    // an ADA change at a base address takes about 0.97 ₳. So when what was
    // picked falls short of that, the next largest UTxO is picked too and the
    // chain built again, while the account has one (1.6.0's release review,
    // MONEY-5); only then is it short.
    let (built, deposit_keys) = loop {
        let coins = coin_rows
            .iter()
            .map(|u| Coin::from_row(u))
            .collect::<Result<Vec<_>>>()?;
        let mut deposit_keys: Vec<(Role, u32)> = picked
            .iter()
            .chain(&coin_rows)
            .map(|u| path_of(u))
            .collect();
        deposit_keys.sort_by_key(|(role, index)| (*role as u32, *index));
        deposit_keys.dedup();
        let funding = lovejoin::Funding {
            coins,
            // None only at depth 0, where `chain` makes no mixes and so never
            // reads it: `fan_out`'s loop doesn't run, and only `mix` puts it up.
            collateral: match &request.collateral {
                Some(c) => Some(Coin::from_row(&c.utxo)?),
                None => None,
            },
            address: address.clone(),
            deposit_signers: deposit_keys.len(),
            mix_signers: mix_keys.len(),
        };
        match lovejoin::chain_across(&params, &funding, &tokens, &[leg], request.depth, width) {
            Ok(built) => break (built, deposit_keys),
            Err(short) if build::is_short(&short) => match rest.next() {
                Some(p) => coin_rows.push(&p.utxo),
                None => return Err(short),
            },
            Err(e) => return Err(e),
        }
    };

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
        legs: Vec::new(),
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
    again_from_account_in(account, sk, request, None)
}

/// [`again_from_account`] in the token pool `pool_ref` names, or the classic
/// pool.
pub fn again_from_account_in(
    account: &CardanoAccount,
    sk: Scalar,
    request: AccountChainRequest,
    pool_ref: Option<&PoolRef>,
) -> Result<ChainResult> {
    again_from_account_at(account, sk, request, pool_ref, 3)
}

/// [`again_from_account_in`], `width` boxes a mix (chunk 34's D3).
pub fn again_from_account_at(
    account: &CardanoAccount,
    sk: Scalar,
    request: AccountChainRequest,
    pool_ref: Option<&PoolRef>,
    width: usize,
) -> Result<ChainResult> {
    lovejoin::check_width(width)?;
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = protocol_of(network_flag, pool_ref)?;
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
    let needed = lovejoin::again_funding_in(boxes, &protocol, request.depth, width);
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
    let built = lovejoin::again_at(
        &params,
        &protocol,
        &payer,
        &ours[..boxes],
        request.depth,
        width,
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
        legs: Vec::new(),
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

/// One of the wallet's boxes brought back with the public account paying its
/// fee (the escape hatch, chunk 34's §2), as JSON from the extension.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawPaidRequest {
    pub network: String,
    pub params: serde_json::Value,
    pub pool: Vec<UtxoResponse>,
    /// The box to take; the first of ours in the pool when absent.
    pub box_ref: Option<OutRef>,
    /// The public account's spendable UTxOs, each with its key's path: the
    /// largest of ADA alone pays.
    pub utxos: Vec<api::PathedUtxo>,
    /// Its collateral, with its path: put up, never spent.
    pub collateral: api::PathedUtxo,
}

/// A box brought back paid by the public account, signed: ready to submit.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawPaidResult {
    /// Signed by the paying UTxO's key and the collateral's.
    pub tx_cbor: String,
    pub tx_hash: String,
    pub fee: String,
    /// Into the new register: the box's ADA, or what the Seedelf output
    /// needs when that's more, the account making up the rest.
    pub lovelace: String,
    /// What the public account pays: the fee, and what it made up.
    pub paid: String,
    pub box_ref: OutRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
}

/// One of our boxes into a fresh register of the Seedelf key, its fee paid
/// by the public account (`lovejoin::withdraw_paid`): for a box that can't
/// pay its own way back. The account's UTxO and change are in the same
/// transaction as the box, so it ties the box to the account; the worker
/// says so before it's built. In the classic pool, or the token pool `pool`
/// names.
pub fn withdraw_paid_in(
    account: &CardanoAccount,
    sk: Scalar,
    request: WithdrawPaidRequest,
    pool: Option<&PoolRef>,
) -> Result<WithdrawPaidResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = protocol_of(network_flag, pool)?;
    let mut every = request.utxos.clone();
    every.push(request.collateral.clone());
    let paths = api::check_paths(account, network_flag, &every)?;
    let collateral_ref = (
        request.collateral.utxo.tx_hash.clone(),
        request.collateral.utxo.tx_index,
    );
    let lovelace = |p: &api::PathedUtxo| p.utxo.value.parse::<u64>().unwrap_or(0);
    let paying = request
        .utxos
        .iter()
        .filter(|p| p.utxo.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|p| seedelf_core::eval::refusal(&p.utxo).is_none())
        .filter(|p| (p.utxo.tx_hash.clone(), p.utxo.tx_index) != collateral_ref)
        .max_by_key(|p| lovelace(p))
        .context("Your public account holds no UTxO of ADA alone to pay for this box's way back, besides its collateral")?;
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
    let path_of = |u: &UtxoResponse| paths[&(u.tx_hash.clone(), u.tx_index)];
    let mut keys = vec![path_of(&paying.utxo)];
    let collateral_key = path_of(&request.collateral.utxo);
    if !keys.contains(&collateral_key) {
        keys.push(collateral_key);
    }
    let payer = lovejoin::Payer {
        fee: Coin::from_row(&paying.utxo)?,
        collateral: Some(Coin::from_row(&request.collateral.utxo)?),
        address: account.base_address(network_flag, Role::Receive, 0)?,
        signers: keys.len(),
    };
    let destination = Register::create(sk)?.rerandomize()?;
    let built = lovejoin::withdraw_paid(
        &params,
        &protocol,
        std::slice::from_ref(&chosen),
        &sk,
        destination,
        &payer,
    )?;
    let change = built
        .change
        .as_ref()
        .context("A paid withdraw has the account's change")?;
    let mut signed = built.tx.clone();
    for (role, index) in &keys {
        signed = signed
            .sign(account.private_key(*role, *index)?.to_ed25519_private_key())
            .map_err(|e| anyhow!("failed to sign: {e:?}"))?;
    }
    Ok(WithdrawPaidResult {
        tx_cbor: hex::encode(&signed.tx_bytes.0),
        tx_hash: hex::encode(signed.tx_hash.0),
        fee: built.fee.to_string(),
        lovelace: built.lovelace.to_string(),
        paid: (payer.fee.lovelace - change.lovelace).to_string(),
        box_ref: OutRef::of_box(&chosen),
        token: built.token.as_ref().map(|(t, q)| token_amount(t, *q)),
    })
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoxValueRequest {
    pub network: String,
    /// One row of Koios's `epoch_params`: the live parameters.
    pub params: serde_json::Value,
    /// The token every box would hold: none for an ADA pool.
    #[serde(default)]
    pub token: Option<api::TokenAmount>,
}

/// What a box of a pool the wallet launches may hold, under the live
/// parameters (chunk 34's session 1, 14). Amounts in lovelace.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoxValueResult {
    /// The least at which a box comes back and pays part of itself on its
    /// own (`lovejoin::least_box_lovelace`): no launch goes below it.
    pub least: String,
    /// What the launch form suggests: the least with a margin, rounded up to
    /// 0.5 ₳.
    pub suggested: String,
    /// The most a token pool's box may hold (9 ₳); none for an ADA pool.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub most: Option<String>,
}

/// The token a request names, as a box's.
pub fn box_token(token: &api::TokenAmount) -> Result<lovejoin::BoxToken> {
    Ok(lovejoin::BoxToken {
        policy: hex::decode(&token.policy_id)?
            .try_into()
            .map_err(|_| anyhow!("The token's policy isn't 28 bytes"))?,
        name: hex::decode(&token.asset_name)?,
        quantity: token
            .quantity
            .parse()
            .map_err(|_| anyhow!("The token's quantity isn't a whole number"))?,
    })
}

/// The least, the suggested and the most box value for a launch: about a
/// dozen ways back built and measured here (`lovejoin::way_back`), scripts by
/// reference, as every launch the wallet makes publishes them.
pub fn box_value(request: BoxValueRequest) -> Result<BoxValueResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let token = request.token.as_ref().map(box_token).transpose()?;
    let probe = lovejoin::Probe::new(network_flag, true)?;
    let least = lovejoin::least_box_lovelace(&probe, &params, token.as_ref())?;
    Ok(BoxValueResult {
        least: least.to_string(),
        suggested: lovejoin::suggested_box_lovelace(least).to_string(),
        most: token
            .is_some()
            .then(|| lovejoin::MAX_TOKEN_BOX_LOVELACE.to_string()),
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
