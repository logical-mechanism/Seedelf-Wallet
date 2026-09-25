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

pub mod cip30;

/// Plain-Rust implementations behind the exports, testable off-wasm.
pub mod api {
    use std::collections::HashMap;

    use anyhow::{Result, anyhow, bail};
    use blstrs::Scalar;
    use cryptoxide::hkdf::{hkdf_expand, hkdf_extract};
    use cryptoxide::sha2::Sha256;
    use ff::Field;
    use pallas_addresses::{
        Address, Network as AddressNetwork, ShelleyDelegationPart, ShelleyPaymentPart,
    };
    use pallas_crypto::hash::{Hash, Hasher};
    use pallas_crypto::key::ed25519::{PublicKey, SecretKey, Signature};
    use pallas_txbuilder::BuiltTransaction;
    use pallas_wallet::PrivateKey;
    use rand_core::{OsRng, RngCore};
    use seedelf_core::address::wallet_contract;
    use seedelf_core::assets::{Asset, Assets};
    use seedelf_core::build::{
        self, AccountAmount, AccountPay, AddressPayment, Budgets, Chain, Payee, Payment,
        ScriptSpend,
    };
    use seedelf_core::constants::{COLLATERAL_PUBLIC_KEY, VARIANT, get_config};
    use seedelf_core::note::Note;
    use seedelf_core::staking::{self, StakeAction, StakeKey, StakeState, Staking};
    use seedelf_crypto::cardano::{CardanoAccount, Role};
    use seedelf_crypto::derivation;
    use seedelf_crypto::register::Register;
    use seedelf_crypto::schnorr;
    use seedelf_koios::koios::{
        ProtocolParameters, UtxoResponse, contains_policy_id, extract_bytes_with_logging,
    };
    use serde::{Deserialize, Serialize};

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

    /// Rebuilds the recovery phrase from vault entropy, hands it to `f`, then
    /// overwrites it. The phrase never leaves WebAssembly.
    pub fn with_phrase<T>(entropy: &[u8], f: impl FnOnce(&str) -> Result<T>) -> Result<T> {
        let phrase = derivation::entropy_to_phrase(entropy)?;
        let result = f(&phrase);
        let mut bytes = phrase.into_bytes();
        bytes.fill(0);
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
        result
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
    type Paths = HashMap<(String, u64), (Role, u32)>;

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

    fn check_paths(
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
    fn sign_with_paths(
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

    /// Signs with the stake key (`2/0`) when `staking` does anything, inside
    /// this module.
    fn sign_staking(
        tx: BuiltTransaction,
        account: &CardanoAccount,
        staking: &Staking,
    ) -> Result<BuiltTransaction> {
        if staking.is_empty() {
            return Ok(tx);
        }
        let key = account.private_key(Role::Staking, 0)?;
        tx.sign(key.to_ed25519_private_key())
            .map_err(|e| anyhow!("failed to sign with the stake key: {e:?}"))
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
            &params, &available, amount, &picked, &owner, &wallet, &change, &rewards,
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
        /// Locked by registering the key.
        pub deposit: String,
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
        };
        let staking = Staking::of(
            &stake_key(account, network_flag)?,
            &action,
            &state,
            params.key_deposit,
        )?;
        let change = account.base_address(network_flag, Role::Receive, 0)?;
        let available: Vec<UtxoResponse> = request.utxos.into_iter().map(|p| p.utxo).collect();

        let built = build::account_staking(&params, &available, &staking, &change)?;

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
        ikm.fill(0);
        prk.fill(0);
        okm.fill(0);
        key
    }

    fn key_hash(key: &PrivateKey) -> Hash<28> {
        Hasher::<224>::hash(key.public_key().as_ref())
    }

    fn network_flag(network: &str) -> Result<bool> {
        match network {
            "preprod" => Ok(true),
            "mainnet" => Ok(false),
            other => bail!("unknown network {other}"),
        }
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
        /// The one-time key's seed from the draft (hex). The draft draws it.
        pub seed: Option<String>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
    }

    #[derive(Serialize, Debug, PartialEq)]
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
    /// wallet's, and none holds a seedelf (it would go with the change).
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

    /// A new one-time key's seed, for a draft.
    fn new_seed() -> [u8; 32] {
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
        let mut minted = build::mint(
            &chain,
            &request.utxos,
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
        let built = spend.finalize(&budgets)?;
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
            inputs: out_refs(&spend),
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
    #[derive(Deserialize)]
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
        /// payment needs (so "0" sends only that).
        pub lovelace: String,
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
        /// The least the payment could carry.
        pub minimum: String,
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
        pub fee: FeeOut,
        /// Back into the Seedelf balance.
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub change_outputs: usize,
        pub inputs: Vec<OutRef>,
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

    fn transfer_spend(
        sk: Scalar,
        request: &TransferRequest,
        seed: &[u8; 32],
    ) -> Result<(ScriptSpend, Vec<SeedelfPaid>)> {
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        check_recipients(request.payments.len())?;
        let mut payments = Vec::with_capacity(request.payments.len());
        let mut paid = Vec::with_capacity(request.payments.len());
        for p in &request.payments {
            let register = recipient_register(&chain, &p.to, &p.recipient)?;
            let to_self = register.is_owned(sk).unwrap_or(false);
            let tokens = assets_of(&p.tokens)?;
            let minimum = build::minimum_seedelf_payment(&chain.params, &tokens)?;
            let lovelace = lovelace_of(&p.lovelace)?.max(minimum);
            paid.push(SeedelfPaid {
                to: p.to.clone(),
                to_self,
                lovelace: lovelace.to_string(),
                minimum: minimum.to_string(),
                tokens: tokens.items.iter().map(token_amount).collect(),
            });
            payments.push(Payment {
                register,
                lovelace,
                tokens,
            });
        }
        let signer = key_hash(&one_time_key(&sk, seed));
        let spend = build::transfer(
            &chain,
            &request.utxos,
            &payments,
            &Register::create(sk)?,
            signer,
        )?;
        Ok((prove_with(sk, spend)?, paid))
    }

    /// Step 1 of paying a seedelf: checks the recipient, picks the UTxOs,
    /// proves them, and drafts the transaction for Ogmios, under a new
    /// one-time key.
    pub fn draft_transfer(sk: Scalar, request: TransferRequest) -> Result<SpendDraft> {
        let seed = new_seed();
        let (spend, _) = transfer_spend(sk, &request, &seed)?;
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
        let (spend, payments) = transfer_spend(sk, &request, &seed)?;
        let built = spend.finalize(&budgets)?;
        Ok(TransferResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            payments,
            fee: fee_out(&built.fee),
            change_lovelace: built.change_lovelace.to_string(),
            change_tokens: built.change_tokens.items.len(),
            change_outputs: built.change_outputs,
            inputs: out_refs(&spend),
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
    #[derive(Deserialize)]
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
        /// The one-time key's seed from the draft (hex). The draft draws it.
        pub seed: Option<String>,
        /// Ogmios's answer to evaluating the draft.
        pub evaluation: Option<serde_json::Value>,
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
        /// Everything (Max) to a single address, rather than amounts.
        pub max: bool,
        pub fee: FeeOut,
        /// Back into the Seedelf balance (nothing, for Max).
        pub change_lovelace: String,
        pub change_tokens: usize,
        pub change_outputs: usize,
        pub inputs: Vec<OutRef>,
        /// Spendable UTxOs Max left for another withdrawal.
        pub left: usize,
    }

    /// The withdrawal, proven; how many UTxOs Max left out; and, for
    /// amounts, what each address is paid (Max's is known once it's
    /// finished).
    fn withdraw_spend(
        sk: Scalar,
        request: &WithdrawRequest,
        seed: &[u8; 32],
    ) -> Result<(ScriptSpend, usize, Option<Vec<Paid>>)> {
        let chain = chain_of(&request.network, &request.params)?;
        check_spendable(sk, &chain, &request.utxos)?;
        check_recipients(request.payments.len())?;
        let owner = Register::create(sk)?;
        let signer = key_hash(&one_time_key(&sk, seed));
        let (spend, left, paid) = match request.payments.as_slice() {
            [only] if only.lovelace.is_none() => {
                let to = payable_address(chain.network_flag, &only.to)?;
                if !only.tokens.is_empty() {
                    bail!("Max sends every token, so it takes no token amounts");
                }
                if request.utxos.is_empty() {
                    bail!("There's nothing in the Seedelf balance to withdraw");
                }
                // The largest first, as many as fit.
                let mut utxos = request.utxos.clone();
                utxos.sort_by_key(|u| std::cmp::Reverse(u.value.parse::<u64>().unwrap_or(0)));
                let left = utxos.len().saturating_sub(MAX_WITHDRAW_UTXOS);
                utxos.truncate(MAX_WITHDRAW_UTXOS);
                (
                    build::sweep_all(&chain, &utxos, &to, &owner, signer)?,
                    left,
                    None,
                )
            }
            payments => {
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
                let spend = build::sweep_many(&chain, &request.utxos, &to_pay, &owner, signer)?;
                (spend, 0, Some(paid))
            }
        };
        Ok((prove_with(sk, spend)?, left, paid))
    }

    /// Step 1 of a withdrawal: checks the addresses, picks the UTxOs, proves
    /// them, and drafts the transaction for Ogmios, under a new one-time key.
    pub fn draft_withdraw(sk: Scalar, request: WithdrawRequest) -> Result<SpendDraft> {
        let seed = new_seed();
        let (spend, _, _) = withdraw_spend(sk, &request, &seed)?;
        draft_of(&spend, &seed)
    }

    /// Step 2: the same withdrawal, finished with the budgets Ogmios measured.
    pub fn finish_withdraw(sk: Scalar, request: WithdrawRequest) -> Result<WithdrawResult> {
        let (seed, budgets) = finishing(
            "withdrawal",
            request.seed.as_deref(),
            request.evaluation.as_ref(),
        )?;
        let (spend, left, paid) = withdraw_spend(sk, &request, &seed)?;
        let built = spend.finalize(&budgets)?;
        let max = paid.is_none();
        // Max's one payment is everything the inputs held, less the fee.
        let payments = paid.unwrap_or_else(|| {
            vec![Paid {
                to: request.payments[0].to.trim().to_string(),
                lovelace: built.change_lovelace.to_string(),
                minimum: None,
                tokens: built.change_tokens.items.iter().map(token_amount).collect(),
            }]
        });
        Ok(WithdrawResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            payments,
            max,
            fee: fee_out(&built.fee),
            change_lovelace: if max {
                "0".into()
            } else {
                built.change_lovelace.to_string()
            },
            change_tokens: if max {
                0
            } else {
                built.change_tokens.items.len()
            },
            change_outputs: if max { 0 } else { built.change_outputs },
            inputs: out_refs(&spend),
            left,
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
        Ok(RemoveResult {
            tx_cbor: hex::encode(&built.tx.tx_bytes.0),
            tx_hash: hex::encode(built.tx.tx_hash.0),
            seed: hex::encode(seed),
            name: hex::encode(name),
            to: request.to.as_ref().map(|t| t.trim().to_string()),
            lovelace: built.change_lovelace.to_string(),
            fee: fee_out(&built.fee),
            inputs: out_refs(&spend),
        })
    }

    /// Whether `address` carries this account's staking key: every address a
    /// normal wallet shows for the account does. Paying it from Seedelf links
    /// the money back to the account.
    pub fn is_own_address(account: &CardanoAccount, address: &str) -> Result<bool> {
        let stake = account.key_hash(Role::Staking, 0)?;
        Ok(match Address::from_bech32(address.trim()) {
            Ok(Address::Shelley(shelley)) => {
                matches!(shelley.delegation(), ShelleyDelegationPart::Key(h) if *h == stake)
            }
            _ => false,
        })
    }

    /// Signing a finished script spend at Send, as JSON from the extension.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SignRequest {
        /// The unsigned transaction from `finishMint`.
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
    /// are ignored; invalid phrases throw with a reason.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: &str, account: u32) -> Result<SeedelfKey, JsError> {
        derivation::seedelf_key_v1(phrase, account)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// The wallet's key from the recovery phrase's BIP39 entropy, as the
    /// vault stores it: the same key `fromPhrase` gives for that phrase. The
    /// phrase is rebuilt inside WebAssembly and never reaches JavaScript.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: &[u8], account: u32) -> Result<SeedelfKey, JsError> {
        api::with_phrase(entropy, |phrase| {
            derivation::seedelf_key_v1(phrase, account)
        })
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
        // Best effort: overwrite the scalar before the memory is released.
        self.sk = Scalar::ZERO;
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
    /// phrase. v1 of the wallet uses account 0.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: &str, account: u32) -> Result<WasmCardanoAccount, JsError> {
        cardano::CardanoAccount::from_phrase(phrase, account)
            .map(|inner| WasmCardanoAccount { inner })
            .map_err(js_error)
    }

    /// Account `account` from the recovery phrase's BIP39 entropy, as the
    /// vault stores it. The phrase never reaches JavaScript.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: &[u8], account: u32) -> Result<WasmCardanoAccount, JsError> {
        api::with_phrase(entropy, |phrase| {
            cardano::CardanoAccount::from_phrase(phrase, account)
        })
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

    /// Whether `address` carries this account's staking key, as every
    /// address a normal wallet shows for it does. Unreadable addresses aren't.
    #[wasm_bindgen(js_name = isOwnAddress)]
    pub fn is_own_address(&self, address: &str) -> Result<bool, JsError> {
        api::is_own_address(&self.inner, address).map_err(js_error)
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

/// A new 24-word recovery phrase from the browser's secure random source.
#[wasm_bindgen(js_name = generatePhrase)]
pub fn generate_phrase() -> String {
    derivation::generate_phrase()
}

/// Checks a typed recovery phrase: 12, 15 or 24 BIP39 English words with a
/// valid checksum (case and extra whitespace ignored), the lengths Lace
/// accepts. Throws with a reason suitable for showing to the user.
#[wasm_bindgen(js_name = validatePhrase)]
pub fn validate_phrase(phrase: &str) -> Result<(), JsError> {
    derivation::parse_phrase(phrase)
        .map(|_| ())
        .map_err(js_error)
}

/// The BIP39 entropy of a recovery phrase (16, 20 or 32 bytes for 12, 15
/// or 24 words), checked and normalized like `validatePhrase`. The vault
/// stores this rather than the words.
#[wasm_bindgen(js_name = phraseToEntropy)]
pub fn phrase_to_entropy(phrase: &str) -> Result<Vec<u8>, JsError> {
    derivation::phrase_to_entropy(phrase).map_err(js_error)
}

/// The recovery phrase for 16, 20 or 32 bytes of BIP39 entropy.
#[wasm_bindgen(js_name = entropyToPhrase)]
pub fn entropy_to_phrase(entropy: &[u8]) -> Result<String, JsError> {
    derivation::entropy_to_phrase(entropy).map_err(js_error)
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

/// Creating a seedelf, step 1: picks the Seedelf UTxOs that pay, proves them
/// under a new one-time key, and drafts the transaction. `request` is JSON
/// (`api::MintRequest`); the result is JSON (`api::SpendDraft`): the draft for
/// Ogmios to evaluate, and the seed that `finishMint` and `signScriptSpend`
/// re-derive the one-time key from.
#[wasm_bindgen(js_name = draftMint)]
pub fn draft_mint(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::MintRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad mint request: {e}")))?;
    let result = api::draft_mint(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Creating a seedelf, step 2: the draft's request plus its `seed` and
/// Ogmios's `evaluation`. Returns JSON (`api::MintResult`): the unsigned
/// transaction with its real budgets and fee, and what it does.
#[wasm_bindgen(js_name = finishMint)]
pub fn finish_mint(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::MintRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad mint request: {e}")))?;
    let result = api::finish_mint(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Paying a seedelf, step 1: checks the recipient's seedelf UTxO, picks the
/// Seedelf UTxOs that pay, proves them under a new one-time key, and drafts
/// the transaction. `request` is JSON (`api::TransferRequest`); the result is
/// JSON (`api::SpendDraft`): the draft for Ogmios, and the one-time key's seed.
#[wasm_bindgen(js_name = draftTransfer)]
pub fn draft_transfer(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::TransferRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad transfer request: {e}")))?;
    let result = api::draft_transfer(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Paying a seedelf, step 2: the draft's request plus its `seed` and Ogmios's
/// `evaluation`. Returns JSON (`api::TransferResult`): the unsigned
/// transaction with its real budgets and fee, and what it does.
#[wasm_bindgen(js_name = finishTransfer)]
pub fn finish_transfer(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::TransferRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad transfer request: {e}")))?;
    let result = api::finish_transfer(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
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

/// A withdrawal, step 1: checks the address, picks the Seedelf UTxOs (or up
/// to 20 for Max), proves them under a new one-time key, and drafts the
/// transaction. `request` is JSON (`api::WithdrawRequest`); the result is
/// JSON (`api::SpendDraft`).
#[wasm_bindgen(js_name = draftWithdraw)]
pub fn draft_withdraw(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::WithdrawRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad withdrawal request: {e}")))?;
    let result = api::draft_withdraw(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// A withdrawal, step 2: the draft's request plus its `seed` and Ogmios's
/// `evaluation`. Returns JSON (`api::WithdrawResult`).
#[wasm_bindgen(js_name = finishWithdraw)]
pub fn finish_withdraw(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::WithdrawRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad withdrawal request: {e}")))?;
    let result = api::finish_withdraw(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Checks a withdrawal's or a send's destination: a normal key address on
/// `network`. Throws the reason to show the user.
#[wasm_bindgen(js_name = checkPayableAddress)]
pub fn check_payable_address(address: &str, network: Network) -> Result<(), JsError> {
    api::payable_address(network.flag(), address)
        .map(|_| ())
        .map_err(js_error)
}

/// Removing a seedelf, step 1: checks the UTxO is this wallet's and holds
/// one seedelf, proves it, and drafts the burn. `request` is JSON
/// (`api::RemoveRequest`); the result is JSON (`api::SpendDraft`).
#[wasm_bindgen(js_name = draftRemove)]
pub fn draft_remove(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::RemoveRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad removal request: {e}")))?;
    let result = api::draft_remove(key.sk, request).map_err(js_error)?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Removing a seedelf, step 2: the draft's request plus its `seed` and
/// Ogmios's `evaluation`. Returns JSON (`api::RemoveResult`).
#[wasm_bindgen(js_name = finishRemove)]
pub fn finish_remove(key: &SeedelfKey, request: &str) -> Result<String, JsError> {
    let request: api::RemoveRequest = serde_json::from_str(request)
        .map_err(|e| JsError::new(&format!("bad removal request: {e}")))?;
    let result = api::finish_remove(key.sk, request).map_err(js_error)?;
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
