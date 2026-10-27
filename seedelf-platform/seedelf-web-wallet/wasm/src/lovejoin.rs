//! Lovejoin in the web wallet: a private session's spare ADA through the
//! mixer on its way back, and the boxes' later withdraws into Seedelf.
//! `seedelf_core::lovejoin` builds and measures the transactions; this signs
//! them with the session's key and gives the worker JSON.
//!
//! A session's chain, built here in one call and sent by the worker in
//! order, each transaction on the one before's change:
//!
//! 1. the deposit: as many boxes as its ADA-only UTxOs pay for, each owned
//!    by the Seedelf key, in the classic pool (10 ₳ a box) or the pool a
//!    request names, a token pool's boxes taking its token from the session's
//!    UTxOs that hold it; a return across pools puts each pool's in at once;
//! 2. the mixes: each box fanned out `depth` waves deep in its own pool,
//!    three or four boxes a mix (`width`), with fresh boxes from that pool;
//! 3. the return: the last change, the collateral the mixes put up (spent
//!    here, last) and any token UTxOs, merged into the Seedelf UTxO the
//!    session's funding made (`api::merged_return`, under that collateral);
//!    or swept into fresh registers (`build::external_sweep`, which runs no
//!    script) when that UTxO is spent, a UTxO there can't be measured, or
//!    there's no collateral to put up: a Bootstrap's session has none.
//!    Where a 5 ₳ pool takes the collateral, it's put into a box of its own
//!    and mixed once first (`CollateralTail`), and the return sweeps the rest.
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
use seedelf_core::data_structures::create_spend_redeemer;
use seedelf_core::lovejoin::{self, Coin, Holding, PoolBox, PoolShort, Protocol, Version};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse, extract_bytes_with_logging};
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
/// a Plutus V3 script and its datum, if any, one the wallet reads;
/// `verify_pool` reads a script by reference only from the holder, and only
/// the one it derived.
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
        // A launch can put any datum beside its scripts (one_shot_mint checks
        // only the reference output), and decoding one a few thousand levels
        // deep overflowed this module's stack, which locked the wallet. Such a
        // row is no reference: its script is carried, and the pool isn't
        // shown, as the data layer doesn't list it (1.6.0's release review,
        // 314-wasm#0). A request naming it is still read.
        if seedelf_core::eval::unreadable_datum(row).is_some() {
            continue;
        }
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

/// A session's 5 ₳ collateral, mixed once on its way into the 5 ₳ pool (the
/// owner, 2026-10-23): back in the private balance it would carry the
/// session's history. Once the chain's mixes no longer need it, a deposit puts
/// it into a box under a fresh re-randomization of the Seedelf key's register,
/// and one mix, three wide, moves that box with two other people's boxes. The
/// session has nothing else to put up by then, so that mix is under giveme.my's
/// collateral, which giveme.my signs only once the deposit is on chain: the
/// worker waits for it. The return after it sweeps what the mix leaves.
pub(crate) struct CollateralTail {
    pub deposit: lovejoin::Deposit,
    pub mix: lovejoin::Mix,
    /// The box the mix made of ours.
    pub leaf: PoolBox,
}

impl CollateralTail {
    /// The tail of `collateral` (the session's 5 ₳ of ADA alone) into the
    /// 5 ₳ pool `pool` names, `payers` paying (the chain's change, or a
    /// direct return's ADA), drawing two boxes from the pool's `rows`: never
    /// the wallet's own, nor one `avoid` names (what the chain spends). A pool
    /// that isn't 5 ₳ boxes of ADA, or doesn't verify, is refused, and so is
    /// anything but the collateral: the caller brings it back with the rest
    /// rather than fail a session's return.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build(
        network_flag: bool,
        params: &ProtocolParameters,
        sk: Scalar,
        pool: &PoolRef,
        rows: &[UtxoResponse],
        collateral: &UtxoResponse,
        payers: Vec<Coin>,
        avoid: &[OutRef],
        address: &Address,
    ) -> Result<Self> {
        let protocol = collateral_protocol(network_flag, pool)?;
        if !fits_collateral(collateral) {
            bail!("Only a session's own 5 ₳ collateral goes into the pool of 5 ₳ boxes");
        }
        let mut coins = vec![Coin::from_row(collateral)?];
        coins.extend(payers);
        let owner = Register::create(sk)?.rerandomize()?;
        let tail = lovejoin::collateral_tail(
            params,
            &protocol,
            &coins,
            &owner,
            &draws(&protocol, rows, sk, avoid),
            address,
            1,
        )?;
        Ok(CollateralTail {
            deposit: tail.deposit,
            mix: tail.mix,
            leaf: tail.leaf,
        })
    }

    /// What it costs: its deposit's fee and its mix's.
    fn fee(&self) -> u64 {
        self.deposit.fee + self.mix.fee
    }

    /// Its two transactions, signed by the session's key, in the order they're
    /// sent: the deposit, then the mix, which giveme.my signs too, later.
    fn txs(&self, accounts: &CardanoAccount, index: u32) -> Result<Vec<ChainTxOut>> {
        let deposit = sign(self.deposit.tx.clone(), accounts, index)?;
        let mix = sign(self.mix.tx.clone(), accounts, index)?;
        Ok(vec![
            ChainTxOut::of(&deposit, "deposit", self.deposit.fee).in_tail(false),
            ChainTxOut::of(&mix, "mix", self.mix.fee).in_tail(true),
        ])
    }

    /// What the worker records of it: the collateral's box, its leaf, and its cost.
    fn out(&self) -> TailOut {
        TailOut {
            boxed: OutRef::of_box(&self.deposit.boxes[0]),
            leaf: OutRef::of_box(&self.leaf),
            fee: self.fee().to_string(),
        }
    }
}

/// The 5 ₳ pool `pool` names, verified: an ADA pool whose box holds exactly
/// the collateral's 5 ₳.
fn collateral_protocol(network_flag: bool, pool: &PoolRef) -> Result<Protocol> {
    let protocol = protocol_of(network_flag, Some(pool))?;
    let value = protocol.box_value();
    if value.token.is_some() || value.lovelace != build::COLLATERAL_LOVELACE {
        bail!("The collateral goes only into a Lovejoin pool of 5 ₳ boxes of ADA");
    }
    Ok(protocol)
}

/// A session's own collateral, as the worker's `collateralFits` has it:
/// exactly 5 ₳ of ADA alone, no datum, no script.
fn fits_collateral(u: &UtxoResponse) -> bool {
    u.value.parse::<u64>().ok() == Some(build::COLLATERAL_LOVELACE)
        && u.asset_list.as_ref().is_none_or(|a| a.is_empty())
        && u.reference_script.is_none()
        && u.inline_datum.is_none()
        && u.datum_hash.is_none()
}

/// What a session sets aside for its collateral's tail before its boxes are
/// counted: [`lovejoin::COLLATERAL_TAIL_RESERVE`] where it was funded with it,
/// nothing otherwise.
fn tail_reserve(funded: bool) -> u64 {
    if funded {
        lovejoin::COLLATERAL_TAIL_RESERVE
    } else {
        0
    }
}

/// The boxes of `rows` a tail's mix may draw: `protocol`'s, never the
/// wallet's own (`sk`'s), nor one `avoid` names.
fn draws(protocol: &Protocol, rows: &[UtxoResponse], sk: Scalar, avoid: &[OutRef]) -> Vec<PoolBox> {
    rows.iter()
        .filter(|row| !avoid.iter().any(|o| o.is(row)))
        .filter_map(|row| PoolBox::from_row(row, protocol))
        .filter(|b| !b.is_owned(&sk))
        .collect()
}

/// What `txs` spend, each input as an [`OutRef`]: the pool's boxes a chain
/// draws, which its collateral's mix then never draws again.
fn spent_by<'a>(txs: impl IntoIterator<Item = &'a BuiltTransaction>) -> Result<Vec<OutRef>> {
    let mut spent = Vec::new();
    for tx in txs {
        let tx = <pallas_primitives::conway::Tx as pallas_primitives::Fragment>::decode_fragment(
            &tx.tx_bytes.0,
        )
        .map_err(|e| anyhow!("A chain's transaction can't be read: {e}"))?;
        spent.extend(tx.transaction_body.inputs.iter().map(|i| OutRef {
            tx_hash: hex::encode(i.transaction_id),
            tx_index: i.index,
        }));
    }
    Ok(spent)
}

/// A direct return's [`CollateralTail`], with no chain before it: the
/// session's own 5 ₳ collateral, its other ADA-only UTxOs paying, and what
/// the return after it sweeps.
pub(crate) struct DirectTail {
    tail: CollateralTail,
    /// What the deposit didn't spend, and the mix's change.
    pub rest: Vec<UtxoResponse>,
}

impl DirectTail {
    /// The session's own transactions, and the tail's mix, whose change the
    /// return takes first.
    pub(crate) fn own(&self, own: &[String]) -> Vec<String> {
        let mut own = own.to_vec();
        own.push(hex::encode(self.tail.mix.change.utxo.tx_hash));
        own
    }

    /// Its transactions signed, and what the worker records of it.
    pub(crate) fn signed(self, accounts: &CardanoAccount, index: u32) -> Result<ReturnTail> {
        Ok(ReturnTail {
            txs: self.tail.txs(accounts, index)?,
            tail: self.tail.out(),
        })
    }
}

/// The tail of a session's direct return (`api::session_return`) into the 5 ₳
/// pool `pool` names, drawing from its `rows`: the session's own collateral
/// among `utxos`, paid for by every other ADA-only UTxO there the wallet's
/// evaluator can take. Refused where there's no such collateral, or nothing
/// else to pay.
pub(crate) fn direct_tail(
    network_flag: bool,
    params: &ProtocolParameters,
    sk: Scalar,
    pool: &PoolRef,
    rows: &[UtxoResponse],
    utxos: &[UtxoResponse],
) -> Result<DirectTail> {
    let collateral = utxos
        .iter()
        .find(|u| fits_collateral(u))
        .context("The session's 5 ₳ collateral isn't at its account")?;
    let is_collateral =
        |u: &UtxoResponse| u.tx_hash == collateral.tx_hash && u.tx_index == collateral.tx_index;
    let payers: Vec<&UtxoResponse> = utxos
        .iter()
        .filter(|u| !is_collateral(u))
        .filter(|u| u.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|u| seedelf_core::eval::refusal(u).is_none())
        .collect();
    if payers.is_empty() {
        bail!("Nothing of the session's but its collateral pays for the collateral's mix");
    }
    let coins = payers
        .iter()
        .map(|u| Coin::from_row(u))
        .collect::<Result<Vec<_>>>()?;
    let address = Address::from_bech32(&collateral.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let tail = CollateralTail::build(
        network_flag,
        params,
        sk,
        pool,
        rows,
        collateral,
        coins,
        &[],
        &address,
    )?;
    let spent = |u: &UtxoResponse| {
        is_collateral(u)
            || payers
                .iter()
                .any(|p| p.tx_hash == u.tx_hash && p.tx_index == u.tx_index)
    };
    let mut rest = vec![coin_row(&tail.mix.change, &collateral.address)];
    rest.extend(utxos.iter().filter(|u| !spent(u)).cloned());
    Ok(DirectTail { tail, rest })
}

/// A direct return's collateral tail, as the worker gets it
/// (`api::SessionReturnResult::tail`): its deposit and its mix, signed by the
/// session's key, to go before the return.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReturnTail {
    pub txs: Vec<ChainTxOut>,
    #[serde(flatten)]
    pub tail: TailOut,
}

/// The collateral's mix built again, and the return after it, once its
/// deposit is on chain (`buildCollateralMix`): a box it drew was spent by
/// someone else by the time giveme.my was asked, or a lock wiped the chain's
/// progress before the mix went.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollateralMixRequest {
    pub network: String,
    /// One row of Koios's `epoch_params`.
    pub params: serde_json::Value,
    pub index: u32,
    /// Every UTxO at the session's account: the deposit's change pays.
    pub utxos: Vec<UtxoResponse>,
    /// The collateral's box, which the deposit made.
    #[serde(rename = "box")]
    pub boxed: OutRef,
    /// The 5 ₳ pool, and its rows at `mix_box`, the box among them, minus
    /// any a sent transaction of ours already spends.
    pub pool_ref: PoolRef,
    pub pool: Vec<UtxoResponse>,
    /// The session's own transactions (`api::SessionReturnRequest::own`).
    #[serde(default)]
    pub own: Vec<String>,
}

/// The collateral's box, mixed once with two boxes drawn fresh, its fee paid
/// from the session's largest UTxO of ADA alone (the deposit's change), under
/// giveme.my's collateral; then the return, a sweep of what's left. As a
/// chain of two: the mix (`giveme`), then the return. The box must be the
/// wallet's own, in the pool.
pub fn collateral_mix(
    accounts: &CardanoAccount,
    sk: Scalar,
    request: CollateralMixRequest,
) -> Result<ChainResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = collateral_protocol(network_flag, &request.pool_ref)?;
    let boxed = request
        .pool
        .iter()
        .find(|row| request.boxed.is(row))
        .and_then(|row| PoolBox::from_row(row, &protocol))
        .filter(|b| b.is_owned(&sk))
        .context("The collateral's box isn't this wallet's, in the pool of 5 ₳ boxes")?;
    let key = accounts.key_hash(Role::Receive, request.index)?;
    let payer = request
        .utxos
        .iter()
        .filter(|u| payment_key(&u.address) == Some(key))
        .filter(|u| u.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .filter(|u| seedelf_core::eval::refusal(u).is_none())
        .max_by_key(|u| u.value.parse::<u64>().unwrap_or(0))
        .context("Nothing of ADA alone at the session's account pays for the collateral's mix")?;
    let address = Address::from_bech32(&payer.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let (mix, leaf) = lovejoin::collateral_mix(
        &params,
        &protocol,
        &boxed,
        &Coin::from_row(payer)?,
        &draws(&protocol, &request.pool, sk, &[]),
        &address,
        1,
    )?;
    let mut rows = vec![coin_row(&mix.change, &payer.address)];
    rows.extend(
        request
            .utxos
            .iter()
            .filter(|u| !(u.tx_hash == payer.tx_hash && u.tx_index == payer.tx_index))
            .cloned(),
    );
    let mut own = request.own.clone();
    own.push(rows[0].tx_hash.clone());
    let plan = api::plan_return(&params, &rows, &[], &own)?;
    let ((back, back_fee), plan) = api::built_or_without_strangers(plan, |plan| {
        let config = get_config(VARIANT, network_flag)?;
        let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
        let (tx, fee) =
            build::external_sweep(&params, &plan.taken, &Register::create(sk)?, &wallet, key)?;
        Ok((sign(tx, accounts, request.index)?, fee))
    })?;
    let (total, tokens) = seedelf_core::utxos::assets_of(plan.taken.clone())?;
    let signed = sign(mix.tx.clone(), accounts, request.index)?;
    Ok(ChainResult {
        txs: vec![
            ChainTxOut::of(&signed, "mix", mix.fee).in_tail(true),
            ChainTxOut::of(&back, "back", back_fee),
        ],
        boxes: 0,
        depth: 1,
        fees: (mix.fee + back_fee).to_string(),
        returned: (total - back_fee).to_string(),
        tokens: tokens
            .items
            .iter()
            .map(|a| api::TokenAmount {
                policy_id: hex::encode(a.policy_id),
                asset_name: hex::encode(&a.token_name),
                quantity: a.amount.to_string(),
            })
            .collect(),
        merged: 0,
        leaves: Vec::new(),
        left_out: plan.left_out,
        skipped: None,
        legs: Vec::new(),
        collateral_tail: Some(TailOut {
            boxed: request.boxed,
            leaf: OutRef::of_box(&leaf),
            fee: mix.fee.to_string(),
        }),
    })
}

/// A key account's coin the wallet built and holds the bytes of (a tail's
/// change), as Koios would list it at `address`: what a return takes.
fn coin_row(coin: &Coin, address: &str) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode(coin.utxo.tx_hash),
        tx_index: coin.utxo.index,
        address: address.to_string(),
        value: coin.lovelace.to_string(),
        ..Default::default()
    }
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
    /// What its mixes put up. None for a Bootstrap's (depth 0), whose deposit
    /// runs no script, so it was never funded one (the owner, 2026-10-23).
    collateral: Option<UtxoResponse>,
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

/// What a chain's mixes put up: the session's collateral, which a chain that
/// mixes (`depth` above 0, or mixing `again`) can't go without; none for a
/// Bootstrap's deposit alone, which runs no script.
fn mixes_collateral(held: &Holdings, depth: u32, again: bool) -> Result<Option<Coin>> {
    match &held.collateral {
        Some(row) => Ok(Some(Coin::from_row(row)?)),
        None if depth > 0 || again => bail!("A chain that mixes needs the session's collateral"),
        None => Ok(None),
    }
}

/// Session `index`'s UTxOs, split for its chain: `token` is a token pool's,
/// whose UTxOs the session's own transactions (`own`) made go to its
/// deposit. Without one, as before token pools. `collateral`: none for a
/// session that has none (a Bootstrap's).
fn holdings(
    accounts: &CardanoAccount,
    index: u32,
    utxos: &[UtxoResponse],
    collateral: Option<&OutRef>,
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
    collateral: Option<&OutRef>,
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
        if collateral.is_some_and(|c| c.is(row)) {
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
    if collateral.is_some() && found.is_none() {
        bail!("The session's collateral isn't among its UTxOs");
    }
    // Where change goes: the collateral's address, else one the session's own transactions paid (its funding),
    // never first a stranger's, which may name the session's key under a stake key of its own.
    let address = found
        .as_ref()
        .or_else(|| utxos.iter().find(|u| own.contains(&u.tx_hash)))
        .or(utxos.first())
        .context("Nothing is at the session's account")?
        .address
        .clone();
    Ok(Holdings {
        address,
        coins,
        tokens,
        collateral: found,
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
    /// None for a Bootstrap's session (depth 0), which has none.
    #[serde(default)]
    pub collateral: Option<OutRef>,
    pub depth: u32,
    /// Mixing the wallet's boxes again: no deposit, so no box to pay for.
    #[serde(default)]
    pub again: bool,
    /// The session was funded with [`lovejoin::COLLATERAL_TAIL_RESERVE`] for
    /// its collateral's tail ([`CollateralTail`]): its boxes are counted on
    /// what's left after it, as its chain's are.
    #[serde(default)]
    pub collateral_reserve: bool,
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
        request.collateral.as_ref(),
        protocol.token.as_ref(),
        own,
    )?;
    let spare = held.spare();
    let reserve = tail_reserve(request.collateral_reserve);
    let boxes = if request.again {
        // The mixes pay from one UTxO, the largest ([`chain`]).
        let largest = held.coins.iter().map(|(c, _)| c.lovelace).max();
        lovejoin::again_affordable_in(
            largest.unwrap_or(0).saturating_sub(reserve),
            &protocol,
            request.depth,
            width,
        )
    } else {
        lovejoin::boxes_affordable_in(
            spare.saturating_sub(reserve),
            &protocol,
            request.depth,
            width,
        )
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
    reserve: u64,
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
        held.spare().saturating_sub(reserve),
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
        request.collateral.as_ref(),
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
        tail_reserve(request.collateral_reserve),
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
    /// What its mixes put up. None only for a Bootstrap's (depth 0), whose
    /// deposit runs no script: its return is then a sweep, never merged.
    #[serde(default)]
    pub collateral: Option<OutRef>,
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
    /// The 5 ₳ pool the session's collateral is mixed into on its way back
    /// ([`CollateralTail`]), and its rows at `mix_box`, minus any a sent
    /// transaction of ours already spends.
    #[serde(default)]
    pub collateral_pool: Option<PoolRef>,
    #[serde(default)]
    pub collateral_boxes: Vec<UtxoResponse>,
    /// The session was funded with [`lovejoin::COLLATERAL_TAIL_RESERVE`] for
    /// that tail: its boxes are counted on what's left after it. Without, the
    /// tail is paid from whatever the chain leaves, if that's enough.
    #[serde(default)]
    pub collateral_reserve: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChainTxOut {
    /// `deposit`, `mix` or `back`.
    pub kind: String,
    pub tx_cbor: String,
    pub tx_hash: String,
    pub fee: String,
    /// The session's collateral's deposit or mix ([`CollateralTail`]).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub tail: bool,
    /// giveme.my signs it too before it's sent, once every transaction
    /// before it is on chain: the collateral's mix.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub giveme: bool,
}

impl ChainTxOut {
    fn of(tx: &BuiltTransaction, kind: &str, fee: u64) -> Self {
        ChainTxOut {
            kind: kind.to_string(),
            tx_cbor: hex::encode(&tx.tx_bytes.0),
            tx_hash: hex::encode(tx.tx_hash.0),
            fee: fee.to_string(),
            tail: false,
            giveme: false,
        }
    }

    /// The collateral's: its mix with `giveme`.
    fn in_tail(self, giveme: bool) -> Self {
        ChainTxOut {
            tail: true,
            giveme,
            ..self
        }
    }
}

/// The session's collateral, mixed once on its way into the 5 ₳ pool
/// ([`CollateralTail`]): the box its deposit made, the box its mix made of
/// ours, and what both cost. What comes back at once leaves its 5 ₳ out.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TailOut {
    #[serde(rename = "box")]
    pub boxed: OutRef,
    pub leaf: OutRef,
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
    /// What the return brings back at once: the last change, the token UTxOs'
    /// ADA and the collateral, less its fee. The collateral isn't in it after
    /// a `collateral_tail`, which mixed it, nor for a Bootstrap's session,
    /// which has none. A public account's chain has no return: this is the
    /// change that stays in the account.
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
    /// The session's collateral, mixed once on its way into the 5 ₳ pool,
    /// when `collateral_pool` was asked and what the chain left pays for it:
    /// its two transactions go before the return, among `txs`, and `fees`
    /// counts them; `returned` leaves its 5 ₳ out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collateral_tail: Option<TailOut>,
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
            collateral_tail: None,
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
        request.collateral.as_ref(),
        protocol.token.as_ref(),
        &request.own,
    )?;
    // A session funded for its collateral's tail pays for it first
    // ([`CollateralTail`]): the boxes are counted on what's left.
    let reserve = tail_reserve(request.collateral_reserve);
    let spare = held.spare().saturating_sub(reserve);
    let (ours, pool): (Vec<PoolBox>, Vec<PoolBox>) = request
        .pool
        .iter()
        .filter_map(|row| PoolBox::from_row(row, &protocol))
        .partition(|b| b.is_owned(&sk));
    let address = Address::from_bech32(&held.address)
        .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
    let collateral = mixes_collateral(&held, request.depth, request.again)?;

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
                lovejoin::again_affordable_in(
                    fee.lovelace.saturating_sub(reserve),
                    &protocol,
                    request.depth,
                    width,
                )
            })
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
            collateral,
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
        request.collateral.as_ref(),
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
        tail_reserve(request.collateral_reserve),
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
        collateral: mixes_collateral(&held, request.depth, false)?,
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
/// built after the chain, and the whole chain signed. With `collateral_pool`,
/// the session's collateral is mixed once on its way into that pool first
/// ([`CollateralTail`]), paid from the chain's change, and the return sweeps
/// what that leaves; where that can't be built, the return is as before, the
/// collateral back with the rest.
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
    let change = coin_row(&built.change, &held.address);
    let mut rest = unused;
    rest.extend(held.kept.iter().cloned());
    // A token pool's deposit: the tokens its boxes didn't take, back at the
    // session's account, made by the deposit, which is the session's own.
    rest.extend(built.token_change.iter().map(|h| row_of(h, &held.address)));
    // What the return takes by cost (independent review H1, H2): the chain's
    // change and the session's own and ADA-only UTxOs first, a stranger's
    // token UTxO only when it pays its own way. The rest waits for a later
    // return, or stays.
    let mut own = request.own.clone();
    own.push(change.tx_hash.clone());
    if let Some(deposit) = built.token_change.first() {
        own.push(hex::encode(deposit.utxo.tx_hash));
    }
    // What the return spends that isn't on chain yet: the chain's change (or
    // the tail's), and the deposit's token change.
    let token_change: Vec<_> = built.token_change.iter().map(|h| h.utxo.clone()).collect();
    // A Bootstrap's session has no collateral to mix (`held.collateral` none).
    let tail = match (&request.collateral_pool, &held.collateral) {
        (Some(pool), Some(collateral)) => {
            let address = Address::from_bech32(&held.address)
                .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
            let avoid = spent_by(built.txs.iter().map(|t| &t.tx))?;
            CollateralTail::build(
                network_flag,
                params,
                sk,
                pool,
                &request.collateral_boxes,
                collateral,
                vec![built.change.clone()],
                &avoid,
                &address,
            )
            .ok()
        }
        _ => None,
    };
    let attempt = |tail: Option<&CollateralTail>| -> Result<_> {
        let mut rows = Vec::with_capacity(rest.len() + 2);
        let mut own = own.clone();
        let mut unsent = token_change.clone();
        let merge: &[UtxoResponse] = match tail {
            // The tail's deposit spent the chain's change and the collateral:
            // its mix's change comes back in their place, swept, since the
            // collateral a merge puts up is in the box by then.
            Some(t) => {
                rows.push(coin_row(&t.mix.change, &held.address));
                own.push(rows[0].tx_hash.clone());
                unsent.push(t.mix.change.utxo.clone());
                &[]
            }
            None => {
                rows.push(change.clone());
                unsent.push(built.change.utxo.clone());
                match &held.collateral {
                    Some(collateral) => {
                        rows.push(collateral.clone());
                        &request.merge
                    }
                    // None to put up for a merge: a sweep, which runs no script.
                    None => &[],
                }
            }
        };
        rows.extend(rest.iter().cloned());
        let plan = api::plan_return(params, &rows, merge, &own)?;
        api::built_or_without_strangers(plan, |plan| {
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
                // Merged only with a collateral to put up (`merge` none without).
                let collateral = held
                    .collateral
                    .as_ref()
                    .context("A merged return needs the session's collateral")?;
                let (signed, spend) = api::merged_return(
                    accounts,
                    sk,
                    &chain,
                    request.index,
                    &plan.taken,
                    collateral,
                    merge,
                    &unsent,
                )?;
                Ok((signed, spend.fee.total))
            }
        })
    };
    let (((back, back_fee), plan), tail) = match tail {
        Some(t) => match attempt(Some(&t)) {
            Ok(built) => (built, Some(t)),
            Err(_) => (attempt(None)?, None),
        },
        None => (attempt(None)?, None),
    };
    let (total, tokens) = seedelf_core::utxos::assets_of(plan.taken.clone())?;

    let mut txs = Vec::with_capacity(built.txs.len() + 3);
    let mut fees = back_fee;
    for step in built.txs {
        fees += step.fee;
        let signed = sign(step.tx, accounts, request.index)?;
        txs.push(ChainTxOut::of(&signed, step.kind, step.fee));
    }
    if let Some(t) = &tail {
        fees += t.fee();
        txs.extend(t.txs(accounts, request.index)?);
    }
    txs.push(ChainTxOut::of(&back, "back", back_fee));
    Ok(ChainResult {
        txs,
        boxes,
        depth: request.depth,
        fees: fees.to_string(),
        returned: (total - back_fee).to_string(),
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
        collateral_tail: tail.as_ref().map(CollateralTail::out),
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
        lovejoin::funding_for_in(request.boxes, &protocol, request.depth, width)?
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
/// balance puts into the pool under `request.params`: what its funding's two
/// reserves, the deposit's and the way back's, pay the deposit and its sweep
/// back for, each count built ([`lovejoin::bootstrap_most`], chunk 34's 34d
/// review, 3; 1.6.0's release review, 318-rust#0).
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

    let mut needed = lovejoin::funding_for_in(request.boxes, &protocol, request.depth, width)?;
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
            // Checked, as the planner's sums on the pool's box ADA are: this
            // build doesn't check overflow (1.6.0's release review, 314-core#1).
            needed = needed
                .checked_add(build::minimum_address_payment(&params, &address, &kept)?)
                .context(lovejoin::MORE_THAN_THERE_IS)?;
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
        txs.push(ChainTxOut::of(&signed, step.kind, step.fee));
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
        collateral_tail: None,
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
        txs.push(ChainTxOut::of(&signed, step.kind, step.fee));
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
        collateral_tail: None,
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

/// The wallet's box among the pool's `rows` that `box_ref` names, or the
/// first of the wallet's there when it names none: what a withdraw takes.
fn our_box(
    sk: Scalar,
    rows: &[UtxoResponse],
    protocol: &Protocol,
    box_ref: Option<&OutRef>,
) -> Result<PoolBox> {
    let mut ours = rows
        .iter()
        .filter_map(|row| PoolBox::from_row(row, protocol))
        .filter(|b| b.is_owned(&sk));
    match box_ref {
        Some(r) => ours
            .find(|b| OutRef::of_box(b) == *r)
            .context("That box isn't in the pool as this wallet's anymore"),
        None => ours
            .next()
            .context("This wallet has no box in Lovejoin's pool"),
    }
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
    let chosen = our_box(sk, &request.pool, &protocol, request.box_ref.as_ref())?;
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
    let chosen = our_box(sk, &request.pool, &protocol, request.box_ref.as_ref())?;
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

/// What [`withdraw_private_in`] says when none of the private balance's
/// UTxOs it was given pays for the box's way back. Fixed English the worker
/// matches, never shown as it is.
pub const NO_PRIVATE_PAYS: &str =
    "Your private balance holds no UTxO of ADA alone that pays for this box's way back";

/// One of the wallet's boxes brought back with a UTxO of the private balance
/// paying its fee (34g's call 36: the private balance pays by default), as
/// JSON from the extension.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawPrivateRequest {
    pub network: String,
    pub params: serde_json::Value,
    pub pool: Vec<UtxoResponse>,
    /// The box to take; the first of ours in the pool when absent.
    pub box_ref: Option<OutRef>,
    /// The private balance's spendable UTxOs, in the order to try them: the
    /// first that pays is spent.
    pub utxos: Vec<UtxoResponse>,
}

/// A box brought back paid by the private balance, unsigned, as any Seedelf
/// spend: `signScriptSpend` adds giveme.my's and the one-time key's signatures.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawPrivateResult {
    pub tx_cbor: String,
    pub tx_hash: String,
    /// Its one-time key's seed, for `signScriptSpend`.
    pub seed: String,
    pub fee: String,
    /// Into the new register: the box's ADA and the private UTxO's, less the fee.
    pub lovelace: String,
    /// The private UTxO that paid, `txHash#index`.
    pub spent: String,
    /// Its ADA.
    pub spent_lovelace: String,
    pub box_ref: OutRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<api::TokenAmount>,
}

/// One of our boxes into a fresh register of the Seedelf key, its fee paid
/// by one of `request.utxos` (`lovejoin::withdraw_private`): for a box that
/// can't pay its own way back. Each is tried in the order given, and the
/// first that pays is spent; one that isn't the wallet's, holds a token, or
/// that the wallet's evaluator can't take (`seedelf_core::eval::refusal`) is
/// passed over, and so is one too small for the output (`PrivateTooSmall`).
/// None pays: [`NO_PRIVATE_PAYS`]. Spent together, the UTxO and the box are
/// tied to each other on chain; the worker says so before it's built. Its
/// proof is bound to a new one-time key, whose seed the answer carries, and
/// it's finished as any Seedelf spend: giveme.my sees it unsigned, lends the
/// collateral, then `signScriptSpend` adds both signatures. In the classic
/// pool, or the token pool `pool` names.
pub fn withdraw_private_in(
    sk: Scalar,
    request: WithdrawPrivateRequest,
    pool: Option<&PoolRef>,
) -> Result<WithdrawPrivateResult> {
    let network_flag = network_flag(&request.network)?;
    let params = ProtocolParameters::from_koios(&request.params)?;
    let protocol = protocol_of(network_flag, pool)?;
    let chosen = our_box(sk, &request.pool, &protocol, request.box_ref.as_ref())?;
    let destination = Register::create(sk)?.rerandomize()?;
    let seed = api::new_seed();
    let signer = api::key_hash(&api::one_time_key(&sk, &seed));
    for utxo in &request.utxos {
        if utxo.asset_list.as_ref().is_some_and(|a| !a.is_empty())
            || seedelf_core::eval::refusal(utxo).is_some()
        {
            continue;
        }
        let Some(register) = extract_bytes_with_logging(&utxo.inline_datum)
            .filter(|r| r.is_owned(sk).unwrap_or(false))
        else {
            continue;
        };
        let (z, g_r) = schnorr::create_proof(register, sk, hex::encode(signer))?;
        let payer = lovejoin::SeedelfPayer {
            coin: Coin::from_row(utxo)?,
            redeemer: create_spend_redeemer(z, g_r, hex::encode(signer))?,
            signer: *signer,
        };
        let built = match lovejoin::withdraw_private(
            &params,
            &protocol,
            std::slice::from_ref(&chosen),
            &sk,
            destination.clone(),
            &payer,
        ) {
            Ok(built) => built,
            Err(e) if e.downcast_ref::<lovejoin::PrivateTooSmall>().is_some() => continue,
            Err(e) => return Err(e),
        };
        return Ok(WithdrawPrivateResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            fee: built.fee.to_string(),
            lovelace: built.lovelace.to_string(),
            spent: format!("{}#{}", utxo.tx_hash, utxo.tx_index),
            spent_lovelace: payer.coin.lovelace.to_string(),
            box_ref: OutRef::of_box(&chosen),
            token: built.token.as_ref().map(|(t, q)| token_amount(t, *q)),
        });
    }
    bail!(NO_PRIVATE_PAYS)
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
        bail!(
            "The collateral service's signature doesn't match this transaction, so it wasn't sent"
        );
    }
    let signed = build::add_witnesses(&bytes, &[(key, Signature::from(signature))])?;
    Ok(FinishResult {
        tx_cbor: hex::encode(signed),
        tx_hash: hex::encode(*hash),
    })
}
