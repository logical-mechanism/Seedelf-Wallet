//! WebAssembly bindings for the Seedelf web wallet.
//!
//! A thin layer over `seedelf-crypto`: every protocol rule (torsion checks,
//! same-`d` re-randomization, the `vkh`-bound Fiat-Shamir challenge) is
//! enforced there, not here. Secrets stay inside WebAssembly: the Seedelf
//! scalar in a [`SeedelfKey`] and the Cardano HD keys in a
//! [`WasmCardanoAccount`] never cross back into JavaScript; re-randomization
//! scalars are drawn and dropped inside `seedelf-crypto`.
//!
//! Each export is a small wrapper around a plain-Rust function in [`api`] so
//! the logic can be tested natively; the wrappers only convert errors into
//! JavaScript exceptions.

use blstrs::Scalar;
use ff::Field;
use seedelf_crypto::{cardano, derivation, register, schnorr};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

pub mod cip30;
pub mod decode;
pub mod lovejoin;

/// The module's start function, which does nothing. wasm-bindgen's reset
/// (`__wbg_reset_state`, built with `--experimental-reset-state-function`),
/// which the extension uses to replace an instance that trapped
/// (`extension/src/background/wasm.ts`), ends by calling the start function:
/// without one it throws a TypeError after the new instance is in place.
#[wasm_bindgen(start)]
pub fn start() {}

/// Plain-Rust implementations behind the exports, testable off-wasm.
pub mod api {
    use std::collections::HashMap;

    use anyhow::{Result, anyhow, bail};
    use blstrs::Scalar;
    use cryptoxide::hkdf::{hkdf_expand, hkdf_extract};
    use cryptoxide::sha2::Sha256;
    use ff::Field;
    use pallas_addresses::{
        Address, Network as AddressNetwork, ShelleyDelegationPart, ShelleyPaymentPart, StakeAddress,
    };
    use pallas_crypto::hash::{Hash, Hasher};
    use pallas_crypto::key::ed25519::{PublicKey, SecretKey, Signature};
    use pallas_primitives::Fragment;
    use pallas_txbuilder::BuiltTransaction;
    use pallas_wallet::PrivateKey;
    use rand_core::{OsRng, RngCore};
    use seedelf_core::address::{dapp_address, wallet_contract};
    use seedelf_core::assets::{Asset, Assets};
    use seedelf_core::build::{
        self, AccountAmount, AccountPay, AddressPayment, Budgets, Chain, Class, Histories, Origin,
        Payee, Payment, Purpose, ScriptSpend,
    };
    use seedelf_core::constants::{COLLATERAL_PUBLIC_KEY, VARIANT, get_config};
    use seedelf_core::note::Note;
    use seedelf_core::staking::{
        self, DrepAction, DrepKey, DrepState, StakeAction, StakeKey, StakeState, Staking,
    };
    use seedelf_core::utxos::assets_of as utxo_assets;
    use seedelf_crypto::cardano::{CardanoAccount, Role};
    use seedelf_crypto::register::Register;
    use seedelf_crypto::schnorr;
    use seedelf_koios::koios::{
        ProtocolParameters, UtxoResponse, contains_policy_id, extract_bytes_with_logging,
    };
    use serde::{Deserialize, Serialize};
    use zeroize::Zeroize;

    /// Parses a secret scalar from 32 big-endian bytes in hex. Rejects
    /// non-canonical values (`>= r`) and zero.
    pub fn scalar_from_hex(sk_hex: &str) -> Result<Scalar> {
        let bytes: [u8; 32] = hex::decode(sk_hex)
            .map_err(|e| anyhow!("secret key is not valid hex: {e}"))?
            .try_into()
            .map_err(|v: Vec<u8>| anyhow!("secret key must be 32 bytes, got {}", v.len()))?;
        let sk: Scalar = Scalar::from_bytes_be(&bytes)
            .into_option()
            .ok_or_else(|| anyhow!("secret key is not a canonical BLS12-381 scalar"))?;
        if bool::from(sk.is_zero()) {
            bail!("secret key must not be zero");
        }
        Ok(sk)
    }

    /// A move-in request from the extension, as JSON. `utxos` are the
    /// Cardano account's UTxOs as Koios returns them, each with the path of
    /// the key that can spend it.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MoveInRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        pub utxos: Vec<PathedUtxo>,
        /// Lovelace as a decimal string, raised to the least the deposit
        /// needs (so "0" moves only that); `null` moves the most possible.
        pub lovelace: Option<String>,
        /// Tokens to bring along, each with how much of it moves in.
        pub tokens: Vec<TokenAmount>,
        /// The staking rewards to withdraw along with it: see [`withdrawing`].
        #[serde(default)]
        pub withdrawal: Option<String>,
        /// The slot the transaction stops being valid at ([`slot_at`]):
        /// past it, one that never landed can't land any more. Without it,
        /// it stays valid for as long as its inputs are unspent.
        #[serde(default)]
        pub invalid_hereafter: Option<u64>,
    }

    #[derive(Deserialize, Clone)]
    pub struct PathedUtxo {
        pub utxo: UtxoResponse,
        /// 0 = receive chain, 1 = change chain.
        pub role: u32,
        pub index: u32,
    }

    /// A token and an amount: the raw quantity as a decimal string.
    #[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct TokenAmount {
        pub policy_id: String,
        pub asset_name: String,
        pub quantity: String,
    }

    /// A signed move-in, ready to submit, and what it does.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct MoveInResult {
        pub tx_cbor: String,
        pub tx_hash: String,
        pub fee: String,
        /// Into the wallet contract.
        pub lovelace: String,
        /// The least the deposit could carry; `null` for Max.
        pub minimum: Option<String>,
        pub tokens: Vec<TokenAmount>,
        pub deposit_outputs: usize,
        /// Staking rewards withdrawn to pay for it ("0" for none).
        pub withdrawal: String,
        /// Back to the Cardano account's receive address `0/0`.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub inputs: usize,
        /// The UTxOs Max couldn't take with the rest (empty for an amount).
        pub left_out: Vec<LeftOut>,
    }

    /// A UTxO a transaction that would take everything leaves where it is.
    #[derive(Serialize, Debug, Clone, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct LeftOut {
        pub tx_hash: String,
        pub tx_index: u64,
        /// Why:
        /// - `tokens`: one of its tokens would total more with the rest than
        ///   an output can hold (`seedelf_core::utxos::fitting`), so it waits
        ///   for the next transaction, which can take it;
        /// - `script`: it holds a reference script the wallet can't measure
        ///   (`seedelf_core::utxos::reference_script_size`), so it can't price
        ///   spending it, and no transaction of this wallet takes it;
        /// - a session's return only (`api::plan_return`): `cost`, a
        ///   stranger's token UTxO whose own ADA doesn't pay for the deposit
        ///   and bytes its tokens add, so it stays; `size`, one transaction
        ///   can't hold it with the rest, so it waits for the next return.
        pub reason: String,
    }

    fn left_out(utxos: &[UtxoResponse]) -> Vec<LeftOut> {
        utxos
            .iter()
            .map(|u| LeftOut {
                tx_hash: u.tx_hash.clone(),
                tx_index: u.tx_index,
                reason: match seedelf_core::utxos::reference_script_size(u) {
                    Ok(_) => "tokens",
                    Err(_) => "script",
                }
                .to_string(),
            })
            .collect()
    }

    /// All the ADA there will ever be, in lovelace: 45 billion ADA.
    pub const MAX_SUPPLY_LOVELACE: u64 = 45_000_000_000_000_000;

    /// An amount of lovelace from the extension: a whole number, no more
    /// than all the ADA there is.
    fn lovelace_of(l: &str) -> Result<u64> {
        let lovelace: u64 = l
            .parse()
            .map_err(|_| anyhow!("the amount must be a whole number of lovelace, got {l:?}"))?;
        if lovelace > MAX_SUPPLY_LOVELACE {
            bail!("the amount is more than all the ADA there is (45 billion)");
        }
        Ok(lovelace)
    }

    /// Token amounts from the extension, each a whole number above zero.
    fn assets_of(tokens: &[TokenAmount]) -> Result<Assets> {
        let mut assets = Assets::new();
        for t in tokens {
            let quantity: u64 = t.quantity.parse().ok().filter(|q| *q > 0).ok_or_else(|| {
                anyhow!(
                    "a token amount must be a whole number above zero, got {:?}",
                    t.quantity
                )
            })?;
            assets = assets.add(Asset::new(
                t.policy_id.clone(),
                t.asset_name.clone(),
                quantity,
            )?)?;
        }
        Ok(assets)
    }

    fn token_amount(a: &Asset) -> TokenAmount {
        TokenAmount {
            policy_id: hex::encode(a.policy_id),
            asset_name: hex::encode(&a.token_name),
            quantity: a.amount.to_string(),
        }
    }

    fn role_of(role: u32) -> Result<Role> {
        match role {
            0 => Ok(Role::Receive),
            1 => Ok(Role::Change),
            _ => bail!("a spending key is on the receive (0) or change (1) chain, not {role}"),
        }
    }

    /// Picked tokens as the account builders take them: `(policy, name,
    /// quantity)`, hex. A quantity of 0 is the builders' to refuse, by name.
    fn picked_of(tokens: &[TokenAmount]) -> Result<Vec<(String, String, u64)>> {
        tokens
            .iter()
            .map(|t| {
                let quantity = t.quantity.parse().map_err(|_| {
                    anyhow!(
                        "a token amount must be a whole number, got {:?}",
                        t.quantity
                    )
                })?;
                Ok((t.policy_id.clone(), t.asset_name.clone(), quantity))
            })
            .collect()
    }

    /// What the account pays: an amount raised to the least `payee` needs
    /// with `tokens` (so "0" pays only that), and that least; or Max
    /// (`null`), with no least.
    fn account_amount(
        params: &ProtocolParameters,
        payee: Payee,
        lovelace: &Option<String>,
        tokens: &[TokenAmount],
    ) -> Result<(AccountAmount, Option<u64>)> {
        let Some(l) = lovelace else {
            return Ok((AccountAmount::Max, None));
        };
        let asked = lovelace_of(l)?;
        // Tokens asked for none are refused by the builder, by name.
        let paying: Vec<TokenAmount> = tokens
            .iter()
            .filter(|t| t.quantity != "0")
            .cloned()
            .collect();
        let minimum = payee.minimum(params, &assets_of(&paying)?)?;
        Ok((AccountAmount::Lovelace(asked.max(minimum)), Some(minimum)))
    }

    /// Which key signs for each of the account's UTxOs: its path. Every UTxO
    /// must be under the payment key its `role/index` derives, on this
    /// network, whatever its staking part: a base address, an enterprise
    /// address (none), or our key with someone else's stake key. It's our
    /// money either way.
    pub(crate) type Paths = HashMap<(String, u64), (Role, u32)>;

    /// The payment key hash of a Shelley address on this network; `None`
    /// for a script, a Byron address, or the other network.
    fn payment_key_of(address: &str, network_flag: bool) -> Option<pallas_crypto::hash::Hash<28>> {
        let Ok(Address::Shelley(shelley)) = Address::from_bech32(address) else {
            return None;
        };
        let network = if network_flag {
            AddressNetwork::Testnet
        } else {
            AddressNetwork::Mainnet
        };
        match shelley.payment() {
            ShelleyPaymentPart::Key(hash) if shelley.network() == network => Some(*hash),
            _ => None,
        }
    }

    pub(crate) fn check_paths(
        account: &CardanoAccount,
        network_flag: bool,
        utxos: &[PathedUtxo],
    ) -> Result<Paths> {
        let mut paths = Paths::new();
        for p in utxos {
            let role = role_of(p.role)?;
            let expected = account.key_hash(role, p.index)?;
            if payment_key_of(&p.utxo.address, network_flag) != Some(expected) {
                bail!(
                    "UTxO {}#{} is not under the account's payment key {}/{}",
                    p.utxo.tx_hash,
                    p.utxo.tx_index,
                    p.role,
                    p.index
                );
            }
            paths.insert((p.utxo.tx_hash.clone(), p.utxo.tx_index), (role, p.index));
        }
        Ok(paths)
    }

    /// Signs `tx` once per distinct payment key among `spent`, inside this module.
    pub(crate) fn sign_with_paths(
        tx: &BuiltTransaction,
        account: &CardanoAccount,
        paths: &Paths,
        spent: &[&UtxoResponse],
    ) -> Result<BuiltTransaction> {
        let mut signed = tx.clone();
        let mut done: Vec<(Role, u32)> = Vec::new();
        for utxo in spent {
            let path = *paths
                .get(&(utxo.tx_hash.clone(), utxo.tx_index))
                .ok_or_else(|| {
                    anyhow!("no key path for UTxO {}#{}", utxo.tx_hash, utxo.tx_index)
                })?;
            if done.contains(&path) {
                continue;
            }
            done.push(path);
            let key = account.private_key(path.0, path.1)?;
            signed = signed
                .sign(key.to_ed25519_private_key())
                .map_err(|e| anyhow!("failed to sign: {e:?}"))?;
        }
        Ok(signed)
    }

    /// The staking rewards withdrawn alongside an account payment: `rewards`
    /// is the whole reward balance as a decimal string, which the extension
    /// passes, fresh from Koios's `account_info`, only when the user spends
    /// rewards and the account's vote is delegated (Conway refuses a
    /// withdrawal otherwise). The ledger refuses any other amount.
    fn withdrawing(
        account: &CardanoAccount,
        network_flag: bool,
        rewards: Option<&str>,
    ) -> Result<Staking> {
        let Some(rewards) = rewards else {
            return Ok(Staking::none());
        };
        let state = StakeState {
            registered: true,
            rewards: lovelace_of(rewards)?,
            votes: true,
            deposit: 0,
        };
        Staking::withdraw(&stake_key(account, network_flag)?, &state)
    }

    fn stake_key(account: &CardanoAccount, network_flag: bool) -> Result<StakeKey> {
        StakeKey::new(&account.stake_address(network_flag)?)
    }

    /// Signs with the stake key (`2/0`) for a stake certificate or a
    /// withdrawal, and with the DRep key (`3/0`) for a DRep certificate or a
    /// vote, inside this module.
    fn sign_staking(
        tx: BuiltTransaction,
        account: &CardanoAccount,
        staking: &Staking,
    ) -> Result<BuiltTransaction> {
        let mut tx = tx;
        if staking.stake_signs() {
            let key = account.private_key(Role::Staking, 0)?;
            tx = tx
                .sign(key.to_ed25519_private_key())
                .map_err(|e| anyhow!("failed to sign with the stake key: {e:?}"))?;
        }
        if staking.drep_signs() {
            let key = account.private_key(Role::Drep, 0)?;
            tx = tx
                .sign(key.to_ed25519_private_key())
                .map_err(|e| anyhow!("failed to sign with the DRep key: {e:?}"))?;
        }
        Ok(tx)
    }

    /// The account's own DRep key (`3/0`).
    fn drep_key(account: &CardanoAccount) -> Result<DrepKey> {
        Ok(DrepKey::new(account.key_hash(Role::Drep, 0)?))
    }

    /// The account's own DRep, as Koios and CIP-95 name it. Amounts none: it's
    /// only who the DRep is, not where it stands.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct DrepOf {
        /// CIP-129 (`drep1…`).
        pub id: String,
        /// The key hash, hex.
        pub hash: String,
        /// The Ed25519 public key, hex: what CIP-95's `getPubDRepKey` gives.
        pub public_key: String,
    }

    pub fn drep_of(account: &CardanoAccount) -> Result<DrepOf> {
        let key = account.private_key(Role::Drep, 0)?.to_public();
        let me = drep_key(account)?;
        Ok(DrepOf {
            id: me.id(),
            hash: hex::encode(me.hash()),
            public_key: hex::encode(key.to_ed25519_pubkey().as_ref()),
        })
    }

    /// A DRep's profile, as the user writes it, for [`drep_profile`].
    #[derive(Deserialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct ProfileRequest {
        pub given_name: String,
        #[serde(default)]
        pub objectives: Option<String>,
        #[serde(default)]
        pub motivations: Option<String>,
        #[serde(default)]
        pub qualifications: Option<String>,
        /// CIP-119's `doNotList`: asks DRep directories not to list it.
        #[serde(default)]
        pub do_not_list: bool,
    }

    /// The profile's file, to be published exactly as it is, and its
    /// blake2b-256 hash, hex: what the registration's anchor carries.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct ProfileFile {
        pub file: String,
        pub hash: String,
    }

    /// CIP-119's limits, in characters.
    pub const MAX_GIVEN_NAME: usize = 80;
    pub const MAX_PROFILE_TEXT: usize = 1000;

    /// Writes a DRep's profile as CIP-119 metadata (JSON-LD, its common
    /// context as the CIP publishes it, `doNotList` added to it), and hashes
    /// the bytes. The wallet never publishes or fetches it: the user does.
    pub fn drep_profile(request: ProfileRequest) -> Result<ProfileFile> {
        let name = request.given_name.trim();
        if name.is_empty() {
            bail!("A profile needs a name");
        }
        if name.chars().count() > MAX_GIVEN_NAME {
            bail!("A name is at most {MAX_GIVEN_NAME} characters");
        }
        let mut body = serde_json::Map::new();
        body.insert("givenName".into(), name.into());
        for (field, text) in [
            ("objectives", &request.objectives),
            ("motivations", &request.motivations),
            ("qualifications", &request.qualifications),
        ] {
            let Some(text) = text.as_deref().map(str::trim).filter(|t| !t.is_empty()) else {
                continue;
            };
            if text.chars().count() > MAX_PROFILE_TEXT {
                bail!("Each part of a profile is at most {MAX_PROFILE_TEXT} characters");
            }
            body.insert(field.into(), text.into());
        }
        if request.do_not_list {
            body.insert("doNotList".into(), true.into());
        }
        let document = serde_json::json!({
            "@context": {
                "CIP100": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
                "CIP119": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
                "hashAlgorithm": "CIP100:hashAlgorithm",
                "body": {
                    "@id": "CIP119:body",
                    "@context": {
                        "references": {
                            "@id": "CIP119:references",
                            "@container": "@set",
                            "@context": {
                                "GovernanceMetadata": "CIP100:GovernanceMetadataReference",
                                "Other": "CIP100:OtherReference",
                                "label": "CIP100:reference-label",
                                "uri": "CIP100:reference-uri"
                            }
                        },
                        "paymentAddress": "CIP119:paymentAddress",
                        "givenName": "CIP119:givenName",
                        "image": {
                            "@id": "CIP119:image",
                            "@context": { "ImageObject": "https://schema.org/ImageObject" }
                        },
                        "objectives": "CIP119:objectives",
                        "motivations": "CIP119:motivations",
                        "qualifications": "CIP119:qualifications",
                        "doNotList": "CIP119:doNotList"
                    }
                }
            },
            "hashAlgorithm": "blake2b-256",
            "body": body,
        });
        let file = serde_json::to_string_pretty(&document)? + "\n";
        Ok(ProfileFile {
            hash: hex::encode(Hasher::<256>::hash(file.as_bytes())),
            file,
        })
    }

    /// Builds and signs a move-in: the Cardano account pays into the wallet
    /// contract under fresh re-randomizations of `sk`'s base register.
    /// Every UTxO must sit at the address its path derives; each spent one is
    /// signed with that path's payment key, inside this module.
    pub fn move_in(
        account: &CardanoAccount,
        sk: Scalar,
        request: MoveInRequest,
    ) -> Result<MoveInResult> {
        let network_flag = network_flag(&request.network)?;
        let params = ProtocolParameters::from_koios(&request.params)?;
        let paths = check_paths(account, network_flag, &request.utxos)?;

        let picked = picked_of(&request.tokens)?;
        let config = get_config(VARIANT, network_flag)?;
        let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
        let owner = Register::create(sk)?;
        let payee = Payee::Seedelf {
            owner: &owner,
            wallet_addr: &wallet,
        };
        let (amount, minimum) = account_amount(&params, payee, &request.lovelace, &request.tokens)?;
        let change = account.base_address(network_flag, Role::Receive, 0)?;
        let rewards = withdrawing(account, network_flag, request.withdrawal.as_deref())?;
        let available: Vec<UtxoResponse> = request.utxos.into_iter().map(|p| p.utxo).collect();

        let built = build::move_in(
            &params,
            &available,
            amount,
            &picked,
            &owner,
            &wallet,
            &change,
            &rewards,
            request.invalid_hereafter,
        )?;

        let spent: Vec<&UtxoResponse> = built.inputs.iter().collect();
        let signed = sign_with_paths(&built.tx, account, &paths, &spent)?;
        let signed = sign_staking(signed, account, &rewards)?;

        Ok(MoveInResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            fee: built.fee.to_string(),
            lovelace: built.lovelace.to_string(),
            minimum: minimum.map(|m| m.to_string()),
            tokens: built.tokens.items.iter().map(token_amount).collect(),
            deposit_outputs: built.outputs,
            withdrawal: rewards.withdrawn().to_string(),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            inputs: built.inputs.len(),
            left_out: left_out(&built.left_out),
        })
    }

    /// Session `index`'s one-time account: a base address with payment key
    /// `0/index` and stake key `2/index` of account `24301'` (`accounts`),
    /// both the session's own. No two sessions share a key, so nothing on
    /// chain ties one session's address to another's, or to anyone else's.
    /// The stake key is never registered.
    pub fn one_time_address(
        accounts: &CardanoAccount,
        network_flag: bool,
        index: u32,
    ) -> Result<Address> {
        let network = if network_flag {
            AddressNetwork::Testnet
        } else {
            AddressNetwork::Mainnet
        };
        Ok(Address::Shelley(pallas_addresses::ShelleyAddress::new(
            network,
            ShelleyPaymentPart::key_hash(accounts.key_hash(Role::Receive, index)?),
            ShelleyDelegationPart::key_hash(accounts.key_hash(Role::Staking, index)?),
        )))
    }

    /// Session `index`'s reward (stake) address: its stake key `2/index`, never
    /// registered. A site connected to the session (private CIP-30) is given
    /// it, and some sign in with it.
    pub fn one_time_reward_address(
        accounts: &CardanoAccount,
        network_flag: bool,
        index: u32,
    ) -> Result<Address> {
        let Address::Shelley(base) = one_time_address(accounts, network_flag, index)? else {
            bail!("a one-time account's address is a Shelley address");
        };
        StakeAddress::try_from(base)
            .map(Address::from)
            .map_err(|e| anyhow!("failed to build the stake address: {e}"))
    }

    /// Session `index`'s address as sessions started before chunk 15b's fix
    /// had it: payment key `0/index` with the shared Seedelf staking part,
    /// the CLI's External Wallet's (`address::dapp_address`). That staking
    /// part is behind many other addresses, so a session no longer uses it;
    /// the ones recorded with it keep it, for what's still at them.
    pub fn shared_stake_address(
        accounts: &CardanoAccount,
        network_flag: bool,
        index: u32,
    ) -> Result<Address> {
        let key = accounts.key_hash(Role::Receive, index)?;
        dapp_address(hex::encode(key), network_flag)
    }

    /// An output at a contract, read for the session's order check: whether
    /// it's a DEX order the wallet can cancel, and the session's own
    /// (`seedelf_core::orders`). As JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DexOrderRequest {
        pub network: String,
        /// The output's address bytes, hex.
        pub address: String,
        /// Its datum's CBOR, hex: inline, or the one its hash names.
        pub datum: String,
        /// The session's address, bech32: its payment key and stake key.
        pub session: String,
        /// The output holds its datum inline, not by hash (`false` when not
        /// said): a Plutus V1 order script can never spend such an output.
        #[serde(default)]
        pub inline: bool,
        /// The output carries a script (`false` when not said): the wallet
        /// can't cancel such an order.
        #[serde(default)]
        pub script_ref: bool,
    }

    /// What [`read_dex_order`] found.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct DexOrderResult {
        /// It sits at an order script the wallet can cancel at.
        pub known: bool,
        pub protocol: Option<String>,
        /// Cancelled by the session's own key, paying the session alone, in a
        /// form its script can spend.
        pub ours: bool,
        /// Its cancel is signed by the session's stake key too.
        pub stake_signs: bool,
        /// Where its script is read from, `hash#index`, when by reference.
        pub reference: Option<String>,
        /// Why it can never be cancelled (its form: `inline`, `scriptRef`), or
        /// why its datum couldn't be read.
        pub why: Option<String>,
    }

    /// A session's payment key and stake key, from its base address.
    fn session_keys(address: &str, network_flag: bool) -> Result<seedelf_core::orders::Session> {
        let Ok(Address::Shelley(shelley)) = Address::from_bech32(address) else {
            bail!("{address} isn't a session's address");
        };
        let network = if network_flag {
            AddressNetwork::Testnet
        } else {
            AddressNetwork::Mainnet
        };
        match (shelley.payment(), shelley.delegation()) {
            (ShelleyPaymentPart::Key(payment), ShelleyDelegationPart::Key(stake))
                if shelley.network() == network =>
            {
                Ok(seedelf_core::orders::Session {
                    payment: *payment,
                    stake: *stake,
                })
            }
            _ => bail!("{address} isn't a session's address"),
        }
    }

    /// Reads an output for the session's order check.
    pub fn read_dex_order(request: DexOrderRequest) -> Result<DexOrderResult> {
        let network_flag = network_flag(&request.network)?;
        let session = session_keys(&request.session, network_flag)?;
        let address = hex::decode(&request.address)?;
        let datum = hex::decode(&request.datum)?;
        let unknown = DexOrderResult {
            known: false,
            protocol: None,
            ours: false,
            stake_signs: false,
            reference: None,
            why: None,
        };
        let header = address.first().copied().unwrap_or(0xff) >> 4;
        if header > 7 || header % 2 == 0 || address.len() < 29 {
            return Ok(unknown);
        }
        let script = Hash::<28>::new(address[1..29].try_into()?);
        let Some(entry) = seedelf_core::orders::entry(network_flag, &script)? else {
            return Ok(unknown);
        };
        // An output no script can spend is never an order the session places,
        // whatever its datum says.
        let unspendable =
            seedelf_core::orders::unspendable(&entry, request.inline, request.script_ref);
        let (ours, why) = match unspendable {
            Some(why) => (
                false,
                Some(format!("This {} order {why}", entry.protocol.name())),
            ),
            None => match seedelf_core::orders::read(entry.protocol, &datum) {
                Ok(read) => (session.owns(&read), None),
                Err(e) => (false, Some(e.to_string())),
            },
        };
        Ok(DexOrderResult {
            known: true,
            protocol: Some(entry.protocol.name().to_string()),
            ours,
            stake_signs: entry.protocol.signs_with_stake(),
            reference: entry.reference_outpoint(),
            why,
        })
    }

    /// One order to cancel: its UTxO as Koios lists it, and its datum's CBOR.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderRow {
        pub utxo: UtxoResponse,
        /// Hex: the inline datum, or the one its hash names.
        pub datum: String,
    }

    /// A cancel of the session's orders, as JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderCancelRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The session's address, bech32: where everything goes back.
        pub session: String,
        pub orders: Vec<OrderRow>,
        /// The session's own UTxOs, the collateral among them or not.
        pub funds: Vec<UtxoResponse>,
        /// One of the session's ADA-only UTxOs.
        pub collateral: UtxoResponse,
        /// The reference UTxOs the orders' scripts are read from, with their scripts.
        pub references: Vec<UtxoResponse>,
    }

    /// A cancel, unsigned: the session's payment key signs it, and its stake
    /// key too when `stakeSigns`.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderCancelResult {
        pub tx_cbor: String,
        pub tx_hash: String,
        pub fee: String,
        /// The orders it cancels, `hash#index`: the first asked for, and those that can share it.
        pub covers: Vec<String>,
        pub stake_signs: bool,
    }

    /// Builds a cancel of the session's orders (`seedelf_core::orders::cancel_orders`).
    pub fn build_order_cancel(request: OrderCancelRequest) -> Result<OrderCancelResult> {
        let network_flag = network_flag(&request.network)?;
        let params = ProtocolParameters::from_koios(&request.params)?;
        let session = session_keys(&request.session, network_flag)?;
        let address = Address::from_bech32(&request.session)
            .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
        let orders = request
            .orders
            .into_iter()
            .map(|o| {
                Ok(seedelf_core::orders::OrderToCancel {
                    utxo: o.utxo,
                    datum: hex::decode(&o.datum)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        for row in request.funds.iter().chain([&request.collateral]) {
            if payment_key_of(&row.address, network_flag) != Some(session.payment) {
                bail!(
                    "UTxO {}#{} isn't at the session's account",
                    row.tx_hash,
                    row.tx_index
                );
            }
        }
        let built = seedelf_core::orders::cancel_orders(&seedelf_core::orders::Cancel {
            params: &params,
            network_flag,
            session,
            address: &address,
            orders: &orders,
            funds: &request.funds,
            collateral: &request.collateral,
            references: &request.references,
        })?;
        Ok(OrderCancelResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            fee: built.fee.to_string(),
            covers: built.covers,
            stake_signs: built.stake_signs,
        })
    }

    /// A swap built for a session, before its key signs it: the orders it
    /// places, each to be cancelled in a dry run. As JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderCancelsRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The session's address, bech32: whose orders they are, and where
        /// each cancel pays everything back.
        pub session: String,
        /// The swap, as built (neither signed nor on chain): its CBOR, hex.
        pub tx_cbor: String,
        /// Its order outputs' indexes (the order check's).
        pub orders: Vec<u64>,
        /// The reference UTxOs the orders' scripts are read from, as Koios's
        /// `utxo_info` lists them (spent or not), with their scripts: what
        /// `buildOrderCancel` takes. A Plutus V1 order needs none.
        pub references: Vec<UtxoResponse>,
    }

    /// What [`check_order_cancels`] found, order by order as asked.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderCancelsResult {
        pub orders: Vec<OrderCancelCheck>,
    }

    /// One order a swap places, and whether the wallet's own cancel of it
    /// builds and runs.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct OrderCancelCheck {
        /// Its output's index in the swap.
        pub index: u64,
        /// `hash#index`: the order, once the swap is on chain.
        pub order: String,
        /// The DEX whose order script it sits at, when the wallet knows it.
        pub protocol: Option<String>,
        /// Its cancel built, and its script ran it, in the wallet.
        pub cancels: bool,
        /// What that cancel would pay in fees, lovelace, when it built.
        pub fee: Option<String>,
        /// Why it can't be cancelled, when it can't.
        pub why: Option<String>,
    }

    /// Before a session signs a swap, builds the wallet's own cancel of each
    /// order it places and runs the order's real script on it
    /// (`seedelf_core::orders::check_cancels`): stand-in funds and collateral
    /// of ADA alone at the session's address, each order alone. A swap or a
    /// session address that can't be read throws; an order that can't be
    /// cancelled says why.
    pub fn check_order_cancels(request: OrderCancelsRequest) -> Result<OrderCancelsResult> {
        let network_flag = network_flag(&request.network)?;
        let params = ProtocolParameters::from_koios(&request.params)?;
        let session = session_keys(&request.session, network_flag)?;
        let address = Address::from_bech32(&request.session)
            .map_err(|e| anyhow!("The session's address can't be read: {e}"))?;
        let tx = hex::decode(&request.tx_cbor).map_err(|e| anyhow!("The swap isn't hex: {e}"))?;
        let checks = seedelf_core::orders::check_cancels(&seedelf_core::orders::SwapCheck {
            params: &params,
            network_flag,
            session,
            address: &address,
            tx_cbor: &tx,
            orders: &request.orders,
            references: &request.references,
        })?;
        Ok(OrderCancelsResult {
            orders: checks
                .into_iter()
                .map(|c| OrderCancelCheck {
                    index: c.index,
                    order: c.order,
                    protocol: c.protocol.map(|p| p.name().to_string()),
                    cancels: c.why.is_none(),
                    fee: c.fee.map(|f| f.to_string()),
                    why: c.why,
                })
                .collect(),
        })
    }

    /// Bringing a private session's one-time account back into Seedelf, as
    /// JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SessionReturnRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The session: payment key `0/index` of account `24301'`.
        pub index: u32,
        /// Every UTxO at the session's account, as Koios returns them.
        pub utxos: Vec<UtxoResponse>,
        /// The Seedelf UTxOs the session's funding made (its change), still
        /// in the private balance: the return merges into them. None: the
        /// return makes new ones.
        #[serde(default)]
        pub merge: Vec<UtxoResponse>,
        /// The session's own transactions, by hash: what they left at the
        /// account comes back first when not everything can at once.
        #[serde(default)]
        pub own: Vec<String>,
    }

    /// A signed return, ready to submit, and what it moves.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct SessionReturnResult {
        pub tx_cbor: String,
        pub tx_hash: String,
        pub fee: String,
        /// What the private balance gains: everything the account held, less the fee.
        pub lovelace: String,
        pub tokens: Vec<TokenAmount>,
        /// The contract outputs holding it (tokens go a limited number to one).
        pub deposit_outputs: usize,
        /// How many of the account's UTxOs it spends.
        pub inputs: usize,
        /// How many of the funding's Seedelf UTxOs it merged into (0: new ones).
        pub merged: usize,
        /// The account's UTxOs it leaves there, for a later return.
        pub left_out: Vec<LeftOut>,
    }

    /// The most funding changes one return merges into.
    pub const MAX_MERGE: usize = 4;

    /// The session's own collateral among its UTxOs: its 5 ₳ ADA-only one,
    /// or else the largest ADA-only one that covers a script's collateral
    /// and leaves its return a valid output. Never one the wallet's evaluator
    /// can't take (`seedelf_core::eval::refusal`).
    pub(crate) fn session_collateral(utxos: &[UtxoResponse]) -> Option<&UtxoResponse> {
        let ada_only = utxos
            .iter()
            .filter(|u| u.asset_list.as_ref().is_none_or(|a| a.is_empty()))
            .filter(|u| seedelf_core::eval::refusal(u).is_none());
        let lovelace = |u: &UtxoResponse| u.value.parse::<u64>().unwrap_or(0);
        ada_only
            .clone()
            .find(|u| lovelace(u) == build::COLLATERAL_LOVELACE)
            .or_else(|| {
                ada_only
                    .filter(|u| lovelace(u) >= 2_000_000)
                    .max_by_key(|u| lovelace(u))
            })
    }

    /// What a session's return takes of its account's UTxOs ([`plan_return`]).
    #[derive(Clone)]
    pub(crate) struct ReturnPlan {
        /// The session's own and ADA-only UTxOs first, then the strangers'
        /// token UTxOs it takes (the last `strangers` of them).
        pub taken: Vec<UtxoResponse>,
        /// The rest, which stays at the account.
        pub left_out: Vec<LeftOut>,
        /// Whether the return merges into `merge` (see [`merged_return`]).
        pub merged: bool,
        /// How many of `taken`, at its end, are strangers' token UTxOs.
        pub strangers: usize,
    }

    impl ReturnPlan {
        /// The same plan with fewer of the strangers' token UTxOs it took,
        /// those it drops left out for `reason`: a return with them couldn't
        /// be built after all. All of them when it takes the session's own
        /// or ADA-only UTxOs too; when strangers' are all it takes, only the
        /// last (the smallest), so it never becomes a return of nothing while
        /// one of them may still come back (independent review H2). None
        /// when it took none, or only that one.
        fn without_strangers(&self, reason: &str) -> Option<ReturnPlan> {
            let core = self.taken.len() - self.strangers;
            let keep = if core > 0 {
                core
            } else {
                self.strangers.saturating_sub(1)
            };
            if self.strangers == 0 || keep == 0 {
                return None;
            }
            let mut left_out = self.left_out.clone();
            left_out.extend(self.taken[keep..].iter().map(|u| LeftOut {
                tx_hash: u.tx_hash.clone(),
                tx_index: u.tx_index,
                reason: reason.to_string(),
            }));
            Some(ReturnPlan {
                taken: self.taken[..keep].to_vec(),
                left_out,
                merged: self.merged,
                strangers: keep - core,
            })
        }
    }

    /// What `session_return` says when nothing at the account pays for its
    /// own way back (the worker's TOO_LITTLE reads it).
    pub const NOTHING_PAYS: &str = "Nothing at the session's account pays for its own way back: its ADA is too little for the deposit and fee";

    /// About the most a plain return's transaction takes besides its inputs
    /// and its deposit outputs: the body, its fee and required signer, and
    /// the session key's witness. One measured 160 bytes of it.
    const SWEEP_OVERHEAD_BYTES: u64 = 500;
    /// The same for a merged one, which also holds the Seedelf spend of up to
    /// [`MAX_MERGE`] of the funding's UTxOs, their proofs, the collateral and
    /// the script data. One merged into four measured under 1,000 bytes.
    const MERGED_OVERHEAD_BYTES: u64 = 2_000;
    /// What one more input adds to a transaction, at most: `[tx hash, index]`.
    const INPUT_BYTES: u64 = 40;
    /// Room each deposit output's measure leaves for the amount it really
    /// carries: up to 9 bytes, against the stand-in's 5.
    const AMOUNT_SLACK: u64 = 4;
    /// What a stranger's token UTxO brings besides the deposit and the bytes
    /// it adds, at least: a merged return's scripts read every input and
    /// output, so each one more costs a little to run.
    const STRANGER_MARGIN: u64 = 50_000;

    /// The deposit outputs `tokens` need in a return (`build::deposit_outputs`,
    /// `MAXIMUM_TOKENS_PER_UTXO` to an output, each with a register): the least
    /// lovelace they carry, and about their bytes, measured on the same
    /// stand-in outputs the minimum is.
    fn deposit_measure(params: &ProtocolParameters, tokens: &Assets) -> Result<(u64, u64)> {
        use seedelf_core::constants::{MAXIMUM_TOKENS_PER_UTXO, OVERHEAD_COST};
        let chunks = if tokens.is_empty() {
            vec![Assets::new()]
        } else {
            tokens.split(MAXIMUM_TOKENS_PER_UTXO as usize)
        };
        let per_byte = params.coins_per_utxo_size.max(1);
        chunks
            .into_iter()
            .try_fold((0u64, 0u64), |(lovelace, bytes), chunk| {
                let minimum =
                    seedelf_core::transaction::wallet_minimum_lovelace_with_assets(params, chunk)?;
                let size = (minimum / per_byte).saturating_sub(OVERHEAD_COST) + AMOUNT_SLACK;
                Ok((lovelace.saturating_add(minimum), bytes.saturating_add(size)))
            })
    }

    /// A return being planned: how many UTxOs it takes, their tokens (with
    /// the funding change's it merges into) and their reference scripts'
    /// bytes.
    #[derive(Clone)]
    struct Draft {
        /// What its transaction takes besides its inputs and outputs.
        overhead: u64,
        inputs: u64,
        tokens: Assets,
        script_bytes: u64,
    }

    impl Draft {
        /// With `row` too; None when one of its tokens would total more with
        /// the rest than an output can hold (`seedelf_core::utxos::fitting`).
        fn with(&self, row: &UtxoResponse) -> Result<Option<Draft>> {
            let (_, tokens) = utxo_assets(vec![row.clone()])?;
            let Ok(tokens) = self.tokens.merge(tokens) else {
                return Ok(None);
            };
            Ok(Some(Draft {
                overhead: self.overhead,
                inputs: self.inputs + 1,
                tokens,
                script_bytes: self
                    .script_bytes
                    .saturating_add(seedelf_core::utxos::reference_script_size(row)?),
            }))
        }

        /// About its signed size, at most.
        fn bytes(&self, params: &ProtocolParameters) -> Result<u64> {
            let (_, outputs) = deposit_measure(params, &self.tokens)?;
            Ok(self.overhead + INPUT_BYTES * self.inputs + outputs)
        }

        /// Whether one transaction holds it, safely: under the network's size
        /// and its reference scripts' limits.
        fn fits(&self, params: &ProtocolParameters) -> Result<bool> {
            Ok(self.script_bytes <= build::MAX_REFERENCE_SCRIPT_BYTES
                && self.bytes(params)? <= build::MAX_TX_SIZE)
        }

        /// The lovelace a return of it needs, at most: its deposit and its fee.
        /// Nothing when it takes nothing.
        fn needs(&self, params: &ProtocolParameters) -> Result<u64> {
            if self.inputs == 0 {
                return Ok(0);
            }
            let (minimum, _) = deposit_measure(params, &self.tokens)?;
            let fee = build::linear_fee(params, self.bytes(params)?)
                .saturating_add(build::reference_script_fee(params, self.script_bytes)?);
            Ok(minimum.saturating_add(fee))
        }
    }

    /// What a session's return takes of its account's `rows`, and whether it
    /// can merge into `merge`: the funding's change, whose tokens count in
    /// the return's. A UTxO holding a reference script that can't be measured
    /// is never taken: its fee can't be priced (`script`).
    ///
    /// Anyone can pay the session's address, so what's there is taken by cost
    /// (independent review H1, H2), never all of it blindly:
    /// - the session's own UTxOs (`own`: what its transactions left) and the
    ///   ADA-only ones first, own first, then the largest, while one
    ///   transaction holds them (`size`: the rest waits for the next return);
    /// - then each stranger's token UTxO, the largest first, only when its
    ///   own ADA pays for the deposit outputs its tokens add (20 tokens to an
    ///   output, each with a register) and the bytes it adds, and one
    ///   transaction still holds it. One that doesn't pay its own way stays
    ///   (`cost`): the session's ADA never pays for a stranger's tokens. One
    ///   that pays but doesn't fit with the rest waits for a return of its
    ///   own (`size`), unless even that couldn't hold it (`cost`: it stays).
    ///
    /// A token that would total more with the rest than an output can hold
    /// waits for the next return (`tokens`).
    ///
    /// A merged return is measured in the wallet, and its evaluator can't take
    /// a reference script, or a datum too deep to read
    /// (`seedelf_core::eval::refusal`), which anyone can send the session's
    /// address. With one, the return is the plain sweep instead, which runs no
    /// script and pays for the reference script's bytes.
    pub(crate) fn plan_return(
        params: &ProtocolParameters,
        rows: &[UtxoResponse],
        merge: &[UtxoResponse],
        own: &[String],
    ) -> Result<ReturnPlan> {
        let priced: Vec<&UtxoResponse> = rows
            .iter()
            .filter(|u| seedelf_core::utxos::reference_script_size(u).is_ok())
            .collect();
        let evaluable = priced
            .iter()
            .copied()
            .chain(merge)
            .all(|u| seedelf_core::eval::refusal(u).is_none());
        let measured: Vec<UtxoResponse> = priced.iter().map(|u| (*u).clone()).collect();
        let base = if merge.is_empty() || !evaluable || session_collateral(&measured).is_none() {
            None
        } else {
            // The funding's change is this wallet's own; if even it can't be
            // added up, the return makes new UTxOs instead.
            utxo_assets(merge.to_vec()).ok().map(|(_, tokens)| tokens)
        };
        let lovelace = |u: &UtxoResponse| -> Result<u64> {
            u.value
                .parse::<u64>()
                .map_err(|_| anyhow!("UTxO {}#{} has an unreadable value", u.tx_hash, u.tx_index))
        };
        let is_own = |u: &UtxoResponse| own.contains(&u.tx_hash);
        let has_tokens = |u: &UtxoResponse| u.asset_list.as_ref().is_some_and(|a| !a.is_empty());
        let key = |u: &UtxoResponse| -> Result<(bool, std::cmp::Reverse<u64>, String, u64)> {
            Ok((
                !is_own(u),
                std::cmp::Reverse(lovelace(u)?),
                u.tx_hash.clone(),
                u.tx_index,
            ))
        };
        let (core, strangers): (Vec<&UtxoResponse>, Vec<&UtxoResponse>) = priced
            .into_iter()
            .partition(|u| is_own(u) || !has_tokens(u));
        let mut core = core
            .into_iter()
            .map(|u| Ok((key(u)?, u)))
            .collect::<Result<Vec<_>>>()?;
        core.sort_by(|(a, _), (b, _)| a.cmp(b));
        // Strangers' only: all the same `!is_own`, so the largest first.
        let mut strangers = strangers
            .into_iter()
            .map(|u| Ok((key(u)?, u)))
            .collect::<Result<Vec<_>>>()?;
        strangers.sort_by(|(a, _), (b, _)| a.cmp(b));

        let mut draft = Draft {
            overhead: if base.is_some() {
                MERGED_OVERHEAD_BYTES
            } else {
                SWEEP_OVERHEAD_BYTES
            },
            inputs: 0,
            tokens: base.clone().unwrap_or_default(),
            script_bytes: 0,
        };
        let mut taken: Vec<UtxoResponse> = Vec::new();
        let mut why: HashMap<(String, u64), &'static str> = HashMap::new();
        let mut leave = |u: &UtxoResponse, reason: &'static str| {
            why.insert((u.tx_hash.clone(), u.tx_index), reason);
        };
        for (_, row) in core {
            match draft.with(row)? {
                None => leave(row, "tokens"),
                // The first is always taken: a return that takes nothing never comes.
                Some(more) if !taken.is_empty() && !more.fits(params)? => leave(row, "size"),
                Some(more) => {
                    draft = more;
                    taken.push(row.clone());
                }
            }
        }
        let own_taken = taken.len();
        for (_, row) in strangers {
            let Some(more) = draft.with(row)? else {
                leave(row, "tokens");
                continue;
            };
            if !more.fits(params)? {
                // It waits for a return of its own, unless even that couldn't
                // hold it, or it couldn't pay for one: then it stays.
                let alone = Draft {
                    overhead: SWEEP_OVERHEAD_BYTES,
                    inputs: 0,
                    tokens: Assets::new(),
                    script_bytes: 0,
                }
                .with(row)?;
                let stays = match alone {
                    Some(alone) => {
                        !alone.fits(params)?
                            || lovelace(row)? < alone.needs(params)?.saturating_add(STRANGER_MARGIN)
                    }
                    None => true,
                };
                leave(row, if stays { "cost" } else { "size" });
                continue;
            }
            let adds = more.needs(params)?.saturating_sub(draft.needs(params)?);
            if lovelace(row)? < adds.saturating_add(STRANGER_MARGIN) {
                leave(row, "cost");
                continue;
            }
            draft = more;
            taken.push(row.clone());
        }
        let left_out = rows
            .iter()
            .filter(|u| {
                !taken
                    .iter()
                    .any(|t| t.tx_hash == u.tx_hash && t.tx_index == u.tx_index)
            })
            .map(|u| match why.get(&(u.tx_hash.clone(), u.tx_index)) {
                Some(reason) => LeftOut {
                    tx_hash: u.tx_hash.clone(),
                    tx_index: u.tx_index,
                    reason: reason.to_string(),
                },
                // Not priced: its reference script can't be measured.
                None => left_out(std::slice::from_ref(u)).remove(0),
            })
            .collect();
        Ok(ReturnPlan {
            merged: base.is_some(),
            strangers: taken.len() - own_taken,
            taken,
            left_out,
        })
    }

    /// `build(plan)`, and when that fails for a plan that took strangers'
    /// token UTxOs, `build` of it without them (left out for `size` when the
    /// return was too big, `cost` otherwise): the plan's measure is an
    /// estimate, and the session's own never waits on a stranger's. When
    /// strangers' are all it takes, they go one at a time, the smallest
    /// first, and none that builds is left behind with the rest
    /// ([`ReturnPlan::without_strangers`]); when none of them builds,
    /// nothing pays for its own way back ([`NOTHING_PAYS`]). The plan built,
    /// with the result.
    pub(crate) fn built_or_without_strangers<T>(
        plan: ReturnPlan,
        mut build: impl FnMut(&ReturnPlan) -> Result<T>,
    ) -> Result<(T, ReturnPlan)> {
        let mut plan = plan;
        loop {
            let e = match build(&plan) {
                Ok(built) => return Ok((built, plan)),
                Err(e) => e,
            };
            let reason = if e.to_string().contains("over the network's limit") {
                "size"
            } else {
                "cost"
            };
            match plan.without_strangers(reason) {
                Some(fewer) => plan = fewer,
                None if plan.strangers > 0 && plan.strangers == plan.taken.len() => {
                    bail!(NOTHING_PAYS)
                }
                None => return Err(e),
            }
        }
    }

    /// The return of `rows`, UTxOs under session `index`'s key, merged into
    /// `merge` (the funding's Seedelf change, checked here to be this
    /// wallet's): one Seedelf spend proven with `sk`, with `collateral` (one
    /// of `rows`) as its collateral. The proofs are bound to a new one-time
    /// key, as every Seedelf spend's (privacy rule 1), never the session's:
    /// a site connected to the session can ask its key to sign, so a proof
    /// bound to it could be replayed in what the site builds. Measured in the
    /// wallet; `known` are UTxOs among `rows` that aren't on chain yet.
    /// Signed by the one-time key and the session's, here.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn merged_return(
        accounts: &CardanoAccount,
        sk: Scalar,
        chain: &Chain,
        index: u32,
        rows: &[UtxoResponse],
        collateral: &UtxoResponse,
        merge: &[UtxoResponse],
        known: &[seedelf_core::eval::Resolved],
    ) -> Result<(BuiltTransaction, build::FinalSpend)> {
        check_spendable(sk, chain, merge)?;
        if merge.len() > MAX_MERGE {
            bail!("A return merges into at most {MAX_MERGE} of the funding's UTxOs");
        }
        let key = accounts.key_hash(Role::Receive, index)?;
        let owner = Register::create(sk)?;
        let one_time = one_time_key(&sk, &new_seed());
        let spend = ScriptSpend::new(chain, merge, &owner, key_hash(&one_time))?
            .with_account(key, rows, collateral)?;
        let built = prove_with(sk, spend)?.measure_locally(known)?;
        let session_key = accounts
            .private_key(Role::Receive, index)?
            .to_ed25519_private_key();
        let signed = built
            .tx
            .clone()
            .sign(one_time)
            .and_then(|tx| tx.sign(session_key))
            .map_err(|e| anyhow!("failed to sign: {e:?}"))?;
        Ok((signed, built))
    }

    /// Builds and signs a session's return: what's at its one-time account
    /// into the wallet contract, under fresh re-randomizations of `sk`'s base
    /// register. With `merge`, one Seedelf spend takes the funding's change
    /// too, so what comes back joins the UTxO already linked to the session
    /// instead of making another ([`merged_return`]), with the session's own
    /// collateral. Without, or when a UTxO there is one the merge can't
    /// measure, it's the CLI's `external sweep` (`build::external_sweep`): no
    /// script runs, and no collateral. What it doesn't take stays, and the
    /// result says why ([`plan_return`]). Each UTxO must be under the
    /// session's payment key; it signs inside this module.
    pub fn session_return(
        accounts: &CardanoAccount,
        sk: Scalar,
        request: SessionReturnRequest,
    ) -> Result<SessionReturnResult> {
        let network_flag = network_flag(&request.network)?;
        let params = ProtocolParameters::from_koios(&request.params)?;
        if request.utxos.is_empty() {
            bail!("The session's account is empty, so there's nothing to bring back.");
        }
        let key = accounts.key_hash(Role::Receive, request.index)?;
        for utxo in &request.utxos {
            if payment_key_of(&utxo.address, network_flag) != Some(key) {
                bail!(
                    "UTxO {}#{} isn't at session {}'s account",
                    utxo.tx_hash,
                    utxo.tx_index,
                    request.index
                );
            }
        }
        let plan = plan_return(&params, &request.utxos, &request.merge, &request.own)?;
        if plan.taken.is_empty() {
            bail!(NOTHING_PAYS);
        }
        let (result, _) = built_or_without_strangers(plan, |plan| {
            planned_return(accounts, sk, &request, &params, plan)
        })?;
        Ok(result)
    }

    /// Session `request.index`'s return of what `plan` takes.
    fn planned_return(
        accounts: &CardanoAccount,
        sk: Scalar,
        request: &SessionReturnRequest,
        params: &ProtocolParameters,
        plan: &ReturnPlan,
    ) -> Result<SessionReturnResult> {
        let network_flag = network_flag(&request.network)?;
        let key = accounts.key_hash(Role::Receive, request.index)?;
        let (total, tokens) = utxo_assets(plan.taken.clone())?;
        if let (true, Some(collateral)) = (plan.merged, session_collateral(&plan.taken)) {
            let chain = chain_of(&request.network, &request.params)?;
            let (signed, built) = merged_return(
                accounts,
                sk,
                &chain,
                request.index,
                &plan.taken,
                collateral,
                &request.merge,
                &[],
            )?;
            return Ok(SessionReturnResult {
                tx_cbor: hex::encode(&signed.tx_bytes.0),
                tx_hash: hex::encode(signed.tx_hash.0),
                fee: built.fee.total.to_string(),
                lovelace: (total - built.fee.total).to_string(),
                tokens: tokens.items.iter().map(token_amount).collect(),
                deposit_outputs: built.change_outputs,
                inputs: plan.taken.len(),
                merged: request.merge.len(),
                left_out: plan.left_out.clone(),
            });
        }
        let config = get_config(VARIANT, network_flag)?;
        let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
        let owner = Register::create(sk)?;
        let (tx, fee) = build::external_sweep(params, &plan.taken, &owner, &wallet, key)?;
        let signed = tx
            .sign(
                accounts
                    .private_key(Role::Receive, request.index)?
                    .to_ed25519_private_key(),
            )
            .map_err(|e| anyhow!("failed to sign: {e:?}"))?;

        // Every output is a deposit into the contract.
        let deposit_outputs = pallas_primitives::conway::Tx::decode_fragment(&signed.tx_bytes.0)
            .map_err(|e| anyhow!("the return doesn't decode: {e}"))?
            .transaction_body
            .outputs
            .len();
        Ok(SessionReturnResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            fee: fee.to_string(),
            lovelace: (total - fee).to_string(),
            tokens: tokens.items.iter().map(token_amount).collect(),
            deposit_outputs,
            inputs: plan.taken.len(),
            merged: 0,
            left_out: plan.left_out.clone(),
        })
    }

    /// The most recipients one payment pays. The transaction must also fit
    /// 16 KiB, which core checks (`build::MAX_TX_SIZE`).
    pub const MAX_RECIPIENTS: usize = 20;

    fn check_recipients(n: usize) -> Result<()> {
        if n == 0 {
            bail!("A payment needs someone to pay");
        }
        if n > MAX_RECIPIENTS {
            bail!("A payment pays at most {MAX_RECIPIENTS} recipients at once, not {n}");
        }
        Ok(())
    }

    /// Paying addresses or Seedelfs from the Cardano account, as JSON from
    /// the extension. `utxos` are as for a move-in.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        pub utxos: Vec<PathedUtxo>,
        /// Who's paid, in order: one to [`MAX_RECIPIENTS`].
        pub payments: Vec<SendPayment>,
        /// The staking rewards to withdraw along with it: see [`withdrawing`].
        #[serde(default)]
        pub withdrawal: Option<String>,
        /// A note on the transaction, CIP-20's message, which anyone can
        /// read: one line, at most 64 characters (see [`Note::new`]).
        #[serde(default)]
        pub note: Option<String>,
        /// As for a move-in: see [`MoveInRequest::invalid_hereafter`].
        #[serde(default)]
        pub invalid_hereafter: Option<u64>,
    }

    /// One recipient of a send from the Cardano account.
    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct SendPayment {
        /// A bech32 key address on this network, or a Seedelf's full token
        /// name, lowercase hex.
        pub to: String,
        /// For a Seedelf: the contract UTxO holding it, as Koios returns it.
        /// Its register is the one paid; see [`recipient_register`].
        #[serde(default)]
        pub recipient: Option<UtxoResponse>,
        /// Lovelace as a decimal string, raised to the least the payment
        /// needs (so "0" sends only that); `null` sends the most possible,
        /// for a single recipient only.
        pub lovelace: Option<String>,
        /// Tokens to send, each with how much of it goes.
        pub tokens: Vec<TokenAmount>,
    }

    /// What one recipient of a send or a withdrawal receives. Amounts in
    /// lovelace.
    #[derive(Serialize, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct Paid {
        /// The address, or the Seedelf's name.
        pub to: String,
        pub lovelace: String,
        /// The least the payment could carry; `null` for Max.
        pub minimum: Option<String>,
        pub tokens: Vec<TokenAmount>,
    }

    /// A signed payment from the Cardano account, ready to submit, and what
    /// it does.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct SendResult {
        pub tx_cbor: String,
        pub tx_hash: String,
        /// What each recipient receives, in order.
        pub payments: Vec<Paid>,
        /// The most possible (Max) to a single recipient, rather than amounts.
        pub max: bool,
        pub fee: String,
        /// Staking rewards withdrawn to pay for it ("0" for none).
        pub withdrawal: String,
        /// The note on it, as the transaction carries it, when there is one.
        pub note: Option<String>,
        /// Back to the Cardano account's receive address `0/0`.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub inputs: usize,
        /// The UTxOs Max couldn't take with the rest (empty for amounts).
        pub left_out: Vec<LeftOut>,
    }

    /// Where a send from the Cardano account goes.
    enum SendTo {
        Address(Address),
        /// A Seedelf's register, paid in the wallet contract.
        Seedelf {
            register: Register,
            wallet: Address,
        },
    }

    impl SendTo {
        /// A key address on this network, or (a Seedelf's name, with the
        /// UTxO holding it) that Seedelf's register.
        fn read(chain: &Chain, payment: &SendPayment) -> Result<SendTo> {
            let to = payment.to.trim();
            if !is_seedelf_name(to) {
                return Ok(SendTo::Address(payable_address(chain.network_flag, to)?));
            }
            let recipient = payment
                .recipient
                .as_ref()
                .ok_or_else(|| anyhow!("paying a Seedelf needs the contract UTxO holding it"))?;
            Ok(SendTo::Seedelf {
                register: recipient_register(chain, to, recipient)?,
                wallet: wallet_contract(
                    chain.network_flag,
                    chain.config.contract.wallet_contract_hash,
                ),
            })
        }

        fn payee(&self) -> Payee<'_> {
            match self {
                SendTo::Address(to) => Payee::Address(to),
                SendTo::Seedelf { register, wallet } => Payee::Seedelf {
                    owner: register,
                    wallet_addr: wallet,
                },
            }
        }
    }

    /// Builds and signs a payment from the Cardano account to each of
    /// `request.payments`: key addresses, or Seedelfs, each under a fresh
    /// re-randomization of its register (`build::account_send_many`). The
    /// UTxOs are checked and signed for as for a move-in, inside this module.
    pub fn account_send(account: &CardanoAccount, request: SendRequest) -> Result<SendResult> {
        let chain = chain_of(&request.network, &request.params)?;
        let network_flag = chain.network_flag;
        let paths = check_paths(account, network_flag, &request.utxos)?;
        check_recipients(request.payments.len())?;
        let sends: Vec<SendTo> = request
            .payments
            .iter()
            .map(|p| SendTo::read(&chain, p))
            .collect::<Result<_>>()?;
        let mut pays = Vec::with_capacity(sends.len());
        let mut minimums = Vec::with_capacity(sends.len());
        for (send, p) in sends.iter().zip(&request.payments) {
            let (amount, minimum) =
                account_amount(&chain.params, send.payee(), &p.lovelace, &p.tokens)?;
            pays.push(AccountPay::new(
                send.payee(),
                amount,
                &picked_of(&p.tokens)?,
            ));
            minimums.push(minimum);
        }
        let change = account.base_address(network_flag, Role::Receive, 0)?;
        let rewards = withdrawing(account, network_flag, request.withdrawal.as_deref())?;
        let note = Note::new(request.note.as_deref().unwrap_or(""))?;
        let available: Vec<UtxoResponse> = request.utxos.into_iter().map(|p| p.utxo).collect();

        let built = build::account_send_many(
            &chain.params,
            &available,
            &pays,
            network_flag,
            &change,
            &rewards,
            note.as_ref(),
            request.invalid_hereafter,
        )?;

        let spent: Vec<&UtxoResponse> = built.inputs.iter().collect();
        let signed = sign_with_paths(&built.tx, account, &paths, &spent)?;
        let signed = sign_staking(signed, account, &rewards)?;

        let payments = request
            .payments
            .iter()
            .zip(&built.paid)
            .zip(minimums)
            .map(|((p, lovelace), minimum)| Paid {
                to: p.to.trim().to_string(),
                lovelace: lovelace.to_string(),
                minimum: minimum.map(|m| m.to_string()),
                tokens: p.tokens.clone(),
            })
            .collect();
        Ok(SendResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            payments,
            max: matches!(request.payments.as_slice(), [only] if only.lovelace.is_none()),
            fee: built.fee.to_string(),
            withdrawal: rewards.withdrawn().to_string(),
            note: note.map(|n| n.text().to_string()),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            inputs: built.inputs.len(),
            left_out: left_out(&built.left_out),
        })
    }

    /// A staking transaction from the Cardano account, as JSON from the
    /// extension: the account's UTxOs (as for a move-in), what to do, and
    /// where the stake key stands.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StakingRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`: its `key_deposit` is what
        /// registering pays.
        pub params: serde_json::Value,
        pub utxos: Vec<PathedUtxo>,
        pub action: StakingAction,
        /// Fresh from Koios's `account_info`.
        pub state: StakeStateIn,
        /// The account's own DRep, fresh from Koios's `drep_info`: needed
        /// for a DRep action, and nothing (never registered) by default.
        #[serde(default)]
        pub drep: Option<DrepStateIn>,
        /// As for a move-in: see [`MoveInRequest::invalid_hereafter`].
        #[serde(default)]
        pub invalid_hereafter: Option<u64>,
    }

    /// What to do with the stake key.
    #[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
    #[serde(tag = "kind", rename_all = "kebab-case")]
    pub enum StakingAction {
        /// Delegate to a pool (its ID, bech32 or hex), registering first when needed.
        Delegate { pool: String },
        /// Delegate the vote: a DRep's ID, `drep_always_abstain` or
        /// `drep_always_no_confidence`; registering first when needed.
        Vote { drep: String },
        /// Withdraw the rewards.
        Withdraw,
        /// Withdraw the rewards, unregister, and get the deposit back.
        Stop,
        /// Register the account's own DRep, with its profile's anchor when
        /// there is one, and (`delegate`) delegate the account's vote to it.
        DrepRegister {
            #[serde(default)]
            anchor: Option<AnchorIn>,
            delegate: bool,
        },
        /// Change the DRep's profile anchor, or take it away.
        DrepUpdate {
            #[serde(default)]
            anchor: Option<AnchorIn>,
        },
        /// Retire the DRep and get its deposit back.
        DrepRetire,
        /// Vote as the DRep on governance actions.
        DrepVote { votes: Vec<BallotIn> },
    }

    /// An anchor: where a file is published, and its blake2b-256 hash, hex.
    #[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct AnchorIn {
        pub url: String,
        pub hash: String,
    }

    /// One vote: the governance action by the transaction that proposed it
    /// and its index there, and `yes`, `no` or `abstain`.
    #[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct BallotIn {
        pub tx_hash: String,
        pub index: u32,
        pub vote: String,
    }

    /// The account's DRep as Koios's `drep_info` gives it.
    #[derive(Deserialize, Clone, Debug, Default)]
    #[serde(rename_all = "camelCase")]
    pub struct DrepStateIn {
        pub registered: bool,
        /// The deposit paid, in lovelace (a decimal string).
        pub deposit: String,
    }

    fn anchor_of(anchor: &Option<AnchorIn>) -> Result<Option<pallas_primitives::conway::Anchor>> {
        anchor
            .as_ref()
            .map(|a| staking::anchor(&a.url, &a.hash))
            .transpose()
    }

    /// The stake key's standing as Koios's `account_info` gives it.
    #[derive(Deserialize, Clone, Debug, Default)]
    #[serde(rename_all = "camelCase")]
    pub struct StakeStateIn {
        pub registered: bool,
        /// The deposit paid, in lovelace (a decimal string).
        pub deposit: String,
        /// The reward balance, in lovelace (a decimal string).
        pub rewards: String,
        /// The vote delegation (`delegated_drep`), or `null` for none.
        pub drep: Option<String>,
    }

    /// A signed staking transaction, ready to submit, and what it does.
    /// Amounts in lovelace.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct StakingResult {
        pub tx_cbor: String,
        pub tx_hash: String,
        pub action: StakingAction,
        /// The pool delegated to, as `pool1…`; the vote, as Koios names it.
        pub pool: Option<String>,
        pub drep: Option<String>,
        pub fee: String,
        /// Locked by registering the key, and a DRep: all of it.
        pub deposit: String,
        /// Of `deposit`, what registering the account's DRep locks up, back
        /// when the DRep retires: only for a DRep action.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub drep_deposit: Option<String>,
        /// Returned by unregistering it.
        pub refund: String,
        /// Rewards withdrawn.
        pub withdrawal: String,
        /// Back to the Cardano account's receive address `0/0`.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub inputs: usize,
    }

    /// A stake pool's ID as `pool1…`, from bech32 or hex. Throws the reason
    /// to show the user.
    pub fn pool_id(id: &str) -> Result<String> {
        Ok(staking::pool_id(&staking::parse_pool_id(id)?))
    }

    /// A vote delegation as Koios names it (CIP-129 for a DRep), from any
    /// form [`staking::parse_drep`] reads. Throws the reason to show the user.
    pub fn drep_id(id: &str) -> Result<String> {
        Ok(staking::drep_id(&staking::parse_drep(id)?))
    }

    /// Builds and signs a staking transaction: `request.action`'s
    /// certificates and withdrawal, paid for by the account's UTxOs, with
    /// everything else back to `0/0`. Signed with the spent UTxOs' payment
    /// keys and the stake key, inside this module.
    pub fn stake(account: &CardanoAccount, request: StakingRequest) -> Result<StakingResult> {
        let network_flag = network_flag(&request.network)?;
        let params = ProtocolParameters::from_koios(&request.params)?;
        let paths = check_paths(account, network_flag, &request.utxos)?;
        let state = StakeState {
            registered: request.state.registered,
            deposit: lovelace_of(&request.state.deposit)?,
            rewards: lovelace_of(&request.state.rewards)?,
            votes: request.state.drep.is_some(),
        };
        let (action, pool, drep) = match &request.action {
            StakingAction::Delegate { pool } => {
                let hash = staking::parse_pool_id(pool)?;
                (
                    StakeAction::Delegate(hash),
                    Some(staking::pool_id(&hash)),
                    None,
                )
            }
            StakingAction::Vote { drep } => {
                let parsed = staking::parse_drep(drep)?;
                let id = staking::drep_id(&parsed);
                (StakeAction::Vote(parsed), None, Some(id))
            }
            StakingAction::Withdraw => (StakeAction::Withdraw, None, None),
            StakingAction::Stop => (StakeAction::Stop, None, None),
            StakingAction::DrepRegister { .. }
            | StakingAction::DrepUpdate { .. }
            | StakingAction::DrepRetire
            | StakingAction::DrepVote { .. } => {
                return drep_transaction(account, request, network_flag, params, paths, state);
            }
        };
        let staking = Staking::of(
            &stake_key(account, network_flag)?,
            &action,
            &state,
            params.key_deposit,
        )?;
        let change = account.base_address(network_flag, Role::Receive, 0)?;
        let available: Vec<UtxoResponse> = request.utxos.into_iter().map(|p| p.utxo).collect();

        let built = build::account_staking(
            &params,
            &available,
            &staking,
            &change,
            request.invalid_hereafter,
        )?;

        let spent: Vec<&UtxoResponse> = built.inputs.iter().collect();
        let signed = sign_with_paths(&built.tx, account, &paths, &spent)?;
        let signed = sign_staking(signed, account, &staking)?;

        Ok(StakingResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            action: request.action,
            pool,
            drep,
            fee: built.fee.to_string(),
            deposit: staking.deposit().to_string(),
            drep_deposit: None,
            refund: staking.refund().to_string(),
            withdrawal: staking.withdrawn().to_string(),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            inputs: built.inputs.len(),
        })
    }

    /// A DRep action of [`stake`]'s: the account's own DRep's certificates
    /// or votes, signed with the DRep key (and the stake key, for the vote
    /// delegation that can ride along).
    fn drep_transaction(
        account: &CardanoAccount,
        request: StakingRequest,
        network_flag: bool,
        params: ProtocolParameters,
        paths: HashMap<(String, u64), (Role, u32)>,
        stake_state: StakeState,
    ) -> Result<StakingResult> {
        let me = drep_key(account)?;
        let drep_in = request.drep.clone().unwrap_or_default();
        let drep_state = DrepState {
            registered: drep_in.registered,
            deposit: if drep_in.registered {
                lovelace_of(&drep_in.deposit)?
            } else {
                0
            },
            own_vote: request.state.drep.as_deref() == Some(me.id().as_str()),
        };
        let action = match &request.action {
            StakingAction::DrepRegister { anchor, delegate } => DrepAction::Register {
                anchor: anchor_of(anchor)?,
                delegate: *delegate,
            },
            StakingAction::DrepUpdate { anchor } => DrepAction::Update {
                anchor: anchor_of(anchor)?,
            },
            StakingAction::DrepRetire => DrepAction::Retire,
            StakingAction::DrepVote { votes } => DrepAction::Vote(
                votes
                    .iter()
                    .map(|b| {
                        let vote = match b.vote.as_str() {
                            "yes" => pallas_primitives::conway::Vote::Yes,
                            "no" => pallas_primitives::conway::Vote::No,
                            "abstain" => pallas_primitives::conway::Vote::Abstain,
                            other => bail!("A vote is yes, no or abstain, not {other}"),
                        };
                        Ok((staking::gov_action_id(&b.tx_hash, b.index)?, vote))
                    })
                    .collect::<Result<_>>()?,
            ),
            _ => bail!("not a DRep action"),
        };
        let staking = Staking::drep(
            &stake_key(account, network_flag)?,
            &stake_state,
            &me,
            &drep_state,
            &action,
            &params,
        )?;
        let change = account.base_address(network_flag, Role::Receive, 0)?;
        let available: Vec<UtxoResponse> = request.utxos.into_iter().map(|p| p.utxo).collect();
        let built = build::account_staking(
            &params,
            &available,
            &staking,
            &change,
            request.invalid_hereafter,
        )?;
        let spent: Vec<&UtxoResponse> = built.inputs.iter().collect();
        let signed = sign_with_paths(&built.tx, account, &paths, &spent)?;
        let signed = sign_staking(signed, account, &staking)?;
        Ok(StakingResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            action: request.action,
            pool: None,
            drep: Some(me.id()),
            fee: built.fee.to_string(),
            deposit: staking.deposit().to_string(),
            drep_deposit: Some(staking.drep_deposit().to_string()),
            refund: staking.refund().to_string(),
            withdrawal: staking.withdrawn().to_string(),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            inputs: built.inputs.len(),
        })
    }

    /// HKDF salt for one-time keys, v1.
    pub const ONE_TIME_SALT: &[u8] = b"seedelf-one-time-key-v1";

    /// The one-time key of a Seedelf spend: HKDF-SHA-256 with the Seedelf
    /// secret as the key material and a fresh random 32-byte `seed` as the
    /// info. The seed can wait in session storage between Review and Send
    /// (a worker restart loses memory); without the Seedelf key it gives
    /// nothing, and the key itself never leaves WebAssembly. A new seed per
    /// spend keeps every one-time key new (privacy rule 1).
    pub fn one_time_key(sk: &Scalar, seed: &[u8; 32]) -> PrivateKey {
        let mut ikm = sk.to_bytes_be();
        let mut prk = [0u8; 32];
        hkdf_extract(Sha256::new(), ONE_TIME_SALT, &ikm, &mut prk);
        let mut okm = [0u8; 32];
        hkdf_expand(Sha256::new(), &prk, seed, &mut okm);
        let key = PrivateKey::from(SecretKey::from(okm));
        ikm.zeroize();
        prk.zeroize();
        okm.zeroize();
        key
    }

    /// A key's hash: what a Seedelf proof is bound to, and the transaction's required signer.
    pub(crate) fn key_hash(key: &PrivateKey) -> Hash<28> {
        Hasher::<224>::hash(key.public_key().as_ref())
    }

    fn network_flag(network: &str) -> Result<bool> {
        match network {
            "preprod" => Ok(true),
            "mainnet" => Ok(false),
            other => bail!("unknown network {other}"),
        }
    }

    /// The slot `unix_ms` (milliseconds since 1970) falls in on a network
    /// (`true` is preprod), as `seedelf_core::eval::slot_at` counts it: what
    /// a request's `invalidHereafter` is.
    pub fn slot_at(network_flag: bool, unix_ms: f64) -> Result<u64> {
        if !unix_ms.is_finite() || unix_ms < 0.0 {
            bail!("{unix_ms} isn't a time");
        }
        Ok(seedelf_core::eval::slot_at(network_flag, unix_ms as u64))
    }

    fn seed_from_hex(seed: &str) -> Result<[u8; 32]> {
        hex::decode(seed)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or_else(|| anyhow!("the one-time key's seed must be 32 bytes of hex"))
    }

    /// The personal tag rule: at most 15 characters of printable ASCII, so it
    /// fits the token name whole and reads back as text.
    pub fn check_label(label: &str) -> Result<()> {
        if let Some(c) = label.chars().find(|c| !(' '..='~').contains(c)) {
            bail!("A label can use letters, digits, spaces and ASCII punctuation, not {c:?}");
        }
        if label.len() > 15 {
            bail!("A label is at most 15 characters, got {}", label.len());
        }
        Ok(())
    }

    /// A Seedelf UTxO's history, as the extension reads it from its sealed
    /// history (activity.ts): its class, and where its money came from:
    /// `own`, `received`, `session`, `lovejoin` or `unknown`. Selection keeps
    /// different classes apart where it can (`build::Histories`).
    #[derive(Deserialize, Clone, Debug)]
    pub struct ClassIn {
        pub id: String,
        pub origin: String,
    }

    /// Each UTxO's class, by outpoint (`txHash#index`): none for the ones
    /// with no history, which are Unknown.
    pub type Classes = HashMap<String, ClassIn>;

    /// What selection knows of the UTxOs a spend for `purpose` picks from.
    pub fn histories(purpose: Purpose, classes: &Classes) -> Result<Histories> {
        classes
            .iter()
            .try_fold(Histories::new(purpose), |h, (at, class)| {
                let (hash, index) = at
                    .split_once('#')
                    .and_then(|(h, i)| Some((h, i.parse::<u64>().ok()?)))
                    .ok_or_else(|| anyhow!("{at} isn't a UTxO's txHash#index"))?;
                let origin = match class.origin.as_str() {
                    "own" => Origin::Own,
                    "received" => Origin::Received,
                    "session" => Origin::Session,
                    "lovejoin" => Origin::Lovejoin,
                    "unknown" => Origin::Unknown,
                    other => bail!("{other} isn't where a UTxO's money came from"),
                };
                Ok(h.with(
                    hash,
                    index,
                    Class {
                        id: class.id.clone(),
                        origin,
                    },
                ))
            })
    }

    /// The classes `spend` merges, by id: none when its inputs share a history.
    fn classes_mixed(classes: &Classes, spend: &ScriptSpend) -> Result<Vec<String>> {
        Ok(histories(Purpose::Pay, classes)?
            .merged(&spend.inputs())
            .into_iter()
            .map(|c| c.id)
            .collect())
    }

    /// Creating a seedelf, as JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MintRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The wallet's spendable contract UTxOs (owned, no seedelf), as Koios
        /// returns them. Each is checked here.
        pub utxos: Vec<UtxoResponse>,
        /// The personal tag; see [`check_label`].
        pub label: String,
        /// Each UTxO's history: a stealth mint takes received money first.
        #[serde(default)]
        pub classes: Classes,
        /// The one-time key's seed from the draft (hex). The draft draws it.
        pub seed: Option<String>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
    }

    #[derive(Serialize, Debug, PartialEq, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct OutRef {
        pub tx_hash: String,
        pub tx_index: u64,
    }

    /// A Seedelf spend's draft for Ogmios, and the seed to finish it with.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct SpendDraft {
        pub seed: String,
        pub draft_cbor: String,
        pub inputs: Vec<OutRef>,
    }

    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct FeeOut {
        pub size: String,
        pub compute: String,
        pub script_reference: String,
        pub total: String,
    }

    /// A finished, unsigned mint and what it does. Amounts in lovelace.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct MintResult {
        /// Unsigned: `signScriptSpend` adds giveme.my's and the one-time key's signatures.
        pub tx_cbor: String,
        pub tx_hash: String,
        pub seed: String,
        pub token_name: String,
        /// Locked with the seedelf.
        pub lovelace: String,
        pub fee: FeeOut,
        /// Back into the Seedelf balance.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub change_outputs: usize,
        pub inputs: Vec<OutRef>,
        /// The classes of money it spends together, when they're more than
        /// one: none of the choices tried without merging them paid
        /// ([`classes_mixed`]).
        pub classes_mixed: Vec<String>,
    }

    // Every Seedelf spend (a stealth mint, a transfer) shares these steps:
    // the UTxOs it pays with must be this wallet's and hold no seedelf, the
    // one-time key comes from the draft's seed, and the proofs are made here.

    fn chain_of(network: &str, params: &serde_json::Value) -> Result<Chain> {
        let network_flag = network_flag(network)?;
        Ok(Chain {
            params: ProtocolParameters::from_koios(params)?,
            network_flag,
            config: get_config(VARIANT, network_flag)?,
        })
    }

    /// Checks the UTxOs a Seedelf spend may pay with: every one is this
    /// wallet's, none holds a seedelf (it would go with the change), and the
    /// wallet's evaluator can take each (`seedelf_core::eval::refusal`): not
    /// one holding a reference script. The worker leaves those out of what a
    /// spend may pay with, so the balance, Max and coin control agree.
    fn check_spendable(sk: Scalar, chain: &Chain, utxos: &[UtxoResponse]) -> Result<()> {
        let policy = &chain.config.contract.seedelf_policy_id;
        for utxo in utxos {
            let owned = extract_bytes_with_logging(&utxo.inline_datum)
                .map(|register| register.is_owned(sk).unwrap_or(false))
                .unwrap_or(false);
            if !owned {
                bail!(
                    "UTxO {}#{} isn't this wallet's",
                    utxo.tx_hash,
                    utxo.tx_index
                );
            }
            if contains_policy_id(&utxo.asset_list, policy) {
                bail!(
                    "UTxO {}#{} holds a Seedelf; a Seedelf spend never pays with one",
                    utxo.tx_hash,
                    utxo.tx_index
                );
            }
            // Anyone can pay a Seedelf a UTxO carrying a reference script.
            if let Some(why) = seedelf_core::eval::refusal(utxo) {
                bail!("{why}, so a Seedelf spend can't take it");
            }
        }
        Ok(())
    }

    /// Proves every input of `spend` with `sk`, bound to its one-time key.
    fn prove_with(sk: Scalar, spend: ScriptSpend) -> Result<ScriptSpend> {
        spend.proven(|register, vkh| schnorr::create_proof(register.clone(), sk, vkh.to_string()))
    }

    fn draft_of(spend: &ScriptSpend, seed: &[u8; 32]) -> Result<SpendDraft> {
        Ok(SpendDraft {
            seed: hex::encode(seed),
            draft_cbor: hex::encode(&spend.draft()?.tx_bytes.0),
            inputs: out_refs(spend),
        })
    }

    /// A Seedelf spend measured in the wallet (`eval`, Aiken's `uplc`) and
    /// finished, rather than drafted for Ogmios: a draft carries valid proofs,
    /// so sending one to Koios would tell it which contract UTxOs are this
    /// wallet's, even for a review that's never sent. It saves the request
    /// too. The finished transaction is measured again as it will be sent.
    fn measured(spend: &ScriptSpend) -> Result<build::FinalSpend> {
        spend.measure_locally(&[])
    }

    /// A new one-time key's seed, for a draft.
    pub(crate) fn new_seed() -> [u8; 32] {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        seed
    }

    /// What finishing a draft needs: its seed and Ogmios's measurements.
    fn finishing(
        what: &str,
        seed: Option<&str>,
        evaluation: Option<&serde_json::Value>,
    ) -> Result<([u8; 32], Budgets)> {
        let seed = seed_from_hex(
            seed.ok_or_else(|| anyhow!("finishing a {what} needs the draft's seed"))?,
        )?;
        let evaluation =
            evaluation.ok_or_else(|| anyhow!("finishing a {what} needs Ogmios's evaluation"))?;
        Ok((seed, Budgets::from_ogmios(evaluation)?))
    }

    fn fee_out(fee: &build::ScriptFee) -> FeeOut {
        FeeOut {
            size: fee.size.to_string(),
            compute: fee.compute.to_string(),
            script_reference: fee.script_reference.to_string(),
            total: fee.total.to_string(),
        }
    }

    fn mint_spend(
        sk: Scalar,
        request: &MintRequest,
        seed: &[u8; 32],
    ) -> Result<(ScriptSpend, build::SeedelfMint)> {
        let chain = chain_of(&request.network, &request.params)?;
        check_label(&request.label)?;
        check_spendable(sk, &chain, &request.utxos)?;
        let owner = Register::create(sk)?;
        let seedelf = owner.clone().rerandomize()?;
        let signer = key_hash(&one_time_key(&sk, seed));
        let mut minted = build::mint_apart(
            &chain,
            &request.utxos,
            &histories(Purpose::Mint, &request.classes)?,
            &request.label,
            &seedelf,
            &owner,
            signer,
        )?;
        let spend = prove_with(sk, minted.spend.clone())?;
        minted.spend = spend.clone();
        Ok((spend, minted))
    }

    fn out_refs(spend: &ScriptSpend) -> Vec<OutRef> {
        spend
            .inputs()
            .into_iter()
            .map(|u| OutRef {
                tx_hash: u.tx_hash,
                tx_index: u.tx_index,
            })
            .collect()
    }

    /// Step 1 of creating a seedelf: picks the UTxOs, proves them, and drafts
    /// the transaction for Ogmios to evaluate, under a new one-time key.
    pub fn draft_mint(sk: Scalar, request: MintRequest) -> Result<SpendDraft> {
        let seed = new_seed();
        let (spend, _) = mint_spend(sk, &request, &seed)?;
        draft_of(&spend, &seed)
    }

    /// Step 2: the same mint, finished with the budgets Ogmios measured on the
    /// draft. `request` is the draft's, plus its `seed` and the `evaluation`.
    pub fn finish_mint(sk: Scalar, request: MintRequest) -> Result<MintResult> {
        let (seed, budgets) =
            finishing("mint", request.seed.as_deref(), request.evaluation.as_ref())?;
        let (spend, minted) = mint_spend(sk, &request, &seed)?;
        mint_result(&request, &spend, &minted, &spend.finalize(&budgets)?, &seed)
    }

    /// Creating a seedelf in one step, measured in the wallet ([`measured`]).
    pub fn build_mint(sk: Scalar, request: MintRequest) -> Result<MintResult> {
        let seed = new_seed();
        let (spend, minted) = mint_spend(sk, &request, &seed)?;
        mint_result(&request, &spend, &minted, &measured(&spend)?, &seed)
    }

    fn mint_result(
        request: &MintRequest,
        spend: &ScriptSpend,
        minted: &build::SeedelfMint,
        built: &build::FinalSpend,
        seed: &[u8; 32],
    ) -> Result<MintResult> {
        Ok(MintResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            token_name: hex::encode(&minted.token_name),
            lovelace: minted.lovelace.to_string(),
            fee: fee_out(&built.fee),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            change_outputs: built.change_outputs,
            inputs: out_refs(spend),
            classes_mixed: classes_mixed(&request.classes, spend)?,
        })
    }

    /// Starting a Lovejoin token pool from the Seedelf balance
    /// (`lovejoin::launch`), as JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LaunchRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The wallet's spendable contract UTxOs, as for a stealth mint; only
        /// those holding ADA alone pay for a launch.
        pub utxos: Vec<UtxoResponse>,
        /// Each UTxO's history: a launch, like a stealth mint, is tied to
        /// whatever pays for it, so it takes received money first.
        #[serde(default)]
        pub classes: Classes,
        /// The token every box holds, and how much of it: `Q`. None for an
        /// ADA pool, at any amount but the classic pool's 10 ₳.
        #[serde(default)]
        pub token: Option<TokenAmount>,
        /// Every box's ADA.
        pub box_lovelace: String,
        /// The most a fee shard pays a mix, under `box_lovelace`.
        pub max_fee: String,
        /// Whether `mix_logic`'s credential is still to register: false when
        /// `account_info` says it is already.
        pub register: bool,
    }

    /// Starting a Lovejoin pool paid by the public account
    /// (`lovejoin::launch_from_account`), as JSON from the extension: the
    /// account's UTxOs, each with its key's path, as for an account-paid mint.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountLaunchRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// What may be spent: the extension leaves out its collateral and
        /// the UTxOs its user locked.
        pub utxos: Vec<PathedUtxo>,
        /// The account's collateral, set aside: put up, never spent. Without
        /// one, the launch puts up one of `utxos`.
        #[serde(default)]
        pub collateral: Option<PathedUtxo>,
        #[serde(default)]
        pub token: Option<TokenAmount>,
        pub box_lovelace: String,
        pub max_fee: String,
        pub register: bool,
        /// As for a move-in ([`MoveInRequest::invalid_hereafter`]).
        #[serde(default)]
        pub invalid_hereafter: Option<u64>,
    }

    /// A launch paid by the public account, signed: ready to submit.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountLaunchResult {
        /// Signed by every input's key and the collateral's.
        pub tx_cbor: String,
        pub tx_hash: String,
        pub pool: crate::lovejoin::PoolView,
        pub locked: LockedOut,
        pub fee: FeeOut,
        /// Back to the public account's receive address `0/0`.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub inputs: Vec<OutRef>,
        pub collateral: OutRef,
        /// `mix_logic`'s reward account (bech32): the worker asks
        /// `account_info` whether something registered it meanwhile.
        pub mix_logic_stake: String,
    }

    /// A launch's terms as a request names them.
    fn launch_terms(
        token: Option<&TokenAmount>,
        box_lovelace: &str,
        max_fee: &str,
    ) -> Result<seedelf_core::lovejoin::Terms> {
        let number = |what: &str, text: &str| -> Result<u64> {
            text.parse()
                .map_err(|_| anyhow!("The launch's {what} isn't a whole number"))
        };
        Ok(seedelf_core::lovejoin::Terms {
            token: token.map(crate::lovejoin::box_token).transpose()?,
            box_lovelace: number("box value", box_lovelace)?,
            max_fee: number("fee cap", max_fee)?,
        })
    }

    /// `mix_logic`'s reward account on this network, bech32.
    fn mix_logic_stake(network_flag: bool, hash: &[u8; 28]) -> Result<String> {
        let mut stake = vec![if network_flag { 0xf0 } else { 0xf1 }];
        stake.extend_from_slice(hash);
        Ok(Address::from_bytes(&stake)?.to_bech32()?)
    }

    /// Starting a pool paid by the public account, in one step: picks its
    /// UTxOs and collateral as an account-paid mint does, measures the
    /// one-shot mint in the wallet, and signs it with every input's key and
    /// the collateral's. The pool it makes is checked from the finished bytes
    /// before it's returned.
    pub fn build_launch_from_account(
        account: &CardanoAccount,
        request: AccountLaunchRequest,
    ) -> Result<AccountLaunchResult> {
        let chain = chain_of(&request.network, &request.params)?;
        let mut paths = check_paths(account, chain.network_flag, &request.utxos)?;
        if let Some(c) = &request.collateral {
            paths.extend(check_paths(
                account,
                chain.network_flag,
                std::slice::from_ref(c),
            )?);
        }
        let terms = launch_terms(
            request.token.as_ref(),
            &request.box_lovelace,
            &request.max_fee,
        )?;
        let available: Vec<UtxoResponse> = request.utxos.iter().map(|p| p.utxo.clone()).collect();
        let change = account.base_address(chain.network_flag, Role::Receive, 0)?;
        let launch = seedelf_core::lovejoin::launch_from_account(
            &chain,
            &available,
            request.collateral.as_ref().map(|c| &c.utxo),
            &terms,
            request.register,
            &change,
            request.invalid_hereafter,
        )?;
        let built = launch.measure_locally()?;
        let pool = seedelf_core::lovejoin::launched_pool(
            chain.network_flag,
            &built.tx.tx_bytes.0,
            launch.seed,
        )?;
        let spent: Vec<&UtxoResponse> = launch
            .inputs()
            .iter()
            .chain(std::iter::once(launch.collateral()))
            .collect();
        let signed = sign_with_paths(&built.tx, account, &paths, &spent)?;
        let locked = &launch.locked;
        Ok(AccountLaunchResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            mix_logic_stake: mix_logic_stake(chain.network_flag, &pool.mix_logic_hash)?,
            pool: crate::lovejoin::PoolView::of(&pool)?,
            locked: LockedOut {
                reference: locked.reference.to_string(),
                mix_box: locked.mix_box.to_string(),
                mix_logic: locked.mix_logic.to_string(),
                deposit: locked.deposit.to_string(),
                total: locked.total().to_string(),
            },
            fee: fee_out(&built.fee),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            inputs: launch.inputs().iter().map(out_ref).collect(),
            collateral: out_ref(launch.collateral()),
        })
    }

    /// What a launch locks for good.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct LockedOut {
        pub reference: String,
        pub mix_box: String,
        pub mix_logic: String,
        pub deposit: String,
        pub total: String,
    }

    /// A launch, unsigned: `signScriptSpend` adds giveme.my's and the
    /// one-time key's signatures.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct LaunchResult {
        pub tx_cbor: String,
        pub tx_hash: String,
        pub seed: String,
        /// The pool it makes, read back from its own bytes and verified as a
        /// stranger's pool would be.
        pub pool: crate::lovejoin::PoolView,
        pub locked: LockedOut,
        pub fee: FeeOut,
        /// Back into the Seedelf balance.
        pub change_lovelace: String,
        pub inputs: Vec<OutRef>,
        pub classes_mixed: Vec<String>,
        /// `mix_logic`'s reward account (bech32): the worker asks
        /// `account_info` whether something registered it meanwhile.
        pub mix_logic_stake: String,
    }

    /// Starting a pool in one step: picks the Seedelf UTxOs that pay,
    /// keeping histories apart as a stealth mint does, proves them under a new
    /// one-time key, measures the scripts in the wallet and finishes it. The
    /// pool it makes is checked from the finished bytes before it's returned.
    pub fn build_launch(sk: Scalar, request: LaunchRequest) -> Result<LaunchResult> {
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        let terms = launch_terms(
            request.token.as_ref(),
            &request.box_lovelace,
            &request.max_fee,
        )?;
        let seed = new_seed();
        let owner = Register::create(sk)?;
        let signer = key_hash(&one_time_key(&sk, &seed));
        let launch = seedelf_core::lovejoin::launch_apart(
            &chain,
            &request.utxos,
            &histories(Purpose::Mint, &request.classes)?,
            &terms,
            request.register,
            &owner,
            signer,
        )?;
        let spend = prove_with(sk, launch.spend.clone())?;
        let built = measured(&spend)?;
        let pool = seedelf_core::lovejoin::launched_pool(
            chain.network_flag,
            &built.tx.tx_bytes.0,
            launch.seed,
        )?;
        let locked = &launch.locked;
        Ok(LaunchResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            mix_logic_stake: mix_logic_stake(chain.network_flag, &pool.mix_logic_hash)?,
            pool: crate::lovejoin::PoolView::of(&pool)?,
            locked: LockedOut {
                reference: locked.reference.to_string(),
                mix_box: locked.mix_box.to_string(),
                mix_logic: locked.mix_logic.to_string(),
                deposit: locked.deposit.to_string(),
                total: locked.total().to_string(),
            },
            fee: fee_out(&built.fee),
            change_lovelace: built.change_lovelace.to_string(),
            inputs: out_refs(&spend),
            classes_mixed: classes_mixed(&request.classes, &spend)?,
        })
    }

    /// Creating a seedelf paid by the Cardano account, as JSON from the
    /// extension: the account's UTxOs, each with its key's path, as for a
    /// move-in.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountMintRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// What may be spent: the extension leaves out its collateral and
        /// the UTxOs its user locked.
        pub utxos: Vec<PathedUtxo>,
        /// The account's collateral, set aside: put up, never spent. Without
        /// one, the mint puts up one of `utxos`.
        #[serde(default)]
        pub collateral: Option<PathedUtxo>,
        /// The personal tag; see [`check_label`].
        pub label: String,
        /// The staking rewards to withdraw along with it: see [`withdrawing`].
        #[serde(default)]
        pub withdrawal: Option<String>,
        /// As for a move-in ([`MoveInRequest::invalid_hereafter`]). The draft
        /// holds it too, so the finish must be given the same slot.
        #[serde(default)]
        pub invalid_hereafter: Option<u64>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
    }

    /// The draft for Ogmios.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountMintDraft {
        pub draft_cbor: String,
        pub inputs: Vec<OutRef>,
        pub collateral: OutRef,
    }

    /// A finished, signed account-paid mint and what it does. Amounts in lovelace.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct AccountMintResult {
        /// Signed by every input's key and the collateral's: ready to submit.
        pub tx_cbor: String,
        pub tx_hash: String,
        pub token_name: String,
        /// Locked with the seedelf.
        pub lovelace: String,
        pub fee: FeeOut,
        /// Staking rewards withdrawn to pay for it ("0" for none).
        pub withdrawal: String,
        /// Back to the Cardano account's receive address `0/0`.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub change_outputs: usize,
        pub inputs: Vec<OutRef>,
        pub collateral: OutRef,
    }

    fn out_ref(u: &UtxoResponse) -> OutRef {
        OutRef {
            tx_hash: u.tx_hash.clone(),
            tx_index: u.tx_index,
        }
    }

    fn account_mint_plan(
        account: &CardanoAccount,
        sk: Scalar,
        request: &AccountMintRequest,
    ) -> Result<(build::AccountMint, Paths, Staking)> {
        let chain = chain_of(&request.network, &request.params)?;
        check_label(&request.label)?;
        let mut paths = check_paths(account, chain.network_flag, &request.utxos)?;
        if let Some(c) = &request.collateral {
            paths.extend(check_paths(
                account,
                chain.network_flag,
                std::slice::from_ref(c),
            )?);
        }
        let available: Vec<UtxoResponse> = request.utxos.iter().map(|p| p.utxo.clone()).collect();
        let collateral = request.collateral.as_ref().map(|c| &c.utxo);
        let seedelf = Register::create(sk)?.rerandomize()?;
        let change = account.base_address(chain.network_flag, Role::Receive, 0)?;
        let rewards = withdrawing(account, chain.network_flag, request.withdrawal.as_deref())?;
        let mint = build::account_mint(
            &chain,
            &available,
            collateral,
            &request.label,
            &seedelf,
            &change,
            &rewards,
            request.invalid_hereafter,
        )?;
        Ok((mint, paths, rewards))
    }

    /// Creating a seedelf paid by the Cardano account, step 1: picks the
    /// UTxOs and the collateral, and drafts the transaction for Ogmios.
    pub fn draft_account_mint(
        account: &CardanoAccount,
        sk: Scalar,
        request: AccountMintRequest,
    ) -> Result<AccountMintDraft> {
        let (mint, _, _) = account_mint_plan(account, sk, &request)?;
        Ok(AccountMintDraft {
            draft_cbor: hex::encode(&mint.draft()?.tx_bytes.0),
            inputs: mint.inputs().iter().map(out_ref).collect(),
            collateral: out_ref(mint.collateral()),
        })
    }

    /// Step 2: the same request plus Ogmios's `evaluation`. Finishes the
    /// transaction with the measured budget and signs it with every input's
    /// key and the collateral's, inside this module.
    pub fn finish_account_mint(
        account: &CardanoAccount,
        sk: Scalar,
        request: AccountMintRequest,
    ) -> Result<AccountMintResult> {
        let evaluation = request
            .evaluation
            .as_ref()
            .ok_or_else(|| anyhow!("finishing a mint needs Ogmios's evaluation"))?;
        let budgets = Budgets::from_ogmios(evaluation)?;
        let (mint, paths, rewards) = account_mint_plan(account, sk, &request)?;
        let built = mint.finalize(&budgets)?;
        let spent: Vec<&UtxoResponse> = mint
            .inputs()
            .iter()
            .chain(std::iter::once(mint.collateral()))
            .collect();
        let signed = sign_with_paths(&built.tx, account, &paths, &spent)?;
        let signed = sign_staking(signed, account, &rewards)?;
        Ok(AccountMintResult {
            tx_cbor: hex::encode(&signed.tx_bytes.0),
            tx_hash: hex::encode(signed.tx_hash.0),
            token_name: hex::encode(&mint.token_name),
            lovelace: mint.lovelace.to_string(),
            fee: fee_out(&built.fee),
            withdrawal: rewards.withdrawn().to_string(),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            change_outputs: built.change_outputs,
            inputs: mint.inputs().iter().map(out_ref).collect(),
            collateral: out_ref(mint.collateral()),
        })
    }

    /// Paying Seedelfs from the Seedelf balance, as JSON from the extension.
    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct TransferRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The wallet's spendable contract UTxOs (owned, no Seedelf), as Koios
        /// returns them. Each is checked here.
        pub utxos: Vec<UtxoResponse>,
        /// The Seedelfs paid, in order: one to [`MAX_RECIPIENTS`].
        pub payments: Vec<SeedelfPayment>,
        /// Each UTxO's history: a payment takes own money first, a box last.
        #[serde(default)]
        pub classes: Classes,
        /// A part of a payment in a chain ([`build_transfer_parts`]): it spends exactly `utxos`, pays its one payment's
        /// tokens with the least ADA they need (Max's too), and carries the rest forward to the wallet's own register
        /// (`ScriptSpend::carry`) for the next part, which has no ADA of its own to pay with.
        #[serde(default)]
        pub carry: bool,
        /// The one-time key's seed from the draft (hex). The draft draws it.
        pub seed: Option<String>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
    }

    /// One Seedelf a transfer pays.
    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct SeedelfPayment {
        /// The Seedelf being paid: its full token name, lowercase hex.
        pub to: String,
        /// The contract UTxO holding that Seedelf, as Koios returns it. Its
        /// register is the recipient's; see [`recipient_register`].
        pub recipient: UtxoResponse,
        /// Lovelace to send, as a decimal string, raised to the least the
        /// payment needs (so "0" sends only that); `null` sends the most
        /// possible (Max), to a single Seedelf only: all the ADA of up to
        /// [`MAX_WITHDRAW_UTXOS`] UTxOs but the fee and what the tokens
        /// that stay need (`build::transfer_most`), as Max on Send from the
        /// Cardano account pays.
        pub lovelace: Option<String>,
        /// Tokens to send, each with how much of it goes; Max sends these
        /// too, and the others stay.
        pub tokens: Vec<TokenAmount>,
    }

    /// What one Seedelf of a transfer receives. Amounts in lovelace.
    #[derive(Serialize, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct SeedelfPaid {
        /// The Seedelf paid.
        pub to: String,
        /// Whether that Seedelf is this wallet's own: the payment comes back.
        pub to_self: bool,
        pub lovelace: String,
        /// The least the payment could carry; `null` for Max.
        pub minimum: Option<String>,
        pub tokens: Vec<TokenAmount>,
    }

    /// A finished, unsigned transfer and what it does. Amounts in lovelace.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct TransferResult {
        /// Unsigned: `signScriptSpend` adds giveme.my's and the one-time key's signatures.
        pub tx_cbor: String,
        pub tx_hash: String,
        pub seed: String,
        /// What each Seedelf receives, in order.
        pub payments: Vec<SeedelfPaid>,
        /// The most possible (Max) to a single Seedelf, rather than amounts.
        pub max: bool,
        pub fee: FeeOut,
        /// Back into the Seedelf balance: for Max, only the tokens that stay,
        /// with the least ADA they need.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub change_outputs: usize,
        /// The least ADA what stays in the Seedelf balance needs ([`change_minimum`]).
        pub change_minimum: String,
        pub inputs: Vec<OutRef>,
        /// Spendable UTxOs Max left for another payment: past the
        /// [`MAX_WITHDRAW_UTXOS`] largest, or holding a token that would
        /// total more with the rest than an output can hold. None for amounts.
        pub left: usize,
        /// The classes of money it spends together, when they're more than one.
        pub classes_mixed: Vec<String>,
        /// What it carries forward, a part of a payment in a chain ([`TransferRequest::carry`]): the row the next part
        /// spends. The worker reads which part waits for which off `inputs`.
        #[serde(skip)]
        pub carry: Option<UtxoResponse>,
    }

    /// The least ADA what stays in the Seedelf balance after `built` needs:
    /// with tokens, what they need; with none, what an output of ADA alone
    /// needs, so less than that can't stay, though nothing can. A shortfall's
    /// message says it (blind test T05: what had to stay was never said).
    fn change_minimum(chain: &Chain, built: &build::FinalSpend) -> Result<u64> {
        build::minimum_deposit(&chain.params, &built.change_tokens)
    }

    /// Whether `name` is a whole seedelf token name: 32 bytes of lowercase
    /// hex starting `5eed0e1f`.
    pub fn is_seedelf_name(name: &str) -> bool {
        name.len() == 64
            && name.starts_with("5eed0e1f")
            && name.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    }

    /// The register a payment to the seedelf `to` goes under: the datum of
    /// `utxo`, which must be a wallet-contract UTxO holding that seedelf.
    /// Whether the register is safe to pay is `build::transfer`'s check.
    pub fn recipient_register(chain: &Chain, to: &str, utxo: &UtxoResponse) -> Result<Register> {
        if !is_seedelf_name(to) {
            bail!("A Seedelf's name is 64 hex characters starting 5eed0e1f");
        }
        if utxo.payment_cred != hex::encode(chain.config.contract.wallet_contract_hash) {
            bail!("That Seedelf isn't in the Seedelf Wallet contract, so it can't be paid");
        }
        let policy = &chain.config.contract.seedelf_policy_id;
        let holds = utxo
            .asset_list
            .iter()
            .flatten()
            .any(|a| &a.policy_id == policy && a.asset_name == to);
        if !holds {
            bail!(
                "UTxO {}#{} doesn't hold the Seedelf {to}",
                utxo.tx_hash,
                utxo.tx_index
            );
        }
        extract_bytes_with_logging(&utxo.inline_datum)
            .ok_or_else(|| anyhow!("That Seedelf sits under no register, so it can't be paid"))
    }

    /// A transfer as asked, checked, before any UTxO is picked.
    struct TransferPlan {
        chain: Chain,
        payments: Vec<Payment>,
        /// What each Seedelf is paid: Max's lovelace is known once it's finished.
        paid: Vec<SeedelfPaid>,
        /// The most possible to a single Seedelf.
        max: bool,
        owner: Register,
        signer: Hash<28>,
    }

    fn transfer_plan(
        sk: Scalar,
        request: &TransferRequest,
        seed: &[u8; 32],
    ) -> Result<TransferPlan> {
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        check_recipients(request.payments.len())?;
        let max = matches!(request.payments.as_slice(), [only] if only.lovelace.is_none());
        let mut payments = Vec::with_capacity(request.payments.len());
        let mut paid = Vec::with_capacity(request.payments.len());
        for p in &request.payments {
            let register = recipient_register(&chain, &p.to, &p.recipient)?;
            let to_self = register.is_owned(sk).unwrap_or(false);
            let tokens = assets_of(&p.tokens)?;
            let minimum = build::minimum_seedelf_payment(&chain.params, &tokens)?;
            let lovelace = match &p.lovelace {
                Some(l) => lovelace_of(l)?.max(minimum),
                // Carried forward, Max's part pays its tokens with their least, and the rest goes on.
                None if max && request.carry && !tokens.is_empty() => minimum,
                None if max => 0,
                None => bail!("Max pays a single recipient: give each of several an amount"),
            };
            paid.push(SeedelfPaid {
                to: p.to.clone(),
                to_self,
                lovelace: lovelace.to_string(),
                minimum: (!max).then(|| minimum.to_string()),
                tokens: tokens.items.iter().map(token_amount).collect(),
            });
            payments.push(Payment {
                register,
                lovelace,
                tokens,
            });
        }
        if max && request.utxos.is_empty() {
            bail!("There's nothing in the Seedelf balance to send");
        }
        Ok(TransferPlan {
            chain,
            payments,
            paid,
            max,
            owner: Register::create(sk)?,
            signer: key_hash(&one_time_key(&sk, seed)),
        })
    }

    /// The plan's spend, proven, and how many UTxOs Max left. Amounts pick as
    /// few UTxOs as pay, keeping histories apart where they can
    /// (`build::transfer_apart`); Max takes the largest
    /// [`MAX_WITHDRAW_UTXOS`], the ones holding the tokens it sends first
    /// (`build::max_inputs`), and pays everything but the fee and what the
    /// tokens that stay need (`build::transfer_most`).
    fn transfer_spend(
        sk: Scalar,
        request: &TransferRequest,
        plan: &TransferPlan,
    ) -> Result<(ScriptSpend, usize)> {
        let TransferPlan {
            chain,
            payments,
            owner,
            signer,
            ..
        } = plan;
        if request.carry {
            let only = &payments[0];
            let spend = if only.lovelace == 0 {
                ScriptSpend::new(chain, &request.utxos, owner, *signer)?
            } else {
                build::transfer_from(
                    chain,
                    &request.utxos,
                    std::slice::from_ref(only),
                    owner,
                    *signer,
                )?
            };
            return Ok((prove_with(sk, spend.carry()?)?, 0));
        }
        if plan.max {
            let only = &payments[0];
            let (inputs, left) =
                build::max_inputs(&request.utxos, &only.tokens, MAX_WITHDRAW_UTXOS)?;
            let spend =
                build::transfer_most(chain, &inputs, &only.register, &only.tokens, owner, *signer)?;
            return Ok((prove_with(sk, spend)?, left));
        }
        let spend = build::transfer_apart(
            chain,
            &request.utxos,
            &histories(Purpose::Pay, &request.classes)?,
            payments,
            owner,
            *signer,
        )?;
        Ok((prove_with(sk, spend)?, 0))
    }

    /// Step 1 of paying a seedelf: checks the recipient, picks the UTxOs,
    /// proves them, and drafts the transaction for Ogmios, under a new
    /// one-time key.
    pub fn draft_transfer(sk: Scalar, request: TransferRequest) -> Result<SpendDraft> {
        let seed = new_seed();
        let plan = transfer_plan(sk, &request, &seed)?;
        let (spend, _) = transfer_spend(sk, &request, &plan)?;
        draft_of(&spend, &seed)
    }

    /// Step 2: the same transfer, finished with the budgets Ogmios measured
    /// on the draft. `request` is the draft's, plus its `seed` and the
    /// `evaluation`.
    pub fn finish_transfer(sk: Scalar, request: TransferRequest) -> Result<TransferResult> {
        let (seed, budgets) = finishing(
            "transfer",
            request.seed.as_deref(),
            request.evaluation.as_ref(),
        )?;
        let plan = transfer_plan(sk, &request, &seed)?;
        let (spend, left) = transfer_spend(sk, &request, &plan)?;
        let built = spend.finalize(&budgets)?;
        transfer_result(&request, &spend, plan, left, &built, &seed)
    }

    /// Paying Seedelfs in one step, measured in the wallet ([`measured`]).
    ///
    /// Picking checks each choice with guessed budgets, about 1.3× what the
    /// scripts use. When none pays, the largest UTxOs together are measured
    /// before the amount is refused ([`measured_or_more`]), so what's refused
    /// is what the review's own fee can't pay, and an amount up to Max's goes
    /// (blind test T05).
    pub fn build_transfer(sk: Scalar, request: TransferRequest) -> Result<TransferResult> {
        let seed = new_seed();
        let plan = transfer_plan(sk, &request, &seed)?;
        let (spend, left, built) = match transfer_spend(sk, &request, &plan) {
            Ok((spend, left)) => {
                let built = measured(&spend)?;
                (spend, left, built)
            }
            Err(short) if build::is_short(&short) && !request.carry => {
                let needed = plan
                    .payments
                    .iter()
                    .try_fold(Assets::new(), |all, p| all.merge(p.tokens.clone()))?;
                let (spend, built) = measured_or_more(short, &request.utxos, &needed, |inputs| {
                    let spend = build::transfer_from(
                        &plan.chain,
                        inputs,
                        &plan.payments,
                        &plan.owner,
                        plan.signer,
                    )?;
                    prove_with(sk, spend)
                })?;
                (spend, 0, built)
            }
            Err(e) => return Err(e),
        };
        transfer_result(&request, &spend, plan, left, &built, &seed)
    }

    /// When picking found nothing that pays by the guessed budgets (`short`):
    /// the largest UTxOs together, the ones holding `needed` first
    /// ([`build::max_inputs`]), spent by `spend` and measured. The guess runs
    /// above what the scripts use, so they may pay; if they don't, `short`.
    fn measured_or_more(
        short: anyhow::Error,
        utxos: &[UtxoResponse],
        needed: &Assets,
        spend: impl FnOnce(&[UtxoResponse]) -> Result<ScriptSpend>,
    ) -> Result<(ScriptSpend, build::FinalSpend)> {
        let Ok((inputs, _)) = build::max_inputs(utxos, needed, MAX_WITHDRAW_UTXOS) else {
            return Err(short);
        };
        let spend = spend(&inputs)?;
        match measured(&spend) {
            Ok(built) => Ok((spend, built)),
            Err(e) if build::is_short(&e) => Err(short),
            Err(e) => Err(e),
        }
    }

    fn transfer_result(
        request: &TransferRequest,
        spend: &ScriptSpend,
        plan: TransferPlan,
        left: usize,
        built: &build::FinalSpend,
        seed: &[u8; 32],
    ) -> Result<TransferResult> {
        let mut payments = plan.paid;
        // Max's one payment is everything but the fee and what the tokens that stay need; carried forward, its tokens'
        // least, as planned.
        if let (true, false, Some(paid), Some(lovelace)) = (
            plan.max,
            request.carry,
            payments.first_mut(),
            built.rest_lovelace,
        ) {
            paid.lovelace = lovelace.to_string();
        }
        let carry = request
            .carry
            .then(|| build::carried(&plan.chain, built))
            .transpose()?;
        Ok(TransferResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            payments,
            max: plan.max,
            fee: fee_out(&built.fee),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            change_outputs: built.change_outputs,
            change_minimum: change_minimum(&plan.chain, built)?.to_string(),
            inputs: out_refs(spend),
            left,
            classes_mixed: classes_mixed(&request.classes, spend)?,
            carry,
        })
    }

    /// The most UTxOs Max spends at once: the CLI's `MAXIMUM_WALLET_UTXOS`.
    /// Twenty wallet-script spends fit a transaction's budget with room.
    pub const MAX_WITHDRAW_UTXOS: usize = 20;

    /// A destination address from the extension: bech32, and one a
    /// withdrawal or a send can pay (`build::is_payable_address`).
    pub fn payable_address(network_flag: bool, to: &str) -> Result<Address> {
        let addr =
            Address::from_bech32(to.trim()).map_err(|_| anyhow!("That isn't a Cardano address"))?;
        if !build::is_payable_address(&addr, network_flag) {
            let network = if network_flag { "preprod" } else { "mainnet" };
            bail!(
                "Payments go to a normal {network} address: not a script, stake or other network's address"
            );
        }
        Ok(addr)
    }

    /// Paying addresses from the Seedelf balance, as JSON from the extension.
    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct WithdrawRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The wallet's spendable contract UTxOs (owned, no Seedelf), as Koios
        /// returns them. Each is checked here.
        pub utxos: Vec<UtxoResponse>,
        /// The addresses paid, in order: one to [`MAX_RECIPIENTS`].
        pub payments: Vec<WithdrawPayment>,
        /// Each UTxO's history: see [`WithdrawRequest::funding`].
        #[serde(default)]
        pub classes: Classes,
        /// A private session's funding or top-up, rather than a payment:
        /// received money, or a box that pays alone, goes first, and another
        /// session's money last.
        #[serde(default)]
        pub funding: Option<Funding>,
        /// With a single payment's `lovelace` null: the most a payment of its
        /// tokens can be, the other tokens staying with the least ADA they
        /// need (`build::sweep_most`), rather than everything with every
        /// token (Max). The worker asks it to say how much an amount that's
        /// too much could be (blind test T05).
        #[serde(default)]
        pub most: bool,
        /// A part of a payment in a chain ([`build_withdraw_parts`]), as [`TransferRequest::carry`]: exactly `utxos`,
        /// its payments (Everything's: every token they hold; `most`'s: its tokens) with the least ADA they need, and
        /// the rest carried forward to the wallet's own register.
        #[serde(default)]
        pub carry: bool,
        /// The one-time key's seed from the draft (hex). The draft draws it.
        pub seed: Option<String>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
    }

    /// The session a withdrawal funds.
    #[derive(Deserialize, Clone, Debug, Default)]
    pub struct Funding {
        /// Its own class, for a top-up: what its funding left pays first.
        #[serde(default)]
        pub session: Option<String>,
    }

    /// One address a withdrawal pays.
    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct WithdrawPayment {
        /// A bech32 key address on this network.
        pub to: String,
        /// Lovelace as a decimal string, raised to the least the payment
        /// needs (so "0" sends only that); `null` sends everything (Max), to
        /// a single address only.
        pub lovelace: Option<String>,
        /// Tokens to send with an amount; Max sends every token instead.
        pub tokens: Vec<TokenAmount>,
    }

    /// A finished, unsigned withdrawal and what it does. Amounts in lovelace.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct WithdrawResult {
        /// Unsigned: `signScriptSpend` adds giveme.my's and the one-time key's signatures.
        pub tx_cbor: String,
        pub tx_hash: String,
        pub seed: String,
        /// What each address receives, in order.
        pub payments: Vec<Paid>,
        /// Everything (Max) to a single address, rather than amounts; the
        /// most a payment of some tokens can be ([`WithdrawRequest::most`]) too.
        pub max: bool,
        pub fee: FeeOut,
        /// Back into the Seedelf balance (nothing, for Max; for `most`, the
        /// tokens that stay, with the least ADA they need).
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub change_outputs: usize,
        /// The least ADA what stays in the Seedelf balance needs ([`change_minimum`]).
        pub change_minimum: String,
        pub inputs: Vec<OutRef>,
        /// Spendable UTxOs Max left for another withdrawal: past the
        /// [`MAX_WITHDRAW_UTXOS`] largest, or holding a token that would total
        /// more with the rest than an output can hold
        /// (`seedelf_core::utxos::fitting`).
        pub left: usize,
        /// The classes of money it spends together, when they're more than one.
        pub classes_mixed: Vec<String>,
        /// What it carries forward, as [`TransferResult::carry`].
        #[serde(skip)]
        pub carry: Option<UtxoResponse>,
    }

    /// What a withdrawal pays: amounts, everything (Max), or the most a
    /// payment of some tokens can be ([`WithdrawRequest::most`]), with the
    /// amounts after it paid too (a session's funding in parts: its first part
    /// carries the one-time account's collateral).
    enum Withdrawing {
        /// What each address is paid.
        Amounts(Vec<Paid>, Vec<AddressPayment>),
        Everything(Address),
        Most(Address, Assets, Vec<Paid>, Vec<AddressPayment>),
    }

    /// What a withdrawal asks for, checked.
    fn withdrawal_of(chain: &Chain, request: &WithdrawRequest) -> Result<Withdrawing> {
        check_recipients(request.payments.len())?;
        if let [first, extra @ ..] = request.payments.as_slice()
            && first.lovelace.is_none()
            && (extra.is_empty() || request.most)
        {
            let to = payable_address(chain.network_flag, &first.to)?;
            if request.utxos.is_empty() {
                bail!("There's nothing in the Seedelf balance to withdraw");
            }
            if request.most {
                let (paid, extra) = amounts_of(chain, extra)?;
                return Ok(Withdrawing::Most(
                    to,
                    assets_of(&first.tokens)?,
                    paid,
                    extra,
                ));
            }
            if !first.tokens.is_empty() {
                bail!("Max sends every token, so it takes no token amounts");
            }
            return Ok(Withdrawing::Everything(to));
        }
        let (paid, to_pay) = amounts_of(chain, &request.payments)?;
        Ok(Withdrawing::Amounts(paid, to_pay))
    }

    /// Each of `payments`, an amount to an address, checked and raised to the least it needs.
    fn amounts_of(
        chain: &Chain,
        payments: &[WithdrawPayment],
    ) -> Result<(Vec<Paid>, Vec<AddressPayment>)> {
        let mut to_pay = Vec::with_capacity(payments.len());
        let mut paid = Vec::with_capacity(payments.len());
        for p in payments {
            let Some(l) = &p.lovelace else {
                bail!("Max pays a single recipient: give each of several an amount");
            };
            let to = payable_address(chain.network_flag, &p.to)?;
            let tokens = assets_of(&p.tokens)?;
            let minimum = build::minimum_address_payment(&chain.params, &to, &tokens)?;
            let lovelace = lovelace_of(l)?.max(minimum);
            paid.push(Paid {
                to: p.to.trim().to_string(),
                lovelace: lovelace.to_string(),
                minimum: Some(minimum.to_string()),
                tokens: tokens.items.iter().map(token_amount).collect(),
            });
            to_pay.push(AddressPayment {
                to,
                lovelace,
                tokens,
            });
        }
        Ok((paid, to_pay))
    }

    /// What a part carried forward ([`WithdrawRequest::carry`]) pays `to` for Everything or the most: the tokens it
    /// sends (Everything's, every token `utxos` hold), with the least ADA they need; none without a token.
    fn carried_payment(
        chain: &Chain,
        request: &WithdrawRequest,
        what: &Withdrawing,
    ) -> Result<Option<AddressPayment>> {
        let (to, tokens) = match what {
            Withdrawing::Amounts(..) => return Ok(None),
            Withdrawing::Everything(to) => (to, utxo_assets(request.utxos.clone())?.1),
            Withdrawing::Most(to, tokens, ..) => (to, tokens.clone()),
        };
        if tokens.is_empty() {
            return Ok(None);
        }
        Ok(Some(AddressPayment {
            to: to.clone(),
            lovelace: build::minimum_address_payment(&chain.params, to, &tokens)?,
            tokens,
        }))
    }

    /// The withdrawal, proven, and how many UTxOs Max left out.
    fn withdraw_spend(
        sk: Scalar,
        request: &WithdrawRequest,
        chain: &Chain,
        what: &Withdrawing,
        signer: Hash<28>,
    ) -> Result<(ScriptSpend, usize)> {
        let owner = Register::create(sk)?;
        if request.carry {
            // A part of a payment in a chain: exactly the UTxOs given, its payments with their least, the rest carried.
            let payments: Vec<AddressPayment> = match what {
                Withdrawing::Amounts(_, to_pay) => to_pay.clone(),
                Withdrawing::Everything(_) => {
                    carried_payment(chain, request, what)?.into_iter().collect()
                }
                Withdrawing::Most(_, _, _, extra) => carried_payment(chain, request, what)?
                    .into_iter()
                    .chain(extra.iter().cloned())
                    .collect(),
            };
            let spend = if payments.is_empty() {
                ScriptSpend::new(chain, &request.utxos, &owner, signer)?
            } else {
                build::sweep_many_from(chain, &request.utxos, &payments, &owner, signer)?
            };
            return Ok((prove_with(sk, spend.carry()?)?, 0));
        }
        let (spend, left) = match what {
            Withdrawing::Everything(to) => {
                // Of those whose tokens add up, the largest first, as many as fit.
                let (utxos, left) =
                    build::max_inputs(&request.utxos, &Assets::new(), MAX_WITHDRAW_UTXOS)?;
                (build::sweep_all(chain, &utxos, to, &owner, signer)?, left)
            }
            Withdrawing::Most(to, tokens, _, extra) => {
                let (utxos, left) = build::max_inputs(&request.utxos, tokens, MAX_WITHDRAW_UTXOS)?;
                (
                    build::sweep_most_with(chain, &utxos, to, tokens, extra, &owner, signer)?,
                    left,
                )
            }
            Withdrawing::Amounts(_, to_pay) => {
                let purpose = match &request.funding {
                    Some(f) => Purpose::Fund {
                        session: f.session.clone(),
                    },
                    None => Purpose::Pay,
                };
                let spend = build::sweep_many_apart(
                    chain,
                    &request.utxos,
                    &histories(purpose, &request.classes)?,
                    to_pay,
                    &owner,
                    signer,
                )?;
                (spend, 0)
            }
        };
        Ok((prove_with(sk, spend)?, left))
    }

    /// Step 1 of a withdrawal: checks the addresses, picks the UTxOs, proves
    /// them, and drafts the transaction for Ogmios, under a new one-time key.
    pub fn draft_withdraw(sk: Scalar, request: WithdrawRequest) -> Result<SpendDraft> {
        let seed = new_seed();
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        let what = withdrawal_of(&chain, &request)?;
        let signer = key_hash(&one_time_key(&sk, &seed));
        let (spend, _) = withdraw_spend(sk, &request, &chain, &what, signer)?;
        draft_of(&spend, &seed)
    }

    /// Step 2: the same withdrawal, finished with the budgets Ogmios measured.
    pub fn finish_withdraw(sk: Scalar, request: WithdrawRequest) -> Result<WithdrawResult> {
        let (seed, budgets) = finishing(
            "withdrawal",
            request.seed.as_deref(),
            request.evaluation.as_ref(),
        )?;
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        let what = withdrawal_of(&chain, &request)?;
        let signer = key_hash(&one_time_key(&sk, &seed));
        let (spend, left) = withdraw_spend(sk, &request, &chain, &what, signer)?;
        let built = spend.finalize(&budgets)?;
        withdraw_result(&request, &chain, &spend, left, what, &built, &seed)
    }

    /// Paying addresses from the Seedelf balance in one step, measured in the
    /// wallet ([`measured`]). Amounts that picking calls short are measured on
    /// the largest UTxOs before they're refused, as a transfer's are
    /// ([`build_transfer`], [`measured_or_more`]); not a session's funding,
    /// whose picking keeps another session's money out.
    pub fn build_withdraw(sk: Scalar, request: WithdrawRequest) -> Result<WithdrawResult> {
        let seed = new_seed();
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        let what = withdrawal_of(&chain, &request)?;
        let signer = key_hash(&one_time_key(&sk, &seed));
        let (spend, left, built) = match withdraw_spend(sk, &request, &chain, &what, signer) {
            Ok((spend, left)) => {
                let built = measured(&spend)?;
                (spend, left, built)
            }
            Err(short)
                if build::is_short(&short) && request.funding.is_none() && !request.carry =>
            {
                let Withdrawing::Amounts(_, to_pay) = &what else {
                    return Err(short);
                };
                let needed = to_pay
                    .iter()
                    .try_fold(Assets::new(), |all, p| all.merge(p.tokens.clone()))?;
                let owner = Register::create(sk)?;
                let (spend, built) = measured_or_more(short, &request.utxos, &needed, |inputs| {
                    let spend = build::sweep_many_from(&chain, inputs, to_pay, &owner, signer)?;
                    prove_with(sk, spend)
                })?;
                (spend, 0, built)
            }
            Err(e) => return Err(e),
        };
        withdraw_result(&request, &chain, &spend, left, what, &built, &seed)
    }

    /// The most transactions one payment goes out as ([`build_transfer_parts`], [`build_withdraw_parts`]): each
    /// spends at most [`MAX_WITHDRAW_UTXOS`], so these spend 500 UTxOs, the boxes of pools brought back all at once
    /// (the owner's test of 1.6.0). Past it, Max says how many it left, as one transaction's does.
    pub const MAX_PARTS: usize = 25;

    /// `utxos` but those `inputs` spends.
    fn without(utxos: &[UtxoResponse], inputs: &[OutRef]) -> Vec<UtxoResponse> {
        utxos
            .iter()
            .filter(|u| {
                !inputs
                    .iter()
                    .any(|i| i.tx_hash == u.tx_hash && i.tx_index == u.tx_index)
            })
            .cloned()
            .collect()
    }

    /// Whether `utxo` holds any of `tokens`.
    fn holds_any(utxo: &UtxoResponse, tokens: &[TokenAmount]) -> bool {
        utxo.asset_list.iter().flatten().any(|a| {
            tokens
                .iter()
                .any(|t| t.policy_id == a.policy_id && t.asset_name == a.asset_name)
        })
    }

    /// Whether `utxos` together hold `lovelace`: an amount more than they do can't go in any number of parts, and
    /// is refused at once, as core's shortfall (the worker says it in the user's words, `privateShortOf`).
    fn holding_enough(utxos: &[UtxoResponse], lovelace: u64) -> Result<()> {
        let held: u64 = utxos
            .iter()
            .map(|u| u.value.parse::<u64>().unwrap_or(0))
            .sum();
        if held < lovelace {
            bail!("Not enough ADA in the Seedelf balance for this payment and its fees");
        }
        Ok(())
    }

    /// How much of `token` `utxo` holds.
    fn quantity_of(utxo: &UtxoResponse, token: &TokenAmount) -> u128 {
        utxo.asset_list
            .iter()
            .flatten()
            .filter(|a| a.policy_id == token.policy_id && a.asset_name == token.asset_name)
            .map(|a| a.quantity.parse::<u128>().unwrap_or(0))
            .sum()
    }

    /// The UTxOs of `rest` holding any of `tokens`, those holding the most of them first, `at_most` of them: a part's,
    /// where the tokens sent are in more UTxOs than one transaction spends (the owner's test of 1.6.0: a pool's boxes
    /// brought back, a few of its token in each), or hold more than one output can. `rich`: those adding the most ADA
    /// first ([`Worth`]), a chain's, which takes the ADA forward (test wallet A, 1.6.0: its 2,621 ADA sat with 19 of
    /// the 400 tokens it sent, behind bundles of 20 holding only their least, and no part could pay its fee).
    fn token_group(
        rest: &[UtxoResponse],
        tokens: &[TokenAmount],
        at_most: usize,
        rich: Option<&Worth>,
    ) -> Vec<UtxoResponse> {
        let mut holders: Vec<UtxoResponse> = rest
            .iter()
            .filter(|u| holds_any(u, tokens))
            .cloned()
            .collect();
        holders.sort_by_key(|u| {
            std::cmp::Reverse((
                rich.map(|w| w.of_utxo(u)),
                tokens.iter().map(|t| quantity_of(u, t)).sum::<u128>(),
            ))
        });
        holders.truncate(at_most);
        holders
    }

    /// Whether `e` says one transaction can't take what it was given: too much computation, or too large. Fewer
    /// UTxOs or tokens at once might go.
    fn too_much(e: &anyhow::Error) -> bool {
        build::is_too_many(e) || build::is_too_large(e)
    }

    /// What each UTxO adds to a payment, the order a part takes them in ([`build::max_inputs_by`]): its ADA less the
    /// least its own tokens need kept in the Seedelf balance. The largest by ADA put a move-in's bundles of tokens,
    /// which hold only their least, ahead of UTxOs of ADA alone, and the part of those bundles couldn't pay its fee,
    /// which ended Max (the owner's test of 1.6.0: "I send all ada to myself … it skipped multi pure ada utxos and
    /// did not spend them").
    ///
    /// A session's funding (`histories`, its purpose's) takes them by its order first, then by that: received money
    /// before the wallet's own, another session's last ([`build::Histories::rank_of`]), as one transaction's funding
    /// does (privacy review §2.3), since a part that fills its room can't keep them apart.
    struct Worth(HashMap<(String, u64), (u8, u64)>);

    impl Worth {
        fn of(chain: &Chain, utxos: &[UtxoResponse], histories: Option<&Histories>) -> Self {
            Worth(
                utxos
                    .iter()
                    .map(|u| {
                        let worth = seedelf_core::utxos::assets_of(vec![u.clone()])
                            .ok()
                            .and_then(|(lovelace, tokens)| {
                                if tokens.is_empty() {
                                    return Some(lovelace);
                                }
                                let kept = build::minimum_deposit(&chain.params, &tokens).ok()?;
                                Some(lovelace.saturating_sub(kept))
                            })
                            .unwrap_or(0);
                        let first = u8::MAX - histories.map_or(0, |h| h.rank_of(u));
                        ((u.tx_hash.clone(), u.tx_index), (first, worth))
                    })
                    .collect(),
            )
        }

        fn of_utxo(&self, u: &UtxoResponse) -> (u8, u64) {
            self.0
                .get(&(u.tx_hash.clone(), u.tx_index))
                .copied()
                .unwrap_or((0, 0))
        }
    }

    /// How much one part of a payment takes: `k` UTxOs at most; of those, `h` at most holding the tokens it sends;
    /// and while parts of tokens follow it, `ada` at most holding none, so the ADA they hold is left for those parts'
    /// fees too (a move-in of many tokens leaves each output of them exactly its least ADA, which pays no fee). The
    /// last part of tokens, or one of ADA alone, fills its room.
    #[derive(Clone, Copy, Debug)]
    struct Room {
        k: usize,
        h: usize,
        ada: usize,
    }

    impl Room {
        fn new() -> Self {
            Room {
                k: MAX_WITHDRAW_UTXOS,
                h: MAX_WITHDRAW_UTXOS,
                ada: 0,
            }
        }

        /// Beside the part before's carry, in a chain: one UTxO fewer of its own.
        fn beside() -> Self {
            Room {
                k: MAX_WITHDRAW_UTXOS - 1,
                h: MAX_WITHDRAW_UTXOS - 1,
                ada: 0,
            }
        }

        /// What a part spends: of `group`, the holders its `share` of the tokens needs, then those of the rest and of
        /// `free` (those holding none of the tokens) adding the most to it ([`Worth`]); `more` when parts of tokens
        /// follow it.
        fn picks(
            &self,
            group: &[UtxoResponse],
            free: &[UtxoResponse],
            share: &[TokenAmount],
            more: bool,
            worth: &Worth,
        ) -> Result<Vec<UtxoResponse>> {
            let from: Vec<UtxoResponse> = group.iter().chain(free).cloned().collect();
            let at_most = if more {
                (group.len() + self.ada).min(self.k)
            } else {
                self.k
            };
            Ok(build::max_inputs_by(&from, &assets_of(share)?, at_most, |u| worth.of_utxo(u))?.0)
        }

        /// Fewer UTxOs, two-thirds as many: after too much computation, or a part of ADA alone that couldn't pay its
        /// own fee (those adding least to it cost more than they bring). `None` at one.
        fn fewer(self) -> Option<Room> {
            let k = (self.k * 2 / 3).clamp(1, self.k.saturating_sub(1).max(1));
            (k < self.k).then_some(Room {
                k,
                h: self.h.min(k),
                ..self
            })
        }

        /// Less room, after a part of `holders` token holders was too much for one transaction (`e`); `None` when
        /// there's none less to try. Only a payment's tokens make one output too large (change goes 20 tokens to an
        /// output), so that takes fewer holders; too large a transaction, or too much computation, fewer UTxOs.
        fn after(self, e: &anyhow::Error, holders: usize) -> Option<Room> {
            let k = match e.downcast_ref::<build::TooLarge>() {
                Some(output @ build::TooLarge::Output(_)) if holders > 1 => {
                    return Some(Room {
                        h: output.fewer(holders),
                        ..self
                    });
                }
                Some(large) => large.fewer(self.k),
                None => return self.fewer(),
            };
            (k < self.k).then_some(Room {
                k,
                h: self.h.min(k),
                ..self
            })
        }

        /// More ADA, after a part of `holders` token holders couldn't pay its own fee and change: one more of the
        /// `free` UTxOs holding no token, while parts of tokens follow it (`more`) and there's one and room for it;
        /// else fewer holders, so more of those join them.
        fn for_ada(self, holders: usize, free: usize, more: bool) -> Option<Room> {
            if more && self.ada < free && holders + self.ada < self.k {
                return Some(Room {
                    ada: self.ada + 1,
                    ..self
                });
            }
            (holders > 1).then_some(Room {
                h: holders * 2 / 3,
                ..self
            })
        }
    }

    /// Of the tokens `owed`, what `group` holds: each one's, up to what's owed.
    fn share_of(group: &[UtxoResponse], owed: &[TokenAmount]) -> Vec<TokenAmount> {
        owed.iter()
            .filter_map(|t| {
                let held: u128 = group.iter().map(|u| quantity_of(u, t)).sum();
                let take = held.min(t.quantity.parse::<u128>().unwrap_or(0));
                (take > 0).then(|| TokenAmount {
                    quantity: take.to_string(),
                    ..t.clone()
                })
            })
            .collect()
    }

    /// The tokens `owed` less those `sent`, each one's; one all sent goes.
    fn less(owed: &[TokenAmount], sent: &[TokenAmount]) -> Vec<TokenAmount> {
        owed.iter()
            .filter_map(|t| {
                let gone: u128 = sent
                    .iter()
                    .filter(|s| s.policy_id == t.policy_id && s.asset_name == t.asset_name)
                    .map(|s| s.quantity.parse::<u128>().unwrap_or(0))
                    .sum();
                let left = t.quantity.parse::<u128>().unwrap_or(0).saturating_sub(gone);
                (left > 0).then(|| TokenAmount {
                    quantity: left.to_string(),
                    ..t.clone()
                })
            })
            .collect()
    }

    /// One part of a payment: of `rest`, the UTxOs holding the `tokens` still owed that its room takes
    /// ([`token_group`]), and those holding none that add the most beside them ([`Worth`]), built by `build` (given
    /// the UTxOs, the share of the tokens they send, and whether parts of tokens follow it). A part one transaction
    /// can't take, or one that can't pay its fee, tries less room or more ADA ([`Room`]); returns it and its share.
    ///
    /// In a chain (`chained`) the part before's carry (`carried`) is spent beside them, the rest of the room theirs,
    /// and no UTxO of ADA alone is kept back for the parts after it: the carry takes the ADA forward.
    fn fit_part<R>(
        rest: &[UtxoResponse],
        tokens: &[TokenAmount],
        chained: bool,
        carried: Option<&UtxoResponse>,
        worth: &Worth,
        mut build: impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>, bool) -> Result<R>,
    ) -> Result<(R, Vec<TokenAmount>)> {
        // Holding none of the tokens owed: spending one sends none, and keeps none a later part sends.
        let free: Vec<UtxoResponse> = rest
            .iter()
            .filter(|u| !holds_any(u, tokens))
            .cloned()
            .collect();
        let mut room = if carried.is_some() {
            Room::beside()
        } else {
            Room::new()
        };
        loop {
            let group = token_group(rest, tokens, room.h, chained.then_some(worth));
            let share = share_of(&group, tokens);
            let more = !less(tokens, &share).is_empty();
            let keep_ada = more && !chained;
            let mut picks = room.picks(&group, &free, &share, keep_ada, worth)?;
            if let Some(carried) = carried {
                picks.insert(0, carried.clone());
            }
            if picks.is_empty() {
                bail!("Not enough ADA in the Seedelf balance for this payment and its fees");
            }
            let built = build(picks, share.clone(), more);
            let next = match &built {
                Ok(_) => None,
                Err(e) if too_much(e) => room.after(e, group.len()),
                Err(e) if build::is_short(e) && !share.is_empty() && !free.is_empty() => {
                    room.for_ada(group.len(), free.len(), keep_ada)
                }
                Err(e) if build::is_short(e) && share.is_empty() => room.fewer(),
                Err(_) => None,
            };
            match (built, next) {
                (Ok(part), _) => return Ok((part, share)),
                (Err(_), Some(less_room)) => room = less_room,
                (Err(e), None) => return Err(e),
            }
        }
    }

    /// What was still owed before a part of a payment, and what was left to pay it with: where a chain starts again.
    struct Owed {
        lovelace: u64,
        tokens: Vec<TokenAmount>,
        rest: Vec<UtxoResponse>,
    }

    /// One payment of `owed` lovelace and `tokens` in parts, when one transaction can't take it (`too_many`, the first
    /// try's refusal: too many UTxOs, or too large). Each part spends its own, so none waits on another; after each,
    /// what's left is tried as the last (`amount`).
    ///
    /// While tokens are owed, a part sends those its UTxOs hold: every holder's, when they're few enough, or those
    /// holding the most of them ([`token_group`]); those holding none that add the most join them for ADA ([`Worth`]).
    /// Then parts of ADA alone, those adding the most first. Each pays all its UTxOs hold but its fee and what the tokens that stay need (`most`),
    /// so ADA held with the tokens goes too (the owner's test of 1.6.0: a pool's boxes brought back hold most of the
    /// ADA). Where that's more than is owed, it pays as much as leaves the rest what it must carry: the least the
    /// tokens still owed need, or an output of ADA alone (`least`), so what it keeps is valid change; or exactly
    /// what's owed, when it sends the last of the tokens and what stays is valid change. A part one transaction
    /// can't take tries less ([`fit_part`]).
    ///
    /// Where a part of tokens has no ADA left to pay its fee with (a move-in's bundles hold exactly their least, and
    /// one big UTxO of ADA can't be shared by parts that each spend their own), the parts from the last one that has
    /// ADA on go as a chain ([`chained`]), each carrying its ADA forward to the next (`carry`, read back by
    /// `carried`); from the part before it when its ADA can't carry them, back to the first.
    ///
    /// `most`, `amount` and `carry` are told whether they build the first part, which pays `beside` too, apart from
    /// the payment: a session's funding's collateral for its one-time account, an output of its own (`paid_of` counts
    /// the payment alone).
    #[allow(clippy::too_many_arguments)]
    fn in_parts<R>(
        too_many: anyhow::Error,
        utxos: &[UtxoResponse],
        mut owed: u64,
        mut tokens: Vec<TokenAmount>,
        beside: u64,
        least: impl Fn(&[TokenAmount]) -> Result<u64>,
        worth: &Worth,
        inputs_of: impl Fn(&R) -> &[OutRef],
        paid_of: impl Fn(&R) -> Result<u64>,
        carried: impl Fn(&R) -> Option<UtxoResponse>,
        mut most: impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>, bool) -> Result<R>,
        mut amount: impl FnMut(Vec<UtxoResponse>, u64, Vec<TokenAmount>, bool) -> Result<R>,
        mut carry: impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>, bool) -> Result<R>,
    ) -> Result<Vec<R>> {
        holding_enough(utxos, owed.saturating_add(beside))?;
        let mut rest = utxos.to_vec();
        let mut parts = Vec::new();
        let mut before: Vec<Owed> = Vec::new();
        let short = loop {
            if parts.len() + 1 >= MAX_PARTS {
                return Err(too_many);
            }
            let first = parts.is_empty();
            before.push(Owed {
                lovelace: owed,
                tokens: tokens.clone(),
                rest: rest.clone(),
            });
            let fitted = fit_part(&rest, &tokens, false, None, worth, |picks, share, _| {
                let later = less(&tokens, &share);
                most(picks.clone(), share.clone(), first).and_then(|all| {
                    let paid = paid_of(&all)?;
                    if later.is_empty() && paid >= owed {
                        match amount(
                            picks.clone(),
                            owed.max(least(&share)?),
                            share.clone(),
                            first,
                        ) {
                            Err(e) if build::is_short(&e) => {}
                            exactly => return exactly,
                        }
                    }
                    let keep = least(&later)?;
                    if paid.saturating_add(keep) <= owed {
                        return Ok(all);
                    }
                    amount(
                        picks,
                        owed.saturating_sub(keep).max(least(&share)?),
                        share.clone(),
                        first,
                    )
                })
            });
            let (part, share) = match fitted {
                Ok(fitted) => fitted,
                Err(e) if build::is_short(&e) => break e,
                Err(e) => return Err(e),
            };
            owed = owed.saturating_sub(paid_of(&part)?);
            tokens = less(&tokens, &share);
            rest = without(&rest, inputs_of(&part));
            parts.push(part);
            if tokens.is_empty() && owed == 0 {
                return Ok(parts);
            }
            match amount(
                rest.clone(),
                owed.max(least(&tokens)?),
                tokens.clone(),
                false,
            ) {
                Ok(last) => {
                    parts.push(last);
                    return Ok(parts);
                }
                Err(e) if too_much(&e) => continue,
                Err(e) if build::is_short(&e) => {
                    before.push(Owed {
                        lovelace: owed,
                        tokens: tokens.clone(),
                        rest: rest.clone(),
                    });
                    break e;
                }
                Err(e) => return Err(e),
            }
        };
        // Parts that each pay their own fee can't go: one has no ADA to pay its fee with. A chain from the part that
        // couldn't go, taking the ADA there is forward, or from the one before it, back to the first (the owner's call,
        // 2026-10-21: chain where needed). `before` holds what was owed before each part, and before the one that
        // couldn't go.
        for anchor in (0..before.len()).rev() {
            match chained(
                &before[anchor],
                anchor == 0,
                MAX_PARTS - 1 - anchor,
                &least,
                worth,
                &inputs_of,
                &paid_of,
                &carried,
                &mut amount,
                &mut carry,
            ) {
                Ok(chain) => {
                    parts.truncate(anchor);
                    parts.extend(chain);
                    return Ok(parts);
                }
                Err(e) if build::is_short(&e) => {}
                Err(_) => break,
            }
        }
        Err(short)
    }

    /// A payment's parts from one on (`from`, what was owed before it) as a chain, where parts that each pay their own
    /// fee can't go. Each part but the last pays the tokens it sends with their least ADA, and carries the rest
    /// forward to the wallet's own register (`carry`, read back by `carried`): the next spends that beside its own
    /// UTxOs, so it waits for the one before to be on chain (giveme.my witnesses only what's on the ledger). After
    /// each, what's left is tried beside its carry as the last, which pays what's still owed (`amount`). `first`:
    /// the chain starts at the payment's first part, which pays a funding's collateral too; `room`: how many parts it
    /// may be. Short when the ADA it starts with can't carry it to the end.
    #[allow(clippy::too_many_arguments)]
    fn chained<R>(
        from: &Owed,
        first: bool,
        room: usize,
        least: &impl Fn(&[TokenAmount]) -> Result<u64>,
        worth: &Worth,
        inputs_of: &impl Fn(&R) -> &[OutRef],
        paid_of: &impl Fn(&R) -> Result<u64>,
        carried: &impl Fn(&R) -> Option<UtxoResponse>,
        amount: &mut impl FnMut(Vec<UtxoResponse>, u64, Vec<TokenAmount>, bool) -> Result<R>,
        carry: &mut impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>, bool) -> Result<R>,
    ) -> Result<Vec<R>> {
        let (mut owed, mut tokens, mut rest) =
            (from.lovelace, from.tokens.clone(), from.rest.clone());
        let mut parts: Vec<R> = Vec::new();
        let mut forward: Option<UtxoResponse> = None;
        while parts.len() < room {
            let starts = first && parts.is_empty();
            if let Some(carried) = &forward {
                let all = std::iter::once(carried.clone())
                    .chain(rest.iter().cloned())
                    .collect();
                match amount(all, owed.max(least(&tokens)?), tokens.clone(), false) {
                    Ok(last) => {
                        parts.push(last);
                        return Ok(parts);
                    }
                    Err(e) if too_much(&e) => {}
                    Err(e) => return Err(e),
                }
            }
            let (part, share) = fit_part(
                &rest,
                &tokens,
                true,
                forward.as_ref(),
                worth,
                |picks, share, _| carry(picks, share, starts),
            )?;
            forward = Some(next_of(&part, &forward, inputs_of, carried)?);
            owed = owed.saturating_sub(paid_of(&part)?);
            tokens = less(&tokens, &share);
            rest = without(&rest, inputs_of(&part));
            parts.push(part);
        }
        bail!("A chain of parts would be more transactions than one payment goes out as")
    }

    /// What `part` of a chain carries forward, once it spent something besides what the part before carried
    /// (`forward`): a part spending its carry alone would go round for nothing.
    fn next_of<R>(
        part: &R,
        forward: &Option<UtxoResponse>,
        inputs_of: &impl Fn(&R) -> &[OutRef],
        carried: &impl Fn(&R) -> Option<UtxoResponse>,
    ) -> Result<UtxoResponse> {
        if inputs_of(part).len() <= usize::from(forward.is_some()) {
            bail!("A part of the chain spends nothing new");
        }
        carried(part).ok_or_else(|| anyhow!("A part of the chain carries nothing forward"))
    }

    /// Max in parts: every UTxO, [`MAX_PARTS`] transactions at most, each the most of what it spends (`part`, given
    /// the UTxOs it spends and the tokens it sends). The tokens sent go first: every holder's, when they're few
    /// enough, or those holding the most of them ([`token_group`]), with the UTxOs holding none of them that add the
    /// most ([`Worth`]); then the rest, those adding the most first, so a UTxO of ADA alone goes before a bundle of
    /// tokens holding only their least. A part one transaction can't take, or one of ADA alone that can't pay its
    /// fee, tries less ([`fit_part`]).
    ///
    /// Where what's left has no ADA to pay a part's fee with (bundles of tokens holding only their least), the parts
    /// from the last one that has ADA on go as a chain ([`max_chained`], `carry`), so Max leaves nothing it could
    /// spend (the owner, 2026-10-21: "grab all utxos, split the tokens off with their min ada going back as change
    /// then send all the ada minus the fee out"). The last says how many it left, as one transaction's Max does.
    #[allow(clippy::too_many_arguments)]
    fn max_in_parts<R>(
        utxos: &[UtxoResponse],
        mut tokens: Vec<TokenAmount>,
        worth: &Worth,
        left_of: impl Fn(&mut R) -> &mut usize,
        inputs_of: impl Fn(&R) -> &[OutRef],
        carried: impl Fn(&R) -> Option<UtxoResponse>,
        mut part: impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>) -> Result<R>,
        mut carry: impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>) -> Result<R>,
    ) -> Result<Vec<R>> {
        let mut rest = utxos.to_vec();
        let mut parts: Vec<R> = Vec::new();
        let mut before: Vec<(Vec<TokenAmount>, Vec<UtxoResponse>)> = Vec::new();
        let mut failed: Option<anyhow::Error> = None;
        while !rest.is_empty() && parts.len() < MAX_PARTS {
            before.push((tokens.clone(), rest.clone()));
            let (built, share) =
                match fit_part(&rest, &tokens, false, None, worth, |picks, share, _| {
                    part(picks, share)
                }) {
                    Ok(fitted) => fitted,
                    Err(e) => {
                        failed = Some(e);
                        break;
                    }
                };
            tokens = less(&tokens, &share);
            let taken = inputs_of(&built).len();
            rest = without(&rest, inputs_of(&built));
            parts.push(built);
            if taken == 0 {
                break;
            }
        }
        // A part couldn't pay its fee: from it, taking the ADA there is forward, or from the one before it, back to
        // the first, a chain. With none, Max sends what went, and says how many it left; refused only with nothing.
        if let Some(e) = failed {
            let mut went = false;
            if build::is_short(&e) {
                for anchor in (0..before.len()).rev() {
                    match max_chained(
                        &before[anchor],
                        MAX_PARTS - anchor,
                        worth,
                        &inputs_of,
                        &carried,
                        &mut part,
                        &mut carry,
                    ) {
                        Ok(chain) => {
                            parts.truncate(anchor);
                            parts.extend(chain);
                            went = true;
                            break;
                        }
                        Err(e) if build::is_short(&e) => {}
                        Err(_) => break,
                    }
                }
            }
            if !went && parts.is_empty() {
                return Err(e);
            }
        }
        let spent: Vec<OutRef> = parts
            .iter()
            .flat_map(|p| inputs_of(p).iter().cloned())
            .collect();
        let left = without(utxos, &spent).len();
        for p in parts.iter_mut() {
            *left_of(p) = 0;
        }
        if let Some(last) = parts.last_mut() {
            *left_of(last) = left;
        }
        Ok(parts)
    }

    /// Max's parts from one on (`from`: the tokens still sent and what was left before it) as a chain, as
    /// [`chained`] pays an amount: each but the last sends its tokens with their least ADA and carries the rest
    /// forward (`carry`); once what's left fits one transaction beside the carry, the last pays all of it (`part`).
    fn max_chained<R>(
        from: &(Vec<TokenAmount>, Vec<UtxoResponse>),
        room: usize,
        worth: &Worth,
        inputs_of: &impl Fn(&R) -> &[OutRef],
        carried: &impl Fn(&R) -> Option<UtxoResponse>,
        part: &mut impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>) -> Result<R>,
        carry: &mut impl FnMut(Vec<UtxoResponse>, Vec<TokenAmount>) -> Result<R>,
    ) -> Result<Vec<R>> {
        let (mut tokens, mut rest) = from.clone();
        let mut parts: Vec<R> = Vec::new();
        let mut forward: Option<UtxoResponse> = None;
        while parts.len() < room {
            if let Some(carried) = &forward
                && rest.len() < MAX_WITHDRAW_UTXOS
            {
                let all = std::iter::once(carried.clone())
                    .chain(rest.iter().cloned())
                    .collect();
                match part(all, tokens.clone()) {
                    Ok(last) => {
                        parts.push(last);
                        return Ok(parts);
                    }
                    Err(e) if too_much(&e) => {}
                    Err(e) => return Err(e),
                }
            }
            let (built, share) = fit_part(
                &rest,
                &tokens,
                true,
                forward.as_ref(),
                worth,
                |picks, share, _| carry(picks, share),
            )?;
            forward = Some(next_of(&built, &forward, inputs_of, carried)?);
            tokens = less(&tokens, &share);
            rest = without(&rest, inputs_of(&built));
            parts.push(built);
        }
        bail!("A chain of parts would be more transactions than one payment goes out as")
    }

    /// Paying a Seedelf from the Seedelf balance as several transactions when one can't spend enough UTxOs (the
    /// owner's test of 1.6.0, after a pool's boxes came back, a UTxO each: "spending more than the max amount of
    /// utxos does not create two healthy tx"; then "attempting to send all my min to myself": its token in more UTxOs
    /// than one spends). One transaction when it does, as [`build_transfer`] builds it. An amount to one Seedelf goes
    /// in parts ([`in_parts`]); Max takes every UTxO ([`max_in_parts`]). Several Seedelfs at once go in one
    /// transaction, as before.
    pub fn build_transfer_parts(
        sk: Scalar,
        request: TransferRequest,
    ) -> Result<Vec<TransferResult>> {
        let with = |utxos: Vec<UtxoResponse>,
                    lovelace: Option<u64>,
                    tokens: Vec<TokenAmount>,
                    carry: bool| {
            let mut sub = request.clone();
            sub.utxos = utxos;
            sub.carry = carry;
            sub.payments = vec![SeedelfPayment {
                lovelace: lovelace.map(|l| l.to_string()),
                tokens,
                ..request.payments[0].clone()
            }];
            build_transfer(sk, sub)
        };
        let chain = chain_of(&request.network, &request.params)?;
        let worth = Worth::of(&chain, &request.utxos, None);
        if let [only] = request.payments.as_slice()
            && only.lovelace.is_none()
        {
            return max_in_parts(
                &request.utxos,
                only.tokens.clone(),
                &worth,
                |r: &mut TransferResult| &mut r.left,
                |r| &r.inputs,
                |r| r.carry.clone(),
                |from, share| with(from, None, share, false),
                |from, share| with(from, None, share, true),
            );
        }
        let too_many = match build_transfer(sk, request.clone()) {
            Ok(one) => return Ok(vec![one]),
            Err(e) if too_much(&e) && request.payments.len() == 1 => e,
            Err(e) => return Err(e),
        };
        let pay = &request.payments[0];
        let least = |tokens: &[TokenAmount]| {
            build::minimum_seedelf_payment(&chain.params, &assets_of(tokens)?)
        };
        let owed = lovelace_of(pay.lovelace.as_deref().unwrap_or("0"))?.max(least(&pay.tokens)?);
        in_parts(
            too_many,
            &request.utxos,
            owed,
            pay.tokens.clone(),
            0,
            least,
            &worth,
            |r: &TransferResult| &r.inputs,
            |r| lovelace_of(&r.payments[0].lovelace),
            |r| r.carry.clone(),
            |picks, share, _| with(picks, None, share, false),
            |from, lovelace, tokens, _| with(from, Some(lovelace), tokens, false),
            // Carried forward: its tokens with their least ADA (an amount of 0 is raised to it).
            |picks, share, _| with(picks, Some(0), share, true),
        )
    }

    /// Paying an address from the Seedelf balance (Make public, Send to an address) as several transactions when one
    /// can't take it, as [`build_transfer_parts`] pays a Seedelf: an amount to one address in parts, Everything (Max)
    /// every UTxO, and `most` (a shortfall's measure) every UTxO too, so the most it says an amount can be is what
    /// the parts would pay. Several addresses at once go in one transaction, as before.
    ///
    /// A session's funding goes in parts too (the owner's test of 1.6.0: selling a token spread over more UTxOs than
    /// one transaction spends): its first payment, the swap's or the site's, in parts as an amount is, picked by
    /// funding's order first ([`Worth`]); the payments after it (the one-time account's collateral, an output of ADA
    /// alone) in the first part.
    pub fn build_withdraw_parts(
        sk: Scalar,
        request: WithdrawRequest,
    ) -> Result<Vec<WithdrawResult>> {
        let funding = request.funding.is_some();
        let with = |utxos: Vec<UtxoResponse>,
                    lovelace: Option<u64>,
                    tokens: Vec<TokenAmount>,
                    most: bool,
                    first: bool,
                    carry: bool| {
            let mut sub = request.clone();
            sub.utxos = utxos;
            sub.most = most;
            sub.carry = carry;
            let beside = if first && funding {
                &request.payments[1..]
            } else {
                &[]
            };
            sub.payments = std::iter::once(WithdrawPayment {
                lovelace: lovelace.map(|l| l.to_string()),
                tokens,
                ..request.payments[0].clone()
            })
            .chain(beside.iter().cloned())
            .collect();
            build_withdraw(sk, sub)
        };
        if let [only] = request.payments.as_slice()
            && only.lovelace.is_none()
            && !funding
        {
            let worth = Worth::of(
                &chain_of(&request.network, &request.params)?,
                &request.utxos,
                None,
            );
            // Everything sends every token; `most`, those named, the others staying.
            let most = request.most;
            let tokens = if most {
                only.tokens.clone()
            } else {
                Vec::new()
            };
            return max_in_parts(
                &request.utxos,
                tokens,
                &worth,
                |r: &mut WithdrawResult| &mut r.left,
                |r| &r.inputs,
                |r| r.carry.clone(),
                |from, share| with(from, None, share, most, false, false),
                |from, share| with(from, None, share, most, false, true),
            );
        }
        let too_many = match build_withdraw(sk, request.clone()) {
            Ok(one) => return Ok(vec![one]),
            Err(e) if too_much(&e) && (request.payments.len() == 1 || funding) => e,
            Err(e) => return Err(e),
        };
        let chain = chain_of(&request.network, &request.params)?;
        let pay = &request.payments[0];
        let to = payable_address(chain.network_flag, &pay.to)?;
        let least = |tokens: &[TokenAmount]| {
            build::minimum_address_payment(&chain.params, &to, &assets_of(tokens)?)
        };
        let owed = lovelace_of(pay.lovelace.as_deref().unwrap_or("0"))?.max(least(&pay.tokens)?);
        let (beside, _) = amounts_of(&chain, &request.payments[1..])?;
        let beside = beside
            .iter()
            .map(|p| lovelace_of(&p.lovelace))
            .sum::<Result<u64>>()?;
        let worth = match &request.funding {
            Some(f) => Worth::of(
                &chain,
                &request.utxos,
                Some(&histories(
                    Purpose::Fund {
                        session: f.session.clone(),
                    },
                    &request.classes,
                )?),
            ),
            None => Worth::of(&chain, &request.utxos, None),
        };
        // A part of an amount pays the most of its UTxOs' ADA, with the tokens it sends, every other token staying in
        // the Seedelf balance with the least ADA it needs (`most`): Everything would pay those too, which weren't asked
        // for.
        in_parts(
            too_many,
            &request.utxos,
            owed,
            pay.tokens.clone(),
            beside,
            least,
            &worth,
            |r: &WithdrawResult| &r.inputs,
            |r| lovelace_of(&r.payments[0].lovelace),
            |r| r.carry.clone(),
            |picks, share, first| with(picks, None, share, true, first, false),
            |from, lovelace, tokens, first| with(from, Some(lovelace), tokens, false, first, false),
            // Carried forward: its tokens with their least ADA (an amount of 0 is raised to it).
            |picks, share, first| with(picks, Some(0), share, false, first, true),
        )
    }

    fn withdraw_result(
        request: &WithdrawRequest,
        chain: &Chain,
        spend: &ScriptSpend,
        left: usize,
        what: Withdrawing,
        built: &build::FinalSpend,
        seed: &[u8; 32],
    ) -> Result<WithdrawResult> {
        let to = || request.payments[0].to.trim().to_string();
        // Carried forward, Everything and the most pay their tokens with their least (`carried_payment`).
        let carried = if request.carry {
            carried_payment(chain, request, &what)?
        } else {
            None
        };
        let carried_paid = || Paid {
            to: to(),
            lovelace: carried.as_ref().map_or(0, |p| p.lovelace).to_string(),
            minimum: None,
            tokens: carried.as_ref().map_or_else(Vec::new, |p| {
                p.tokens.items.iter().map(token_amount).collect()
            }),
        };
        let (payments, max, change) = match what {
            Withdrawing::Amounts(paid, _) => (paid, false, true),
            Withdrawing::Everything(_) if request.carry => (vec![carried_paid()], true, true),
            Withdrawing::Most(_, _, extra, _) if request.carry => (
                std::iter::once(carried_paid()).chain(extra).collect(),
                true,
                true,
            ),
            // Max's one payment is everything the inputs held, less the fee.
            Withdrawing::Everything(_) => (
                vec![Paid {
                    to: to(),
                    lovelace: built.change_lovelace.to_string(),
                    minimum: None,
                    tokens: built.change_tokens.items.iter().map(token_amount).collect(),
                }],
                true,
                false,
            ),
            // The most: all but the fee, what the tokens that stay need, and the amounts after it.
            Withdrawing::Most(_, tokens, extra, _) => (
                std::iter::once(Paid {
                    to: to(),
                    lovelace: built.rest_lovelace.unwrap_or_default().to_string(),
                    minimum: None,
                    tokens: tokens.items.iter().map(token_amount).collect(),
                })
                .chain(extra)
                .collect(),
                true,
                true,
            ),
        };
        Ok(WithdrawResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            payments,
            max,
            fee: fee_out(&built.fee),
            change_lovelace: if change {
                built.change_lovelace.to_string()
            } else {
                "0".into()
            },
            change_tokens: if change {
                built.change_tokens.items.len()
            } else {
                0
            },
            change_outputs: if change { built.change_outputs } else { 0 },
            change_minimum: if change {
                change_minimum(chain, built)?
            } else {
                build::minimum_deposit(&chain.params, &Assets::new())?
            }
            .to_string(),
            inputs: out_refs(spend),
            left,
            classes_mixed: classes_mixed(&request.classes, spend)?,
            carry: request
                .carry
                .then(|| build::carried(chain, built))
                .transpose()?,
        })
    }

    /// Removing one of this wallet's seedelfs, as JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RemoveRequest {
        pub network: String,
        /// One row of Koios's `epoch_params`.
        pub params: serde_json::Value,
        /// The contract UTxO holding the seedelf, as Koios returns it.
        pub utxo: UtxoResponse,
        /// Where its ADA goes: a bech32 key address, or `null` for the Seedelf balance.
        pub to: Option<String>,
        /// The one-time key's seed from the draft (hex). The draft draws it.
        pub seed: Option<String>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
    }

    /// A finished, unsigned removal and what it does. Amounts in lovelace.
    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct RemoveResult {
        /// Unsigned: `signScriptSpend` adds giveme.my's and the one-time key's signatures.
        pub tx_cbor: String,
        pub tx_hash: String,
        pub seed: String,
        /// The seedelf burned: its token name, hex.
        pub name: String,
        /// Where its ADA goes; `null` is the Seedelf balance.
        pub to: Option<String>,
        /// What comes back: the ADA locked with it, less the fee.
        pub lovelace: String,
        pub fee: FeeOut,
        pub inputs: Vec<OutRef>,
    }

    fn remove_spend(
        sk: Scalar,
        request: &RemoveRequest,
        seed: &[u8; 32],
    ) -> Result<(ScriptSpend, Vec<u8>)> {
        let chain = chain_of(&request.network, &request.params)?;
        let utxo = &request.utxo;
        let owned = extract_bytes_with_logging(&utxo.inline_datum)
            .is_some_and(|register| register.is_owned(sk).unwrap_or(false));
        if !owned {
            bail!("That Seedelf isn't this wallet's");
        }
        let name = build::seedelf_in(&chain, utxo)?;
        let signer = key_hash(&one_time_key(&sk, seed));
        let mut spend = build::remove(&chain, utxo, &Register::create(sk)?, signer)?;
        if let Some(to) = &request.to {
            spend = spend.change_to(&payable_address(chain.network_flag, to)?);
        }
        Ok((prove_with(sk, spend)?, name))
    }

    /// Step 1 of removing a seedelf: checks it's this wallet's, proves its
    /// UTxO, and drafts the burn for Ogmios, under a new one-time key.
    pub fn draft_remove(sk: Scalar, request: RemoveRequest) -> Result<SpendDraft> {
        let seed = new_seed();
        let (spend, _) = remove_spend(sk, &request, &seed)?;
        draft_of(&spend, &seed)
    }

    /// Step 2: the same removal, finished with the budgets Ogmios measured.
    pub fn finish_remove(sk: Scalar, request: RemoveRequest) -> Result<RemoveResult> {
        let (seed, budgets) = finishing(
            "removal",
            request.seed.as_deref(),
            request.evaluation.as_ref(),
        )?;
        let (spend, name) = remove_spend(sk, &request, &seed)?;
        let built = spend.finalize(&budgets)?;
        Ok(remove_result(&request, &spend, &name, &built, &seed))
    }

    /// Removing a seedelf in one step, measured in the wallet ([`measured`]).
    pub fn build_remove(sk: Scalar, request: RemoveRequest) -> Result<RemoveResult> {
        let seed = new_seed();
        let (spend, name) = remove_spend(sk, &request, &seed)?;
        let built = measured(&spend)?;
        Ok(remove_result(&request, &spend, &name, &built, &seed))
    }

    fn remove_result(
        request: &RemoveRequest,
        spend: &ScriptSpend,
        name: &[u8],
        built: &build::FinalSpend,
        seed: &[u8; 32],
    ) -> RemoveResult {
        RemoveResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            name: hex::encode(name),
            to: request.to.as_ref().map(|t| t.trim().to_string()),
            lovelace: built.change_lovelace.to_string(),
            fee: fee_out(&built.fee),
            inputs: out_refs(spend),
        }
    }

    /// How many keys of each payment chain (receive, change) `is_own_address`
    /// always matches, whatever the last reading found: the gap limit's.
    pub const OWN_KEYS_ALWAYS: u32 = 20;

    /// Whether `address` is this account's own: under one of its payment
    /// keys, whatever its staking part (an enterprise address, say), as the
    /// wallet counts and spends the account; or carrying its staking key, as
    /// every address a normal wallet shows for it does. The payment keys are
    /// the first [`OWN_KEYS_ALWAYS`] of each chain, and `known` (hex key
    /// hashes, as the last balance reading found them). Paying it from Seedelf
    /// links the money back to the account (privacy review §2.17).
    pub fn is_own_address(
        account: &CardanoAccount,
        address: &str,
        known: &[String],
    ) -> Result<bool> {
        let Ok(Address::Shelley(shelley)) = Address::from_bech32(address.trim()) else {
            return Ok(false);
        };
        let stake = account.key_hash(Role::Staking, 0)?;
        if matches!(shelley.delegation(), ShelleyDelegationPart::Key(h) if *h == stake) {
            return Ok(true);
        }
        let ShelleyPaymentPart::Key(payment) = shelley.payment() else {
            return Ok(false);
        };
        let payment_hex = hex::encode(payment);
        if known
            .iter()
            .any(|k| k.trim().eq_ignore_ascii_case(&payment_hex))
        {
            return Ok(true);
        }
        for role in [Role::Receive, Role::Change] {
            for index in 0..OWN_KEYS_ALWAYS {
                if account.key_hash(role, index)? == *payment {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// Signing a finished script spend at Send, as JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SignRequest {
        /// The unsigned transaction a `build*` call returned.
        pub tx_cbor: String,
        /// Its one-time key's seed.
        pub seed: String,
        /// giveme.my's answer: `{ "witness": hex }`.
        pub collateral: serde_json::Value,
    }

    #[derive(Serialize, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct SignResult {
        pub tx_cbor: String,
        pub tx_hash: String,
    }

    /// Signs a finished script spend: checks giveme.my's signature over the
    /// transaction, then adds it and the one-time key's own.
    pub fn sign_script_spend(sk: Scalar, request: SignRequest) -> Result<SignResult> {
        sign_with_collateral_key(sk, request, PublicKey::from(COLLATERAL_PUBLIC_KEY))
    }

    /// [`sign_script_spend`] against any collateral key, so tests can sign
    /// with a stand-in for giveme.my's.
    pub fn sign_with_collateral_key(
        sk: Scalar,
        request: SignRequest,
        collateral_key: PublicKey,
    ) -> Result<SignResult> {
        let bytes =
            hex::decode(&request.tx_cbor).map_err(|e| anyhow!("the transaction isn't hex: {e}"))?;
        let key = one_time_key(&sk, &seed_from_hex(&request.seed)?);
        let hash = build::tx_id(&bytes)?;
        if !build::required_signers(&bytes)?.contains(&key_hash(&key)) {
            bail!("This transaction wasn't built with that one-time key");
        }
        let collateral = build::collateral_signature(&request.collateral)?;
        if !collateral_key.verify(hash, &Signature::from(collateral)) {
            bail!(
                "The collateral service's signature doesn't match this transaction, so it wasn't sent"
            );
        }
        let signed = build::add_witnesses(
            &bytes,
            &[
                (key.public_key(), key.sign(hash)),
                (collateral_key, Signature::from(collateral)),
            ],
        )?;
        Ok(SignResult {
            tx_cbor: hex::encode(signed),
            tx_hash: hex::encode(hash),
        })
    }

    /// Re-randomizes a register with a fresh random `d` applied to both points.
    pub fn rerandomize(register: &Register) -> Result<Register> {
        register.clone().rerandomize()
    }

    /// Checks a Schnorr proof the same way the wallet validator does.
    pub fn verify_proof(
        register: &Register,
        z_hex: &str,
        g_r_hex: &str,
        vkh_hex: &str,
    ) -> Result<bool> {
        schnorr::prove(
            &register.generator,
            &register.public_value,
            z_hex,
            g_r_hex,
            vkh_hex,
        )
    }

    /// [`built_or_without_strangers`] with a stand-in for the build: a
    /// return's plan is an estimate, and what happens when the build
    /// disagrees (independent review H2). `ReturnPlan` is the crate's own,
    /// so its tests are here.
    #[cfg(test)]
    mod return_plan_tests {
        use super::*;

        fn row(tx: u8) -> UtxoResponse {
            UtxoResponse {
                tx_hash: format!("{tx:02x}").repeat(32),
                value: "2000000".to_string(),
                ..Default::default()
            }
        }

        /// A plan taking `core` (the session's own, ADA-only), then `strangers`.
        fn plan(core: &[u8], strangers: &[u8]) -> ReturnPlan {
            ReturnPlan {
                taken: core.iter().chain(strangers).map(|&tx| row(tx)).collect(),
                left_out: vec![],
                merged: false,
                strangers: strangers.len(),
            }
        }

        fn taken(plan: &ReturnPlan) -> Vec<&str> {
            plan.taken.iter().map(|u| &u.tx_hash[..2]).collect()
        }

        fn left(plan: &ReturnPlan) -> Vec<(&str, &str)> {
            plan.left_out
                .iter()
                .map(|l| (&l.tx_hash[..2], l.reason.as_str()))
                .collect()
        }

        #[test]
        fn strangers_alone_go_one_at_a_time_never_all_of_them() {
            // One transaction holds only one of them after all.
            let (built, fewer) = built_or_without_strangers(plan(&[], &[1, 2, 3]), |p| {
                if p.taken.len() > 1 {
                    bail!("the transaction is over the network's limit")
                }
                Ok(p.taken.len())
            })
            .unwrap();
            assert_eq!(built, 1);
            assert_eq!(taken(&fewer), ["01"]);
            assert_eq!(fewer.strangers, 1);
            assert_eq!(left(&fewer), [("03", "size"), ("02", "size")]);
        }

        #[test]
        fn strangers_alone_none_of_which_builds_are_nothing_that_pays() {
            for strangers in [&[1][..], &[1, 2]] {
                let mut tries = 0;
                let e = built_or_without_strangers(plan(&[], strangers), |_| -> Result<()> {
                    tries += 1;
                    bail!("Not Enough Lovelace/Tokens")
                })
                .err()
                .unwrap();
                assert_eq!(e.to_string(), NOTHING_PAYS);
                assert_eq!(tries, strangers.len());
            }
        }

        #[test]
        fn with_the_sessions_own_every_stranger_goes_at_once() {
            let mut tried = vec![];
            let (_, own) = built_or_without_strangers(plan(&[1], &[2, 3]), |p| {
                tried.push(p.taken.len());
                if p.strangers > 0 {
                    bail!("Not Enough Lovelace/Tokens")
                }
                Ok(())
            })
            .unwrap();
            assert_eq!(tried, [3, 1]);
            assert_eq!(taken(&own), ["01"]);
            assert_eq!(left(&own), [("02", "cost"), ("03", "cost")]);
            // The session's own failing says why, as it did.
            let e = built_or_without_strangers(plan(&[1], &[2]), |_| -> Result<()> {
                bail!("the session's own failed")
            })
            .err()
            .unwrap();
            assert_eq!(e.to_string(), "the session's own failed");
        }
    }

    /// `readDexOrder` and the dry run of a swap's cancels (chunk 24, Step 3;
    /// the 1.3.0 review), on the real orders seedelf-core's tests cancel.
    #[cfg(test)]
    mod dex_order_tests {
        use super::*;
        use serde_json::{Value, json};

        fn fixtures() -> Vec<Value> {
            serde_json::from_str(include_str!(
                "../../../seedelf-core/tests/fixtures/order_cancels.json"
            ))
            .unwrap()
        }

        fn fixture(protocol: &str, network: &str) -> Value {
            fixtures()
                .into_iter()
                .find(|f| {
                    f["protocol"] == protocol && f["network"] == network && f["stuck"] != true
                })
                .unwrap()
        }

        /// The order's owner as a session's address: a base address of the
        /// keys its datum pays.
        fn session_of(f: &Value) -> String {
            let protocol: seedelf_core::orders::Protocol =
                serde_json::from_value(f["protocol"].clone()).unwrap();
            let datum = hex::decode(f["datum"].as_str().unwrap()).unwrap();
            let read = seedelf_core::orders::read(protocol, &datum).unwrap();
            let (
                seedelf_core::orders::Credential::Key(payment),
                Some(seedelf_core::orders::Credential::Key(stake)),
            ) = (read.pays[0].payment, read.pays[0].stake)
            else {
                panic!("not a base address of keys");
            };
            let network = if f["network"] == "preprod" {
                AddressNetwork::Testnet
            } else {
                AddressNetwork::Mainnet
            };
            Address::Shelley(pallas_addresses::ShelleyAddress::new(
                network,
                ShelleyPaymentPart::key_hash(payment),
                ShelleyDelegationPart::key_hash(stake),
            ))
            .to_bech32()
            .unwrap()
        }

        /// `readDexOrder` on the fixture's order output, its request with
        /// `extra`'s fields too.
        fn read(f: &Value, datum: &str, extra: Value) -> DexOrderResult {
            let address = Address::from_bech32(f["order"]["address"].as_str().unwrap())
                .unwrap()
                .to_vec();
            let mut request = json!({
                "network": f["network"],
                "address": hex::encode(address),
                "datum": datum,
                "session": session_of(f),
            });
            for (k, v) in extra.as_object().unwrap() {
                request[k] = v.clone();
            }
            read_dex_order(serde_json::from_value(request).unwrap()).unwrap()
        }

        #[test]
        fn an_order_output_no_script_can_spend_is_never_the_sessions() {
            for f in fixtures() {
                let name = format!("{} on {}", f["protocol"], f["network"]);
                let datum = f["datum"].as_str().unwrap();
                // Asked as before, without the output's form: every real order is the session's.
                let plain = read(&f, datum, json!({}));
                assert!(plain.known && plain.ours, "{name}: {plain:?}");
                // With its real form, the same.
                let inline = f["datumInline"] == true;
                let real = read(&f, datum, json!({ "inline": inline, "scriptRef": false }));
                assert!(real.ours && real.why.is_none(), "{name}: {real:?}");
                // Carrying a script, no order is one the wallet can cancel.
                let scripted = read(&f, datum, json!({ "inline": inline, "scriptRef": true }));
                assert!(scripted.known && !scripted.ours, "{name}: {scripted:?}");
                assert!(scripted.why.is_some(), "{name}");
            }
            // A Plutus V1 order holding its datum inline: its script can never spend it.
            for protocol in ["Minswap", "SundaeSwap", "WingRiders"] {
                let f = fixture(protocol, "mainnet");
                let held = read(&f, f["datum"].as_str().unwrap(), json!({ "inline": true }));
                assert!(held.known && !held.ours, "{protocol}: {held:?}");
                assert!(
                    held.why.as_deref().unwrap_or_default().contains("inline"),
                    "{protocol}: {held:?}"
                );
            }
        }

        /// Minswap's aggregator's real preprod swap
        /// (`tests/fixtures/minswap-swap-preprod.json`): a Minswap V1 order
        /// at output 0, kept by hash with its datum in the witnesses, made
        /// out to the account that asked, and its change at output 1.
        #[test]
        fn a_real_swaps_order_is_cancelled_in_a_dry_run_before_it_is_signed() {
            let fixture: Value =
                serde_json::from_str(include_str!("../tests/fixtures/minswap-swap-preprod.json"))
                    .unwrap();
            let params: Value = serde_json::from_str::<Value>(include_str!(
                "../../../seedelf-core/tests/fixtures/epoch_params.json"
            ))
            .unwrap()[0]
                .clone();
            let tx_cbor = fixture["cbor"].as_str().unwrap();
            let swap = seedelf_core::build::tx_id(&hex::decode(tx_cbor).unwrap()).unwrap();
            let request = json!({
                "network": "preprod",
                "params": params,
                "session": fixture["sender"],
                "txCbor": tx_cbor,
                "orders": [0, 1, 9],
                "references": [],
            });
            let result =
                check_order_cancels(serde_json::from_value(request.clone()).unwrap()).unwrap();
            let answer = serde_json::to_value(&result).unwrap();
            let orders = answer["orders"].as_array().unwrap();
            assert_eq!(orders.len(), 3);
            for o in orders {
                let keys: Vec<&String> = o.as_object().unwrap().keys().collect();
                assert_eq!(
                    keys,
                    ["cancels", "fee", "index", "order", "protocol", "why"],
                    "{o}"
                );
            }
            // The order: its cancel builds through Minswap V1's bundled script.
            assert_eq!(orders[0]["order"], format!("{swap}#0"));
            assert_eq!(orders[0]["index"], 0);
            assert_eq!(orders[0]["protocol"], "Minswap");
            assert_eq!(orders[0]["cancels"], true, "{}", orders[0]);
            assert!(orders[0]["why"].is_null());
            let fee: u64 = orders[0]["fee"].as_str().unwrap().parse().unwrap();
            assert!(fee > 150_000 && fee < 3_000_000, "{fee}");
            // The change, at the account's key: no order to cancel.
            assert_eq!(orders[1]["cancels"], false);
            assert!(orders[1]["fee"].is_null());
            assert!(
                orders[1]["why"]
                    .as_str()
                    .unwrap()
                    .contains("doesn't sit at a script"),
                "{}",
                orders[1]
            );
            // An output the swap doesn't have.
            assert_eq!(orders[2]["cancels"], false);
            assert!(orders[2]["why"].as_str().unwrap().contains("no output 9"));
            // For anyone but the order's owner, it isn't a cancel the session can build.
            let mut theirs = request.clone();
            theirs["session"] = json!(nobodys_address());
            theirs["orders"] = json!([0]);
            let answer = check_order_cancels(serde_json::from_value(theirs).unwrap()).unwrap();
            let why = answer.orders[0].why.clone().unwrap_or_default();
            assert!(!answer.orders[0].cancels);
            assert!(why.contains("isn't this session's to cancel"), "{why}");
            // A swap that isn't hex, or a session that isn't one, throws.
            let mut bad = request.clone();
            bad["txCbor"] = json!("zz");
            assert!(check_order_cancels(serde_json::from_value(bad).unwrap()).is_err());
            let mut bad = request;
            bad["session"] = json!("addr_test1wrong");
            assert!(check_order_cancels(serde_json::from_value(bad).unwrap()).is_err());
        }

        /// A base address of keys on preprod that's nobody's: no order is its.
        fn nobodys_address() -> String {
            Address::Shelley(pallas_addresses::ShelleyAddress::new(
                AddressNetwork::Testnet,
                ShelleyPaymentPart::key_hash(Hash::new([0xee; 28])),
                ShelleyDelegationPart::key_hash(Hash::new([0xdd; 28])),
            ))
            .to_bech32()
            .unwrap()
        }

        #[test]
        fn a_datum_nested_too_deep_is_never_the_sessions() {
            let f = fixture("Splash", "mainnet");
            let deep = format!("{}00", "81".repeat(100_000));
            let read_deep = read(&f, &deep, json!({ "inline": true }));
            assert!(read_deep.known && !read_deep.ours, "{read_deep:?}");
            assert!(read_deep.why.is_some());
            // And the reader is whole after it.
            let real = read(&f, f["datum"].as_str().unwrap(), json!({ "inline": true }));
            assert!(real.ours, "{real:?}");
        }
    }
}

fn js_error(e: anyhow::Error) -> JsError {
    JsError::new(&format!("{e:#}"))
}

/// A register: the datum of every UTxO in the wallet contract. Both points
/// are compressed BLS12-381 G1 points, hex-encoded.
#[wasm_bindgen(js_name = Register, getter_with_clone)]
#[derive(Clone)]
pub struct WasmRegister {
    pub generator: String,
    #[wasm_bindgen(js_name = publicValue)]
    pub public_value: String,
}

#[wasm_bindgen(js_class = Register)]
impl WasmRegister {
    /// Wraps two hex-encoded points, e.g. read from an inline datum. Nothing
    /// is checked here; see [`is_valid_register`].
    #[wasm_bindgen(constructor)]
    pub fn new(generator: String, public_value: String) -> WasmRegister {
        WasmRegister {
            generator,
            public_value,
        }
    }
}

impl From<register::Register> for WasmRegister {
    fn from(r: register::Register) -> Self {
        WasmRegister {
            generator: r.generator,
            public_value: r.public_value,
        }
    }
}

impl From<&WasmRegister> for register::Register {
    fn from(r: &WasmRegister) -> Self {
        register::Register::new(r.generator.clone(), r.public_value.clone())
    }
}

/// A Schnorr proof for one wallet-contract input: `z` is the response scalar
/// (32 bytes, big-endian hex) and `gR` is the blinded generator `g^r`.
#[wasm_bindgen(js_name = Proof, getter_with_clone)]
pub struct WasmProof {
    pub z: String,
    #[wasm_bindgen(js_name = gR)]
    pub g_r: String,
}

/// The wallet's Seedelf secret key `x`. It stays inside WebAssembly memory;
/// call `free()` from JavaScript to drop it (the scalar is overwritten on drop).
#[wasm_bindgen]
pub struct SeedelfKey {
    sk: Scalar,
}

#[wasm_bindgen]
impl SeedelfKey {
    /// A fresh random key. For development and tests only: wallets use
    /// `fromPhrase`.
    pub fn random() -> SeedelfKey {
        SeedelfKey {
            sk: schnorr::random_scalar(),
        }
    }

    /// The wallet's key: v1 derivation from a 12-, 15- or 24-word recovery
    /// phrase (see `seedelf_crypto::derivation`). Case and extra whitespace
    /// are ignored; invalid phrases throw with a reason. WebAssembly's copy
    /// of the phrase is wiped.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: String, account: u32) -> Result<SeedelfKey, JsError> {
        let phrase = Zeroizing::new(phrase);
        derivation::seedelf_key_v1(&phrase, account)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// The wallet's key from the recovery phrase's BIP39 entropy, as the
    /// vault stores it: the same key `fromPhrase` gives for that phrase. The
    /// phrase is never written out, and WebAssembly's copy of the entropy is
    /// wiped.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: Vec<u8>, account: u32) -> Result<SeedelfKey, JsError> {
        let entropy = Zeroizing::new(entropy);
        derivation::seedelf_key_v1_from_entropy(&entropy, account)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// Imports a key from 32 big-endian bytes in hex. For development and
    /// tests only.
    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(sk_hex: &str) -> Result<SeedelfKey, JsError> {
        api::scalar_from_hex(sk_hex)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// The base register `(G1, G1^x)`. Senders re-randomize a copy of it;
    /// it is never written to chain as-is.
    #[wasm_bindgen(js_name = baseRegister)]
    pub fn base_register(&self) -> Result<WasmRegister, JsError> {
        register::Register::create(self.sk)
            .map(WasmRegister::from)
            .map_err(js_error)
    }

    /// Whether this key can spend a UTxO holding `register`.
    #[wasm_bindgen(js_name = isOwned)]
    pub fn is_owned(&self, register: &WasmRegister) -> Result<bool, JsError> {
        register::Register::from(register)
            .is_owned(self.sk)
            .map_err(js_error)
    }

    /// Proves ownership of `register`, binding the proof to `vkh`: the
    /// blake2b-224 hash (28 bytes, hex) of the transaction's one-time signing key.
    #[wasm_bindgen(js_name = createProof)]
    pub fn create_proof(&self, register: &WasmRegister, vkh: &str) -> Result<WasmProof, JsError> {
        schnorr::create_proof(register.into(), self.sk, vkh.to_string())
            .map(|(z, g_r)| WasmProof { z, g_r })
            .map_err(js_error)
    }
}

impl Drop for SeedelfKey {
    fn drop(&mut self) {
        // Overwrite the scalar before the memory is released. A volatile
        // write, as `zeroize` makes, so the compiler can't drop it as a
        // store nobody reads.
        // SAFETY: `self.sk` is a valid, aligned `Scalar` we own.
        unsafe { std::ptr::write_volatile(&mut self.sk, Scalar::ZERO) };
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    }
}

/// Which Cardano network an address is for.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum Network {
    Preprod = 0,
    Mainnet = 1,
}

impl Network {
    /// The CLI's convention: `true` means preprod.
    fn flag(self) -> bool {
        matches!(self, Network::Preprod)
    }
}

/// The wallet's Cardano account: standard CIP-1852 keys from the recovery
/// phrase, so the same phrase shows the same account in Lace, Eternl or
/// Yoroi. The private keys stay inside WebAssembly memory; call `free()` to
/// drop them.
#[wasm_bindgen(js_name = CardanoAccount)]
pub struct WasmCardanoAccount {
    inner: cardano::CardanoAccount,
}

#[wasm_bindgen(js_class = CardanoAccount)]
impl WasmCardanoAccount {
    /// Account `account` (`m/1852'/1815'/account'`) of a 12-, 15- or 24-word
    /// phrase. The web wallet's public accounts are any index but `24301'`,
    /// the one-time accounts' (`OneTimeAccounts`). WebAssembly's copy of the
    /// phrase is wiped.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: String, account: u32) -> Result<WasmCardanoAccount, JsError> {
        let phrase = Zeroizing::new(phrase);
        cardano::CardanoAccount::from_phrase(&phrase, account)
            .map(|inner| WasmCardanoAccount { inner })
            .map_err(js_error)
    }

    /// Account `account` from the recovery phrase's BIP39 entropy, as the
    /// vault stores it. The phrase is never written out, and WebAssembly's
    /// copy of the entropy is wiped.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: Vec<u8>, account: u32) -> Result<WasmCardanoAccount, JsError> {
        let entropy = Zeroizing::new(entropy);
        cardano::CardanoAccount::from_entropy(&entropy, account)
            .map(|inner| WasmCardanoAccount { inner })
            .map_err(js_error)
    }

    /// The account public key (public key || chain code), hex. Enough to
    /// derive every address without the private key.
    #[wasm_bindgen(js_name = accountPublicKey)]
    pub fn account_public_key(&self) -> String {
        hex::encode(self.inner.account_public_key().as_bytes())
    }

    /// The receive address `0/index`, delegated to the account's staking key.
    #[wasm_bindgen(js_name = receiveAddress)]
    pub fn receive_address(&self, network: Network, index: u32) -> Result<String, JsError> {
        self.address(network, cardano::Role::Receive, index)
    }

    /// The change address `1/index`, delegated to the account's staking key.
    #[wasm_bindgen(js_name = changeAddress)]
    pub fn change_address(&self, network: Network, index: u32) -> Result<String, JsError> {
        self.address(network, cardano::Role::Change, index)
    }

    /// Whether `address` is this account's own: under one of its payment
    /// keys, whatever its staking part (the first 20 of each chain, and
    /// `keys`, hex, as the last balance reading found them), or carrying its
    /// staking key, as every address a normal wallet shows for it does.
    /// Unreadable addresses aren't.
    #[wasm_bindgen(js_name = isOwnAddress)]
    pub fn is_own_address(
        &self,
        address: &str,
        keys: Option<Vec<String>>,
    ) -> Result<bool, JsError> {
        api::is_own_address(&self.inner, address, &keys.unwrap_or_default()).map_err(js_error)
    }

    /// The payment key hash at `role/index` (0 receive, 1 change), hex: the
    /// payment credential of every address made from that key, whatever its
    /// staking part. Koios is asked for the UTxOs under these.
    #[wasm_bindgen(js_name = paymentKeyHash)]
    pub fn payment_key_hash(&self, role: u32, index: u32) -> Result<String, JsError> {
        let role = match role {
            0 => cardano::Role::Receive,
            1 => cardano::Role::Change,
            _ => {
                return Err(JsError::new(
                    "a payment key is on the receive (0) or change (1) chain",
                ));
            }
        };
        self.inner
            .key_hash(role, index)
            .map(hex::encode)
            .map_err(js_error)
    }

    /// The account's own DRep (CIP-105's key `3/0`), as JSON
    /// (`api::DrepOf`): its CIP-129 ID, key hash and public key. Never the
    /// private key, which stays in this module.
    #[wasm_bindgen(js_name = drepOf)]
    pub fn drep_of(&self) -> Result<String, JsError> {
        let drep = api::drep_of(&self.inner).map_err(js_error)?;
        serde_json::to_string(&drep).map_err(|e| JsError::new(&e.to_string()))
    }

    /// The account's stake key `2/0`, its Ed25519 public key in hex: what
    /// CIP-95's `getRegisteredPubStakeKeys` and `getUnregisteredPubStakeKeys`
    /// give. Never the private key.
    #[wasm_bindgen(js_name = stakePublicKey)]
    pub fn stake_public_key(&self) -> Result<String, JsError> {
        let key = self
            .inner
            .private_key(cardano::Role::Staking, 0)
            .map_err(js_error)?
            .to_public();
        Ok(hex::encode(key.to_ed25519_pubkey().as_ref()))
    }

    /// The account's reward (stake) address.
    #[wasm_bindgen(js_name = stakeAddress)]
    pub fn stake_address(&self, network: Network) -> Result<String, JsError> {
        self.inner
            .stake_address(network.flag())
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }

    fn address(
        &self,
        network: Network,
        role: cardano::Role,
        index: u32,
    ) -> Result<String, JsError> {
        self.inner
            .base_address(network.flag(), role, index)
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }
}

/// The one-time accounts of private sessions: CIP-1852 account `24301'`
/// (`cardano::ONE_TIME_ACCOUNT`), payment key `0/i` and stake key `2/i` for
/// session `i`, both its own. A separate type from the
/// public account's, so nothing that pays or shows the public account can be
/// handed these keys. They never leave WebAssembly; call `free()` to drop them.
#[wasm_bindgen(js_name = OneTimeAccounts)]
pub struct WasmOneTimeAccounts {
    inner: cardano::CardanoAccount,
}

#[wasm_bindgen(js_class = OneTimeAccounts)]
impl WasmOneTimeAccounts {
    /// From a 12-, 15- or 24-word phrase. WebAssembly's copy of the phrase is
    /// wiped.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: String) -> Result<WasmOneTimeAccounts, JsError> {
        let phrase = Zeroizing::new(phrase);
        cardano::CardanoAccount::from_phrase(&phrase, cardano::ONE_TIME_ACCOUNT)
            .map(|inner| WasmOneTimeAccounts { inner })
            .map_err(js_error)
    }

    /// From the recovery phrase's BIP39 entropy, as the vault stores it. The
    /// phrase is never written out, and WebAssembly's copy of the entropy is
    /// wiped.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: Vec<u8>) -> Result<WasmOneTimeAccounts, JsError> {
        let entropy = Zeroizing::new(entropy);
        cardano::CardanoAccount::from_entropy(&entropy, cardano::ONE_TIME_ACCOUNT)
            .map(|inner| WasmOneTimeAccounts { inner })
            .map_err(js_error)
    }

    /// Session `index`'s address (bech32): its own payment and stake keys.
    pub fn address(&self, network: Network, index: u32) -> Result<String, JsError> {
        api::one_time_address(&self.inner, network.flag(), index)
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }

    /// Session `index`'s reward address (bech32): its own stake key `2/index`.
    #[wasm_bindgen(js_name = rewardAddress)]
    pub fn reward_address(&self, network: Network, index: u32) -> Result<String, JsError> {
        api::one_time_reward_address(&self.inner, network.flag(), index)
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }

    /// Session `index`'s address with the shared Seedelf staking part, as
    /// sessions started before chunk 15b's fix have it (bech32).
    #[wasm_bindgen(js_name = sharedStakeAddress)]
    pub fn shared_stake_address(&self, network: Network, index: u32) -> Result<String, JsError> {
        api::shared_stake_address(&self.inner, network.flag(), index)
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }

    /// Session `index`'s payment key hash, hex: Koios is asked for the UTxOs
    /// under it.
    #[wasm_bindgen(js_name = keyHash)]
    pub fn key_hash(&self, index: u32) -> Result<String, JsError> {
        self.inner
            .key_hash(cardano::Role::Receive, index)
            .map(hex::encode)
            .map_err(js_error)
    }
}

/// Builds and signs a session's return: everything at its one-time account
/// into the Seedelf balance. `request` is JSON (`api::SessionReturnRequest`);
/// the result is JSON (`api::SessionReturnResult`).
#[wasm_bindgen(js_name = buildSessionReturn)]
pub fn build_session_return(
    accounts: &WasmOneTimeAccounts,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let request: api::SessionReturnRequest = from_json(request)?;
    to_json(&api::session_return(&accounts.inner, key.sk, request).map_err(js_error)?)
}

/// Reads an output for a session's order check: whether it's a DEX order
/// the wallet can cancel, and the session's own (`api::DexOrderRequest` →
/// `api::DexOrderResult`).
#[wasm_bindgen(js_name = readDexOrder)]
pub fn read_dex_order(request: &str) -> Result<String, JsError> {
    to_json(&api::read_dex_order(from_json(request)?).map_err(js_error)?)
}

/// Builds a cancel of a session's DEX orders, unsigned
/// (`api::OrderCancelRequest` → `api::OrderCancelResult`): Stop's, without
/// asking Minswap.
#[wasm_bindgen(js_name = buildOrderCancel)]
pub fn build_order_cancel(request: &str) -> Result<String, JsError> {
    to_json(&api::build_order_cancel(from_json(request)?).map_err(js_error)?)
}

/// Before a session signs a swap, the dry run of Stop's cancel of each order
/// it places: built in the wallet and run through the order's real script
/// (`api::OrderCancelsRequest` → `api::OrderCancelsResult`).
#[wasm_bindgen(js_name = checkOrderCancels)]
pub fn check_order_cancels(request: &str) -> Result<String, JsError> {
    to_json(&api::check_order_cancels(from_json(request)?).map_err(js_error)?)
}

/// How many Lovejoin boxes a session's spare ADA pays for at `depth`, before
/// anything is built (`lovejoin::PlanRequest` → `lovejoin::PlanResult`), in
/// the classic pool or the token pool `poolRef` names; or, a return's across
/// the pools `legs` names, each leg's (`lovejoin::Across`, chunk 34's 34e).
#[wasm_bindgen(js_name = planLovejoin)]
pub fn plan_lovejoin(accounts: &WasmOneTimeAccounts, request: &str) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    let own: lovejoin::PlanOwn = from_json(request)?;
    let across: lovejoin::Across = from_json(request)?;
    let wide: lovejoin::Wide = from_json(request)?;
    let width = wide.width().map_err(js_error)?;
    if !across.legs.is_empty() {
        return to_json(
            &lovejoin::plan_across_pools(
                &accounts.inner,
                from_json(request)?,
                &own.own,
                &across,
                width,
            )
            .map_err(js_error)?,
        );
    }
    to_json(
        &lovejoin::plan_at(
            &accounts.inner,
            from_json(request)?,
            named.pool_ref.as_ref(),
            &own.own,
            width,
        )
        .map_err(js_error)?,
    )
}

/// A session's whole chain through Lovejoin, built, measured against the
/// scripts and signed with its key: the deposit, the mixes, then the return
/// (`lovejoin::ChainRequest` → `lovejoin::ChainResult`); with `again`, the
/// wallet's boxes in the pool mixed again, with no deposit. The worker sends
/// them in order. A pool with too few boxes builds nothing and says why in
/// `skipped`. In the classic pool or the token pool `poolRef` names; or a
/// return's across the pools `legs` names (`lovejoin::Across`, chunk 34's
/// 34e), one deposit into each and the mixes in each.
#[wasm_bindgen(js_name = buildLovejoinChain)]
pub fn build_lovejoin_chain(
    accounts: &WasmOneTimeAccounts,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    let across: lovejoin::Across = from_json(request)?;
    let wide: lovejoin::Wide = from_json(request)?;
    let width = wide.width().map_err(js_error)?;
    if !across.legs.is_empty() {
        return to_json(
            &lovejoin::chain_across_pools(
                &accounts.inner,
                key.sk,
                from_json(request)?,
                &across,
                width,
            )
            .map_err(js_error)?,
        );
    }
    to_json(
        &lovejoin::chain_at(
            &accounts.inner,
            key.sk,
            from_json(request)?,
            named.pool_ref.as_ref(),
            width,
        )
        .map_err(js_error)?,
    )
}

/// What mixing a number of boxes takes, before anything is built
/// (`lovejoin::FundingRequest` → `lovejoin::FundingResult`), in the classic
/// pool or the token pool `poolRef` names.
#[wasm_bindgen(js_name = lovejoinFunding)]
pub fn lovejoin_funding(request: &str) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    let wide: lovejoin::Wide = from_json(request)?;
    let width = wide.width().map_err(js_error)?;
    to_json(
        &lovejoin::funding_at(from_json(request)?, named.pool_ref.as_ref(), width)
            .map_err(js_error)?,
    )
}

/// The most boxes a Bootstrap paid from the private balance puts in at once
/// (`lovejoin::BootstrapMostRequest` → a number), in the classic pool or the
/// token pool `poolRef` names.
#[wasm_bindgen(js_name = lovejoinBootstrapMost)]
pub fn lovejoin_bootstrap_most(request: &str) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    to_json(
        &lovejoin::bootstrap_most_in(from_json(request)?, named.pool_ref.as_ref())
            .map_err(js_error)?,
    )
}

/// Boxes from the public account straight into Lovejoin: the deposit and
/// every mix, built, measured and signed with the account's keys
/// (`lovejoin::AccountChainRequest` → `lovejoin::ChainResult`).
#[wasm_bindgen(js_name = buildLovejoinFromAccount)]
pub fn build_lovejoin_from_account(
    account: &WasmCardanoAccount,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    let wide: lovejoin::Wide = from_json(request)?;
    let width = wide.width().map_err(js_error)?;
    to_json(
        &lovejoin::chain_from_account_at(
            &account.inner,
            key.sk,
            from_json(request)?,
            named.pool_ref.as_ref(),
            width,
        )
        .map_err(js_error)?,
    )
}

/// The wallet's boxes in the pool mixed again, paid by the public account:
/// every mix built, measured and signed with the account's keys, no deposit
/// (`lovejoin::AccountChainRequest` → `lovejoin::ChainResult`).
#[wasm_bindgen(js_name = buildLovejoinAgainFromAccount)]
pub fn build_lovejoin_again_from_account(
    account: &WasmCardanoAccount,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    let wide: lovejoin::Wide = from_json(request)?;
    let width = wide.width().map_err(js_error)?;
    to_json(
        &lovejoin::again_from_account_at(
            &account.inner,
            key.sk,
            from_json(request)?,
            named.pool_ref.as_ref(),
            width,
        )
        .map_err(js_error)?,
    )
}

/// A transaction's outputs as Ogmios v6 UTxOs (JSON), for `evaluateTransaction`'s
/// `additionalUtxo`: the network can then measure a child of it before it's on chain.
#[wasm_bindgen(js_name = ogmiosUtxos)]
pub fn ogmios_utxos(tx_cbor: &str) -> Result<String, JsError> {
    let bytes = hex::decode(tx_cbor)
        .map_err(|e| JsError::new(&format!("the transaction isn't hex: {e}")))?;
    to_json(&seedelf_core::eval::ogmios_utxos(&bytes).map_err(js_error)?)
}

/// Whether the budgets a transaction declares cover what the network
/// measured (`answer`, Ogmios's `evaluateTransaction` answer as JSON): JSON
/// `{ covers, reason }`, the reason when they don't.
#[wasm_bindgen(js_name = declaredCovers)]
pub fn declared_covers(tx_cbor: &str, answer: &str) -> Result<String, JsError> {
    let bytes = hex::decode(tx_cbor)
        .map_err(|e| JsError::new(&format!("the transaction isn't hex: {e}")))?;
    let answer: serde_json::Value = from_json(answer)?;
    let checked = seedelf_core::eval::declared_covers(&bytes, &answer).map_err(js_error)?;
    to_json(&match checked {
        Ok(()) => serde_json::json!({ "covers": true }),
        Err(reason) => serde_json::json!({ "covers": false, "reason": reason }),
    })
}

/// The wallet's boxes among the pool's rows, and how many other boxes a mix
/// may take (`lovejoin::OwnedRequest` → `lovejoin::OwnedResult`), in the
/// classic pool or the token pool `poolRef` names.
#[wasm_bindgen(js_name = lovejoinOwned)]
pub fn lovejoin_owned(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    to_json(
        &lovejoin::owned_in(key.sk, from_json(request)?, named.pool_ref.as_ref())
            .map_err(js_error)?,
    )
}

/// A token pool found on chain, verified from the bundled templates
/// (`lovejoin::VerifyPoolRequest` → `lovejoin::PoolView`), or why it isn't
/// one the wallet reads.
#[wasm_bindgen(js_name = lovejoinVerifyPool)]
pub fn lovejoin_verify_pool(request: &str) -> Result<String, JsError> {
    to_json(&lovejoin::verify_pool(from_json(request)?).map_err(js_error)?)
}

/// A candidate at Lovejoin's holder, its cheap offline checks alone
/// (`lovejoin::CandidateRequest` → `lovejoin::CandidateView`), or why it isn't one.
#[wasm_bindgen(js_name = lovejoinCandidate)]
pub fn lovejoin_candidate(request: &str) -> Result<String, JsError> {
    to_json(&lovejoin::candidate(from_json(request)?).map_err(js_error)?)
}

/// A candidate checked against its launch transaction: its seed among the
/// inputs, its scripts derived and matched (`lovejoin::LaunchCheckRequest`
/// → `lovejoin::LaunchCheck`), or why it isn't a genuine pool.
#[wasm_bindgen(js_name = lovejoinLaunchCheck)]
pub fn lovejoin_launch_check(request: &str) -> Result<String, JsError> {
    to_json(&lovejoin::launch_check(from_json(request)?).map_err(js_error)?)
}

/// Whether a pool can take a new mix under today's parameters
/// (`lovejoin::UsableRequest` → `lovejoin::UsableResult`).
#[wasm_bindgen(js_name = lovejoinUsable)]
pub fn lovejoin_usable(request: &str) -> Result<String, JsError> {
    to_json(&lovejoin::usable(from_json(request)?).map_err(js_error)?)
}

/// Starting a Lovejoin pool from the Seedelf balance, measured and
/// finished in the wallet, its pool checked from its own bytes
/// (`api::LaunchRequest` → `api::LaunchResult`), unsigned for
/// `signScriptSpend`.
#[wasm_bindgen(js_name = buildLovejoinLaunch)]
pub fn build_lovejoin_launch(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    to_json(&api::build_launch(key.sk, from_json(request)?).map_err(js_error)?)
}

/// Starting a Lovejoin pool paid by the public account, measured in the
/// wallet, its pool checked from its own bytes, and signed with the
/// account's keys (`api::AccountLaunchRequest` → `api::AccountLaunchResult`).
#[wasm_bindgen(js_name = buildLovejoinLaunchFromAccount)]
pub fn build_lovejoin_launch_from_account(
    account: &WasmCardanoAccount,
    request: &str,
) -> Result<String, JsError> {
    to_json(&api::build_launch_from_account(&account.inner, from_json(request)?).map_err(js_error)?)
}

/// What a box of a pool the wallet launches may hold under the live
/// parameters: the least, the suggested and the most
/// (`lovejoin::BoxValueRequest` → `lovejoin::BoxValueResult`).
#[wasm_bindgen(js_name = lovejoinBoxValue)]
pub fn lovejoin_box_value(request: &str) -> Result<String, JsError> {
    to_json(&lovejoin::box_value(from_json(request)?).map_err(js_error)?)
}

/// One of the wallet's boxes brought back with the public account paying
/// its fee, signed with the account's keys (`lovejoin::WithdrawPaidRequest`
/// → `lovejoin::WithdrawPaidResult`), from the classic pool or the token
/// pool `poolRef` names.
#[wasm_bindgen(js_name = buildLovejoinWithdrawPaid)]
pub fn build_lovejoin_withdraw_paid(
    account: &WasmCardanoAccount,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    to_json(
        &lovejoin::withdraw_paid_in(
            &account.inner,
            key.sk,
            from_json(request)?,
            named.pool_ref.as_ref(),
        )
        .map_err(js_error)?,
    )
}

/// One of the wallet's boxes brought back with a UTxO of the private balance
/// paying its fee, measured in the wallet, unsigned for giveme.my and
/// `signScriptSpend`, with its one-time key's seed
/// (`lovejoin::WithdrawPrivateRequest` → `lovejoin::WithdrawPrivateResult`),
/// from the classic pool or the token pool `poolRef` names. None of the
/// UTxOs pays: it throws `lovejoin::NO_PRIVATE_PAYS`.
#[wasm_bindgen(js_name = buildLovejoinWithdrawPrivate)]
pub fn build_lovejoin_withdraw_private(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    to_json(
        &lovejoin::withdraw_private_in(key.sk, from_json(request)?, named.pool_ref.as_ref())
            .map_err(js_error)?,
    )
}

/// One of the wallet's boxes into a fresh register, unsigned, for giveme.my
/// (`lovejoin::WithdrawRequest` → `lovejoin::WithdrawResult`), from the
/// classic pool or the token pool `poolRef` names.
#[wasm_bindgen(js_name = buildLovejoinWithdraw)]
pub fn build_lovejoin_withdraw(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let named: lovejoin::PoolNamed = from_json(request)?;
    to_json(
        &lovejoin::withdraw_in(key.sk, from_json(request)?, named.pool_ref.as_ref())
            .map_err(js_error)?,
    )
}

/// A withdraw with giveme.my's checked signature, ready to submit
/// (`lovejoin::FinishRequest` → `lovejoin::FinishResult`).
#[wasm_bindgen(js_name = finishLovejoinWithdraw)]
pub fn finish_lovejoin_withdraw(request: &str) -> Result<String, JsError> {
    to_json(&lovejoin::finish_withdraw(from_json(request)?).map_err(js_error)?)
}

/// What a transaction built for a session (a swap, a cancel) does to its
/// one-time account, as JSON, read the way the connector reads a dApp's
/// (`cip30::inspect_tx`); `keys` is the session's one path, `0/i`.
#[wasm_bindgen(js_name = inspectSessionTx)]
pub fn inspect_session_tx(
    accounts: &WasmOneTimeAccounts,
    request: &str,
) -> Result<String, JsError> {
    let request = cip30::TxRequest {
        // A session has no DRep: governance is the public account's alone.
        governance: false,
        ..from_json(request)?
    };
    to_json(&cip30::inspect_tx(&accounts.inner, &request).map_err(js_error)?)
}

/// Signs a transaction built for a session with its one-time key: JSON
/// `{ witnessSet, summary }`, as `signDappTx`.
#[wasm_bindgen(js_name = signSessionTx)]
pub fn sign_session_tx(accounts: &WasmOneTimeAccounts, request: &str) -> Result<String, JsError> {
    let request = cip30::TxRequest {
        // A session has no DRep: governance is the public account's alone.
        governance: false,
        ..from_json(request)?
    };
    to_json(&cip30::sign_tx(&accounts.inner, &request).map_err(js_error)?)
}

/// Which of a session's keys signs data for an address (a site connected to
/// the session, private CIP-30), as JSON, or `null` when it isn't the
/// session's; `keys` is its one path, `0/i`, and `stakeIndex` is `i`.
#[wasm_bindgen(js_name = sessionDataSigner)]
pub fn session_data_signer(
    accounts: &WasmOneTimeAccounts,
    request: &str,
) -> Result<String, JsError> {
    let request = cip30::DataRequest {
        // A session has no DRep: governance is the public account's alone.
        governance: false,
        ..from_json(request)?
    };
    to_json(&cip30::data_signer(&accounts.inner, &request).map_err(js_error)?)
}

/// Signs data (CIP-8) for a site connected to a session: JSON
/// `{ signature, key }`, as `signDappData`.
#[wasm_bindgen(js_name = signSessionData)]
pub fn sign_session_data(accounts: &WasmOneTimeAccounts, request: &str) -> Result<String, JsError> {
    let request = cip30::DataRequest {
        // A session has no DRep: governance is the public account's alone.
        governance: false,
        ..from_json(request)?
    };
    to_json(&cip30::sign_data(&accounts.inner, &request).map_err(js_error)?)
}

/// A transaction someone else built (a session's swap) with the wallet's
/// signatures (`witnessSet`, as `signSessionTx` gives them) added, ready to
/// submit. The body and the builder's witnesses are kept byte for byte.
#[wasm_bindgen(js_name = attachWitnesses)]
pub fn attach_witnesses(tx_cbor: &str, witness_set: &str) -> Result<String, JsError> {
    cip30::attach_witnesses(tx_cbor, witness_set).map_err(js_error)
}

// The phrase and entropy exports below take their arguments by value and
// build their results in JavaScript, so that WebAssembly's copies are wiped:
// wasm-bindgen frees a borrowed argument or a returned `String` or `Vec`
// as it is.

/// A new 24-word recovery phrase from the browser's secure random source.
#[wasm_bindgen(js_name = generatePhrase)]
pub fn generate_phrase() -> js_sys::JsString {
    js_sys::JsString::from(derivation::generate_phrase().as_str())
}

/// Checks a typed recovery phrase: 12, 15 or 24 BIP39 English words with a
/// valid checksum (case and extra whitespace ignored), the lengths Lace
/// accepts. Throws with a reason suitable for showing to the user.
#[wasm_bindgen(js_name = validatePhrase)]
pub fn validate_phrase(phrase: String) -> Result<(), JsError> {
    let phrase = Zeroizing::new(phrase);
    derivation::parse_phrase(&phrase)
        .map(|_| ())
        .map_err(js_error)
}

/// The BIP39 entropy of a recovery phrase (16, 20 or 32 bytes for 12, 15
/// or 24 words), checked and normalized like `validatePhrase`. The vault
/// stores this rather than the words.
#[wasm_bindgen(js_name = phraseToEntropy)]
pub fn phrase_to_entropy(phrase: String) -> Result<js_sys::Uint8Array, JsError> {
    let phrase = Zeroizing::new(phrase);
    derivation::phrase_to_entropy(&phrase)
        .map(|entropy| js_sys::Uint8Array::from(entropy.as_slice()))
        .map_err(js_error)
}

/// The recovery phrase for 16, 20 or 32 bytes of BIP39 entropy.
#[wasm_bindgen(js_name = entropyToPhrase)]
pub fn entropy_to_phrase(entropy: Vec<u8>) -> Result<js_sys::JsString, JsError> {
    let entropy = Zeroizing::new(entropy);
    derivation::entropy_to_phrase(&entropy)
        .map(|phrase| js_sys::JsString::from(phrase.as_str()))
        .map_err(js_error)
}

/// The 2048-word BIP39 English list, for autocomplete while typing a phrase.
#[wasm_bindgen(js_name = bip39Wordlist)]
pub fn bip39_wordlist() -> Vec<String> {
    derivation::wordlist()
        .iter()
        .map(|w| w.to_string())
        .collect()
}

/// Builds and signs a move-in from the Cardano account into the wallet
/// contract. `request` is JSON (see `api::MoveInRequest`); the result is JSON
/// (`api::MoveInResult`) holding the signed transaction and what it does.
/// The payment keys and the Seedelf key never leave WebAssembly.
#[wasm_bindgen(js_name = buildMoveIn)]
pub fn build_move_in(
    account: &WasmCardanoAccount,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let request: api::MoveInRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad move-in request: {e}")))?;
    let result = api::move_in(&account.inner, key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Builds and signs a payment from the Cardano account to a key address or a
/// seedelf. `request` is JSON (see `api::SendRequest`); the result is JSON
/// (`api::SendResult`) holding the signed transaction and what it does. The
/// payment keys never leave WebAssembly.
#[wasm_bindgen(js_name = buildAccountSend)]
pub fn build_account_send(account: &WasmCardanoAccount, request: &str) -> Result<String, JsError> {
    let request: api::SendRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad send request: {e}")))?;
    let result = api::account_send(&account.inner, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Builds and signs a staking transaction from the Cardano account: delegate
/// to a pool, delegate the vote, withdraw the rewards, or stop staking.
/// `request` is JSON (see `api::StakingRequest`); the result is JSON
/// (`api::StakingResult`). The payment keys and the stake key never leave
/// WebAssembly.
#[wasm_bindgen(js_name = buildStaking)]
pub fn build_staking(account: &WasmCardanoAccount, request: &str) -> Result<String, JsError> {
    let request: api::StakingRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad staking request: {e}")))?;
    let result = api::stake(&account.inner, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// A DRep's profile as CIP-119 metadata: `request` is JSON
/// (`api::ProfileRequest`), the result JSON (`api::ProfileFile`), the file to
/// publish exactly as it is and its blake2b-256 hash. Throws the reason to
/// show the user.
#[wasm_bindgen(js_name = drepProfile)]
pub fn drep_profile(request: &str) -> Result<String, JsError> {
    let request: api::ProfileRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad profile request: {e}")))?;
    let file = api::drep_profile(request).map_err(js_error)?;
    serde_json::to_string(&file).map_err(|e| JsError::new(&e.to_string()))
}

/// A stake pool's ID as `pool1…`, from bech32 or hex. Throws the reason to
/// show the user.
#[wasm_bindgen(js_name = poolId)]
pub fn pool_id(id: &str) -> Result<String, JsError> {
    api::pool_id(id).map_err(js_error)
}

/// A vote delegation as Koios names it: a DRep's ID in CIP-129 form (from
/// CIP-129 or CIP-105), `drep_always_abstain` or `drep_always_no_confidence`.
/// Throws the reason to show the user.
#[wasm_bindgen(js_name = drepId)]
pub fn drep_id(id: &str) -> Result<String, JsError> {
    api::drep_id(id).map_err(js_error)
}

/// The slot `unixMs` (milliseconds since 1970, as `Date.now()` gives) falls
/// in on `network`: what a move-in's, a send's, a staking transaction's or an
/// account-paid mint's `invalidHereafter` is counted in.
#[wasm_bindgen(js_name = slotAt)]
pub fn slot_at(network: Network, unix_ms: f64) -> Result<f64, JsError> {
    api::slot_at(network.flag(), unix_ms)
        .map(|slot| slot as f64)
        .map_err(js_error)
}

/// Creating a seedelf from the Seedelf balance: picks the Seedelf UTxOs that
/// pay, proves them under a new one-time key, measures the scripts in the
/// wallet and finishes the transaction; no draft leaves it. `request` is JSON
/// (`api::MintRequest`); the result is JSON (`api::MintResult`): the unsigned
/// transaction with its real budgets and fee, and the seed `signScriptSpend`
/// re-derives the one-time key from.
#[wasm_bindgen(js_name = buildMint)]
pub fn build_mint(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::MintRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad mint request: {e}")))?;
    let result = api::build_mint(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Paying seedelfs: checks each recipient's seedelf UTxO, picks the Seedelf
/// UTxOs that pay, proves them under a new one-time key, and measures and
/// finishes the transaction in the wallet. `request` is JSON
/// (`api::TransferRequest`); the result is JSON (`api::TransferResult`).
#[wasm_bindgen(js_name = buildTransfer)]
pub fn build_transfer(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::TransferRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad transfer request: {e}")))?;
    let result = api::build_transfer(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Paying seedelfs as [`build_transfer`] does, in as many transactions as the UTxOs it spends need
/// (`api::build_transfer_parts`): one when one does. Returns JSON, `{ parts: [api::TransferResult] }`.
#[wasm_bindgen(js_name = buildTransferParts)]
pub fn build_transfer_parts(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::TransferRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad transfer request: {e}")))?;
    let parts = api::build_transfer_parts(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&serde_json::json!({ "parts": parts }))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Creating a seedelf paid by the Cardano account, step 1 (`build::account_mint`).
/// `request` is JSON (`api::AccountMintRequest`): the account's UTxOs, each
/// with its `role/index`, and the label. Returns JSON (`api::AccountMintDraft`):
/// the draft for Ogmios, and the inputs and collateral it picked.
#[wasm_bindgen(js_name = draftAccountMint)]
pub fn draft_account_mint(
    account: &WasmCardanoAccount,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let request: api::AccountMintRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad mint request: {e}")))?;
    let result = api::draft_account_mint(&account.inner, key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Step 2: the draft's request plus Ogmios's `evaluation`. Returns JSON
/// (`api::AccountMintResult`): the transaction signed with the account's
/// keys, ready to submit, and what it does. The keys never leave WebAssembly.
#[wasm_bindgen(js_name = finishAccountMint)]
pub fn finish_account_mint(
    account: &WasmCardanoAccount,
    key: &SeedelfKey,
    request: &str,
) -> Result<String, JsError> {
    let request: api::AccountMintRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad mint request: {e}")))?;
    let result = api::finish_account_mint(&account.inner, key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// A withdrawal: checks the addresses, picks the Seedelf UTxOs (or up to 20
/// for Max), proves them under a new one-time key, and measures and finishes
/// the transaction in the wallet. `request` is JSON (`api::WithdrawRequest`);
/// the result is JSON (`api::WithdrawResult`).
#[wasm_bindgen(js_name = buildWithdraw)]
pub fn build_withdraw(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::WithdrawRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad withdrawal request: {e}")))?;
    let result = api::build_withdraw(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// A withdrawal as [`build_withdraw`] builds it, in as many transactions as the UTxOs it spends need
/// (`api::build_withdraw_parts`): one when one does. Returns JSON, `{ parts: [api::WithdrawResult] }`.
#[wasm_bindgen(js_name = buildWithdrawParts)]
pub fn build_withdraw_parts(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::WithdrawRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad withdrawal request: {e}")))?;
    let parts = api::build_withdraw_parts(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&serde_json::json!({ "parts": parts }))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Checks a withdrawal's or a send's destination: a normal key address on
/// `network`. Throws the reason to show the user.
#[wasm_bindgen(js_name = checkPayableAddress)]
pub fn check_payable_address(address: &str, network: Network) -> Result<(), JsError> {
    api::payable_address(network.flag(), address)
        .map(|_| ())
        .map_err(js_error)
}

/// Removing a seedelf: checks the UTxO is this wallet's and holds one
/// seedelf, proves it, and measures and finishes the burn in the wallet.
/// `request` is JSON (`api::RemoveRequest`); the result is JSON
/// (`api::RemoveResult`).
#[wasm_bindgen(js_name = buildRemove)]
pub fn build_remove(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::RemoveRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad removal request: {e}")))?;
    let result = api::build_remove(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Signs a finished Seedelf spend at Send (`api::SignRequest` as JSON):
/// checks giveme.my's collateral signature against its public key, then adds
/// it and the one-time key's. Returns JSON (`api::SignResult`).
#[wasm_bindgen(js_name = signScriptSpend)]
pub fn sign_script_spend(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::SignRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad signing request: {e}")))?;
    let result = api::sign_script_spend(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Re-randomizes `register` for a new output: `(g^d, u^d)` with a fresh,
/// discarded `d`. Fails on points outside the prime-order subgroup.
#[wasm_bindgen]
pub fn rerandomize(register: &WasmRegister) -> Result<WasmRegister, JsError> {
    api::rerandomize(&register.into())
        .map(WasmRegister::from)
        .map_err(js_error)
}

/// Whether both points are on the curve and torsion-free. A register that
/// fails this locks funds forever if written to chain.
#[wasm_bindgen(js_name = isValidRegister)]
pub fn is_valid_register(register: &WasmRegister) -> Result<bool, JsError> {
    register::Register::from(register)
        .is_valid()
        .map_err(js_error)
}

/// The register as inline-datum bytes (PlutusData CBOR).
#[wasm_bindgen(js_name = registerToDatum)]
pub fn register_to_datum(register: &WasmRegister) -> Result<Vec<u8>, JsError> {
    register::Register::from(register)
        .to_vec()
        .map_err(js_error)
}

/// Checks a Schnorr proof off-chain, mirroring the wallet validator.
#[wasm_bindgen(js_name = verifyProof)]
pub fn verify_proof(
    register: &WasmRegister,
    z: &str,
    g_r: &str,
    vkh: &str,
) -> Result<bool, JsError> {
    api::verify_proof(&register.into(), z, g_r, vkh).map_err(js_error)
}

// ---------------------------------------------------------------------------
// The dApp connector (CIP-30), for the public account: see [`cip30`].
// ---------------------------------------------------------------------------

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("bad request: {e}")))
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, JsError> {
    serde_json::to_string(value).map_err(|e| JsError::new(&e.to_string()))
}

/// UTxOs (Koios rows, JSON) as CIP-30's `TransactionUnspentOutput`s, hex.
#[wasm_bindgen(js_name = cip30Utxos)]
pub fn cip30_utxos(rows: &str) -> Result<Vec<String>, JsError> {
    let rows: Vec<cip30::KoiosRow> = from_json(rows)?;
    rows.iter()
        .map(|r| cip30::utxo_cbor(r).map(hex::encode).map_err(js_error))
        .collect()
}

/// A balance (lovelace, and tokens as JSON `[{ policyId, assetName, quantity }]`) as CIP-30's `Value`, hex.
#[wasm_bindgen(js_name = cip30Value)]
pub fn cip30_value(lovelace: &str, tokens: &str) -> Result<String, JsError> {
    let tokens: Vec<cip30::Token> = from_json(tokens)?;
    cip30::value_cbor(lovelace, &tokens)
        .map(hex::encode)
        .map_err(js_error)
}

/// A bech32 address as CIP-30 hands it over: its bytes, hex.
#[wasm_bindgen(js_name = cip30Address)]
pub fn cip30_address(bech32: &str) -> Result<String, JsError> {
    cip30::address_hex(bech32).map_err(js_error)
}

/// A CIP-30 `Value` a dApp asks for, as JSON `{ lovelace, tokens }`.
#[wasm_bindgen(js_name = cip30ReadValue)]
pub fn cip30_read_value(value: &str) -> Result<String, JsError> {
    let (lovelace, tokens) = cip30::read_value(value).map_err(js_error)?;
    to_json(&serde_json::json!({ "lovelace": lovelace.to_string(), "tokens": tokens }))
}

/// What a dApp's transaction does to the public account, as JSON, for the
/// signing prompt. Throws the reason for one the wallet won't sign.
#[wasm_bindgen(js_name = inspectDappTx)]
pub fn inspect_dapp_tx(account: &WasmCardanoAccount, request: &str) -> Result<String, JsError> {
    let request: cip30::TxRequest = from_json(request)?;
    to_json(&cip30::inspect_tx(&account.inner, &request).map_err(js_error)?)
}

/// Signs a dApp's transaction with the public account's keys it needs:
/// JSON `{ witnessSet, summary }`, the witness set in hex.
#[wasm_bindgen(js_name = signDappTx)]
pub fn sign_dapp_tx(account: &WasmCardanoAccount, request: &str) -> Result<String, JsError> {
    let request: cip30::TxRequest = from_json(request)?;
    to_json(&cip30::sign_tx(&account.inner, &request).map_err(js_error)?)
}

/// Which of the public account's keys signs data for an address, as JSON,
/// or `null` when the address isn't the account's.
#[wasm_bindgen(js_name = dataSigner)]
pub fn data_signer(account: &WasmCardanoAccount, request: &str) -> Result<String, JsError> {
    let request: cip30::DataRequest = from_json(request)?;
    to_json(&cip30::data_signer(&account.inner, &request).map_err(js_error)?)
}

/// Signs data for a dApp (CIP-8): JSON `{ signature, key }`, both hex.
#[wasm_bindgen(js_name = signDappData)]
pub fn sign_dapp_data(account: &WasmCardanoAccount, request: &str) -> Result<String, JsError> {
    let request: cip30::DataRequest = from_json(request)?;
    to_json(&cip30::sign_data(&account.inner, &request).map_err(js_error)?)
}

// ---------------------------------------------------------------------------
// The transaction itself, decoded: see [`decode`].
// ---------------------------------------------------------------------------

/// Everything in a transaction's bytes, as JSON, for the transaction view:
/// inputs, outputs, datums, scripts, certificates, votes, redeemers and
/// metadata. CBOR in, structure out — it reads no account and asks nothing of
/// the network, so opening it leaks nothing. `network` only names Seedelf
/// Wallet's own contract; every address is read from its own bytes.
#[wasm_bindgen(js_name = decodeTx)]
pub fn decode_tx(network: Network, tx_cbor: &str) -> Result<String, JsError> {
    let name = if network.flag() { "preprod" } else { "mainnet" };
    to_json(&decode::decode_tx(name, tx_cbor).map_err(js_error)?)
}
