use crate::assets::{Asset, Assets, string_to_u64};
use crate::constants::{Contract, MAXIMUM_TOKENS_PER_UTXO, MAXIMUM_WALLET_UTXOS};
use crate::transaction::wallet_minimum_lovelace_with_assets;
use anyhow::{Context, Ok, Result, anyhow, bail};
use blstrs::Scalar;
use hex;
use pallas_addresses::{Address, ShelleyPaymentPart};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{
    ProtocolParameters, UtxoResponse, address_utxos, contains_policy_id, credential_utxos,
    extract_bytes_with_logging,
};
use std::cmp::Reverse;

pub async fn get_credential_utxos(
    wallet_contract_hash: [u8; 28],
    network_flag: bool,
) -> Result<Vec<UtxoResponse>> {
    let utxos: Vec<UtxoResponse> =
        credential_utxos(hex::encode(wallet_contract_hash).as_str(), network_flag)
            .await
            .context("Failed To Get Credential UTxOs")?;
    Ok(utxos)
}

pub async fn get_address_utxos(address: &str, network_flag: bool) -> Result<Vec<UtxoResponse>> {
    let utxos: Vec<UtxoResponse> = address_utxos(address, network_flag)
        .await
        .context("Failed To Get Address UTxOs")?;
    Ok(utxos)
}

/// Whether `utxo` sits at the wallet contract: its address's payment part is
/// the contract's script, with any stake part or none. Asked for the
/// contract's UTxOs, Koios lists a credential's by its 28 bytes alone, a
/// key's and a script's alike, so the KEY address carrying the contract's
/// hash comes with them: no key can spend from it, and anyone can pay it
/// under one of a user's registers, each public beside a Seedelf. Nothing
/// there is anyone's (chunk 51, x2#2, as the web wallet's balances.ts
/// `atContract` reads it).
pub fn at_wallet_contract(utxo: &UtxoResponse, wallet_contract_hash: [u8; 28]) -> bool {
    let Some(Address::Shelley(address)) = Address::from_bech32(&utxo.address).ok() else {
        return false;
    };
    matches!(
        address.payment(),
        ShelleyPaymentPart::Script(hash) if **hash == wallet_contract_hash
    )
}

/// collects all the wallet utxos owned by some scalar: the contract's
/// ([`at_wallet_contract`]) under one of its registers, holding no Seedelf.
pub fn collect_all_wallet_utxos(
    sk: Scalar,
    contract: &Contract,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let mut all_utxos: Vec<UtxoResponse> = Vec::new();
    for utxo in utxos {
        if !at_wallet_contract(&utxo, contract.wallet_contract_hash) {
            continue;
        }
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scalar. A register whose
            // points don't decompress is nobody's: anyone can pay the
            // contract under one, so it's skipped, never an error that
            // stops the scan.
            if inline_datum.is_owned(sk).unwrap_or(false) {
                // its owned but lets not count the seedelf in the balance
                if !contains_policy_id(&utxo.asset_list, &contract.seedelf_policy_id) {
                    all_utxos.push(utxo.clone());
                }
            }
        }
    }
    Ok(all_utxos)
}

/// The register of the contract's UTxO ([`at_wallet_contract`]) holding the
/// Seedelf named `seedelf`, if one does.
pub fn find_seedelf_datum(
    seedelf: String,
    contract: &Contract,
    utxos: Vec<UtxoResponse>,
) -> Result<Option<Register>> {
    let seedelf_policy_id: &str = &contract.seedelf_policy_id;
    let mut seedelf_datum: Option<Register> = None;

    for utxo in utxos {
        if !at_wallet_contract(&utxo, contract.wallet_contract_hash) {
            continue;
        }
        // Extract bytes
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum)
            && contains_policy_id(&utxo.asset_list, seedelf_policy_id)
        {
            let asset_name = utxo
                .asset_list
                .as_ref()
                .and_then(|vec| {
                    vec.iter()
                        .find(|asset| asset.policy_id == seedelf_policy_id)
                        .map(|asset| &asset.asset_name)
                })
                .context("Can't Produce Asset Name")?;
            if asset_name == &seedelf {
                seedelf_datum = Some(inline_datum.clone());
            }
        }
    }
    Ok(seedelf_datum)
}

/// Find a specific seedelf: the contract's UTxO ([`at_wallet_contract`])
/// holding it.
pub fn find_seedelf_utxo(
    seedelf: String,
    contract: &Contract,
    utxos: Vec<UtxoResponse>,
) -> Result<Option<UtxoResponse>> {
    let seedelf_policy_id: &str = &contract.seedelf_policy_id;
    for utxo in utxos {
        if !at_wallet_contract(&utxo, contract.wallet_contract_hash) {
            continue;
        }
        if contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
            let asset_name = utxo
                .asset_list
                .as_ref()
                .and_then(|vec| {
                    vec.iter()
                        .find(|asset| asset.policy_id == seedelf_policy_id)
                        .map(|asset| &asset.asset_name)
                })
                .context("Can't Produce Asset Name")?;
            if asset_name == &seedelf {
                // we found it so stop searching
                return Ok(Some(utxo));
            }
        }
    }
    Ok(None)
}

// Find wallet utxos owned by some scalar: the contract's ([`at_wallet_contract`]),
// holding no Seedelf. The maximum amount of utxos is limited by a upper bound.
pub fn collect_wallet_utxos(
    sk: Scalar,
    contract: &Contract,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let mut number_of_utxos: u64 = 0;
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();

    for utxo in utxos {
        if !at_wallet_contract(&utxo, contract.wallet_contract_hash) {
            continue;
        }
        // Extract bytes
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scalar. A register whose
            // points don't decompress is nobody's, and doesn't stop the scan.
            if inline_datum.is_owned(sk).unwrap_or(false) {
                // its owned but it can't hold a seedelf
                if !contains_policy_id(&utxo.asset_list, &contract.seedelf_policy_id) {
                    if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                        // we hit the max utxos allowed in a single tx
                        break;
                    }
                    usable_utxos.push(utxo);
                    number_of_utxos += 1;
                }
            }
        }
    }
    Ok(usable_utxos)
}

/// Collect all the address utxos that are not an assumed collateral utxo.
///
/// Koios reports a token-less outpoint as either `Some(vec![])` or `None`; treat
/// them identically. An earlier version filtered on `Some(_)` and silently
/// dropped every pure-ADA UTxO whose `asset_list` came back `None`.
pub fn collect_address_utxos(utxos: Vec<UtxoResponse>) -> Result<Vec<UtxoResponse>> {
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();
    for utxo in utxos {
        let lovelace: u64 = utxo.value.parse::<u64>().context("Invalid Lovelace")?;
        let is_empty_asset_list = utxo
            .asset_list
            .as_ref()
            .is_none_or(|assets| assets.is_empty());
        if is_empty_asset_list && lovelace == 5_000_000 {
            // probably the collateral UTxO — skip
            continue;
        }
        usable_utxos.push(utxo);
    }
    Ok(usable_utxos)
}

/// The least lovelace [`select`] keeps for change holding `tokens`: one
/// output's least for all of them, times the outputs they take at
/// `MAXIMUM_TOKENS_PER_UTXO` to an output.
fn change_floor(params: &ProtocolParameters, tokens: &Assets) -> Result<u64> {
    let kinds: u64 = tokens.len();
    let minimum: u64 = wallet_minimum_lovelace_with_assets(params, tokens.clone())
        .context("Invalid Minimum Lovelace")?;
    // we need to calculate how many multiple change utxos we need
    let multiplier: u64 = if kinds > MAXIMUM_TOKENS_PER_UTXO {
        // add one due to floor division
        (kinds / MAXIMUM_TOKENS_PER_UTXO) + 1
    } else {
        1
    };
    Ok(multiplier.saturating_mul(minimum))
}

/// As few of `held` (each UTxO's lovelace and tokens) as hold `tokens`
/// together: for each token in turn, those that bring most first, until
/// there's enough. What a holder brings is its lovelace less what its other
/// tokens, all bound for the change, need there ([`change_floor`]), so one
/// that brings less than nothing comes last. By how much of a token each
/// held, a UTxO of 2 ₳, 150 T and 40 NFTs led one of 50 ₳ and 100 T, and its
/// NFTs put the change's floor past all the address held; a stranger's at
/// the address, with more T than the user's, led too (chunk 51, l3money#1 and
/// l3cli#2). Their places in `held`, in the order picked.
fn holders_of(
    params: &ProtocolParameters,
    held: &[(u64, Assets)],
    tokens: &Assets,
) -> Result<Vec<usize>> {
    let brings = |i: usize| -> Result<i128> {
        let (lovelace, assets) = &held[i];
        let others = Assets {
            items: assets
                .items
                .iter()
                .filter(|a| {
                    !tokens
                        .items
                        .iter()
                        .any(|t| t.policy_id == a.policy_id && t.token_name == a.token_name)
                })
                .cloned()
                .collect(),
        };
        Ok(i128::from(*lovelace) - i128::from(change_floor(params, &others)?))
    };
    let mut picked: Vec<usize> = Vec::new();
    for want in &tokens.items {
        let of = |i: usize| -> u64 {
            held[i]
                .1
                .items
                .iter()
                .filter(|a| a.policy_id == want.policy_id && a.token_name == want.token_name)
                .fold(0, |sum, a| sum.saturating_add(a.amount))
        };
        let mut have: u64 = picked.iter().fold(0, |sum, &i| sum.saturating_add(of(i)));
        let mut holders: Vec<(Reverse<i128>, usize)> = (0..held.len())
            .filter(|i| !picked.contains(i) && of(*i) > 0)
            .map(|i| Ok((Reverse(brings(i)?), i)))
            .collect::<Result<Vec<_>>>()?;
        holders.sort_by_key(|(most, _)| *most);
        for (_, i) in holders {
            if have >= want.amount {
                break;
            }
            have = have.saturating_add(of(i));
            picked.push(i);
        }
    }
    Ok(picked)
}

/// The order [`select`] takes `utxos` in, and how many of them, at the front,
/// it takes for the `tokens` being sent. That's the order a script spend
/// takes them in when nothing is known of their histories (build.rs
/// `select_script_inputs`): the fewest holding the tokens, those that bring
/// most first ([`holders_of`]), then those with no tokens, then every other
/// token UTxO, each of these two groups the most lovelace first. Koios
/// reports a token-less outpoint as either `Some(vec![])` or `None`; both
/// group together. A caller that hands [`select`] only some of the UTxOs
/// keeps those it takes first (chunk 51, l4cli#2).
pub fn select_order(
    params: &ProtocolParameters,
    utxos: Vec<UtxoResponse>,
    tokens: &Assets,
) -> Result<(Vec<UtxoResponse>, usize)> {
    // Pre-parse the values once and bail on any malformed entry. An earlier
    // version used `Result::into_iter().cmp(...)`, which silently treated
    // parse failures as `Equal` and could break the largest-first invariant
    // the selector depends on.
    let held: Vec<(u64, Assets)> = utxos
        .iter()
        .map(|u| -> Result<_> {
            let v = string_to_u64(u.value.clone()).context("Invalid UTxO Value")?;
            Ok((v, assets_of(vec![u.clone()])?.1))
        })
        .collect::<Result<Vec<_>>>()?;
    let front: Vec<usize> = holders_of(params, &held, tokens)?;
    let mut rest: Vec<usize> = (0..held.len()).filter(|i| !front.contains(i)).collect();
    rest.sort_by_key(|&i| (!held[i].1.is_empty(), Reverse(held[i].0)));
    let ordered: Vec<UtxoResponse> = front
        .iter()
        .chain(&rest)
        .map(|&i| utxos[i].clone())
        .collect();
    Ok((ordered, front.len()))
}

// lets assume that the lovelace here initially accounts for the estimated fee, like 1 ada or something
// use largest first algo but account for change
pub fn select(
    params: &ProtocolParameters,
    utxos: Vec<UtxoResponse>,
    lovelace: u64,
    tokens: Assets,
) -> Result<Vec<UtxoResponse>> {
    do_select(params, utxos, lovelace, tokens, lovelace).context("Do Select Failed")
}
fn do_select(
    params: &ProtocolParameters,
    utxos: Vec<UtxoResponse>,
    lovelace: u64,
    tokens: Assets,
    lovelace_goal: u64,
) -> Result<Vec<UtxoResponse>> {
    let mut selected_utxos: Vec<UtxoResponse> = Vec::new();

    let mut current_lovelace_sum: u64 = 0;
    let mut found_enough: bool = false;

    // all the found assets
    let mut found_assets: Assets = Assets::new();

    // The order to take them in ([`select_order`]). The loop below takes a
    // UTxO holding none of the tokens only once they're all found, and never
    // comes back to one it passed, so the tokens' holders go first: an
    // address whose ADA sat in such a UTxO, sorted ahead of a smaller one
    // holding the token, found nothing (chunk 51, r2b#2). Only the holders
    // needed lead: another, taken for its ADA ahead of ADA alone, put its
    // other tokens in the change, whose floor could pass all the address held
    // (r2cli#2).
    let (utxos, _) = select_order(params, utxos, &tokens)?;

    for utxo in utxos.clone() {
        // the value from koios is the lovelace
        let value: u64 = string_to_u64(utxo.value.clone()).context("Invalid UTxO Value")?;

        let mut utxo_assets: Assets = Assets::new();
        let mut added: bool = false;

        // Treat `None` and `Some(vec![])` identically — both mean "no native
        // tokens here". An earlier version of this branch dropped `None`
        // through entirely, leaving such UTxOs unselectable until the
        // tokens-already-found path fired.
        let asset_list: Vec<seedelf_koios::koios::Asset> =
            utxo.asset_list.clone().unwrap_or_default();
        if !asset_list.is_empty() {
            for token in asset_list {
                utxo_assets = utxo_assets
                    .add(
                        Asset::new(
                            token.policy_id,
                            token.asset_name,
                            string_to_u64(token.quantity).context("Invalid Asset Amount")?,
                        )
                        .context("Invalid Asset")?,
                    )
                    .context("Can't Add Assets")?;
            }
            // if this utxo has the assets we need but we haven't found it all yet then add it
            if utxo_assets.any(tokens.clone()) && !found_assets.contains(tokens.clone()) {
                selected_utxos.push(utxo.clone());
                current_lovelace_sum = current_lovelace_sum
                    .checked_add(value)
                    .context("Lovelace sum overflow")?;
                found_assets = found_assets
                    .merge(utxo_assets.clone())
                    .context("Can't Merge Assets")?;
                added = true;
            }
        } else if current_lovelace_sum < lovelace {
            // no tokens here just lovelace so add it
            selected_utxos.push(utxo.clone());
            current_lovelace_sum = current_lovelace_sum
                .checked_add(value)
                .context("Lovelace sum overflow")?;
            added = true;
        }

        // the utxo is not pure ada and doesnt contain what you need but you need ada because you already found the tokens so add it
        if !added && current_lovelace_sum < lovelace && found_assets.contains(tokens.clone()) {
            selected_utxos.push(utxo.clone());
            current_lovelace_sum = current_lovelace_sum
                .checked_add(value)
                .context("Lovelace sum overflow")?;
            found_assets = found_assets
                .merge(utxo_assets)
                .context("Can't Merge Assets")?;
        }

        // we know we found enough lovelace and assets
        if current_lovelace_sum >= lovelace && found_assets.contains(tokens.clone()) {
            // but is it enough to account for the min ada for the token change as we will assume there will always be a change utxo
            let change_assets: Assets = found_assets
                .separate(tokens.clone())
                .context("Can't Separate Assets")?;
            // we need lovelace for both the spend goal AND the change min-UTxO.
            // Compare via addition instead of subtraction — degenerate token
            // UTxOs (lots of accessory tokens, little ADA) can make the change
            // floor exceed gathered lovelace, which would underflow u64.
            let floor: u64 = change_floor(params, &change_assets)?;
            let total_needed: u64 = lovelace_goal.saturating_add(floor);
            if current_lovelace_sum >= total_needed {
                found_enough = true;
                break;
            } else {
                // not yet — bump the lovelace target by the change floor and retry
                return do_select(
                    params,
                    utxos.clone(),
                    lovelace.saturating_add(floor),
                    tokens.clone(),
                    lovelace_goal,
                );
            }
        }
    }
    if found_enough {
        // we found enough utxos to pay for it
        Ok(selected_utxos)
    } else {
        // not enough utxos to pay for what you are trying to do so return the empty utxo set
        Ok(Vec::new())
    }
}

/// Calculate the total assets of a list of utxos.
pub fn assets_of(utxos: Vec<UtxoResponse>) -> Result<(u64, Assets)> {
    let mut found_assets: Assets = Assets::new();
    let mut current_lovelace_sum: u64 = 0;

    for utxo in utxos.clone() {
        let value: u64 = string_to_u64(utxo.value.clone()).context("Invalid UTxO Value")?;
        current_lovelace_sum = current_lovelace_sum
            .checked_add(value)
            .context("Lovelace sum overflow")?;

        if let Some(assets) = utxo.clone().asset_list
            && !assets.is_empty()
        {
            let mut utxo_assets: Assets = Assets::new();

            for token in assets.clone() {
                let new_asset = Asset::new(
                    token.policy_id,
                    token.asset_name,
                    string_to_u64(token.quantity).context("Invalid Token Quantity")?,
                )
                .context("Fail To Construct Asset")?;
                utxo_assets = utxo_assets.add(new_asset).context("Can't Add Assets")?;
            }

            found_assets = found_assets
                .merge(utxo_assets.clone())
                .context("Can't Merge Assets")?;
        }
    }
    Ok((current_lovelace_sum, found_assets))
}

/// The size of a UTxO's reference script, as the ledger counts it for the
/// reference-script fee (`build::reference_script_fee`): its bytes as Koios
/// gives them, which must agree with Koios's `size` when it gives one. 0 when
/// it holds none. One it holds but that can't be sized (no bytes, not hex, or
/// a size that disagrees) is an error naming the UTxO, never 0: the fee
/// would come out short, and the network would refuse the transaction.
pub fn reference_script_size(utxo: &UtxoResponse) -> Result<u64> {
    let Some(script) = &utxo.reference_script else {
        return Ok(0);
    };
    let size = script
        .bytes
        .as_deref()
        .and_then(|bytes| hex::decode(bytes).ok())
        .map(|bytes| bytes.len() as u64)
        .filter(|size| *size > 0 && script.size.is_none_or(|given| given == *size));
    size.with_context(|| {
        format!(
            "UTxO {}#{} holds a reference script the wallet can't measure, so it can't price spending it",
            utxo.tx_hash, utxo.tx_index
        )
    })
}

/// The reference-script bytes of `utxos` together (see [`reference_script_size`]).
pub fn reference_script_bytes(utxos: &[UtxoResponse]) -> Result<u64> {
    utxos.iter().try_fold(0u64, |total, utxo| {
        Ok(total.saturating_add(reference_script_size(utxo)?))
    })
}

/// Which of `utxos` one transaction can spend together (`taken`), and which
/// it leaves out (`left`), each in the order given.
///
/// - A UTxO is left out when its tokens, added to `base`'s and to those of
///   the UTxOs taken before it, would push a token's total past a u64. No
///   output can hold more of one token than that, so totalling in u128
///   wouldn't help: anyone can send three UTxOs of 2^63 − 1 of one token to
///   an address, and nothing holding all three could be built.
/// - The order they're taken in: ADA-only first (they never conflict), then
///   those `first` picks (a session's own), then the most lovelace first,
///   ties by outpoint, so the same UTxOs split the same way every time.
/// - Every UTxO fits on its own, so spending again from `left` always takes
///   at least one.
pub fn fitting(
    utxos: &[UtxoResponse],
    base: &Assets,
    first: impl Fn(&UtxoResponse) -> bool,
) -> Result<(Vec<UtxoResponse>, Vec<UtxoResponse>)> {
    let mut order: Vec<(usize, &UtxoResponse, u64, Assets)> = utxos
        .iter()
        .enumerate()
        .map(|(i, utxo)| {
            let (lovelace, tokens) = assets_of(vec![utxo.clone()])?;
            Ok((i, utxo, lovelace, tokens))
        })
        .collect::<Result<_>>()?;
    order.sort_by(
        |(_, a, a_lovelace, a_tokens), (_, b, b_lovelace, b_tokens)| {
            (
                !a_tokens.is_empty(),
                !first(a),
                std::cmp::Reverse(*a_lovelace),
            )
                .cmp(&(
                    !b_tokens.is_empty(),
                    !first(b),
                    std::cmp::Reverse(*b_lovelace),
                ))
                .then_with(|| (&a.tx_hash, a.tx_index).cmp(&(&b.tx_hash, b.tx_index)))
        },
    );
    let mut total = base.clone();
    let mut fits = vec![false; utxos.len()];
    for (i, _, _, tokens) in order {
        if let std::result::Result::Ok(more) = total.merge(tokens) {
            total = more;
            fits[i] = true;
        }
    }
    let (taken, left): (Vec<_>, Vec<_>) = utxos.iter().zip(fits).partition(|(_, fits)| *fits);
    Ok((
        taken.into_iter().map(|(u, _)| u.clone()).collect(),
        left.into_iter().map(|(u, _)| u.clone()).collect(),
    ))
}

/// The Seedelfs at the contract ([`at_wallet_contract`]) whose names contain
/// the label.
pub fn find_all_seedelfs(
    label: String,
    contract: &Contract,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<String>> {
    let seedelf_policy_id: &str = &contract.seedelf_policy_id;
    let mut matches = Vec::new();
    for utxo in utxos {
        if !at_wallet_contract(&utxo, contract.wallet_contract_hash) {
            continue;
        }
        if contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
            let asset_name = utxo
                .asset_list
                .as_ref()
                .and_then(|vec| {
                    vec.iter()
                        .find(|asset| asset.policy_id == seedelf_policy_id)
                        .map(|asset| &asset.asset_name)
                })
                .context("Can't Produce Asset Name")?;
            if asset_name.to_lowercase().contains(&label.to_lowercase()) {
                // we found it so print it
                matches.push(asset_name.to_string());
            }
        }
    }
    Ok(matches)
}

/// The Seedelfs held at the contract ([`at_wallet_contract`]) under one of
/// `sk`'s registers, by name: what `balance` lists.
pub fn owned_seedelfs(sk: Scalar, contract: &Contract, utxos: &[UtxoResponse]) -> Vec<String> {
    utxos
        .iter()
        .filter(|utxo| at_wallet_contract(utxo, contract.wallet_contract_hash))
        .filter(|utxo| {
            extract_bytes_with_logging(&utxo.inline_datum)
                .is_some_and(|register| register.is_owned(sk).unwrap_or(false))
        })
        .filter_map(|utxo| {
            utxo.asset_list.as_ref()?.iter().find_map(|asset| {
                (asset.policy_id == contract.seedelf_policy_id).then(|| asset.asset_name.clone())
            })
        })
        .collect()
}

/// The contract's UTxOs ([`at_wallet_contract`]): how many, their lovelace,
/// and how many hold a Seedelf.
pub fn count_lovelace_and_utxos(
    contract: &Contract,
    utxos: Vec<UtxoResponse>,
) -> Result<(usize, u64, u64)> {
    let seedelf_policy_id: &str = &contract.seedelf_policy_id;
    let utxos: Vec<UtxoResponse> = utxos
        .into_iter()
        .filter(|utxo| at_wallet_contract(utxo, contract.wallet_contract_hash))
        .collect();
    let mut total_lovelace: u64 = 0;
    let mut total_seedelfs: u64 = 0;

    for utxo in utxos.clone() {
        // count if a utxo holds a seedelf policy id
        if contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
            total_seedelfs += 1;
        }
        // count the lovelace on the utxo
        let value: u64 =
            string_to_u64(utxo.value.clone()).context("failed to parse lovelace value")?;
        total_lovelace += value;
    }
    Ok((utxos.len(), total_lovelace, total_seedelfs))
}

pub fn parse_tx_utxos(utxos: Vec<String>) -> Result<Vec<(String, u64)>> {
    utxos
        .into_iter()
        .map(|s| {
            let parts: Vec<&str> = s.split('#').collect();
            if parts.len() != 2 {
                bail!("Invalid input format: {s}");
            }

            let tx_hash = parts[0].to_string();
            let index = parts[1]
                .parse::<u64>()
                .map_err(|_| anyhow!("Invalid index in input: {s}"))?;

            Ok((tx_hash, index))
        })
        .collect()
}

pub fn filter_utxos(utxos: Vec<UtxoResponse>, targets: Vec<(String, u64)>) -> Vec<UtxoResponse> {
    // For fast lookup, convert to a HashSet
    use std::collections::HashSet;

    let target_set: HashSet<(String, u64)> = targets.into_iter().collect();

    utxos
        .into_iter()
        .filter(|u| target_set.contains(&(u.tx_hash.clone(), u.tx_index)))
        .collect()
}
