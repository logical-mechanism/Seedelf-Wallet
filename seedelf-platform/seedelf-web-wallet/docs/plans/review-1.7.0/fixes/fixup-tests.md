# Fix-up lane "tests": report

The cross-area review's tests lens, four findings. Named here in task order: tests#0 (the critical-translation guard), tests#1 (314-wasm#0's vacuous assertion), tests#2 (317-wallet#0's check), tests#3 (the roadmap's claimSubmit sentence).

Tree `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`. Mutations ran only in a copy under `scratchpad/fix/fixup-tests/copy/`, deleted after.

**Files changed in W:**
- `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-discovery-review-fixes.test.ts`
- `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-discovery.test.ts`
- `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md`

**No source, locale or provenance file changed.**

## tests#0 (low): the guard checks critical keys by name: deferred to the lead

**Reproduced in the copy.** Two verified critical values were changed to say the opposite:
- es `lj.tail.privacy.wayOut`'s first sentence became "La mezcla del colateral ya se hizo."
- ja `settings.koiosOnly.privacy.off`'s new sentence became "ウォレットは Koios に何も問い合わせません。"
- `i18n.test.ts` still passed 24 of 24, and `i18n-critical-helpers.test.ts` 62 of 62.
- Only a key's presence in `verified.keys` is checked (`i18n.test.ts:199-203`).

**Not changed, for two reasons:**
- **The release half is the lead's.** The FIXBRIEF keeps `verified-critical-*.json` for the lead's blind back-translations.
- **The guard half needs those same files.** Each verified value must be recorded beside its key, and the reviewer marked this part "later".

**For the lead, before the commit: four values need a blind back-translation.** The FIXBRIEF says "A test will fail until that's done". That holds only for a new critical key. For a changed one, nothing fails, so CI won't remind you.

The four values, as they now read (no English, for a blind reader):

- es `lj.tail.privacy.wayOut`: "La mezcla del colateral aún no se ha hecho. Si traes el resto de vuelta sin ella, su caja de 5 ₳ se queda en el pool sin mezclar, vinculada con esta sesión, hasta que la vuelvas a mezclar."
- ja `lj.tail.privacy.wayOut`: "コラテラルのミックスはまだできていません。それを待たずに残りを取り戻すと、5 ₳ のボックスはミックスされないまま、このセッションと結び付いた状態でプールに残ります。もう一度ミックスするまでそのままです。"
- es `settings.koiosOnly.privacy.off`: "Responde primero el servidor propio de Seedelf Wallet, y Koios cuando este no puede. La billetera también consulta a Koios sobre cada pool nuevo de Lovejoin. Lo que lee la billetera no le revela a ninguno de los dos qué Seedelfs son tuyos."
- ja `settings.koiosOnly.privacy.off`: "まず Seedelf Wallet 自身のサーバーが応答し、応答できないときは、ウォレットが Koios を使います。新しい Lovejoin のプールについても、ウォレットは Koios に問い合わせます。ウォレットの問い合わせからは、どちらも、どの Seedelf があなたのものかは分かりません。"

**The list is complete.** I compared every key in `critical-keys.json` between `6bca8bec` and `W` (at about 21:50):
- Exactly these four values changed.
- No new critical key appeared.
- Script: `scratchpad/fix/fixup-tests/critical_diff.py 6bca8bec W`.

**History: has the gap let anything through before?** I checked every first-parent commit on `main` that changed a critical es or ja value already listed as verified (`history_check.py`).
- Each one also changed that locale's verified-critical file in the same PR. That covers 11 PRs, from #276 to #324.
- Within 1.7.0's #325 to #338, the only critical change is #337's new `lj.tail.privacy.wayOut`, recorded with it.
- So, at PR granularity, the name-only guard has never let a value ship unverified. This round's four would be the first.

**The guard, as an owner's call** (in `owner_calls`): store a sha256 of each verified value in a `values` map beside `keys` in `verified-critical-{es,ja}.json`. The test then treats a key whose current value no longer matches as unchecked.
- To start it, take `6bca8bec`'s values for every key unchanged since then. The history above supports that.
- The four values get their hashes when the lead records this round.

## tests#1 (low): 314-wasm#0's "left out of the data layer's list" assertion: fixed

**Failed before.** In the copy, `refresh()`'s script rows were given `inline_datum: null` (`lovejoin-pools.ts:476-478`). That emulates an offline check that lets the deep-datum pool through.
- The test still passed, 3 runs of 3.
- `known()` was read before `confirm()`'s check, which `refresh()` doesn't wait for, had kept the pool.

**Fix:** the second call (`:127`) is now `await found.look("preprod")`, which waits for Koios's check. The comment says why.

**Passes now:**
- On `W`: 2 of 2, 5 runs of 5 on two CPUs.
- In the copy under the same mutation it fails, 3 runs of 3, with `AssertionError: expected [ { …(5) } ] to deeply equal []` at `:128`. That's the finding's reason.
- The trap half is still pinned. With the offline verify made to trap on the deep datum, the same test fails.

**The test:** `lovejoin-discovery-review-fixes.test.ts`, "a launch's script under a datum too deep to read (1.6.0's release review, 314-wasm#0) > leaves its pool out of the data layer's list, and the module whole".

## tests#2 (nit): 317-wallet#0's list-contradiction check: fixed

**Failed before.** With `lovejoin-pools.ts:471`'s check deleted in the copy, all 27 tests stayed green. The test's Koios knew no launch, so nothing could be kept either way.

**Fix:** in the test's loop over the two contradicting lists:
- Koios knows the launch: `const k = koiosOf([], [launch()])`.
- Each list is read by `look()`.
- `expect(k.calls.map((c) => c.path)).toEqual([])` sits beside the `known()` check. That's the file's own form, as at `:322` and `:389`, and gives a readable failure.
- The comment's "nothing is asked of Koios about it" is now asserted.

**Passes now:**
- On `W`: 27 of 27, 5 runs of 5 on two CPUs.
- In the copy, each half of the check is pinned:
  - **Whole check deleted:** fails at `:349`. The list that names another launch is kept.
  - **Only the launch half kept:** fails at `:350`, `expected [ 'utxo_info' ] to deeply equal []`. The list with a script elsewhere is asked of Koios.
  - **Only the scripts half kept:** fails at `:349`.

**The test:** `lovejoin-discovery.test.ts`, "the data layer's list" > "leaves out a pool whose launch, or a script of it, isn't its reference UTxO's own transaction (1.6.0's release review, 317-wallet#0)".

## tests#3 (nit): the roadmap still listed claimSubmit's trap as open: fixed, docs only

**Checked against the code:**
- `sessions.ts:3211` has `if (isTrap(e)) throw e;` in `claimSubmit`'s per-return catch.
- The request's `answerUi` (`sw.ts`) locks on a trap.
- `session-trap.test.ts` pins it: "ends Bring everything back's Send with a trap in a chain's sending, sends no other return on it, and the lock cuts that chain".

**Changed:** in `docs/post-release-roadmap.md:390`, item 3's ✅ entry. The "Left: Bring everything back's send (`claimSubmit`) …" sentence now reads "So does one under Bring everything back's send (`claimSubmit`), which sends no other return on the broken module (1.7.0's review of the fixes, worker#0)."
- No other doc describes the gap (I searched `docs/*.md` and `docs/store/*.md`).
- No test reads the roadmap.

## Runs on W

- `lovejoin-discovery` 27/27.
- `lovejoin-discovery-review-fixes` 2/2.
- `lovejoin-merged-review` 42/42.
- `lovejoin-pools-head-start` 2 passed, 2 skipped.
- `i18n` 24/24.
- `npm run typecheck` is clean.

## For the docs lanes and the lead

- **Strings added or changed:** none.
- **Critical keys changed by this lane:** none. The four values above belong to the tail and docs-design lanes.
- **e2e specs edited:** none.
- **WebAssembly node tests added:** none.
- **Docs:** the roadmap line above is done. Nothing else in the docs follows from this lane.
- **Scratch:** the scripts are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/fix/fixup-tests/`: `mut.py`, `critical_diff.py`, `history_check.py`, and the mutation texts `m*.old`/`m*.new`. The copy is deleted. Rebuild it with the REVIEWBRIEF's rsync, plus `seedelf-core/tests/fixtures/` beside it, which `tests/fakes.ts` reads.
