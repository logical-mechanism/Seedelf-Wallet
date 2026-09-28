use crate::assets::{Asset, Assets, string_to_u64};
use crate::constants::{MAXIMUM_TOKENS_PER_UTXO, MAXIMUM_WALLET_UTXOS};
use crate::transaction::wallet_minimum_lovelace_with_assets;
use anyhow::{Context, Ok, Result, anyhow, bail};
use blstrs::Scalar;
use hex;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{
    ProtocolParameters, UtxoResponse, address_utxos, contains_policy_id, credential_utxos,
    extract_bytes_with_logging,
};

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

/// collects all the wallet utxos owned by some scalar.
pub fn collect_all_wallet_utxos(
    sk: Scalar,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let mut all_utxos: Vec<UtxoResponse> = Vec::new();
    for utxo in utxos {
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scalar. A register whose
            // points don't decompress is nobody's: anyone can pay the
            // contract under one, so it's skipped, never an error that
            // stops the scan.
            if inline_datum.is_owned(sk).unwrap_or(false) {
                // its owned but lets not count the seedelf in the balance
                if !contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
                    all_utxos.push(utxo.clone());
                }
            }
        }
    }
    Ok(all_utxos)
}

pub fn find_seedelf_datum(
    seedelf: String,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Option<Register>> {
    let mut seedelf_datum: Option<Register> = None;

    for utxo in utxos {
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

/// Find a specific seedelf.
pub fn find_seedelf_utxo(
    seedelf: String,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Option<UtxoResponse>> {
    for utxo in utxos {
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

// Find wallet utxos owned by some scalar. The maximum amount of utxos is limited by a upper bound.
pub fn collect_wallet_utxos(
    sk: Scalar,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let mut number_of_utxos: u64 = 0;
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();

    for utxo in utxos {
        // Extract bytes
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scalar. A register whose
            // points don't decompress is nobody's, and doesn't stop the scan.
            if inline_datum.is_owned(sk).unwrap_or(false) {
                // its owned but it can't hold a seedelf
                if !contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
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

    // Sort: no-token UTxOs first, then by descending lovelace value within
    // each group. Koios reports a token-less outpoint as either `Some(vec![])`
    // or `None`; both must group together.
    //
    // Pre-parse the values once and bail on any malformed entry. An earlier
    // version used `Result::into_iter().cmp(...)`, which silently treated
    // parse failures as `Equal` and could break the largest-first invariant
    // the selector below depends on.
    let mut sortable: Vec<(u64, UtxoResponse)> = utxos
        .into_iter()
        .map(|u| -> Result<(u64, UtxoResponse)> {
            let v = string_to_u64(u.value.clone()).context("Invalid UTxO Value")?;
            Ok((v, u))
        })
        .collect::<Result<Vec<_>>>()?;
    sortable.sort_by(|(a_val, a), (b_val, b)| {
        let a_has_tokens = a.asset_list.as_ref().is_some_and(|list| !list.is_empty());
        let b_has_tokens = b.asset_list.as_ref().is_some_and(|list| !list.is_empty());
        a_has_tokens
            .cmp(&b_has_tokens)
            .then_with(|| b_val.cmp(a_val))
    });
    let utxos: Vec<UtxoResponse> = sortable.into_iter().map(|(_, u)| u).collect();

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
            let number_of_change_assets: u64 = change_assets.len();
            let minimum: u64 = wallet_minimum_lovelace_with_assets(params, change_assets.clone())
                .context("Invalid Minimum Lovelace")?;
            // we need to calculate how many multiple change utxos we need
            let multiplier: u64 = if number_of_change_assets > MAXIMUM_TOKENS_PER_UTXO {
                // add one due to floor division
                (number_of_change_assets / MAXIMUM_TOKENS_PER_UTXO) + 1
            } else {
                1
            };
            // we need lovelace for both the spend goal AND the change min-UTxO.
            // Compare via addition instead of subtraction — degenerate token
            // UTxOs (lots of accessory tokens, little ADA) can make the change
            // floor exceed gathered lovelace, which would underflow u64.
            let change_floor: u64 = multiplier.saturating_mul(minimum);
            let total_needed: u64 = lovelace_goal.saturating_add(change_floor);
            if current_lovelace_sum >= total_needed {
                found_enough = true;
                break;
            } else {
                // not yet — bump the lovelace target by the change floor and retry
                return do_select(
                    params,
                    utxos.clone(),
                    lovelace.saturating_add(change_floor),
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

/// Find a seedelf that contains the label and print the match.
pub fn find_all_seedelfs(
    label: String,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<String>> {
    let mut matches = Vec::new();
    for utxo in utxos {
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

/// Find a seedelf that contains the label and print the match.
pub fn count_lovelace_and_utxos(
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<(usize, u64, u64)> {
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
