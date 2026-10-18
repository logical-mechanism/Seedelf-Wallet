//! Lovejoin, the mixer (<https://github.com/logical-mechanism/Lovejoin>): its
//! pools, their boxes, and the three transactions the wallet makes with them.
//!
//! A pool ([`Protocol`]) is one launch of Lovejoin's scripts: its boxes hold
//! exactly its box value ([`BoxValue`]) and mix only with each other. The
//! classic pool, live on preprod and mainnet, holds 10 ₳ a box and is bundled
//! whole ([`Protocol::of`]). A token pool, on the generalized scripts of
//! Lovejoin's PR #163, holds `box_lovelace` and `Q` of one token a box; it's
//! found on chain and trusted only once its scripts are derived from its seed
//! ([`verify_pool`]). One prover serves both: only the value's bytes differ.
//!
//! - **Deposit:** a key account locks boxes at `mix_box`, each with an
//!   inline datum `{a, b}`. Nothing validates a deposit. The wallet's boxes are
//!   a Seedelf register's shape (`b = [x]·a`), owned by the Seedelf key, in
//!   every pool: one scalar across pools leaves boxes unlinkable under DDH,
//!   as it does across one pool's boxes.
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
//! A [`chain`] is a deposit and each of its boxes fanned out; [`again`] fans
//! out boxes of ours already in the pool, with no deposit.
//!
//! Every transaction here is measured in the wallet ([`crate::eval`]) against
//! the deployed scripts, bundled with their reference UTxOs
//! ([`crate::references`]), so a chain of them can be built before any is on
//! chain.

use crate::address::{collateral_address, wallet_contract};
use crate::assets::{Asset, Assets};
use crate::build::{
    Budget, Budgets, DRAFT_BUDGET, MAX_TX_BUDGET, NotEnough, check_fee, collateral_output, even,
    fake_signer, linear_fee, reference_script_fee, settle_fee,
};
use crate::cbor;
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
use pallas_primitives::conway::{
    ExUnits, PlutusData, ScriptRef, TransactionInput, TransactionOutput,
};
use pallas_primitives::{Fragment, MaybeIndefArray};
use pallas_traverse::{Era, MultiEraOutput, MultiEraTx};
use pallas_txbuilder::{
    BuildConway, BuiltTransaction, Input, Output, ScriptKind, StagingTransaction,
};
use rand_core::{OsRng, RngCore};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use uplc::tx::to_plutus_data::ToPlutusData;

mod box_value;
mod launch;
mod pool;
pub mod templates;
mod value;

pub use box_value::{
    BOX_MARGIN, BOX_STEP, MAX_TOKEN_BOX_LOVELACE, Probe, WayBack, least_box_lovelace,
    suggested_box_lovelace, way_back,
};
pub use launch::{
    AccountLaunch, FinalAccountLaunch, Launch, Locked, Terms, launch, launch_apart,
    launch_from_account, launched_pool,
};

pub use pool::{
    CLASSIC_LOVELACE, MAX_TOKEN_QUANTITY, ReferenceDatum, Rejected, Unusable, Usable, candidate,
    comes_back, find_seed, holder_address, policy_of, usable, verify_pool,
};
pub use value::{BoxToken, BoxValue};

/// The unit datum, `Constr 0 []`: `mix_box`'s spend redeemer (it reads none).
const UNIT: [u8; 3] = hex!("d87980");

/// Which of Lovejoin's scripts a pool runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Version {
    /// The classic ADA pool's, with its five-field reference datum: live on
    /// mainnet since 2026-09-26, and on preprod.
    Classic,
    /// The generalized scripts of Lovejoin's PR #163 ([`templates`]), with an
    /// eight-field datum: every token pool's.
    TokenV1,
}

/// A pool: one launch of Lovejoin's scripts on a network, with what
/// evaluating against it needs. (Its name is older than token pools.)
#[derive(Debug, Clone)]
pub struct Protocol {
    pub network_flag: bool,
    /// Every box holds exactly this much ADA (`box_lovelace`; the classic
    /// pool's `denom_lovelace`), and [`Self::token`] besides.
    pub denom: u64,
    pub mix_box_hash: [u8; 28],
    pub mix_logic_hash: [u8; 28],
    /// The pool's reference UTxO, and its scripts' reference UTxOs where
    /// they're read by reference.
    pub references: Vec<Resolved>,
    /// The reference scripts' size, for the reference-script fee, read from
    /// `references`.
    pub script_bytes: u64,
    pub version: Version,
    /// The pool's id: the policy of its `lovejoin` NFT, P.
    pub id: [u8; 28],
    /// What every box holds besides [`Self::denom`]: a token pool's token.
    pub token: Option<BoxToken>,
    /// The most a fee shard pays a mix (`max_fee_per_mix_lovelace`). The
    /// wallet pays its own fees and never draws on a shard.
    pub max_fee: u64,
    /// `fee_contract`'s hash, F, which the wallet never uses.
    pub fee_hash: [u8; 28],
    /// Scripts every transaction carries in its witnesses, because no
    /// reference to them is trusted (none at the holder): `mix_box`,
    /// `mix_logic`, or both. Empty for the classic pool.
    pub inline_scripts: Vec<Vec<u8>>,
    /// The UTxO the launch spent, when known: what proves the pool genuine.
    pub seed: Option<([u8; 32], u64)>,
}

impl Protocol {
    /// Lovejoin on preprod (`true`, as everywhere in the workspace) or on
    /// mainnet (`false`, live since 2026-09-26). Mainnet's scripts are
    /// preprod's logic recompiled, so their hashes and sizes differ.
    ///
    /// The reference scripts' size, which prices every mix and withdraw, is
    /// read from the bundled reference outputs, never typed in: mainnet's
    /// `mix_logic` is 3,161 bytes to preprod's 3,156, and preprod's number
    /// would have priced every mainnet mix 75 lovelace under the ledger's
    /// minimum.
    pub fn of(network_flag: bool) -> Result<Self> {
        let resolved = |tx_hash: [u8; 32], output: &str| -> Result<Resolved> {
            Ok(Resolved {
                tx_hash,
                index: 0,
                output: hex::decode(output)?,
            })
        };
        // Lovejoin's artifacts/<network>/addresses.json: each pool's NFT
        // policy, its fee shards' script, and its five-field datum's fee cap.
        let (id, fee_hash, max_fee, seed) = if network_flag {
            (
                hex!("8ca2cc1836ff9c001384cd5c3c77ef1dab063c8048e801e27eb3ad42"),
                hex!("64802866996e4712904ed21cfe36dd9b4c6672fe4051d5578086514a"),
                2_000_000,
                None,
            )
        } else {
            (
                hex!("f5592689c7ab35553a3234a54c0ee118090a5762c696819a53a5a826"),
                hex!("a072c7e839ab9ddf24344d0b2f70f56971f187fee8089f5f64212406"),
                1_000_000,
                Some((
                    hex!("ba815aa54b022a347a3e5e84d5491334cf6f878916eebeeb7f9014da9dc369bb"),
                    2,
                )),
            )
        };
        let (mix_box_hash, mix_logic_hash, references) = if network_flag {
            (
                hex!("67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5"),
                hex!("b7079c65f3b40b6da344bf68840eb0363af17787e8375004387348b8"),
                vec![
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
            )
        } else {
            // Lovejoin cb5a5a3, artifacts/mainnet/addresses.json.
            (
                hex!("c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad"),
                hex!("0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e"),
                vec![
                    resolved(
                        hex!("f89cb43a55eed378fe90fe954a9d86566280e6416d97f9008937ab492b37175c"),
                        references::LOVEJOIN_MAINNET_REFERENCE,
                    )?,
                    resolved(
                        hex!("7d21335ffea6d3e8144ecb55f62f045f3fecd1414c932c62d7edd2886a57416a"),
                        references::LOVEJOIN_MAINNET_MIX_BOX,
                    )?,
                    resolved(
                        hex!("2452c3e6886e6d946837bfea730a76dad43aefff267b5bbffd0232a2af68c7b6"),
                        references::LOVEJOIN_MAINNET_MIX_LOGIC,
                    )?,
                ],
            )
        };
        let script_bytes = references
            .iter()
            .map(|r| reference_script_size(&r.output))
            .sum::<Result<u64>>()?;
        Ok(Protocol {
            network_flag,
            denom: CLASSIC_LOVELACE,
            mix_box_hash,
            mix_logic_hash,
            references,
            script_bytes,
            version: Version::Classic,
            id,
            token: None,
            max_fee,
            fee_hash,
            inline_scripts: Vec::new(),
            seed,
        })
    }

    /// What every box of the pool holds, exactly.
    pub fn box_value(&self) -> BoxValue {
        BoxValue {
            lovelace: self.denom,
            token: self.token.clone(),
        }
    }

    /// Adds the scripts the pool's transactions carry in their witnesses.
    fn with_scripts(&self, mut tx: StagingTransaction) -> StagingTransaction {
        for script in &self.inline_scripts {
            tx = tx.script(ScriptKind::PlutusV3, script.clone());
        }
        tx
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
}

/// The size of the script a reference output carries, as the ledger counts
/// it for the reference-script fee: the script's bytes inside its
/// `script_ref`. 0 for an output with none.
fn reference_script_size(output: &[u8]) -> Result<u64> {
    let TransactionOutput::PostAlonzo(output) = minicbor::decode::<TransactionOutput>(output)
        .map_err(|e| anyhow!("A Lovejoin reference output can't be read: {e}"))?
    else {
        return Ok(0);
    };
    Ok(match output.script_ref.map(|s| s.0) {
        None => 0,
        Some(ScriptRef::PlutusV1Script(s)) => s.as_ref().len() as u64,
        Some(ScriptRef::PlutusV2Script(s)) => s.as_ref().len() as u64,
        Some(ScriptRef::PlutusV3Script(s)) => s.as_ref().len() as u64,
        Some(ScriptRef::NativeScript(_)) => bail!("A Lovejoin reference holds a native script"),
    })
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

/// `{a, b}` from a box's datum, if it's the well-formed shape. Anyone can pay
/// `mix_box` any datum, so one nested too deeply to decode safely is skipped
/// unread.
fn parse_mix_datum(datum: &[u8]) -> Option<([u8; 48], [u8; 48])> {
    if !cbor::within_depth(datum, cbor::MAX_DEPTH) {
        return None;
    }
    let PlutusData::Constr(constr) = PlutusData::decode_fragment(datum).ok()? else {
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
    /// pool's box value (10 ₳ alone in the classic pool), an inline `{a, b}`
    /// with `a ≠ b`, both points in G1's prime-order subgroup and neither the
    /// identity. Anything else at the address is someone's mistake, left
    /// alone: a box holding more than the box value could be mixed by anyone,
    /// who'd take the excess.
    pub fn from_row(row: &UtxoResponse, protocol: &Protocol) -> Option<Self> {
        if !protocol.box_value().is_row(row)
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
            || !protocol.box_value().is_value(&output.value)
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

/// A key account's UTxO, tokens and all: what a deposit into a token pool
/// pays from. Never one with a reference script or a datum too deep to read
/// ([`eval::resolve_row`] refuses both).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holding {
    pub utxo: Resolved,
    pub lovelace: u64,
    pub tokens: Assets,
}

impl Holding {
    /// A Koios row of the account's.
    pub fn from_row(row: &UtxoResponse) -> Result<Self> {
        let (lovelace, tokens) = crate::utxos::assets_of(vec![row.clone()])?;
        Ok(Holding {
            utxo: eval::resolve_row(row)?,
            lovelace,
            tokens,
        })
    }

    /// What a UTxO the wallet built holds, read from its output's bytes.
    pub fn of(utxo: &Resolved) -> Result<Self> {
        let output = MultiEraOutput::decode(Era::Conway, &utxo.output)
            .map_err(|e| anyhow!("An output can't be read: {e}"))?;
        let value = output.value();
        let mut tokens = Assets::new();
        for policy in value.assets() {
            for asset in policy.assets() {
                tokens = tokens.add(Asset::new(
                    hex::encode(policy.policy()),
                    hex::encode(asset.name()),
                    asset
                        .output_coin()
                        .context("An output holds a negative amount")?,
                )?)?;
            }
        }
        Ok(Holding {
            utxo: utxo.clone(),
            lovelace: value.coin(),
            tokens,
        })
    }

    fn input(&self) -> Input {
        Input::new(Hash::new(self.utxo.tx_hash), self.utxo.index)
    }
}

impl From<&Coin> for Holding {
    fn from(coin: &Coin) -> Self {
        Holding {
            utxo: coin.utxo.clone(),
            lovelace: coin.lovelace,
            tokens: Assets::new(),
        }
    }
}

/// A deposit's inputs can't pay for its boxes.
const DEPOSIT_SHORT: NotEnough =
    NotEnough("There isn't enough ADA for these boxes, the fee and the change");

/// Who pays a deposit or a mix: its fee comes from `fee`, its collateral is
/// `collateral` (left unspent), and the change goes back to `address`.
/// `signers` is how many keys sign it (the fee's and the collateral's): a
/// session's one key, or two of a public account's.
#[derive(Debug, Clone)]
pub struct Payer {
    pub fee: Coin,
    /// None only where nothing is mixed: [`mix`] refuses without it.
    pub collateral: Option<Coin>,
    pub address: Address,
    pub signers: usize,
}

/// The least an ADA-only output at `address` may hold.
fn least_change(params: &ProtocolParameters, address: &Address) -> Result<u64> {
    crate::transaction::calculate_min_required_utxo(Output::new(address.clone(), 1_000_000), params)
}

/// A script transaction's fee: its signed `size`, the `budgets` it declares,
/// and `script_fee`, its reference scripts' ([`reference_script_fee`]).
fn price(params: &ProtocolParameters, size: u64, budgets: &[Budget], script_fee: u64) -> u64 {
    linear_fee(params, size)
        + budgets
            .iter()
            .map(|b| computation_fee(params, b.mem, b.steps))
            .sum::<u64>()
        + script_fee
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
    /// The tokens the boxes didn't take, back at the change address with the
    /// least ADA each output needs, apart from `change` so that it stays ADA
    /// alone to pay the mixes. Empty when the inputs held only what the boxes
    /// took, as in the classic pool always.
    pub token_change: Vec<Holding>,
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
    let inputs: Vec<Holding> = inputs.iter().map(Holding::from).collect();
    deposit_from(params, protocol, &inputs, owners, change_address, signers)
}

/// [`deposit`] from UTxOs that may hold tokens: a token pool's boxes take
/// `Q` of its token each from them, and what they don't take comes back as
/// [`Deposit::token_change`]. The outputs go boxes, then the token change,
/// then the ADA change, last.
pub fn deposit_from(
    params: &ProtocolParameters,
    protocol: &Protocol,
    inputs: &[Holding],
    owners: &[Register],
    change_address: &Address,
    signers: usize,
) -> Result<Deposit> {
    deposit_across(
        params,
        &[(protocol, owners)],
        inputs,
        change_address,
        signers,
    )
}

/// A box a deposit makes: its datum's `{a, b}`, what it holds, and where.
type BoxOut = (([u8; 48], [u8; 48]), BoxValue, Address);

/// [`deposit_from`] into several pools at once (chunk 34's §6, a return
/// whose ADA and tokens go into their own pools): for each `(pool, owners)`,
/// one box per register at that pool's `mix_box`, holding its box value. The
/// outputs go each pool's boxes in turn, then the token change, then the ADA
/// change, last; [`Deposit::boxes`] are in that order. With one pool, it's
/// [`deposit_from`]'s transaction exactly.
pub fn deposit_across(
    params: &ProtocolParameters,
    legs: &[(&Protocol, &[Register])],
    inputs: &[Holding],
    change_address: &Address,
    signers: usize,
) -> Result<Deposit> {
    if legs.iter().all(|(_, owners)| owners.is_empty()) {
        bail!("A deposit needs at least one box");
    }
    let datum_of = |r: &Register| -> Result<([u8; 48], [u8; 48])> {
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
    };
    // Each box: its datum, what it holds, and where.
    let mut boxed_outputs: Vec<BoxOut> = Vec::new();
    for (protocol, owners) in legs {
        let value = protocol.box_value();
        let address = protocol.mix_box_address();
        for owner in *owners {
            boxed_outputs.push((datum_of(owner)?, value.clone(), address.clone()));
        }
    }
    let total = inputs
        .iter()
        .try_fold(0u64, |sum, h| sum.checked_add(h.lovelace))
        .context("The inputs' ADA overflows")?;
    let mut kept = inputs
        .iter()
        .try_fold(Assets::new(), |sum, h| sum.merge(h.tokens.clone()))?;
    let mut boxed = 0u64;
    for (protocol, owners) in legs {
        let box_value = protocol.box_value();
        boxed = box_value
            .lovelace
            .checked_mul(owners.len() as u64)
            .and_then(|b| boxed.checked_add(b))
            .context("Too many boxes")?;
        if let Some((token, quantity)) = box_value.token_total(owners.len())? {
            kept = kept
                .separate(Assets::new().add(Asset::new(
                    hex::encode(token.policy),
                    hex::encode(&token.name),
                    quantity,
                )?)?)
                .context(
                    "The UTxOs paying for these boxes don't hold enough of the pool's token",
                )?;
        }
    }
    // The tokens the boxes don't take, each output with exactly its least.
    let kept_lovelace = crate::build::minimum_change(params, change_address, &kept)?;
    let token_outputs =
        crate::build::change_outputs(params, change_address, kept_lovelace, &kept, DEPOSIT_SHORT)?;
    let least = least_change(params, change_address)?;
    let (fee, staged) = settle_fee(params, signers, |fee| {
        let change = total
            .checked_sub(boxed + kept_lovelace + fee)
            .filter(|c| *c >= least)
            .context("There isn't enough ADA for these boxes, the fee and the change")?;
        let mut tx = StagingTransaction::new();
        for held in inputs {
            tx = tx.input(held.input());
        }
        for ((a, b), value, address) in &boxed_outputs {
            tx = tx.output(
                value
                    .output(address.clone())?
                    .set_inline_datum(mix_datum(a, b)),
            );
        }
        for output in &token_outputs {
            tx = tx.output(output.clone());
        }
        Ok(tx
            .output(Output::new(change_address.clone(), change))
            .fee(fee))
    })?;
    let tx = staged
        .build_conway_raw()
        .context("Failed To Build The Deposit")?;
    let outputs = eval::resolve_outputs(&tx.tx_bytes.0)?;
    let made = boxed_outputs.len();
    let token_change = outputs[made..made + token_outputs.len()]
        .iter()
        .map(Holding::of)
        .collect::<Result<Vec<_>>>()?;
    let boxes = boxed_outputs
        .iter()
        .zip(&outputs)
        .map(|(((a, b), _, _), utxo)| PoolBox {
            utxo: utxo.clone(),
            a: *a,
            b: *b,
        })
        .collect();
    let change = Coin {
        utxo: outputs.last().context("The deposit has no change")?.clone(),
        lovelace: total - boxed - kept_lovelace - fee,
    };
    Ok(Deposit {
        tx,
        fee,
        boxes,
        change,
        token_change,
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
    let box_value = protocol.box_value();
    let mut preimage: Vec<u8> = datums.concat();
    let value = box_value.cbor();
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
    // A mix spends the pool's scripts, so it always puts collateral up; only a
    // seed, which makes no mixes, ever goes without, and never reaches here.
    let collateral = payer
        .collateral
        .as_ref()
        .context("A mix needs collateral")?;
    let stage = |fee: u64, budgets: Option<&Budgets>| -> Result<BuiltTransaction> {
        let change = payer
            .fee
            .lovelace
            .checked_sub(fee)
            .filter(|c| *c >= least)
            .context("There isn't enough ADA left to pay this mix's fee and keep the change")?;
        let collateral_back = collateral
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
                box_value
                    .output(protocol.mix_box_address())?
                    .set_inline_datum(mix_datum(a, b)),
            );
        }
        tx = tx.output(Output::new(payer.address.clone(), change));
        for reference in protocol.reference_inputs() {
            tx = tx.reference_input(reference);
        }
        tx = protocol.with_scripts(tx);
        tx = tx
            .collateral_input(collateral.input())
            .collateral_output(Output::new(payer.address.clone(), collateral_back))
            .fee(fee)
            .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone());
        let built = tx.build_conway_raw().context("Failed To Build The Mix")?;
        let reward = budgets.and_then(|b| b.withdraw(0)).unwrap_or(DRAFT_BUDGET);
        withdraw.patch(built, units(reward), &params.cost_model_v3)
    };

    let mut known: Vec<Resolved> = sorted.iter().map(|b| b.utxo.clone()).collect();
    known.push(payer.fee.utxo.clone());
    known.push(collateral.utxo.clone());
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
    let script_fee = reference_script_fee(params, protocol.script_bytes)?;
    let mut fee = 1_000_000;
    for _ in 0..5 {
        let tx = stage(fee, Some(&budgets))?;
        let needed = price(params, signed_size(&tx, payer.signers)?, &used, script_fee);
        check_fee(needed)?;
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

/// A withdraw, ready for giveme.my's collateral signature (or the payer's,
/// for [`withdraw_paid`]): the register the boxes went to and what it holds.
#[derive(Debug, Clone)]
pub struct Withdraw {
    pub tx: BuiltTransaction,
    pub fee: u64,
    pub lovelace: u64,
    pub register: Register,
    /// A token pool's token, and how much of it the register holds.
    pub token: Option<(BoxToken, u64)>,
    /// The payer's change, for [`withdraw_paid`].
    pub change: Option<Coin>,
}

/// A withdraw whose boxes can't pay their own way back: what's left of them
/// after the fee (`has`) is less than the output they come back in needs
/// (`needs`). A token pool launched with too little ADA a box is like this;
/// [`withdraw_paid`] still brings its boxes back. Its own type, so a caller
/// can tell it apart (`downcast_ref`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CantPayBack {
    pub has: u64,
    pub needs: u64,
}

impl std::fmt::Display for CantPayBack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "These boxes can't pay their own way back: {} lovelace is left of them after the fee, and the Seedelf output they come back in needs {}",
            self.has, self.needs
        )
    }
}

impl std::error::Error for CantPayBack {}

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
    withdraw_with(params, protocol, boxes, owner, destination, None)
}

/// [`withdraw`] with the fee paid by `payer`, a key account, which puts up
/// its own collateral too: the boxes come back whole, and if their ADA is
/// less than the Seedelf output needs, the account makes up the rest. For a
/// box that can't pay its own way back ([`CantPayBack`]), as a token pool's
/// can't once the ledger's price of a byte passes what its box value covers.
/// The account's input and change are in the same transaction as the box,
/// so it ties the box to the account: the caller says so before it's signed.
pub fn withdraw_paid(
    params: &ProtocolParameters,
    protocol: &Protocol,
    boxes: &[PoolBox],
    owner: &Scalar,
    destination: Register,
    payer: &Payer,
) -> Result<Withdraw> {
    withdraw_with(params, protocol, boxes, owner, destination, Some(payer))
}

fn withdraw_with(
    params: &ProtocolParameters,
    protocol: &Protocol,
    boxes: &[PoolBox],
    owner: &Scalar,
    destination: Register,
    payer: Option<&Payer>,
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
    let collateral = match payer {
        None => None,
        Some(p) => Some(
            p.collateral
                .as_ref()
                .context("A paid withdraw needs collateral")?,
        ),
    };
    let config = get_config(VARIANT, protocol.network_flag)?;
    let to = wallet_contract(protocol.network_flag, config.contract.wallet_contract_hash);
    let datum = destination.to_vec()?;
    let total = protocol.denom * sorted.len() as u64;
    let token = protocol.box_value().token_total(sorted.len())?;
    let least = match payer {
        None => 0,
        Some(p) => least_change(params, &p.address)?,
    };
    // Every input in the ledger's order, which the spend redeemers point into.
    let mut all_inputs: Vec<Input> = sorted.iter().map(|b| b.input()).collect();
    all_inputs.extend(payer.map(|p| p.fee.input()));
    all_inputs.sort_by_key(|i| (i.tx_hash.0, i.txo_index));
    let positions: Vec<u64> = sorted
        .iter()
        .map(|b| {
            all_inputs
                .iter()
                .position(|i| *i == b.input())
                .expect("sorted in") as u64
        })
        .collect();
    let back = |lovelace: u64| -> Result<Output> {
        let output = Output::new(to.clone(), lovelace).set_inline_datum(datum.clone());
        match &token {
            None => Ok(output),
            Some((t, quantity)) => output
                .add_asset(Hash::new(t.policy), t.name.clone(), *quantity)
                .context("The withdraw's token can't be added to its output"),
        }
    };
    let minimum =
        |lovelace: u64| crate::transaction::calculate_min_required_utxo(back(lovelace)?, params);
    // Paid: the boxes' ADA, or what the output needs if that's more, the
    // payer making up the difference.
    let paid_back = match payer {
        None => 0,
        Some(_) => {
            let first = minimum(total)?;
            total.max(minimum(total.max(first))?)
        }
    };
    let topped = paid_back.saturating_sub(total);

    let stage =
        |fee: u64, budgets: Option<&Budgets>, redeemer: &[u8]| -> Result<BuiltTransaction> {
            let lovelace = match payer {
                None => total
                    .checked_sub(fee)
                    .context("The boxes can't pay the fee")?,
                Some(_) => paid_back,
            };
            let mut tx = StagingTransaction::new();
            for (boxed, index) in sorted.iter().zip(&positions) {
                let budget = budgets
                    .and_then(|b| b.spend(*index))
                    .unwrap_or(DRAFT_BUDGET);
                tx = tx.input(boxed.input()).add_spend_redeemer(
                    boxed.input(),
                    UNIT.to_vec(),
                    Some(staged_units(budget)),
                );
            }
            if let Some(p) = payer {
                tx = tx.input(p.fee.input());
            }
            tx = tx.output(back(lovelace)?);
            if let Some(p) = payer {
                let change = p
                .fee
                .lovelace
                .checked_sub(fee + topped)
                .filter(|c| *c >= least)
                .context(
                    "There isn't enough ADA left to pay this withdraw's fee and keep the change",
                )?;
                tx = tx.output(Output::new(p.address.clone(), change));
            }
            for reference in protocol.reference_inputs() {
                tx = tx.reference_input(reference);
            }
            tx = protocol.with_scripts(tx);
            tx = match (payer, collateral) {
                (Some(p), Some(c)) => tx
                    .collateral_input(c.input())
                    .collateral_output(Output::new(
                        p.address.clone(),
                        c.lovelace
                            .checked_sub(fee * 3 / 2 + 1)
                            .context("The collateral can't cover this withdraw")?,
                    ))
                    .fee(fee)
                    .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone()),
                _ => tx
                    .collateral_input(collateral_input(protocol.network_flag))
                    .collateral_output(collateral_output(
                        collateral_address(protocol.network_flag),
                        fee,
                    )?)
                    .fee(fee)
                    .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone())
                    .disclosed_signer(Hash::new(COLLATERAL_HASH)),
            };
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
    if let (Some(p), Some(c)) = (payer, collateral) {
        known.push(p.fee.utxo.clone());
        known.push(c.utxo.clone());
    }
    known.extend(protocol.references.iter().cloned());
    let measure = |tx: &BuiltTransaction| -> Result<Budgets> {
        let answer = eval::evaluate(
            &tx.tx_bytes.0,
            &known,
            &params.cost_model_v3,
            protocol.network_flag,
        )?;
        let budgets = Budgets::from_ogmios(&answer)?;
        for index in &positions {
            budgets.spend(*index).context("No budget for a box")?;
        }
        budgets.withdraw(0).context("No budget for mix_logic")?;
        Ok(budgets)
    };
    // A placeholder with a real proof's size, for the first build: a proof is
    // always a compressed point and 32 bytes, so no key is used on one that's
    // thrown away.
    let placeholder = {
        let one = constr(0, vec![bytes_data(&sorted[0].a), bytes_data(&[0u8; 32])]);
        constr(0, vec![list(vec![one; sorted.len()])])
            .encode_fragment()
            .map_err(|e| anyhow!("{e}"))?
    };
    let signers = payer.map_or(1, |p| p.signers);

    // Each round's proof is new, and its scalars' sizes move the budget by a
    // hair, so the transaction declares 1% over what was measured, and is
    // priced on what it declares (which the ledger charges).
    let script_fee = reference_script_fee(params, protocol.script_bytes)?;
    let mut fee = 500_000;
    let mut declared: Option<Budgets> = None;
    for _ in 0..8 {
        let unproven = stage(fee, declared.as_ref(), &placeholder)?;
        let redeemer = prove(&unproven)?;
        let tx = stage(fee, declared.as_ref(), &redeemer)?;
        let measured = measure(&tx)?;
        match &declared {
            Some(d) if d.covers(&measured) => {
                let mut charged = Vec::with_capacity(sorted.len() + 1);
                for index in &positions {
                    charged.push(d.spend(*index).context("No budget for a box")?);
                }
                charged.push(d.withdraw(0).context("No budget for mix_logic")?);
                let needed = price(params, signed_size(&tx, signers)?, &charged, script_fee);
                if needed <= fee && fee - needed < 5_000 {
                    let lovelace = match payer {
                        None => total - fee,
                        Some(_) => paid_back,
                    };
                    let needs = minimum(lovelace)?;
                    if lovelace < needs {
                        bail!(CantPayBack {
                            has: lovelace,
                            needs,
                        });
                    }
                    let change = match payer {
                        None => None,
                        Some(p) => Some(Coin {
                            utxo: eval::resolve_outputs(&tx.tx_bytes.0)?
                                .get(1)
                                .context("The withdraw has no change")?
                                .clone(),
                            lovelace: p.fee.lovelace - fee - topped,
                        }),
                    };
                    return Ok(Withdraw {
                        tx,
                        fee,
                        lovelace,
                        register: destination,
                        token,
                        change,
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
    mixes_per_box_at(depth, 3)
}

/// How many boxes a mix the wallet makes may take: three, or four (chunk 34's
/// D3, a Settings option). Four fits a transaction's computation by about 1%
/// and five never does ([lovejoin-mix-width.md]).
///
/// [lovejoin-mix-width.md]: ../../../seedelf-web-wallet/docs/lovejoin-mix-width.md
pub const WIDTHS: [usize; 2] = [3, 4];

/// Whether `width` is one of [`WIDTHS`], or why not.
pub fn check_width(width: usize) -> Result<()> {
    if !WIDTHS.contains(&width) {
        bail!("A Lovejoin mix is three or four boxes wide");
    }
    Ok(())
}

/// [`mixes_per_box`] at `width` boxes a mix: `(width^depth − 1)/(width − 1)`,
/// which leaves ours one of `width^depth`.
pub fn mixes_per_box_at(depth: u32, width: usize) -> usize {
    (width.pow(depth) - 1) / (width - 1)
}

/// What the wallet plans on for a 3-box mix before measuring one: preprod's
/// cost 0.877 ₳, rounded up. One measured 0.82 ₳ against mainnet's scripts.
/// The wallet pays its mixes itself and never draws on Lovejoin's fee shards,
/// so the cap Lovejoin puts on a fee a shard pays (1 ₳ on mainnet) doesn't
/// apply.
pub const MIX_FEE_ESTIMATE: u64 = 950_000;

/// [`MIX_FEE_ESTIMATE`] for a 4-box mix: 1.214 ₳ measured on mainnet's
/// classic pool and 1.227 ₳ on a token pool (lovejoin-mix-width.md), and
/// about a tenth more.
pub const MIX_FEE_ESTIMATE_FOUR: u64 = 1_350_000;

/// What each mix in a pool no reference carries the scripts of adds: both
/// scripts in its witnesses, 0.114 ₳ more measured on Lovejoin's preprod
/// token pool (chunk 34's groundwork), and a margin. A pool the wallet shows
/// has its scripts at the holder, so this is for a pool read otherwise.
pub const INLINE_SCRIPTS_ESTIMATE: u64 = 150_000;

/// What the wallet plans on for one of `protocol`'s mixes, `width` boxes wide.
pub fn mix_fee_estimate(protocol: &Protocol, width: usize) -> u64 {
    let mix = if width >= 4 {
        MIX_FEE_ESTIMATE_FOUR
    } else {
        MIX_FEE_ESTIMATE
    };
    if protocol.inline_scripts.is_empty() {
        mix
    } else {
        mix + INLINE_SCRIPTS_ESTIMATE
    }
}

/// What a deposit (when the chain has one) and the change the chain leaves
/// are planned on.
const DEPOSIT_RESERVE: u64 = 1_500_000;

/// What a box costs at `depth`: the box, and every mix of its fan-out.
fn per_box(depth: u32, denom: u64) -> u64 {
    denom + mixes_per_box(depth) as u64 * MIX_FEE_ESTIMATE
}

/// What mixing one of the wallet's boxes again costs at `depth`: every mix of
/// its fan-out. It's in the pool already, so there's no box to pay for.
fn per_box_again(depth: u32) -> u64 {
    mixes_per_box(depth) as u64 * MIX_FEE_ESTIMATE
}

/// [`per_box`] in `protocol`'s pool, `width` boxes a mix: its box's ADA, and
/// every mix of its fan-out at that pool's estimate. The classic pool's at
/// three is [`per_box`]'s. A token pool's token isn't counted: it's the
/// token's, not ADA.
pub fn per_box_in(protocol: &Protocol, depth: u32, width: usize) -> u64 {
    protocol.denom + per_box_again_in(protocol, depth, width)
}

/// [`per_box_again`] in `protocol`'s pool, `width` boxes a mix.
pub fn per_box_again_in(protocol: &Protocol, depth: u32, width: usize) -> u64 {
    mixes_per_box_at(depth, width) as u64 * mix_fee_estimate(protocol, width)
}

/// [`boxes_affordable`] in `protocol`'s pool, `width` boxes a mix.
pub fn boxes_affordable_in(spare: u64, protocol: &Protocol, depth: u32, width: usize) -> usize {
    (spare.saturating_sub(DEPOSIT_RESERVE) / per_box_in(protocol, depth, width)) as usize
}

/// [`funding_for`] in `protocol`'s pool, `width` boxes a mix.
pub fn funding_for_in(boxes: usize, protocol: &Protocol, depth: u32, width: usize) -> u64 {
    DEPOSIT_RESERVE + boxes as u64 * per_box_in(protocol, depth, width)
}

/// [`again_affordable`] in `protocol`'s pool, `width` boxes a mix.
pub fn again_affordable_in(spare: u64, protocol: &Protocol, depth: u32, width: usize) -> usize {
    let per = per_box_again_in(protocol, depth, width);
    if per == 0 {
        return 0;
    }
    (spare.saturating_sub(DEPOSIT_RESERVE) / per) as usize
}

/// [`again_funding`] in `protocol`'s pool, `width` boxes a mix.
pub fn again_funding_in(boxes: usize, protocol: &Protocol, depth: u32, width: usize) -> u64 {
    DEPOSIT_RESERVE + boxes as u64 * per_box_again_in(protocol, depth, width)
}

/// One pool's part of a chain that spans pools, as it's planned: the pool,
/// the most boxes it may take (what its pool has room for, the chain's and
/// the deposit's share), and how much of its token the UTxOs paying for the
/// deposit hold (none for an ADA pool).
#[derive(Debug, Clone)]
pub struct LegPlan<'a> {
    pub protocol: &'a Protocol,
    pub most: usize,
    pub held: u128,
}

/// How many boxes each of `legs` takes, in order, from `spare` lovelace and
/// `tokens` (what the UTxOs paying for the deposit hold besides ADA), mixed
/// `depth` waves deep, `width` boxes a mix (chunk 34's §6). Each leg takes as
/// many boxes as its token makes (`Q` each), its `most`, and the ADA left
/// allows, each box costing [`per_box_in`]; then the next takes what's left.
/// The caller lists the token pools first, so ADA boxes come from what token
/// boxes leave. Besides the deposit's reserve, the ADA keeps back the least
/// the tokens the boxes don't take need, back at `change_address` in an output
/// of their own ([`Deposit::token_change`]).
///
/// One leg in the classic pool, with no tokens, three wide, is
/// [`boxes_affordable`] exactly.
pub fn plan_across(
    params: &ProtocolParameters,
    change_address: &Address,
    spare: u64,
    tokens: &Assets,
    legs: &[LegPlan],
    depth: u32,
    width: usize,
) -> Result<Vec<usize>> {
    check_width(width)?;
    let counts = |reserve: u64| -> Vec<usize> {
        let mut left = spare
            .saturating_sub(DEPOSIT_RESERVE)
            .saturating_sub(reserve);
        legs.iter()
            .map(|leg| {
                let by_token = match &leg.protocol.token {
                    None => usize::MAX,
                    Some(t) => usize::try_from(leg.held / u128::from(t.quantity.max(1)))
                        .unwrap_or(usize::MAX),
                };
                let per = per_box_in(leg.protocol, depth, width);
                let n = usize::try_from(left / per)
                    .unwrap_or(usize::MAX)
                    .min(by_token)
                    .min(leg.most);
                left -= n as u64 * per;
                n
            })
            .collect()
    };
    // What the boxes leave of `tokens` when each leg takes `boxes`.
    let kept = |boxes: &[usize]| -> Result<Assets> {
        let mut kept = tokens.clone();
        for (leg, n) in legs.iter().zip(boxes) {
            if let Some((token, quantity)) = leg.protocol.box_value().token_total(*n)? {
                kept = kept
                    .separate(Assets::new().add(Asset::new(
                        hex::encode(token.policy),
                        hex::encode(&token.name),
                        quantity,
                    )?)?)
                    .context(
                        "The UTxOs paying for these boxes don't hold enough of a pool's token",
                    )?;
            }
        }
        Ok(kept)
    };
    if tokens.is_empty() {
        return Ok(counts(0));
    }
    // When the boxes take every token, nothing is kept back: asked first, so
    // a reserve never costs the box that takes the last of them (34e's
    // review, 8).
    let unreserved = counts(0);
    if kept(&unreserved)?.is_empty() {
        return Ok(unreserved);
    }
    // Otherwise kept back for every token they hold, which is at least what
    // the tokens left need.
    Ok(counts(crate::build::minimum_change(
        params,
        change_address,
        tokens,
    )?))
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

/// The most boxes, of `most`, a Bootstrap paid from the private balance
/// puts into `protocol`'s pool under `params`, or none when not one fits.
/// Its mix session holds one UTxO of [`funding_for`]'s ADA at depth 0 and
/// the boxes' token, beside a collateral the deposit never spends, so
/// [`DEPOSIT_RESERVE`] alone pays the deposit's fee and its change's least:
/// a fee that grows with the boxes (chunk 34's 34d review, 3). Each count is
/// built ([`deposit_from`]), never estimated, its change at a base address,
/// as long as a session's is.
pub fn bootstrap_most(
    params: &ProtocolParameters,
    protocol: &Protocol,
    network_flag: bool,
    most: usize,
) -> Result<usize> {
    let mut address = vec![if network_flag { 0x00 } else { 0x01 }];
    address.extend([0x5e; 56]);
    let address = Address::from_bytes(&address).map_err(|e| anyhow!("{e}"))?;
    // One register for every box: each datum is as long as a fresh one's.
    let owner = Register::create(Scalar::from(4_242_424u64))?;
    let fits = |boxes: usize| -> Result<bool> {
        let tokens = match protocol.box_value().token_total(boxes) {
            Ok(None) => Assets::new(),
            Ok(Some((token, quantity))) => Assets::new().add(Asset::new(
                hex::encode(token.policy),
                hex::encode(&token.name),
                quantity,
            )?)?,
            // More of the token than one output holds: no deposit of this many.
            Err(_) => return Ok(false),
        };
        let input = Holding {
            utxo: Resolved {
                tx_hash: [0x5e; 32],
                index: 0,
                output: Vec::new(),
            },
            lovelace: funding_for(boxes, 0, protocol.denom),
            tokens,
        };
        let owners = vec![owner.clone(); boxes];
        // Short of ADA, or over a transaction's size: both grow with the boxes.
        Ok(deposit_from(params, protocol, &[input], &owners, &address, 1).is_ok())
    };
    if most == 0 || !fits(1)? {
        return Ok(0);
    }
    let (mut low, mut high) = (1, most);
    while low < high {
        let mid = low + (high - low).div_ceil(2);
        if fits(mid)? {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    Ok(low)
}

/// How many of the wallet's boxes `spare` lovelace mixes again at `depth`
/// ([`again`]): none if it can't pay for one's mixes.
pub fn again_affordable(spare: u64, depth: u32) -> usize {
    (spare.saturating_sub(DEPOSIT_RESERVE) / per_box_again(depth)) as usize
}

/// What pays for mixing `boxes` of the wallet's boxes again at `depth`
/// ([`again_affordable`]'s plan run backwards): every mix, and the change the
/// last one leaves, which comes back.
pub fn again_funding(boxes: usize, depth: u32) -> u64 {
    DEPOSIT_RESERVE + boxes as u64 * per_box_again(depth)
}

/// What pays for a chain: the key account's ADA-only `coins`, its
/// `collateral` (never spent by the chain), and its `address` for change.
/// The deposit is signed by `deposit_signers` keys (the coins'), each mix by
/// `mix_signers` (the change's and the collateral's).
#[derive(Debug, Clone)]
pub struct Funding {
    pub coins: Vec<Coin>,
    /// What every mix puts up. None only for a seed (depth 0), which makes no
    /// mixes and so spends no script: [`fan_out`] never runs, so never reads it.
    pub collateral: Option<Coin>,
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
    /// The tokens the deposit's boxes didn't take ([`Deposit::token_change`]).
    pub token_change: Vec<Holding>,
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
    chain_from(params, protocol, funding, &[], owners, depth, pool)
}

/// [`chain`] whose deposit spends `tokens` too, UTxOs of the same account
/// holding a token pool's token: its boxes take `Q` each, and what they
/// don't take is [`Chain::token_change`]. The mixes are paid from ADA alone,
/// as ever.
pub fn chain_from(
    params: &ProtocolParameters,
    protocol: &Protocol,
    funding: &Funding,
    tokens: &[Holding],
    owners: &[Register],
    depth: u32,
    pool: &[PoolBox],
) -> Result<Chain> {
    let leg = Leg {
        protocol,
        owners,
        pool,
    };
    chain_across(params, funding, tokens, &[leg], depth, 3)
}

/// One pool's part of a chain that spans pools: the pool, a register for each
/// box it gets, and its boxes a fan-out may draw from.
#[derive(Debug, Clone, Copy)]
pub struct Leg<'a> {
    pub protocol: &'a Protocol,
    pub owners: &'a [Register],
    pub pool: &'a [PoolBox],
}

/// [`chain_from`] across pools, `width` boxes a mix (chunk 34's §6 and D3):
/// one deposit of every leg's boxes ([`deposit_across`]), then each leg's
/// boxes fanned out in its own pool, a leg at a time, every mix paid from the
/// one before's change. [`Chain::leaves`] are in the legs' order: each of a
/// leg's boxes ends as one leaf, so a leg's leaves are as many as its owners.
/// One leg three wide is [`chain_from`] exactly.
pub fn chain_across(
    params: &ProtocolParameters,
    funding: &Funding,
    tokens: &[Holding],
    legs: &[Leg],
    depth: u32,
    width: usize,
) -> Result<Chain> {
    check_width(width)?;
    let Funding {
        coins,
        collateral,
        address,
        deposit_signers,
        mix_signers,
    } = funding;
    let fresh = legs
        .iter()
        .map(|leg| fresh_for(leg.owners.len(), depth, width, leg.pool, &[]))
        .collect::<Result<Vec<_>>>()?;
    let mut inputs: Vec<Holding> = coins.iter().map(Holding::from).collect();
    inputs.extend(tokens.iter().cloned());
    let parts: Vec<(&Protocol, &[Register])> =
        legs.iter().map(|leg| (leg.protocol, leg.owners)).collect();
    let deposit = deposit_across(params, &parts, &inputs, address, *deposit_signers)?;
    // A mix needs collateral; a seed makes none, so it may go without.
    if depth > 0 && collateral.is_none() {
        bail!("A chain that mixes needs collateral");
    }
    let mut txs = vec![ChainTx {
        kind: "deposit",
        tx: deposit.tx,
        fee: deposit.fee,
    }];
    let mut leaves = Vec::new();
    let mut change = deposit.change;
    let mut boxes = deposit.boxes.into_iter();
    for (leg, fresh) in legs.iter().zip(fresh) {
        let start: Vec<PoolBox> = boxes.by_ref().take(leg.owners.len()).collect();
        let payer = Payer {
            fee: change,
            collateral: collateral.clone(),
            address: address.clone(),
            signers: *mix_signers,
        };
        let fanned = fan_out(params, leg.protocol, start, &payer, depth, width, fresh)?;
        txs.extend(fanned.txs);
        leaves.extend(fanned.leaves);
        change = fanned.change;
    }
    Ok(Chain {
        txs,
        leaves,
        change,
        token_change: deposit.token_change,
    })
}

/// The wallet's own `boxes`, in the pool already, fanned out again `depth`
/// waves deep with fresh boxes from `pool`, as [`chain`] fans out a
/// deposit's: every output of each wave mixed again in the next, in a random
/// order. There's no deposit: the first mix pays from `payer.fee`, and each
/// after from the one before's change; the collateral is never spent. For a
/// chain cut short, or boxes that haven't moved since.
pub fn again(
    params: &ProtocolParameters,
    protocol: &Protocol,
    payer: &Payer,
    boxes: &[PoolBox],
    depth: u32,
    pool: &[PoolBox],
) -> Result<Chain> {
    again_at(params, protocol, payer, boxes, depth, 3, pool)
}

/// [`again`], `width` boxes a mix (chunk 34's D3).
pub fn again_at(
    params: &ProtocolParameters,
    protocol: &Protocol,
    payer: &Payer,
    boxes: &[PoolBox],
    depth: u32,
    width: usize,
    pool: &[PoolBox],
) -> Result<Chain> {
    check_width(width)?;
    if boxes.is_empty() {
        bail!("There's no box to mix again");
    }
    let fresh = fresh_for(boxes.len(), depth, width, pool, boxes)?;
    fan_out(params, protocol, boxes.to_vec(), payer, depth, width, fresh)
}

/// Lovejoin's pool has too few boxes to mix with for a fan-out: `have`
/// boxes that aren't ours, where it takes `needed`. Its own type, so a
/// caller can tell it from a build that failed (`downcast_ref`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolShort {
    pub have: usize,
    pub needed: usize,
}

impl std::fmt::Display for PoolShort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Lovejoin's pool has {} boxes to mix with, and this needs {}",
            self.have, self.needed
        )
    }
}

impl std::error::Error for PoolShort {}

/// The pool's boxes a fan-out of `trees` boxes at `depth`, `width` boxes a
/// mix, draws from, in a random order, `ours` left out: `width − 1` for every
/// mix, never one twice. Too few is a [`PoolShort`].
fn fresh_for(
    trees: usize,
    depth: u32,
    width: usize,
    pool: &[PoolBox],
    ours: &[PoolBox],
) -> Result<Vec<PoolBox>> {
    // Depth 0 is a seed: the deposit alone, with no mixes, so it needs no
    // other boxes and works on an empty pool. It hides nothing of its own;
    // it puts boxes in for other people to mix with, which is the only way a
    // pool can start (the wallet's own boxes never count towards its floor).
    if !(0..=3).contains(&depth) {
        bail!("The fan-out is 0 to 3 waves deep");
    }
    let mut fresh: Vec<PoolBox> = pool
        .iter()
        .filter(|b| !ours.iter().any(|o| o.utxo == b.utxo))
        .cloned()
        .collect();
    let needed = trees * mixes_per_box_at(depth, width) * (width - 1);
    if fresh.len() < needed {
        return Err(PoolShort {
            have: fresh.len(),
            needed,
        }
        .into());
    }
    shuffle(&mut fresh);
    Ok(fresh)
}

/// Fans each of `start` (all ours) out `depth` waves deep, `width` boxes a
/// mix, with boxes from `fresh`, each wave's mixes in a random order so the
/// order doesn't point at our branch. The first mix pays from `payer.fee`;
/// each after from the one before's change.
fn fan_out(
    params: &ProtocolParameters,
    protocol: &Protocol,
    start: Vec<PoolBox>,
    payer: &Payer,
    depth: u32,
    width: usize,
    mut fresh: Vec<PoolBox>,
) -> Result<Chain> {
    let mut txs = Vec::new();
    let mut change = payer.fee.clone();
    let mut ours: Vec<PoolBox> = start.clone();
    // Every box of every tree in this wave; ours are among them.
    let mut wave: Vec<PoolBox> = start;
    for _ in 0..depth {
        shuffle(&mut wave);
        let mut next = Vec::with_capacity(wave.len() * width);
        let mut ours_next = Vec::new();
        for boxed in &wave {
            let mut inputs = vec![boxed.clone()];
            for _ in 1..width {
                inputs.push(fresh.pop().expect("counted by fresh_for"));
            }
            let paying = Payer {
                fee: change.clone(),
                ..payer.clone()
            };
            let mixed = mix(params, protocol, &inputs, &paying)?;
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
        token_change: Vec::new(),
    })
}

/// Shuffles in place, uniformly (Fisher–Yates). A Seedelf spend's outputs
/// go in this order too ([`crate::build::ScriptSpend`]).
pub(crate) fn shuffle<T>(items: &mut [T]) {
    for i in (1..items.len()).rev() {
        let j = (OsRng.next_u64() % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
}
