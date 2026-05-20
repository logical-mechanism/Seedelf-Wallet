# Seedelf Smart Contract Security Audit

**Scope:** Aiken on-chain contracts in [seedelf-contracts/](.) at commit of `aiken.toml` v0.4.10 (Aiken v1.1.19, Plutus v3, stdlib v3.0.0).

**Files audited:**
- [validators/wallet.ak](validators/wallet.ak)
- [validators/seedelf.ak](validators/seedelf.ak)
- [validators/always_false.ak](validators/always_false.ak)
- [lib/schnorr.ak](lib/schnorr.ak)
- [lib/token_name.ak](lib/token_name.ak)

**Design premise (hyperstructure):** The contracts intentionally treat malformed / unexpected inputs as *spendable* (dead-ends must resolve to `True`) so that value is never permanently trapped by a decoding accident. `always_false` is the single opposite — it is a deliberate perma-lock for reference-script UTxOs. This audit evaluates the code against that premise as well as general Cardano/Plutus safety.

---

## Summary

No critical vulnerabilities were found. The proof system, replay protection, and minting uniqueness reasoning are sound. Findings below are a mix of informational notes, hardening suggestions, and documentation items that auditors will typically ask about. The contracts behave as designed.

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | Info | wallet | `is Register` is a shape-only check; field payloads are never validated |
| 2 | Info | wallet | Identity / torsion points in the datum produce dead or trivially-spendable UTxOs (sender responsibility) |
| 3 | Low | schnorr | Fiat-Shamir uses `blake2b_224` (~112-bit challenge) vs. 128-bit target |
| 4 | Info | schnorr | No subgroup/prime-order check on `generator`, `public_value`, or `g_r_b` |
| 5 | Info | schnorr | `scalar.from_bytes(z_b)` accepts arbitrary-length bytes and reduces mod the field order (benign malleability) |
| 6 | Low | seedelf | Mint validator requires the `mint` field to contain *exactly one* flattened entry — blocks mixing with any other mint or burn in the same tx |
| 7 | Info | seedelf | Burn path only checks `amt == -1` and the `5eed0e1f` prefix; any token with that prefix under this policy can be burned (correct, by design) |
| 8 | Low | seedelf | `bytearray.push(txid, idx)` will fail if `idx > 255`; mint becomes infeasible off high-index outputs |
| 9 | Info | token_name | Short `personal` tags produce variable-length name *middles* (not a collision risk; confirmed by `rollover_attack` test) |
| 10 | Info | wallet / seedelf | Spend-only / mint-only enforced by `else(_) { fail }` — correct |
| 11 | Info | always_false | Perma-lock by design; any value-bearing UTxO sent there is unrecoverable (acknowledged) |

---

## 1. wallet.ak — Spending validator

### Logic recap

```
when maybe_register is
  Some(register) -> if register is Register { verify ∧ has(vkh, signatories) } else True
  None           -> True
```

The `else(_) { fail }` clause forbids every purpose except `spend`. ✔ correct.

### 1.1 [Info] `is Register` is a shape check, not a semantic check

At runtime, `if register is Register` checks the Data representation matches a two-field constructor-0. It does **not** verify:

- the fields are `ByteArray` (UPLC is type-erased; a mistyped field fails later inside `g1.decompress`);
- the bytearrays are valid compressed G1 elements;
- the points are in the prime-order subgroup or non-identity.

This is aligned with the hyperstructure philosophy: any register that survives the shape check but is cryptographically malformed becomes a *dead* UTxO (unspendable because no proof verifies). Flagged only to make the assumption explicit — callers constructing registers off-chain are the sole defense against accidentally creating dead UTxOs.

### 1.2 [Info] Identity / torsion / adversarial registers

- **Identity `u` (`public_value = 0_G1`):** any `z` satisfies `g^z = g^r · 0^c`, so anyone can spend. A sender who deposits to such a register is gifting funds.
- **Identity `g`:** same — trivial proofs always succeed.
- **Torsion (non-prime-order) points:** decompress succeeds, but `g^z ≠ g^r · u^c` because the Schnorr relation only holds in the prime-order subgroup. UTxO becomes dead.

These are not contract bugs — the validator cannot distinguish "user wants their funds locked" from "user made a mistake". The off-chain wallet must enforce `is_torsion_free()` and non-identity before constructing a register. CLAUDE.md already states this. Keep it prominent in user-facing docs.

### 1.3 Replay / rollback analysis

The Fiat-Shamir challenge binds `vkh`, and the tx must carry a signature by that `vkh`. On rollback:

- The mempool-visible proof `(z_b, g_r_b, vkh)` is reusable only inside a tx whose body hash an existing `vkh`-signature already covers. Cardano signatures commit to the full tx body, so an attacker cannot repackage the witness onto a new tx body without the `vkh` secret key.
- The legitimate user, upon rollback, generates a **fresh** `vkh`, a fresh `r`, hence a fresh `c`, hence a fresh `z`. The old proof can never co-spend the same UTxO under a different body.

Conclusion: one-time-pad design is sound, conditional on `vkh` actually being fresh per attempt. This is an **off-chain invariant**: reusing a `vkh` across two spend attempts does not break security (the tx-body signature still differs), but it reduces privacy hygiene. Recommend keeping the "one-time" wording in the off-chain code comments as a hard rule.

### 1.4 No value/output checks — intentional

The validator does not constrain outputs. A spender who knows `x` can send value anywhere. Correct — the holder of the secret has full authority.

### 1.5 Multi-UTxO spend in a single tx

Each input under this script runs the validator independently with its own datum and redeemer. Distinct registers produce distinct challenges (different `g`, `u`). No cross-proof interference. ✔.

---

## 2. lib/schnorr.ak — NIZK verifier

### 2.1 [Low] `blake2b_224` truncates the Fiat-Shamir security parameter

The challenge is 224 bits. The standard target for Schnorr Fiat-Shamir is 128-bit soundness (collisions / grinding). `blake2b_224` provides ~112-bit collision resistance.

- **Discrete-log extractor soundness** still inherits BLS12-381 G1's ~128-bit classical security, so the practical posture is unchanged.
- **Grinding (adaptive proof-of-knowledge attacks)** are bounded by ~2¹¹² — still well out of reach, but below the common target.

Recommendation (non-blocking): if a future validator rev is ever spun up, consider `blake2b_256` for a clean 128-bit margin. Note that the off-chain prover in `seedelf-crypto` must match exactly; do not change unilaterally. Previous commits (`e930657`) chose 224-bit intentionally for cost — this is a deliberate, documented trade-off, not a defect.

### 2.2 [Info] No explicit subgroup check on input points

`g1.decompress` validates that bytes encode a curve point but does **not** enforce prime-order-subgroup membership. As discussed in §1.2, bad points yield dead UTxOs rather than exploitable verifications. Explicit on-chain subgroup checks would cost additional execution units and are omitted on purpose; the safety falls on the off-chain constructor.

### 2.3 [Info] Scalar deserialization of `z_b`

`scalar.from_bytes(z_b)` interprets arbitrary-length big-endian bytes and reduces mod the scalar field prime. Multiple distinct `z_b` values map to the same scalar; this is benign for Schnorr (the verifier checks a group equation after reduction, so all representatives verify identically). No malleability vector that doesn't already require knowledge of `x`.

### 2.4 Fiat-Shamir domain

`c = H(g ‖ g_r ‖ u ‖ vkh)` — all four values are included and in a fixed order. Since `g` and `u` are the register fields and `g_r`/`vkh` are prover-chosen, this binds the proof to the specific register and the specific one-time pad. ✔.

### 2.5 Test coverage

Positive, negative, and randomization tests are present (`valid_schnorr_proof`, `randomized_valid_schnorr_proof`, `invalid_schnorr_proof` (expect-fail), `torsion_point` (expect-fail)). Consider adding explicit expect-fail tests for:

- `public_value` = identity,
- `generator` = identity,
- a proof that omits `vkh` from the hash input (ensures domain-separation bug would be caught).

---

## 3. seedelf.ak — Minting policy

### 3.1 [Low] Single-entry `mint` constraint

```aiken
expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> = mint |> assets.flatten()
```

`mint` is the whole-tx multi-asset value. This pattern forces the entire tx to have exactly **one** minted/burned asset line. Consequences:

- Cannot mint two seedelf NFTs in one tx.
- Cannot mint a seedelf NFT and a user token (e.g. for fund-send) in the same tx.
- Cannot mint-and-burn simultaneously.

This is safe (over-restrictive rather than permissive) but is a **composability cost** worth surfacing. If batch-minting many seedelfs is ever desired, this check must be rewritten to filter by `policy_id` first, then validate each row.

### 3.2 [Info] Burn branch only checks prefix

Burn requires `(pid == policy_id)` and `bytearray.take(tkn, 4) == seedelf`. The `amt == -1` branch means exactly one burn. Anyone holding a `5eed0e1f…` token under this policy can burn their own — intended, since these are locator NFTs.

### 3.3 [Info] Mint uniqueness

Token name = `generate(first_input.txid, first_input.idx, 5eed0e1f, personal_tag)`. Since Cardano orders inputs lexicographically by `(txid, idx)` and every consumed UTxO is unique, the derived name is globally unique per mint. An attacker cannot pre-image collide or replay a past name because they must also consume the exact same UTxO (impossible twice). ✔.

### 3.4 [Low] `idx > 255` makes mints infeasible

`bytearray.push(txid, idx)` prepends `idx` as a single byte. Stdlib raises for `idx` outside `[0, 255]`. If the first-input UTxO's `output_index` exceeds 255, the validator aborts. In practice, protocol limits on outputs per tx cap this well below 255, so the risk is theoretical; but note that **future protocol parameter changes** could make this reachable. Consider encoding `idx` as a full varint if robustness across parameter upgrades is desired.

### 3.5 Redundant but harmless

Both branches check `pid == policy_id`. In `assets.flatten()` output filtered to one entry, the `pid` is whatever the aggregate contains; if the tx mints under a *different* policy, the `pid` there is not this policy — the equality check catches it. Good defensive style.

---

## 4. token_name.ak

Token-name construction is correct. The `rollover_attack` test (expect-fail) confirms distinct `idx` values in `[0, 255]` produce distinct names. The `bytearray.slice(0, 31)` keeps names at 32 bytes under realistic inputs (`prefix + trimmed_personal + prepend_index` ≥ 33 bytes when `prefix ≥ 0` and `txid` is 32 bytes).

[Info] If `prefix` is shorter than 4 bytes in some future call-site, the `5eed0e1f` prefix invariant asserted elsewhere (e.g. the burn check) could mismatch. Today only `seedelf` (4 bytes) is used, so this is not exploitable — but the function itself doesn't enforce a minimum prefix length. Worth a one-line comment.

---

## 5. always_false.ak

Intentionally perma-locks value. The bytes of its `else(_) { fail }` mean there is no purpose under which it succeeds. Confirmed behavior:

- Any UTxO sent there with ADA or tokens is irrecoverable.
- Reference-script UTxOs are cheap to keep (min-UTxO ADA only) and are the intended use case.

Operational recommendation: document that users should **never** send value or tokens to this address beyond the min-UTxO required for a script reference. Consider a wallet-side guardrail.

---

## 6. Cross-cutting items

### 6.1 Purpose restriction (`else(_) { fail }`)

Both `wallet` and `seedelf` lock out all non-intended purposes (cert publish, withdraw, vote, propose). ✔. `always_false` has *only* the `else` and therefore also fails for spend — correct perma-lock.

### 6.2 Seed parameter `_any: Data`

Each validator accepts a `Data` parameter that is unused in logic but baked in at `aiken blueprint apply` time. This gives a hash-only versioning lever (the `acabcafe` constant in `compile.sh`). Safe and common. Ensure `_any` is never accidentally referenced in future edits — the underscore prefix currently guards this.

### 6.3 Toolchain pinning

`aiken.toml` pins compiler `v1.1.19`, Plutus `v3`, and stdlib `v3.0.0`. Good. Any stdlib upgrade should re-run the full test suite and **diff the resulting script hashes** against `hashes/` before release, because a stdlib change could silently alter generated UPLC.

### 6.4 No on-chain randomness / oracle dependency

All randomness is user-supplied. No block-header or slot-based surface. ✔.

### 6.5 Datum vs. redeemer trust

The datum (`Register`) is chosen by the *sender* of a UTxO, not the recipient. A malicious sender can deposit to a malformed / identity / torsion register and then *claim* that they gifted value — the "gift" is either trivially claimable by them or locked. This is a **social** concern, not a contract concern; the recipient's wallet must verify the register before treating an incoming UTxO as spendable. Reinforce this check off-chain.

---

## Recommendations (ranked)

1. **Keep off-chain point validation strict.** `is_torsion_free` + non-identity checks on both `generator` and `public_value` must be unconditional in `seedelf-crypto` / `seedelf-core` before publishing a register. A single lapse produces dead UTxOs with no on-chain recourse.
2. **Add expect-fail unit tests** in `lib/schnorr.ak` for identity-point attempts (§2.5). Cheap insurance against future refactors.
3. **Document the "one mint per tx" restriction** of `seedelf.ak` in user-facing docs (§3.1). If batch-mint is ever a product requirement, plan a v2 policy rather than patching in place.
4. **Guardrail the GUI/CLI** against sending assets to the `always_false` address beyond the minimum reference-script min-UTxO (§5).
5. **Consider blake2b_256 for Fiat-Shamir** in a future validator version if 128-bit soundness is a marketing/audit requirement (§2.1). Current 224-bit choice is a deliberate cost trade-off.
6. **Add a stdlib-upgrade checklist** to the release process: rebuild, re-test, diff `hashes/` (§6.3).

---

## Closing

The contracts are small, purposeful, and coherent with the stated hyperstructure philosophy. All "unexpected input → spendable" branches are deliberate and documented. The one perma-lock (`always_false`) is appropriately narrow. Replay protection via the `vkh` one-time pad plus tx-body signatures is structurally correct. Residual risk is concentrated **off-chain**, where register construction must guarantee prime-order, non-identity G1 points — the on-chain code cannot compensate for an off-chain failure there, by design.
