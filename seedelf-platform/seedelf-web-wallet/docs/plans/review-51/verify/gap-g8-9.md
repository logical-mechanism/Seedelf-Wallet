# gap-g8#9: verification

From lane gap-G8, graded low by its finder.

## Trace: known, low

The finding holds exactly as written, and a run shows it. When the public account's largest ADA-only UTxO is output #300, account_mint tries it alone first. seedelf_token_name refuses that set, and the `?` at build.rs:3898 ends the whole mint, even though a set the policy takes is right there. The test's set is the other UTxO (output #0), alone or first in ledger order. The blind stealth path does the same: select_script_inputs' loop returns any error that isn't NotEnough (build.rs:2577). No guard comes earlier. The worker, coin control, WebAssembly, the Koios and data-layer clients and `fitting` never filter by index. No existing test covers selection here; transaction_test.rs:145 pins only the naming refusal, which is right for that one set.

It is known, though. Chunk 40 recorded the same edge for the burn, and the owner settled it on 2026-11-02: "a narrow edge of the wallet's input selection. No fix requested". The same record notes that core refuses such an input for a mint (chunk-40-verification-upstream.md:179-186, :194, :210). Chunk 51's R2b lane, under the same brief, already put this exact account-mint behaviour in its notes as "Settled (chunk 40 ...), with the mint side as a new fact" (lanes/R2b.md:149). The brief puts a settled item with a new fact in notes, never as a finding. The finder's known check cited chunk 40 only for the policy's 0..255 rule and missed both records.

New facts for the owner's note:
(1) The mint's selection gives up instead of trying a set the policy takes. The verification README:70/:201 and AUDIT.md's errata §3.4 say only that "a mint can't be built from it".
(2) R2b's "a private mint can't hit it" is wrong. A payment to the user's Seedelf at #256 or later fits in 16 KiB when the 256 outputs before it are small enterprise outputs (about 37 bytes each, about 9.5 KiB). The stealth mint stops on it, but only on the blind path: the CLI's util mint, or the web wallet when every private UTxO's origin is Unknown. It has to be the largest ADA-only one. With histories, apart marks the set Failed and one_more goes on.
(3) The refusal reaches the screen in core's words (mint.ts:95-98 passes anything that isn't a shortfall through). They name output #300 but not the way out.

One correction to the reach: "only when most of them are small enterprise outputs" overstates it. 257 base-address outputs come to 16,705 bytes, and each enterprise output saves 28, so about 18 enterprise outputs among 257 suffice. It still takes a transaction of 257 or more outputs, which is rare.

Severity is low:
- **Who:** the user, in a rare state. A stranger can cause it only by giving the user more ADA than their largest ADA-only UTxO, at output #256 or later.
- **Cost:** no money. The mint is refused in core before any draft, Ogmios call or signature.
- **Way out:** lock that UTxO on the UTxOs screen (coin-control.ts:253-254 drops locked outpoints before WebAssembly), spend it first, or pay from the other balance.

**Evidence:**

Paths are relative to TREE. HEAD is 140886c9, but only docs changed since cd764fba, and since web-wallet/1.9.1 only manifest.ts and an e2e spec. I opened every file and line the finder cites.

Account-paid mint, from the press to the outcome:
1. mint.ts:70-98 buildFromAccount: readAccount, then `request.utxos`, then wasm.draftAccountMint (:93).
   - readAccountUtxos (account.ts:95-125) has no index filter.
   - coins.account (coin-control.ts:246-256) drops only the collateral and locked outpoints.
2. wasm lib.rs:2794-2825 account_mint_plan: `available = request.utxos` as given, then build::account_mint (:2814).
3. build.rs:3797-3817 account_inputs:
   - removes the set-aside collateral and unmeasurable reference scripts;
   - `fitting` (utxos.rs:392-433) drops only token overflows;
   - sorts by (!pure_ada, has a reference script, Reverse(lovelace)): the largest ADA-only UTxO first.
4. build.rs:3891-3898: k=1, `inputs = &spendable[..1]`, then `let token_name = seedelf_token_name(label.to_string(), Some(&owned))?;`.
5. transaction.rs:118-135: the min by (tx_hash, txo_index), then `if smallest_input.txo_index > 255 { anyhow::bail!("A Seedelf can't be named after output #{} …") }`.
   - The `?` returns from account_mint.
   - `match mint.estimate()` (3915-3919), the only place a failure lets the loop go on (NotEnough), is never reached.
6. The policy at 5b82530:
   - seedelf.ak:57-60 `expect [input, ..] = inputs` names the token after the ledger-first input;
   - token_name.ak:25 `bytearray.push(txid, idx)` fails past 255 under V3.
   - So {other} alone, or {batch, other} with other's txid first, is a mint it takes.
7. mint.ts:95-98: isPublicShort is false, so core's words reach the screen.

Stealth mint:
- mint.ts:126 → lib.rs:2396-2415 mint_apart(histories(Purpose::Mint, classes)) → build.rs:3012-3027 select_script_inputs.
- It is blind when every UTxO's class is Unknown (2494-2498; unlisted means Unknown, 2452-2457).
- Blind loop (2567-2578): sorted by (holds_tokens, Reverse(lovelace)); k=1 → mint_from (3058) seedelf_token_name bails → `Err(e) => return Err(e)` (2577).
- With histories, apart's try_with (2690-2699) marks it Failed and one_more (2622-2625) goes on.

CLI (same class, CLI-only): create.rs:76-99, utxos::select, then `seedelf_token_name(...)?`.

Since: git blame puts build.rs:3898 at 719b1538, and transaction.rs:130 and build.rs:2577 at 97be888f, both 2026-09-23. The first tag containing them is web-wallet/1.6.0; 1.0.0 to 1.5.0 carry no tags.

Run on TREE: both tests in r51_gap-g8_9.rs fail with core's naming refusal (output below).

Would pass once fixed: I put a stand-in fix in a copy under ~/.cache/seedelf-review-51/, never in TREE, and removed the copy and its target after:
- account_mint: `match seedelf_token_name(..) { Ok(n) => n, Err(e) => { last_error = Some(e); continue } }`;
- the blind loop: one more arm that goes on for that refusal.
- With it, both tests pass in 0.88 s: `test result: ok. 2 passed; 0 failed`.

TREE: only my test file was added; `git status` shows seedelf-core/src unchanged.

**Known:** - **The owner's call:** seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-40-verification-upstream.md:179-186, "Found along the way: A burn fails when the transaction's first input is output #256 or later … seedelf-core refuses such an input for a mint (`seedelf_token_name`) but not for Remove's burn … The owner, 2026-11-02: a narrow edge of the wallet's input selection. No fix requested." Also :194 (the owner's decisions) and :210 ("Stays as decided: the burn at #256, with no fix requested").
- **Already in this review:** chunk 51's lanes/R2b.md:149 records this account-mint behaviour as "Settled (chunk 40 …), with the mint side as a new fact" (in notes, not a finding).
- **The same edge recorded elsewhere:** seedelf-verification/README.md:70 and :201, and seedelf-contracts/AUDIT.md's Errata (17 November 2026), §3.4: "It means a mint can't be built from it … the wallets refuse or fail to evaluate such a transaction before sending it, so nothing is lost."
- **Searched:** backlog.md and docs/archive/plans/*.md for one-byte, txo_index, #256, 255/256, consByteString, "named after output", account_mint and "smallest input"; SECURITY.md for #256; and the review-51 lanes, INDEX.md and verify records.

**Fix notes:**

If the owner reopens it, fix the whole family, not the one shape:
- **The family:** account_mint (build.rs:3898), select_script_inputs' blind loop (build.rs:2574-2577, through mint_from build.rs:3058), the CLI's create (create.rs:99), and Remove's burn (the settled chunk 40 item: no index check, so local evaluation fails).
- **Not in it:** Lovejoin's launch. one_shot_mint compares the seed's outref whole, so the seed's index has no byte limit.
- **The fix:** make the naming refusal a typed marker, like NotEnough, that every selection loop treats as "try the next set". Or order account_inputs and the blind sort so a UTxO past #255 never comes first alone.
- **What a correct mint looks like:** the stand-in fix (a `match` that sets last_error and goes on, in both loops) makes r51_gap-g8_9.rs pass, building with output #0 first.
- **If it stays as is:** a short line could name the way out. The refusal reaches the screen in core's English words (mint.ts:95-98). Lock that UTxO on the UTxOs screen, or spend it first.

needs_owner: yes. It changes which UTxOs a mint spends, and it reopens a class the owner settled on 2026-11-02. It belongs in the owner's notes with the new facts in the reason, beside R2b's note:
- the selection gives up rather than trying another set;
- the blind stealth path is reachable after all, against R2b's "can't";
- the refusal's words don't name the way out.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-core/tests/r51_gap-g8_9.rs`

Result: Run from TREE/seedelf-platform with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m cargo test -j 4 --locked -p seedelf-core --test r51_gap-g8_9`:

    Finished `test` profile [unoptimized + debuginfo] target(s) in 4.69s
     Running tests/r51_gap-g8_9.rs (target/debug/deps/r51_gap_g8_9-3730798cfdc0790d)
running 2 tests
test a_blind_stealth_mint_names_the_seedelf_after_a_utxo_the_policy_takes ... FAILED
test an_account_mint_names_the_seedelf_after_a_utxo_the_policy_takes ... FAILED
---- a_blind_stealth_mint_names_the_seedelf_after_a_utxo_the_policy_takes stdout ----
thread '...' panicked at seedelf-core/tests/r51_gap-g8_9.rs:182:13:
the Seedelf balance holds a mint the policy takes (output #0 first), but mint says: A Seedelf can't be named after output #300 of a transaction (the contract takes a one-byte index)
---- an_account_mint_names_the_seedelf_after_a_utxo_the_policy_takes stdout ----
thread '...' panicked at seedelf-core/tests/r51_gap-g8_9.rs:117:9:
the account holds a mint the policy takes (output #0 first), but account_mint says: A Seedelf can't be named after output #300 of a transaction (the contract takes a one-byte index)
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.57s

The same test in a copy with a stand-in fix (the naming refusal treated as a failed set in account_mint and in the blind loop), built with its own target folder, `--offline`:

test a_blind_stealth_mint_names_the_seedelf_after_a_utxo_the_policy_takes ... ok
test an_account_mint_names_the_seedelf_after_a_utxo_the_policy_takes ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.88s

The copy and its target were removed afterwards.

```
//! Chunk 51, gap-g8#9: a Seedelf mint whose largest ADA-only UTxO is output
//! #300 of its transaction.
//!
//! The deployed policy (seedelf.ak at 5b82530) names the token after the
//! transaction's first input in ledger order (by transaction id, then
//! index), prepending the index as one byte (token_name.ak's
//! `bytearray.push`, which fails past 255 under V3). So a mint whose first
//! input is output #300 can't pass, and `seedelf_token_name` rightly refuses
//! it; one whose first input is output #0 passes.
//!
//! With two ADA-only UTxOs, the larger at #300, both mints below should
//! build, naming the Seedelf after the other one. Today each tries the larger
//! alone first and returns the naming refusal at once: account_mint's `?`
//! (build.rs:3898), and the blind selection's `Err(e) => return Err(e)`
//! (build.rs:2577), so no other set is tried.

use pallas_crypto::hash::Hasher;
use pallas_traverse::MultiEraTx;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{self, Budgets, Chain, fake_signer};
use seedelf_core::constants::get_config;
use seedelf_core::staking::Staking;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const LABEL: &str = "r51";

fn chain() -> Chain {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    Chain {
        params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    }
}

fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/tests/fixtures/ogmios/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// The policy's name for a first input, written out from token_name.ak:
/// 5eed0e1f, the tag's first 15 bytes, the index as one byte, the
/// transaction id, cut to 32 bytes. None past a byte, where the policy fails.
fn policy_name(label: &str, tx_hash: &str, index: u64) -> Option<String> {
    let index = u8::try_from(index).ok()?;
    let mut bytes = hex::decode("5eed0e1f").unwrap();
    bytes.extend(label.as_bytes().iter().take(15));
    bytes.push(index);
    bytes.extend(hex::decode(tx_hash).unwrap());
    bytes.truncate(32);
    Some(hex::encode(bytes))
}

/// The first input in ledger order: by transaction id, then index.
fn ledger_first(utxos: &[UtxoResponse]) -> UtxoResponse {
    utxos
        .iter()
        .min_by_key(|u| (hex::decode(&u.tx_hash).unwrap(), u.tx_index))
        .cloned()
        .expect("some inputs")
}

/// An ADA-only UTxO at the account's receive address `key`.
fn at(account: &CardanoAccount, key: u32, n: u8, tx_index: u64, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index,
        address: account
            .base_address(true, Role::Receive, key)
            .unwrap()
            .to_bech32()
            .unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(account.key_hash(Role::Receive, key).unwrap()),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

#[test]
fn an_account_mint_names_the_seedelf_after_a_utxo_the_policy_takes() {
    let chain = chain();
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    // The largest ADA-only UTxO is output #300 of a big batch; the other is
    // output #0, and its transaction id sorts first.
    let batch = at(&account, 0, 0x40, 300, 10_000_000);
    let other = at(&account, 1, 0x30, 0, 8_000_000);
    // Set aside as the collateral, as the web wallet's is: never an input.
    let collateral = at(&account, 2, 0x50, 0, 5_000_000);
    let seedelf = Register::create(random_scalar())
        .unwrap()
        .rerandomize()
        .unwrap();
    let change = account.base_address(true, Role::Receive, 0).unwrap();

    let mint = build::account_mint(
        &chain,
        &[batch, other.clone()],
        Some(&collateral),
        LABEL,
        &seedelf,
        &change,
        &Staking::none(),
        None,
    )
    .unwrap_or_else(|e| {
        panic!("the account holds a mint the policy takes (output #0 first), but account_mint says: {e}")
    });

    // Named as the policy names it, after a first input whose index is a byte.
    let first = ledger_first(mint.inputs());
    assert_eq!(first.tx_hash, other.tx_hash);
    let expected = policy_name(LABEL, &first.tx_hash, first.tx_index)
        .expect("the first input's index is a byte");
    assert_eq!(hex::encode(&mint.token_name), expected);

    // It finishes, and the transaction mints that name with output #0 first.
    let built = mint
        .finalize(&Budgets::from_ogmios(&fixture("account_mint.json")).unwrap())
        .unwrap();
    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    let inputs = tx.inputs_sorted_set();
    assert_eq!(hex::encode(inputs[0].hash()), other.tx_hash);
    assert_eq!(inputs[0].index(), 0);
    let minted: Vec<String> = tx
        .mints()
        .iter()
        .flat_map(|p| {
            p.assets()
                .into_iter()
                .map(|a| hex::encode(a.name()))
                .collect::<Vec<_>>()
        })
        .collect();
    assert_eq!(minted, vec![expected]);
}

#[test]
fn a_blind_stealth_mint_names_the_seedelf_after_a_utxo_the_policy_takes() {
    let chain = chain();
    let owner = Register::create(random_scalar()).unwrap();
    let wallet = wallet_contract(true, chain.config.contract.wallet_contract_hash);
    // A wallet-contract UTxO under a fresh re-randomization of `owner`.
    let owned = |n: u8, tx_index: u64, lovelace: u64| {
        let register = owner.clone().rerandomize().unwrap();
        UtxoResponse {
            tx_hash: hex::encode([n; 32]),
            tx_index,
            address: wallet.to_bech32().unwrap(),
            value: lovelace.to_string(),
            payment_cred: hex::encode(chain.config.contract.wallet_contract_hash),
            inline_datum: Some(InlineDatum {
                bytes: hex::encode(register.to_vec().unwrap()),
                value: json!({
                    "constructor": 0,
                    "fields": [{"bytes": register.generator}, {"bytes": register.public_value}]
                }),
            }),
            asset_list: Some(vec![]),
            ..Default::default()
        }
    };
    let batch = owned(0x40, 300, 10_000_000);
    let other = owned(0x30, 0, 8_000_000);
    let seedelf = owner.clone().rerandomize().unwrap();
    let signer = Hasher::<224>::hash(fake_signer().public_key().as_ref());

    // No histories: the CLI's `util mint`, or the web wallet's when every
    // private UTxO's origin is unknown (a restore's first reading).
    let minted = build::mint(&chain, &[batch, other.clone()], LABEL, &seedelf, &owner, signer)
        .unwrap_or_else(|e| {
            panic!("the Seedelf balance holds a mint the policy takes (output #0 first), but mint says: {e}")
        });

    let first = ledger_first(&minted.spend.inputs());
    assert_eq!(first.tx_hash, other.tx_hash);
    let expected = policy_name(LABEL, &first.tx_hash, first.tx_index)
        .expect("the first input's index is a byte");
    assert_eq!(hex::encode(&minted.token_name), expected);
}
```
