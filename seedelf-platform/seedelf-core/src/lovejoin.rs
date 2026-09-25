//! Lovejoin, the mixer (<https://github.com/logical-mechanism/Lovejoin>): its
//! preprod deployment, the pool's boxes, and the three transactions the wallet
//! makes with it.
//!
//! - **Deposit:** a key account locks 10 ₳ boxes at `mix_box`, each with an
//!   inline datum `{a, b}`. Nothing validates a deposit. The wallet's boxes are
//!   a Seedelf register's shape (`b = [x]·a`), owned by the Seedelf key.
//! - **Mix:** N boxes in, N re-randomized boxes out, in a random order, at
//!   outputs 0..N−1, with one sigma-OR proof per box in `mix_logic`'s
//!   withdraw-zero redeemer. A key account pays the fee and puts up the
//!   collateral: no fee shard, so the on-chain floor is N ≥ 2. The proofs bind
//!   only the box outputs, so the change is priced after the proofs are made.
//! - **Withdraw:** boxes into one fresh Seedelf register, paid from the boxes,
//!   with giveme.my's collateral and no key of ours on it. One Schnorr proof
//!   per box binds every output and input, so the fee is settled by building,
//!   proving and measuring until it stops moving.
//!
//! Every transaction here is measured in the wallet ([`crate::eval`]) against
//! the deployed scripts, bundled with their reference UTxOs
//! ([`crate::references`]), so a chain of them can be built before any is on
//! chain.

use crate::address::{collateral_address, wallet_contract};
use crate::build::{
    Budget, Budgets, DRAFT_BUDGET, MAX_TX_BUDGET, collateral_output, even, fake_signer, linear_fee,
    settle_fee,
};
use crate::constants::{COLLATERAL_HASH, VARIANT, get_config};
use crate::eval::{self, Resolved};
use crate::references;
use crate::transaction::{collateral_input, computation_fee};
use crate::withdraw_zero::WithdrawZero;
use anyhow::{Context, Result, anyhow, bail};
use blstrs::{G1Projective, Scalar};
use ff::Field;
use group::Group;
use hex_literal::hex;
use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_codec::minicbor;
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::{ExUnits, PlutusData, TransactionInput, TransactionOutput};
use pallas_primitives::{Fragment, MaybeIndefArray};
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{
    BuildConway, BuiltTransaction, Input, Output, ScriptKind, StagingTransaction,
};
use rand_core::{OsRng, RngCore};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use uplc::tx::to_plutus_data::ToPlutusData;

/// The Conway reference-script fee per byte, flat below the first 25 KiB tier.
const REFERENCE_SCRIPT_FEE_PER_BYTE: u64 = 15;

/// The unit datum, `Constr 0 []`: `mix_box`'s spend redeemer (it reads none).
const UNIT: [u8; 3] = hex!("d87980");

/// Lovejoin's deployment on a network, with what evaluating against it needs.
#[derive(Debug, Clone)]
pub struct Protocol {
    pub network_flag: bool,
    /// Every box holds exactly this, and only ADA (`denom_lovelace`).
    pub denom: u64,
    pub mix_box_hash: [u8; 28],
    pub mix_logic_hash: [u8; 28],
    /// The protocol's reference UTxO and the two scripts' reference UTxOs.
    pub references: Vec<Resolved>,
    /// The reference scripts' size, for the reference-script fee.
    pub script_bytes: u64,
}

impl Protocol {
    /// Lovejoin on preprod (`true`, as everywhere in the workspace). It isn't
    /// deployed on mainnet yet.
    pub fn of(network_flag: bool) -> Result<Self> {
        if !network_flag {
            bail!("Lovejoin isn't on mainnet yet");
        }
        let resolved = |tx_hash: [u8; 32], output: &str| -> Result<Resolved> {
            Ok(Resolved {
                tx_hash,
                index: 0,
                output: hex::decode(output)?,
            })
        };
        Ok(Protocol {
            network_flag,
            denom: 10_000_000,
            mix_box_hash: hex!("67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5"),
            mix_logic_hash: hex!("b7079c65f3b40b6da344bf68840eb0363af17787e8375004387348b8"),
            references: vec![
                resolved(
                    hex!("c5ed058606efdde7f1419c2f4b9497a2f8f3bbe4d3bb906b97cbab6c2b161190"),
                    references::LOVEJOIN_PREPROD_REFERENCE,
                )?,
                resolved(
                    hex!("c19c0157e236a8b01af13d7731b89d2329331588cdec3a12c5b6c599e8817a96"),
                    references::LOVEJOIN_PREPROD_MIX_BOX,
                )?,
                resolved(
                    hex!("06045afa3f79b25eb89c523bf9d08ef8d6605ed9c2207140cbc672669b039364"),
                    references::LOVEJOIN_PREPROD_MIX_LOGIC,
                )?,
            ],
            // mix_box 629 and mix_logic 3,156 bytes.
            script_bytes: 629 + 3_156,
        })
    }

    /// `mix_box`'s enterprise script address, where every box sits.
    pub fn mix_box_address(&self) -> Address {
        let network = if self.network_flag {
            Network::Testnet
        } else {
            Network::Mainnet
        };
        ShelleyAddress::new(
            network,
            ShelleyPaymentPart::Script(Hash::new(self.mix_box_hash)),
            ShelleyDelegationPart::Null,
        )
        .into()
    }

    fn reference_inputs(&self) -> Vec<Input> {
        self.references
            .iter()
            .map(|r| Input::new(Hash::new(r.tx_hash), r.index))
            .collect()
    }

    /// `serialise_data` of a box's value, `{"": {"": denom}}`, as the mix
    /// context takes it.
    fn denom_value_bytes(&self) -> Vec<u8> {
        let mut e = minicbor::Encoder::new(Vec::new());
        e.map(1)
            .and_then(|e| e.bytes(&[]))
            .and_then(|e| e.map(1))
            .and_then(|e| e.bytes(&[]))
            .and_then(|e| e.u64(self.denom))
            .expect("encoding into a Vec doesn't fail");
        e.into_writer()
    }
}

/// A box's datum, `Constr 0 [a, b]`, in the canonical form `serialise_data`
/// gives it (fields as an indefinite list), so what the mix context hashes is
/// byte for byte what the transaction holds.
pub fn mix_datum(a: &[u8; 48], b: &[u8; 48]) -> Vec<u8> {
    let mut e = minicbor::Encoder::new(Vec::new());
    e.tag(minicbor::data::Tag::new(121))
        .and_then(|e| e.begin_array())
        .and_then(|e| e.bytes(a))
        .and_then(|e| e.bytes(b))
        .and_then(|e| e.end())
        .expect("encoding into a Vec doesn't fail");
    e.into_writer()
}

/// `{a, b}` from a box's datum, if it's the well-formed shape.
fn parse_mix_datum(cbor: &[u8]) -> Option<([u8; 48], [u8; 48])> {
    let PlutusData::Constr(constr) = PlutusData::decode_fragment(cbor).ok()? else {
        return None;
    };
    if constr.tag != 121 || constr.any_constructor.is_some() {
        return None;
    }
    let [PlutusData::BoundedBytes(a), PlutusData::BoundedBytes(b)] = constr.fields.as_slice()
    else {
        return None;
    };
    let a: [u8; 48] = a.to_vec().try_into().ok()?;
    let b: [u8; 48] = b.to_vec().try_into().ok()?;
    (a != b).then_some((a, b))
}

/// A box in the pool: where it is and its `{a, b}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolBox {
    pub utxo: Resolved,
    pub a: [u8; 48],
    pub b: [u8; 48],
}

impl PoolBox {
    /// A pool row, if it's a box a mix may take: at `mix_box`, exactly the
    /// denomination in ADA alone, an inline `{a, b}` with `a ≠ b`, both points
    /// in G1's prime-order subgroup and neither the identity. Anything else at
    /// the address is someone's mistake, left alone.
    pub fn from_row(row: &UtxoResponse, protocol: &Protocol) -> Option<Self> {
        if row.value != protocol.denom.to_string()
            || row.asset_list.as_ref().is_some_and(|a| !a.is_empty())
            || row.payment_cred != hex::encode(protocol.mix_box_hash)
        {
            return None;
        }
        let (a, b) = parse_mix_datum(&hex::decode(&row.inline_datum.as_ref()?.bytes).ok()?)?;
        let boxed = PoolBox {
            utxo: eval::resolve_row(row).ok()?,
            a,
            b,
        };
        boxed.points().ok().map(|_| boxed)
    }

    /// A UTxO this wallet knows the bytes of (a chain's own output, say), if
    /// it's a box a mix may take, by the same rules as [`Self::from_row`].
    pub fn from_resolved(utxo: Resolved, protocol: &Protocol) -> Option<Self> {
        let TransactionOutput::PostAlonzo(output) =
            minicbor::decode::<TransactionOutput>(&utxo.output).ok()?
        else {
            return None;
        };
        if output.address.to_vec() != protocol.mix_box_address().to_vec()
            || output.value != pallas_primitives::conway::Value::Coin(protocol.denom)
        {
            return None;
        }
        let Some(pallas_primitives::conway::DatumOption::Data(data)) = output.datum_option else {
            return None;
        };
        let (a, b) = parse_mix_datum(&data.0.encode_fragment().ok()?)?;
        let boxed = PoolBox { utxo, a, b };
        boxed.points().ok().map(|_| boxed)
    }

    fn points(&self) -> Result<(G1Projective, G1Projective)> {
        let a = crypto::point_from_bytes(&self.a)?;
        let b = crypto::point_from_bytes(&self.b)?;
        if bool::from(a.is_identity()) || bool::from(b.is_identity()) {
            bail!("A box's points can't be the identity");
        }
        Ok((a, b))
    }

    /// Whether `sk` owns the box: `b = [sk]·a`, the Seedelf register check.
    pub fn is_owned(&self, sk: &Scalar) -> bool {
        self.points().is_ok_and(|(a, b)| a * sk == b)
    }

    fn input(&self) -> Input {
        Input::new(Hash::new(self.utxo.tx_hash), self.utxo.index)
    }
}

/// A key account's ADA-only UTxO: a fee input, a collateral, or change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coin {
    pub utxo: Resolved,
    pub lovelace: u64,
}

impl Coin {
    /// A Koios row, if it holds ADA alone.
    pub fn from_row(row: &UtxoResponse) -> Result<Self> {
        if row.asset_list.as_ref().is_some_and(|a| !a.is_empty()) {
            bail!(
                "UTxO {}#{} holds tokens; only ADA pays for Lovejoin",
                row.tx_hash,
                row.tx_index
            );
        }
        Ok(Coin {
            utxo: eval::resolve_row(row)?,
            lovelace: row.value.parse().context("A UTxO's value isn't a number")?,
        })
    }

    fn input(&self) -> Input {
        Input::new(Hash::new(self.utxo.tx_hash), self.utxo.index)
    }
}

/// Who pays a deposit or a mix: its fee comes from `fee`, its collateral is
/// `collateral` (left unspent), and the change goes back to `address`.
/// `signers` is how many keys sign it (the fee's and the collateral's): a
/// session's one key, or two of a public account's.
#[derive(Debug, Clone)]
pub struct Payer {
    pub fee: Coin,
    pub collateral: Coin,
    pub address: Address,
    pub signers: usize,
}

/// The least an ADA-only output at `address` may hold.
fn least_change(params: &ProtocolParameters, address: &Address) -> Result<u64> {
    crate::transaction::calculate_min_required_utxo(Output::new(address.clone(), 1_000_000), params)
}

fn price(params: &ProtocolParameters, size: u64, budgets: &[Budget], script_bytes: u64) -> u64 {
    linear_fee(params, size)
        + budgets
            .iter()
            .map(|b| computation_fee(params, b.mem, b.steps))
            .sum::<u64>()
        + script_bytes * REFERENCE_SCRIPT_FEE_PER_BYTE
}

/// A budget as a staged redeemer carries it.
fn staged_units(budget: Budget) -> pallas_txbuilder::ExUnits {
    pallas_txbuilder::ExUnits {
        mem: budget.mem,
        steps: budget.steps,
    }
}

/// A budget as the withdraw-zero patch writes it.
fn units(budget: Budget) -> ExUnits {
    ExUnits {
        mem: budget.mem,
        steps: budget.steps,
    }
}

fn signed_size(tx: &BuiltTransaction, signers: usize) -> Result<u64> {
    let mut signed = tx.clone();
    for _ in 0..signers {
        signed = signed
            .sign(fake_signer())
            .context("Failed To Sign The Draft Transaction")?;
    }
    Ok(signed.tx_bytes.0.len() as u64)
}

/// A deposit: the boxes it made, and the account's change (which pays the
/// mixes that follow).
#[derive(Debug, Clone)]
pub struct Deposit {
    pub tx: BuiltTransaction,
    pub fee: u64,
    pub boxes: Vec<PoolBox>,
    pub change: Coin,
}

/// Locks one box per register in `owners` (each already re-randomized, so
/// its `{a, b}` is fresh), paid from `inputs`, with the rest back to
/// `change_address`. Key-signed, by `signers` keys.
pub fn deposit(
    params: &ProtocolParameters,
    protocol: &Protocol,
    inputs: &[Coin],
    owners: &[Register],
    change_address: &Address,
    signers: usize,
) -> Result<Deposit> {
    if owners.is_empty() {
        bail!("A deposit needs at least one box");
    }
    let datums: Vec<([u8; 48], [u8; 48])> = owners
        .iter()
        .map(|r| {
            if !crate::build::is_payable(r) {
                bail!("A box's register must be a valid, non-identity register");
            }
            let a: [u8; 48] = hex::decode(&r.generator)?
                .try_into()
                .map_err(|_| anyhow!("a bad generator"))?;
            let b: [u8; 48] = hex::decode(&r.public_value)?
                .try_into()
                .map_err(|_| anyhow!("a bad public value"))?;
            Ok((a, b))
        })
        .collect::<Result<_>>()?;
    let total: u64 = inputs.iter().map(|c| c.lovelace).sum();
    let boxed = protocol.denom * owners.len() as u64;
    let least = least_change(params, change_address)?;
    let (fee, staged) = settle_fee(params, signers, |fee| {
        let change = total
            .checked_sub(boxed + fee)
            .filter(|c| *c >= least)
            .context("There isn't enough ADA for these boxes, the fee and the change")?;
        let mut tx = StagingTransaction::new();
        for coin in inputs {
            tx = tx.input(coin.input());
        }
        for (a, b) in &datums {
            tx = tx.output(
                Output::new(protocol.mix_box_address(), protocol.denom)
                    .set_inline_datum(mix_datum(a, b)),
            );
        }
        Ok(tx
            .output(Output::new(change_address.clone(), change))
            .fee(fee))
    })?;
    let tx = staged
        .build_conway_raw()
        .context("Failed To Build The Deposit")?;
    let outputs = eval::resolve_outputs(&tx.tx_bytes.0)?;
    let boxes = datums
        .iter()
        .zip(&outputs)
        .map(|((a, b), utxo)| PoolBox {
            utxo: utxo.clone(),
            a: *a,
            b: *b,
        })
        .collect();
    let change = Coin {
        utxo: outputs.last().context("The deposit has no change")?.clone(),
        lovelace: total - boxed - fee,
    };
    Ok(Deposit {
        tx,
        fee,
        boxes,
        change,
    })
}

/// A mix: the boxes it made (in output order) and the payer's change.
#[derive(Debug, Clone)]
pub struct Mix {
    pub tx: BuiltTransaction,
    pub fee: u64,
    pub outputs: Vec<PoolBox>,
    pub change: Coin,
    /// Where each input box (in the order given) went among `outputs`.
    pub moved_to: Vec<usize>,
}

/// A random scalar in `[1, r)`.
fn nonzero_scalar() -> Scalar {
    loop {
        let s = Scalar::random(&mut OsRng);
        if !bool::from(s.is_zero()) {
            return s;
        }
    }
}

/// A uniformly random permutation of `0..n`.
fn permutation(n: usize) -> Vec<usize> {
    let mut p: Vec<usize> = (0..n).collect();
    shuffle(&mut p);
    p
}

/// `Constr tag fields` as Plutus data.
fn constr(index: u64, fields: Vec<PlutusData>) -> PlutusData {
    PlutusData::Constr(pallas_primitives::Constr {
        tag: 121 + index,
        any_constructor: None,
        fields: MaybeIndefArray::Indef(fields),
    })
}

fn bytes_data(bytes: &[u8]) -> PlutusData {
    PlutusData::BoundedBytes(bytes.to_vec().into())
}

fn list(items: Vec<PlutusData>) -> PlutusData {
    PlutusData::Array(MaybeIndefArray::Indef(items))
}

/// Mixes `boxes` (two or more, none of them ours to know) into as many fresh
/// ones, paid by `payer`. Measured against `mix_logic` before it's returned.
pub fn mix(
    params: &ProtocolParameters,
    protocol: &Protocol,
    boxes: &[PoolBox],
    payer: &Payer,
) -> Result<Mix> {
    let n = boxes.len();
    if n < 2 {
        bail!("A mix needs at least two boxes");
    }
    // The ledger's order, which the redeemer's proofs follow.
    let mut sorted: Vec<&PoolBox> = boxes.iter().collect();
    sorted.sort_by_key(|b| (b.utxo.tx_hash, b.utxo.index));
    sorted.dedup_by_key(|b| (b.utxo.tx_hash, b.utxo.index));
    if sorted.len() != n {
        bail!("A box can't be mixed twice in one transaction");
    }

    let perm = permutation(n);
    let ys: Vec<Scalar> = (0..n).map(|_| nonzero_scalar()).collect();
    let mut outputs = vec![(G1Projective::identity(), G1Projective::identity()); n];
    for (i, boxed) in sorted.iter().enumerate() {
        let (a, b) = boxed.points()?;
        outputs[perm[i]] = (a * ys[i], b * ys[i]);
    }
    let out_bytes: Vec<([u8; 48], [u8; 48])> = outputs
        .iter()
        .map(|(a, b)| (crypto::point_to_bytes(a), crypto::point_to_bytes(b)))
        .collect();
    let datums: Vec<Vec<u8>> = out_bytes.iter().map(|(a, b)| mix_datum(a, b)).collect();

    // ctx = blake2b_256(datums 0..N−1 ‖ values 0..N−1 ‖ mix_box's hash)
    let mut preimage: Vec<u8> = datums.concat();
    let value = protocol.denom_value_bytes();
    for _ in 0..n {
        preimage.extend_from_slice(&value);
    }
    preimage.extend_from_slice(&protocol.mix_box_hash);
    let ctx = crypto::blake2b_256(&preimage);

    let mut proofs = Vec::with_capacity(n);
    for (i, boxed) in sorted.iter().enumerate() {
        let (a, b) = boxed.points()?;
        let branches = crypto::prove_sigma_or(&a, &b, &outputs, perm[i], &ys[i], &ctx)?;
        proofs.push(constr(
            0,
            vec![list(
                branches
                    .iter()
                    .map(|br| {
                        constr(
                            0,
                            vec![
                                bytes_data(&br.t0),
                                bytes_data(&br.t1),
                                bytes_data(&br.c),
                                bytes_data(&br.z),
                            ],
                        )
                    })
                    .collect(),
            )],
        ));
    }
    let redeemer = constr(1, vec![list(proofs)])
        .encode_fragment()
        .map_err(|e| anyhow!("{e}"))?;
    let withdraw = WithdrawZero::new(&protocol.mix_logic_hash, protocol.network_flag, &redeemer)?;

    let mut all_inputs: Vec<Input> = sorted.iter().map(|b| b.input()).collect();
    all_inputs.push(payer.fee.input());
    all_inputs.sort_by_key(|i| (i.tx_hash.0, i.txo_index));

    let least = least_change(params, &payer.address)?;
    let stage = |fee: u64, budgets: Option<&Budgets>| -> Result<BuiltTransaction> {
        let change = payer
            .fee
            .lovelace
            .checked_sub(fee)
            .filter(|c| *c >= least)
            .context("There isn't enough ADA left to pay this mix's fee and keep the change")?;
        let collateral_back = payer
            .collateral
            .lovelace
            .checked_sub(fee * 3 / 2 + 1)
            .context("The collateral can't cover this mix")?;
        let mut tx = StagingTransaction::new();
        for boxed in &sorted {
            let index = all_inputs
                .iter()
                .position(|i| *i == boxed.input())
                .expect("sorted in");
            let budget = budgets
                .and_then(|b| b.spend(index as u64))
                .unwrap_or(DRAFT_BUDGET);
            tx = tx.input(boxed.input()).add_spend_redeemer(
                boxed.input(),
                UNIT.to_vec(),
                Some(staged_units(budget)),
            );
        }
        tx = tx.input(payer.fee.input());
        for (a, b) in &out_bytes {
            tx = tx.output(
                Output::new(protocol.mix_box_address(), protocol.denom)
                    .set_inline_datum(mix_datum(a, b)),
            );
        }
        tx = tx.output(Output::new(payer.address.clone(), change));
        for reference in protocol.reference_inputs() {
            tx = tx.reference_input(reference);
        }
        tx = tx
            .collateral_input(payer.collateral.input())
            .collateral_output(Output::new(payer.address.clone(), collateral_back))
            .fee(fee)
            .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone());
        let built = tx.build_conway_raw().context("Failed To Build The Mix")?;
        let reward = budgets.and_then(|b| b.withdraw(0)).unwrap_or(DRAFT_BUDGET);
        withdraw.patch(built, units(reward), &params.cost_model_v3)
    };

    let mut known: Vec<Resolved> = sorted.iter().map(|b| b.utxo.clone()).collect();
    known.push(payer.fee.utxo.clone());
    known.push(payer.collateral.utxo.clone());
    known.extend(protocol.references.iter().cloned());
    let measure = |tx: &BuiltTransaction| -> Result<(Budgets, Vec<Budget>)> {
        let answer = eval::evaluate(
            &tx.tx_bytes.0,
            &known,
            &params.cost_model_v3,
            protocol.network_flag,
        )?;
        let budgets = Budgets::from_ogmios(&answer)?;
        let mut used = Vec::with_capacity(n + 1);
        for boxed in &sorted {
            let index = all_inputs
                .iter()
                .position(|i| *i == boxed.input())
                .expect("sorted in");
            used.push(budgets.spend(index as u64).context("No budget for a box")?);
        }
        used.push(budgets.withdraw(0).context("No budget for mix_logic")?);
        Ok((budgets, used))
    };

    let draft = stage(1_000_000, None)?;
    let (budgets, used) = measure(&draft)?;
    let total = used
        .iter()
        .fold(Budget { mem: 0, steps: 0 }, |a, b| Budget {
            mem: a.mem + b.mem,
            steps: a.steps + b.steps,
        });
    if total.mem > MAX_TX_BUDGET.mem || total.steps > MAX_TX_BUDGET.steps {
        bail!("Mixing {n} boxes at once needs more computation than a transaction may use");
    }
    let mut fee = 1_000_000;
    for _ in 0..5 {
        let tx = stage(fee, Some(&budgets))?;
        let needed = price(
            params,
            signed_size(&tx, payer.signers)?,
            &used,
            protocol.script_bytes,
        );
        if needed <= fee && fee - needed < 1_000 {
            break;
        }
        fee = needed;
    }
    let tx = stage(fee, Some(&budgets))?;
    // The finished transaction must pass as it will be sent.
    measure(&tx)?;

    let resolved = eval::resolve_outputs(&tx.tx_bytes.0)?;
    let outputs: Vec<PoolBox> = out_bytes
        .iter()
        .zip(&resolved)
        .map(|((a, b), utxo)| PoolBox {
            utxo: utxo.clone(),
            a: *a,
            b: *b,
        })
        .collect();
    let change = Coin {
        utxo: resolved.get(n).context("The mix has no change")?.clone(),
        lovelace: payer.fee.lovelace - fee,
    };
    let moved_to = boxes
        .iter()
        .map(|b| {
            let i = sorted
                .iter()
                .position(|s| s.utxo == b.utxo)
                .expect("sorted from boxes");
            perm[i]
        })
        .collect();
    Ok(Mix {
        tx,
        fee,
        outputs,
        change,
        moved_to,
    })
}

/// A withdraw, ready for giveme.my's collateral signature: the register the
/// boxes went to and what it holds.
#[derive(Debug, Clone)]
pub struct Withdraw {
    pub tx: BuiltTransaction,
    pub fee: u64,
    pub lovelace: u64,
    pub register: Register,
}

/// `blake2b_256(serialise_data(outputs) ‖ serialise_data(input refs) ‖
/// mix_box's hash)`: what an owner's Schnorr proof binds, read from a built
/// transaction exactly as the ledger hands it to `mix_logic`.
pub fn owner_context(tx_cbor: &[u8], mix_box_hash: &[u8; 28]) -> Result<[u8; 32]> {
    let tx =
        MultiEraTx::decode(tx_cbor).map_err(|e| anyhow!("The transaction can't be read: {e}"))?;
    let conway = tx.as_conway().context("Not a Conway transaction")?;
    let outputs: Vec<TransactionOutput> = conway
        .transaction_body
        .outputs
        .iter()
        .map(|o| TransactionOutput::from(o.clone()))
        .collect();
    let mut inputs: Vec<TransactionInput> =
        conway.transaction_body.inputs.iter().cloned().collect();
    inputs.sort_by_key(|i| (i.transaction_id, i.index));
    let mut preimage = uplc::plutus_data_to_bytes(&outputs.to_plutus_data());
    preimage.extend(uplc::plutus_data_to_bytes(&inputs.to_plutus_data()));
    preimage.extend_from_slice(mix_box_hash);
    Ok(crypto::blake2b_256(&preimage))
}

/// Takes `boxes`, all owned by `owner`, into `destination` (a fresh
/// re-randomization of the Seedelf register), paying the fee from them, with
/// giveme.my's collateral. Measured against the scripts before it's returned.
pub fn withdraw(
    params: &ProtocolParameters,
    protocol: &Protocol,
    boxes: &[PoolBox],
    owner: &Scalar,
    destination: Register,
) -> Result<Withdraw> {
    if boxes.is_empty() {
        bail!("A withdraw needs a box");
    }
    if !crate::build::is_payable(&destination) {
        bail!("The destination register must be a valid, non-identity register");
    }
    let mut sorted: Vec<&PoolBox> = boxes.iter().collect();
    sorted.sort_by_key(|b| (b.utxo.tx_hash, b.utxo.index));
    sorted.dedup_by_key(|b| (b.utxo.tx_hash, b.utxo.index));
    if sorted.iter().any(|b| !b.is_owned(owner)) {
        bail!("A box to withdraw isn't this wallet's");
    }
    let config = get_config(VARIANT, protocol.network_flag)?;
    let to = wallet_contract(protocol.network_flag, config.contract.wallet_contract_hash);
    let datum = destination.to_vec()?;
    let total = protocol.denom * sorted.len() as u64;

    let stage =
        |fee: u64, budgets: Option<&Budgets>, redeemer: &[u8]| -> Result<BuiltTransaction> {
            let lovelace = total
                .checked_sub(fee)
                .context("The boxes can't pay the fee")?;
            let mut tx = StagingTransaction::new();
            for (index, boxed) in sorted.iter().enumerate() {
                let budget = budgets
                    .and_then(|b| b.spend(index as u64))
                    .unwrap_or(DRAFT_BUDGET);
                tx = tx.input(boxed.input()).add_spend_redeemer(
                    boxed.input(),
                    UNIT.to_vec(),
                    Some(staged_units(budget)),
                );
            }
            tx = tx.output(Output::new(to.clone(), lovelace).set_inline_datum(datum.clone()));
            for reference in protocol.reference_inputs() {
                tx = tx.reference_input(reference);
            }
            tx = tx
                .collateral_input(collateral_input(protocol.network_flag))
                .collateral_output(collateral_output(
                    collateral_address(protocol.network_flag),
                    fee,
                )?)
                .fee(fee)
                .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone())
                .disclosed_signer(Hash::new(COLLATERAL_HASH));
            let built = tx
                .build_conway_raw()
                .context("Failed To Build The Withdraw")?;
            let reward = budgets.and_then(|b| b.withdraw(0)).unwrap_or(DRAFT_BUDGET);
            WithdrawZero::new(&protocol.mix_logic_hash, protocol.network_flag, redeemer)?.patch(
                built,
                units(reward),
                &params.cost_model_v3,
            )
        };
    // Owner { proofs }, one Schnorr proof per box in the ledger's order.
    let prove = |tx: &BuiltTransaction| -> Result<Vec<u8>> {
        let ctx = owner_context(&tx.tx_bytes.0, &protocol.mix_box_hash)?;
        let mut proofs = Vec::with_capacity(sorted.len());
        for boxed in &sorted {
            let (a, _) = boxed.points()?;
            let proof = crypto::prove_schnorr(&a, owner, &ctx)?;
            proofs.push(constr(0, vec![bytes_data(&proof.t), bytes_data(&proof.z)]));
        }
        constr(0, vec![list(proofs)])
            .encode_fragment()
            .map_err(|e| anyhow!("{e}"))
    };
    let mut known: Vec<Resolved> = sorted.iter().map(|b| b.utxo.clone()).collect();
    known.extend(protocol.references.iter().cloned());
    let measure = |tx: &BuiltTransaction| -> Result<(Budgets, Vec<Budget>)> {
        let answer = eval::evaluate(
            &tx.tx_bytes.0,
            &known,
            &params.cost_model_v3,
            protocol.network_flag,
        )?;
        let budgets = Budgets::from_ogmios(&answer)?;
        let mut used = Vec::with_capacity(sorted.len() + 1);
        for index in 0..sorted.len() as u64 {
            used.push(budgets.spend(index).context("No budget for a box")?);
        }
        used.push(budgets.withdraw(0).context("No budget for mix_logic")?);
        Ok((budgets, used))
    };
    // A placeholder with a real proof's size, for the first build.
    let placeholder = {
        let (a, _) = sorted[0].points()?;
        let proof = crypto::prove_schnorr(&a, owner, &[0u8; 32])?;
        let one = constr(0, vec![bytes_data(&proof.t), bytes_data(&proof.z)]);
        constr(0, vec![list(vec![one; sorted.len()])])
            .encode_fragment()
            .map_err(|e| anyhow!("{e}"))?
    };

    // Each round's proof is new, and its scalars' sizes move the budget by a
    // hair, so the transaction declares 1% over what was measured, and is
    // priced on what it declares (which the ledger charges).
    let mut fee = 500_000;
    let mut declared: Option<Budgets> = None;
    for _ in 0..8 {
        let unproven = stage(fee, declared.as_ref(), &placeholder)?;
        let redeemer = prove(&unproven)?;
        let tx = stage(fee, declared.as_ref(), &redeemer)?;
        let (measured, _) = measure(&tx)?;
        match &declared {
            Some(d) if d.covers(&measured) => {
                let mut charged = Vec::with_capacity(sorted.len() + 1);
                for index in 0..sorted.len() as u64 {
                    charged.push(d.spend(index).context("No budget for a box")?);
                }
                charged.push(d.withdraw(0).context("No budget for mix_logic")?);
                let needed = price(
                    params,
                    signed_size(&tx, 1)?,
                    &charged,
                    protocol.script_bytes,
                );
                if needed <= fee && fee - needed < 5_000 {
                    return Ok(Withdraw {
                        tx,
                        fee,
                        lovelace: total - fee,
                        register: destination,
                    });
                }
                // Even, so giveme.my's collateral return (5 ₳ − 3/2 × fee) is
                // whole: an odd fee left it half a lovelace short of what the
                // ledger asks, which it rounds up (InsufficientCollateral).
                fee = even(needed);
            }
            _ => declared = Some(measured.with_margin(1)),
        }
    }
    bail!("The withdraw's fee did not settle")
}

/// Mixes one box goes through, fanned out `depth` waves deep, three wide:
/// every output of a wave is mixed again in the next, so which leaf is ours
/// stays one of `3^depth` (Lovejoin's `strategy/fanout.ts`).
pub fn mixes_per_box(depth: u32) -> usize {
    (3usize.pow(depth) - 1) / 2
}

/// What the wallet plans on for a 3-box mix before measuring one: preprod's
/// cost 0.877 ₳, rounded up.
pub const MIX_FEE_ESTIMATE: u64 = 950_000;

/// What a deposit and the change it leaves are planned on.
const DEPOSIT_RESERVE: u64 = 1_500_000;

/// What a box costs at `depth`: the box, and every mix of its fan-out.
fn per_box(depth: u32, denom: u64) -> u64 {
    denom + mixes_per_box(depth) as u64 * MIX_FEE_ESTIMATE
}

/// How many boxes `spare` lovelace pays for, with every mix of a `depth`-deep
/// fan-out and the deposit: none if it can't pay for one.
pub fn boxes_affordable(spare: u64, depth: u32, denom: u64) -> usize {
    (spare.saturating_sub(DEPOSIT_RESERVE) / per_box(depth, denom)) as usize
}

/// What pays for `boxes` boxes at `depth` ([`boxes_affordable`]'s plan run
/// backwards): the boxes, every mix, and the deposit and its change. What
/// the mixes don't use comes back with the change.
pub fn funding_for(boxes: usize, depth: u32, denom: u64) -> u64 {
    DEPOSIT_RESERVE + boxes as u64 * per_box(depth, denom)
}

/// What pays for a chain: the key account's ADA-only `coins`, its
/// `collateral` (never spent by the chain), and its `address` for change.
/// The deposit is signed by `deposit_signers` keys (the coins'), each mix by
/// `mix_signers` (the change's and the collateral's).
#[derive(Debug, Clone)]
pub struct Funding {
    pub coins: Vec<Coin>,
    pub collateral: Coin,
    pub address: Address,
    pub deposit_signers: usize,
    pub mix_signers: usize,
}

/// A transaction of a chain, in the order it's sent.
#[derive(Debug, Clone)]
pub struct ChainTx {
    /// `deposit` or `mix`.
    pub kind: &'static str,
    pub tx: BuiltTransaction,
    pub fee: u64,
}

/// A chain through Lovejoin: its transactions in order, our boxes at the
/// end of it, and the payer's last change.
#[derive(Debug, Clone)]
pub struct Chain {
    pub txs: Vec<ChainTx>,
    pub leaves: Vec<PoolBox>,
    pub change: Coin,
}

/// Builds a whole chain before any of it is sent: a deposit of one box per
/// register in `owners` from `coins`, then each box fanned out `depth` waves
/// deep with fresh boxes drawn at random from `pool` (never one twice). Each
/// wave's mixes go in a random order, so the order doesn't point at our
/// branch. Every transaction pays from the one before's change; the
/// collateral is never spent. Each is measured against the scripts.
pub fn chain(
    params: &ProtocolParameters,
    protocol: &Protocol,
    funding: &Funding,
    owners: &[Register],
    depth: u32,
    pool: &[PoolBox],
) -> Result<Chain> {
    let Funding {
        coins,
        collateral,
        address,
        deposit_signers,
        mix_signers,
    } = funding;
    if !(1..=3).contains(&depth) {
        bail!("The fan-out is 1 to 3 waves deep");
    }
    let needed = owners.len() * mixes_per_box(depth) * 2;
    if pool.len() < needed {
        bail!(
            "Lovejoin's pool has {} boxes to mix with, and this needs {needed}",
            pool.len()
        );
    }
    let mut fresh: Vec<PoolBox> = pool.to_vec();
    shuffle(&mut fresh);

    let deposit = deposit(params, protocol, coins, owners, address, *deposit_signers)?;
    let mut txs = vec![ChainTx {
        kind: "deposit",
        tx: deposit.tx.clone(),
        fee: deposit.fee,
    }];
    let mut change = deposit.change.clone();
    let mut ours: Vec<PoolBox> = deposit.boxes.clone();
    // Every box of every tree in this wave; ours are among them.
    let mut wave: Vec<PoolBox> = deposit.boxes;
    for _ in 0..depth {
        shuffle(&mut wave);
        let mut next = Vec::with_capacity(wave.len() * 3);
        let mut ours_next = Vec::new();
        for boxed in &wave {
            let others = [
                fresh.pop().expect("counted above"),
                fresh.pop().expect("counted above"),
            ];
            let inputs = vec![boxed.clone(), others[0].clone(), others[1].clone()];
            let payer = Payer {
                fee: change.clone(),
                collateral: collateral.clone(),
                address: address.clone(),
                signers: *mix_signers,
            };
            let mixed = mix(params, protocol, &inputs, &payer)?;
            if ours.contains(boxed) {
                ours_next.push(mixed.outputs[mixed.moved_to[0]].clone());
            }
            change = mixed.change.clone();
            next.extend(mixed.outputs.iter().cloned());
            txs.push(ChainTx {
                kind: "mix",
                tx: mixed.tx,
                fee: mixed.fee,
            });
        }
        ours = ours_next;
        wave = next;
    }
    Ok(Chain {
        txs,
        leaves: ours,
        change,
    })
}

/// Shuffles in place, uniformly (Fisher–Yates).
fn shuffle<T>(items: &mut [T]) {
    for i in (1..items.len()).rev() {
        let j = (OsRng.next_u64() % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
}
