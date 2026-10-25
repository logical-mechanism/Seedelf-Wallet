# 1.6.0 review findings (HEAD 499768f6)

Each section: `## <id>`. grep -n '^## <id>' to find one.

## 314-wasm#0

**high · confirmed · security** — A deeply nested datum on a launch's script output breaks the WebAssembly during pool verification, and the wallet then locks itself

At `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:149`

**Detail.** The two kinds of row a pool names are guarded differently:
- **The reference row is guarded.** protocol_of (wasm/src/lovejoin.rs:102-158) resolves it with eval::resolve_row (line 106). resolve_row calls refusal(), which refuses a datum nested past cbor::MAX_DEPTH.
- **Script rows are not.** Each one goes through seedelf_core::eval::resolve_reference (line 149; seedelf-core/src/eval.rs:89). That skips refusal() and copies the row's inline datum in unchecked.

How the datum gets decoded:
- verify_pool calls pool_of. Its held() closure (seedelf-core/src/lovejoin/pool.rs:391-395) decodes every script row with post_alonzo (pool.rs:268, minicbor::decode::<TransactionOutput>).
- That decode walks the inline datum recursively, one call per nesting level.

Why a launcher can do this: one_shot_mint checks only the reference output. The chunk-34 plan says it "finds its output with list.find, so other outputs at the holder in the same transaction are fine". So whoever launches a pool can put any datum on the mix_box or mix_logic reference-script outputs.

Both discovery paths pass those rows to WebAssembly with the datum attached:
- **Data layer:** its pool list carries each script row's `datum` (seedelf-data/api/src/chain.rs:137 selects `encode(d.bytes,'hex') as datum`; routes.rs:63 ScriptRow flattens Row). refresh() maps the rows through utxoOf (private-index.ts:399) into lovejoinVerifyPool (lovejoin-pools.ts:436-441).
- **Koios holder look:** it passes every holder row of the launch that has a reference script (lovejoin-pools.ts:496) to lovejoinLaunchCheck (lovejoin-pools.ts:513).

What happens in the extension:
1. In V8 the overflow surfaces as a RangeError. isTrap (wasm.ts:42) doesn't count a RangeError as a trap, so tried() swallows it.
2. Rust's shadow stack pointer is not restored when the exception unwinds, so the instance's next call traps with "memory access out of bounds".
3. That trap reaches answerUi (sw.ts:378), which calls wallet.trapped() and locks the wallet.

The pool read ours() (lovejoin.ts:2658) calls readSet without quiet, which refreshes the list. It runs in the withdraw run at unlock for any wallet with something open in Lovejoin (lovejoin.ts:5524), on the Lovejoin page and in mixes.

**Scenario.** 1. A stranger launches a pool that passes as standard and is the earliest of its values, so it is shown:
   - a listed token at a box value nobody has used, say DJED;
   - the launch puts mix_box and mix_logic at the holder and registers L;
   - the mix_box script output also carries a datum of 3,000 nested one-item lists, about 3 KB.
   That costs roughly 37 ₳ locked plus fees, and the transaction stays under 16 KiB.
2. The data layer lists the pool.
3. Any mainnet 1.6.0 wallet whose pool read refreshes the list breaks its WebAssembly on lovejoinVerifyPool. Its very next WebAssembly call traps and the user sees: "The wallet's core stopped working, so the wallet locked itself. Unlock it to carry on." The refresh runs:
   - in the withdraw run right after unlock, for anyone with boxes, chains or schedules in Lovejoin;
   - when the Lovejoin page opens;
   - when building a mix.
4. It repeats at the next refresh: 5 minutes later, or immediately after the MV3 service worker restarts.
5. Turning on Koios-only, or a data-layer outage, only moves the problem. The Lovejoin page's Koios look keeps nothing from a look that fails, so it breaks on every open. On preprod that look is the only path.

No money moves. But the wallet keeps locking itself and, for users, there is no way out until a store release. The owner can only stop mainnet's default path by changing the data layer.

**Confirmed how.** Read the code, then ran a throwaway Vitest test (tests/zz-review-314-wasm-deep.test.ts, now deleted) against the pkg built from HEAD.
- **Baseline:** the preprod LJTEST pool fixture, with its two scripts at the holder named by hash, verifies with scriptsInline 0.
- **Deep datum through lovejoinVerifyPool:** the same pool with inline_datum bytes "81"×N+"00" on the mix_box row.
  - N=500, 1,000 and 2,000 verify, and lovejoinUsable still answers.
  - N=3,000 and 4,000: the call throws "RangeError: Maximum call stack size exceeded" (not an instanceof WebAssembly.RuntimeError). The next clean lovejoinVerifyPool then throws "RuntimeError: memory access out of bounds".
- **Koios path:** lovejoinLaunchCheck with Koios-style rows (script bytes given) at N=3,000 gives the same RangeError, then the same trap.

**Suggested fix.** - **Wallet:** refuse or skip a script row whose datum is nested past cbor::MAX_DEPTH before anything decodes it.
  - In protocol_of: skip the row, so the script reads inline and the pool is not shown, or refuse the pool outright.
  - Better, in core: have eval::resolve_reference apply refusal()'s depth check (orders.rs calls it too), and have pool_of's held() call cbor::within_depth before post_alonzo.
- **Data layer:** a standard launch's script outputs never need a datum. The data layer could leave such pools out, or drop `datum` from ScriptRow, so mainnet's default path stops at once.
- Per CLAUDE.md, a change to the shown-pool rule changes both sides in the same PR. The wallet-side guard is what protects the Koios path.

**Test idea.** In wasm/tests/lovejoin-pools.test.mjs, next to "a stranger's deep datum at the holder, named as a pool…":
- Call lovejoinVerifyPool, and lovejoinLaunchCheck with script bytes given, where atHolder(1, MIX_BOX) carries inline_datum {bytes: "81".repeat(3000)+"00", value: null}.
- Assert that neither throws a RangeError: each either refuses in words or reads the script as inline.
- Then assert that a lovejoinVerifyPool of the clean poolRef still returns version tokenV1.

Today it fails with the RangeError, followed by "memory access out of bounds". A Rust test can't catch a stack overflow, so this has to be a node test.

**Skeptic (confirmed, high).** The finding holds on HEAD, and I reproduced it.

**Why the deep datum gets through**
- A pool's script rows skip the depth guard that its reference row gets. protocol_of runs the reference row through resolve_row, which calls refusal(). Each script row goes through resolve_reference, which only copies the inline datum in.
- verify_pool then calls pool_of, whose held() decodes every script row with post_alonzo, a recursive minicbor decode that walks into the datum.
- On chain, nothing stops the datum. one_shot_mint checks only the reference output, and the plan records that "other outputs at the holder in the same transaction are fine".
- The data layer doesn't stop it either. Its standard check ignores the script rows' datums. Its launch query selects `datum` through row_columns, and ScriptRow flattens Row. utxoOf turns that into inline_datum, and refresh() verifies every listed pool again on each refresh.
- On Koios, trimmed() keeps the datum bytes, and the holder look hands the launch's script rows to lovejoinLaunchCheck.

**What my throwaway test showed** (pkg built from HEAD)
- Up to N=2,500 nested levels, the pool verifies. At N=3,000, 5,000 and 9,000, lovejoinVerifyPool throws a RangeError with isTrap false, so tried() swallows it. lovejoinLaunchCheck in Koios's shape fails the same way.
- On a fresh module, one deep call leaves the stack pointer at 18,800 of 1,048,576. The next clean verify then throws "memory access out of bounds", which isTrap counts.
- Through PoolDiscovery.refresh, a deep pool listed by the data layer was swallowed quietly.

**Two corrections to the report**
- "The very next call traps" depends on the module's state. On a warmed module, the first deep call left 119,360 bytes and the next clean verify passed. The second deep call then trapped outright, with the stack pointer at -128. Either way the instance breaks within a refresh or two.
- The first trap can be swallowed: by readSet's `.catch` on deps.pools, or by runNetworks' `.catch` around withdrawDue. The instance stays broken, though, so the next UI request that uses WebAssembly reaches answerUi or wallet.serial and the wallet locks itself.
- Also, the Koios look doesn't fail outright. It keeps its height, but RESCAN_BLOCKS re-reads the launch at each later look while it is the newest activity at the holder.

**Who is hit**
- The run at unlock reads the pools whenever anything is open in Lovejoin. In 1.6.0 that includes each private session's collateral box in the 5 ₳ pool, so this reaches most active users, not only people who mix.
- The attack costs roughly 40 ₳, locked at the always-false holder, and it lasts for good: a shown pool stays listed.
- The owner can stop the data layer path with a deploy. Koios-only, data-layer outages and preprod still need the wallet fix, and with Koios-only on, the Lovejoin page's look still hits it.

**Why it isn't owner-call or already fixed**
- The docs treat a stranger's deep datum as a threat to guard against (plan lines 322 and 495, deep.test.mjs). Nothing accepts the risk for script rows.
- The existing test covers only the reference row.

That makes it high: a repeated self-lock for many users, and boxes stuck on the default path until a fix ships.

Evidence: - **Code on HEAD:**
  - seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:106 (resolve_row, guarded) against :149 (resolve_reference, unguarded).
  - seedelf-platform/seedelf-core/src/eval.rs:56-74 (refusal: reference script, depth), :78-83 (resolve_row), :89-94 (resolve_reference, no refusal).
  - seedelf-platform/seedelf-core/src/lovejoin/pool.rs:268-269 (post_alonzo is minicbor::decode::<TransactionOutput>), :391-400 (held() decodes each script row).
  - seedelf-data/api/src/chain.rs:137 (`encode(d.bytes, 'hex') as datum`); seedelf-data/api/src/lovejoin/db.rs:102-112 (the launch's holder outputs, with row_columns); seedelf-data/api/src/lovejoin/routes.rs:63-68 (ScriptRow flattens Row); seedelf-data/api/src/lovejoin/standard.rs pool_of (no check on the script rows' datums).
  - extension/src/background/private-index.ts:399 (inline_datum from row.datum), :159 (isRow checks only that it's hex).
  - extension/src/background/lovejoin-pools.ts:243-250 (tried swallows a non-trap), :431-442 (refresh verifies every listed pool), :496 and :512-514 (Koios look); extension/src/background/koios.ts:67-72 (trimmed keeps the bytes).
  - extension/src/background/wasm.ts:42-45 (a RangeError isn't a trap); extension/src/background/lovejoin.ts:2262 (readSet's catch), :5519-5524 (the unlock run reads pools when anything is open); extension/src/background/runs.ts:68; extension/src/background/sw.ts:371-381 (answerUi locks on a trap).
  - docs/plans/chunk-34-token-pools.md:201 ("other outputs at the holder in the same transaction are fine"); wasm/tests/lovejoin-pools.test.mjs:77-83 (deep datum tested on the reference row only).
- **Throwaway Vitest test** (tests/zz-review-314-wasm-skeptic.test.ts, deleted), datum "81"×N+"00" on the mix_box row, named by hash as the data layer names it:
  - N=130, 1000, 2000, 2500: ok, scriptsInline=0.
  - N=3000, 5000, 9000: "RangeError: Maximum call stack size exceeded", trap=false.
  - Fresh module: stack pointer 1048576 before, 18800 after; the next clean verify gave "RuntimeError: memory access out of bounds", trap=true.
  - Warmed module: stack pointer 119360 after; the clean verify passed; the second deep call gave "RuntimeError: memory access out of bounds" with the stack pointer at -128.
  - lovejoinLaunchCheck with script bytes, N=3000 and 5000: the same RangeError.
  - PoolDiscovery.refresh with a fake index listing [deep, clean] on a warmed module: the deep pool was dropped silently and known=1.

**Reproduction (confirmed, high).** Throwaway Vitest test, extension/tests/zz-review-314-wasm-repro.test.ts (now deleted), run alone against wasm/pkg built from HEAD.

**What it asserted.** It asserted what a fixed wallet should do: a deep datum on a script row is refused in words or read as no reference, the module stays whole, and the wallet stays unlocked. Both tests failed on HEAD.

**What it printed**
- Baselines held:
  - The fixture pool (PR #163's LJTEST pool), with both scripts at the holder named by hash as refresh() builds them, verifies with scriptsInline 0.
  - A 100-level datum on mix_box's row also verifies, so nothing refuses a datum on a script row.
  - The same listing with no datum is verified and kept by PoolDiscovery.refresh.
- The reference row is guarded. With a 3,000-level datum it is refused in words ("…holds a datum the wallet can't read", isTrap false), and the stack pointer stays at 1,048,576.
- The script row is not guarded. These are lovejoinVerifyPool calls on a reset instance, with "81"×N+"00" on mix_box's row:
  - N=2,000: passes.
  - N=2,500, 3,000, 4,000 and 9,000: "RangeError: Maximum call stack size exceeded" (isTrap false). The shadow stack pointer is left at 92,640–102,720 of 1,048,576. The next clean verify passed. A second deep call then trapped ("memory access out of bounds", stack pointer -48 or -304), and every call after that trapped.
  - In one run, N=2,500 passed on its first call, so the threshold depends on the engine's state.
- Koios's shape fails the same way: lovejoinLaunchCheck with the scripts' bytes given, at 3,000 levels, threw a RangeError (isTrap false).
- End to end (first test, fresh module, then a wallet created):
  - PoolDiscovery.refresh read a fake data-layer list whose mix_box script row has a 3,000-level datum. It rejected with "RuntimeError: memory access out of bounds" (stack pointer 1,048,576 → -192), and the pool was not kept.
  - REFRESH_MS later, the next refresh trapped again.
  - The wallet's next call under its queue (withKeys → baseRegister) threw WalletLocked: "The wallet's core stopped working, so the wallet locked itself." State was locked, lockReason "trap", and one fresh instance was made.

**Trace on HEAD**
1. Data layer:
   - seedelf-data/api/src/lovejoin/db.rs:102-113 selects row_columns for the launch's script outputs at the holder; chain.rs:137 includes `encode(d.bytes,'hex') as datum`.
   - row.rs:56-57 serializes the datum, and routes.rs:62-68 ScriptRow flattens Row.
   - standard.rs:228-237 checks only the script hashes, so the pool is listed.
2. Wallet, data-layer path:
   - lovejoin-pools.ts:431-441 maps each script row through utxoOf (private-index.ts:399 sets inline_datum {bytes, value: null}) and overrides only reference_script.
   - :450 then calls tried(lovejoinVerifyPool).
3. Wallet, Koios path:
   - koios.ts:67-72 trimmed() keeps the datum bytes.
   - lovejoin-pools.ts:496 passes every holder row of the launch that has a reference script, and :512-514 calls lovejoinLaunchCheck.
4. WebAssembly:
   - wasm/src/lovejoin.rs:106 resolves the reference with eval::resolve_row, which runs the depth guard (eval.rs:54-84).
   - :149 resolves each script row with eval::resolve_reference (eval.rs:89-94), which skips refusal(). resolve() copies the datum in as-is (eval.rs:133-137, 155-163).
5. Decode: lovejoin::verify_pool (pool.rs:369) → pool_of → held() (pool.rs:391-401) → post_alonzo (pool.rs:268-272), a recursive minicbor decode of TransactionOutput through the datum.
6. Error handling:
   - A RangeError is not a trap to isTrap (wasm.ts:42-45), so tried() (lovejoin-pools.ts:243-249) swallows it, leaving the instance's stack pointer leaked.
   - A trap is rethrown, but readSet's `.catch` on deps.pools (lovejoin.ts:2262) and runNetworks' `.catch` around withdrawDue (runs.ts:68) swallow it without a reset.
   - The broken instance's next call under answerUi (sw.ts:375-381) or wallet.serial (wallet.ts:577-588) locks the wallet.
7. Reach: ours() (lovejoin.ts:2658) calls a non-quiet readSet, which runs in withdrawDueNow at unlock whenever something is open in Lovejoin (lovejoin.ts:5521-5525). The Lovejoin page's look and mixes reach it too. The repeat timing is set by `asked`, which is kept in memory (lovejoin-pools.ts:407-415): every REFRESH_MS, and at once after each worker restart.

Why: The finding holds on HEAD, and I reproduced it on my own.

**The cause.** A pool's reference row is depth-checked, but its script rows are not. They reach a recursive decode with whatever datum the launch put on them. Both discovery paths carry that datum to WebAssembly: the data layer's list, and Koios's holder look.

**What a user sees.** Once such a pool is listed:
- Any mainnet wallet with something open in Lovejoin breaks its WebAssembly at the pool read. Since 1.6.0 that includes every private session's collateral box in the 5 ₳ pool.
- The wallet then locks itself with "The wallet's core stopped working…".
- This repeats at each refresh: every 5 minutes, and at each start of the service worker. Boxes due back don't come back while it goes on.
- Koios-only mode and preprod hit the same thing through lovejoinLaunchCheck when the Lovejoin page opens.

No money moves. But many users get stuck in a self-lock loop with no way out until a release, which makes this high. The owner can blunt mainnet's default path with a data-layer deploy, but not the Koios path.

**Corrections to the report**
- Whether the first deep call shows up as a swallowed RangeError or as a direct trap depends on the engine's state. My first, fresh-module run trapped outright inside refresh, and tried() rethrew it. On a reset instance with warmed code it was a RangeError that leaked about 90% of the 1 MiB shadow stack, and the second deep call trapped. Either way the instance breaks within one or two deep calls.
- The depth threshold also moves with the engine's state: N=2,500 passed once and failed once. A fix must be depth-based (cbor::MAX_DEPTH), not tuned to a number.

**Nothing on HEAD stops it:**
- No later PR guards script rows.
- The existing test (wasm/tests/lovejoin-pools.test.mjs, "a stranger's deep datum at the holder…") covers only the reference row.
- The docs treat a stranger's deep datum as a threat (cbor.rs header, deep.test.mjs), so this is not an owner call.

**Also checked and sound:**
- The reference row's guard (resolve_row → refusal → within_depth).
- trimmed() dropping Koios's deep JSON `value`, so JSON.stringify is safe.
- serde never sees deep JSON.
- The bundled head-start pools' script rows (both preprod pools) and PR #163's fixture carry no datum.
- orders.rs:793, the other resolve_reference caller, reads only pinned DEX reference UTxOs, which no stranger can change.

**Fix notes.** **1. Fix it in core, in one place.**
- In seedelf-core/src/eval.rs:89, have resolve_reference apply the datum-depth part of refusal(), not its reference-script refusal, since these rows carry scripts by design.
- That covers wasm protocol_of (lovejoin.rs:149) and orders.rs:793.
- Also have pool.rs's held() (391-401) and anything else that decodes a script_refs row call cbor::within_depth(.., MAX_DEPTH) before post_alonzo. verify_pool and pool_of are pub and take a Resolved from any caller.

**2. Skip the row; don't strip its datum.**
- In protocol_of, skip such a row (`continue`) rather than fail the request. The script then reads as not held, so scriptsInline is ≥1.
- discovery's verified() (lovejoin-pools.ts:451) and the Koios look (:515) require 0, so such a pool is never shown, and Lovejoin requests that name it stay readable.
- Don't strip the datum and keep the row. The chain's script context carries the output whole, so locally measured budgets would differ, and uplc would recurse on it again.

**3. Change both sides of the shown-pool rule together.** Today the data layer lists such a pool (db.rs:102-113, chain.rs:137, routes.rs:62-68; standard.rs:228-237 ignores script rows' datums).
- With the wallet fix, the two sides disagree on "standard" for it. Per seedelf-platform/CLAUDE.md, change both sides in the same PR and re-record lovejoin-pool-vectors.json and lovejoin-shown.json.
- The rule "a script row's datum within MAX_DEPTH" (or "no datum") drops no known pool: the head start's preprod pools and PR #163's rows have none.
- The quick lever for mainnet's default path is a data-layer deploy that drops such pools, or `datum` from ScriptRow, which the wallet doesn't need. Koios-only mode, data-layer outages and preprod still need the wallet fix.

**4. Defense in depth, which doesn't replace the guard.** isTrap (wasm.ts:42-45) treats every RangeError as harmless, but a RangeError thrown out of a WebAssembly call leaves `__stack_pointer` leaked, so the instance is broken.
- In tried() (lovejoin-pools.ts:243) and verifiedPool (lovejoin.ts:2283-2290), JSON.stringify sits inside the same try.
- Stringify first, then count a RangeError from the WebAssembly call itself as a trap.
- That turns silent corruption into an immediate, honest lock, but it doesn't stop the repeat.

**5. Know where traps get swallowed.** readSet's `.catch` on deps.pools (lovejoin.ts:2262) catches traps too, and runNetworks (runs.ts:68) swallows withdrawDue's errors. A broken instance then shows up later, at sw.ts:378 or wallet.ts:582.

**6. Tests.** This needs node tests: a Rust test can't catch a stack overflow.
- In wasm/tests/lovejoin-pools.test.mjs: lovejoinVerifyPool, and lovejoinLaunchCheck with the bytes given, with a datum on atHolder(1, MIX_BOX) at 3,000 and at 100,000 levels.
  - Assert each answers in words or with scriptsInline ≥1.
  - Make each deep call twice, since the first can pass or only leak.
  - Then assert the clean poolRef still verifies as tokenV1.
- In lovejoin-discovery.test.ts: give the listed mix_box row such a datum. Assert that refresh resolves, the pool isn't kept, and a clean call still answers.

## 316#0

**high · confirmed · privacy** — Two Bootstraps in one pool: a box brought back by hand is credited to the oldest one, whose own boxes then stop being held and come back by themselves

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1989`

**Detail.** countBack(bootstrap=true) picks its target from openIn(s, p, true), sorted by `at`, so it always takes the oldest open Bootstrap in the pool, whatever deposit the box sat at (lovejoin.ts:1987-1989). bootstrapOf holds, per pool, as many boxes as the open entries have out. It takes boxes at the deposits of entries still open first, then only boxes no record accounts for (`!known(b)`, 2060-2067). Once the older entry closes, its deposit leaves `deposits`. Its boxes are `known` (from its chain record, or from `leaves` kept after the record goes), and at depth 0 they are leaves, not 'not mixed yet'. So they are simply free: scheduleFound (4314) draws them due times, and withdrawDueNow sends them. The page's Bring one back takes `pool.bootstrap.at(-1)` (ui/screens/Lovejoin.tsx:742), and the held list follows the listing's order. The data layer lists oldest first (`order by o.id`, seedelf-data/api/src/lovejoin/db.rs:50; Kupo sorts by place). So each by-hand return takes the newest Bootstrap's box while crediting the oldest. Once the older Bootstrap's chain record is gone (RECORD_KEEP_MS after its deposit, so nearly always before boxes are brought back), depositAccountOf (1843) finds neither its record nor its closed entry. A public Bootstrap's box then comes back with no `ties`. Meanwhile held() (5429-5466) still counts the newer entry's out as held, so Home shows those same boxes both on their way back and held. A related gap with the same root: before a Bootstrap's deposit is listed (entry not `found`), bootstrapOf holds the wallet's other unknown boxes in its place. A run in that window trims their due times (5545), and they are redrawn later.

**Scenario.** Nobody has mixed in a new token pool yet. The user puts 2 boxes in with a public Bootstrap (B1), and 2 more a minute later (B2). Later they press Bring one back twice on the pool's page. Both times B2's newest box goes, and B1's entry is credited. B1's entry closes while both its boxes are still where its deposit put them. The next read shows no held boxes for the pool and gives B1's two boxes due times. Home now shows 2 boxes on their way back and 2 held, while the wallet has only 2 there. Within the delay, B1's unmixed deposit boxes come back into the private balance by themselves, tying the public account to the private balance on chain. Their history entries carry no `box:…+public:0`, so coin selection merges them with other private money and no review names the link. privacy.md says a Bootstrap's boxes never come back by themselves.

**Confirmed how.** Read the code, then wrote a throwaway Vitest, tests/zz-review-316-bootstraps.test.ts, since deleted. Setup: two public Bootstraps of two LJTEST boxes each in PR #163's preprod token pool, listed oldest first, then withdrawNow twice on status().pools[0].bootstrap.at(-1). What it printed: both withdraws spent b2#1 and b2#0; `mixes` kept only B2 `{boxes:2}` and B1's entry was gone; status listed held [] and due [t, t]; held().pools[0] showed `boxes: 2, bootstrap: 2`. Ten hours on, with B1's record gone and its leaves kept as "public", withdrawDue sent b1#0 by itself. Its history entry had no origin, while the two by-hand ones had `box:…+public:0`. The test's assertion that B1's two boxes are still held failed.

**Suggested fix.** In countBack, credit a box to the open Bootstrap whose deposit it sits at before falling back to the oldest: `const atDeposit = box ? openIn(s, p, true).find((e) => depositOf(s, e) === box.txHash) : undefined;` then `target = unmixed ?? (bootstrap || atDeposit?.released ? atDeposit : undefined) ?? candidates.find(…) ?? candidates[0] ?? released[0]`. In bootstrapOf, use the unknown-box fallback only for entries that are `found`, so nothing is held in place of a Bootstrap whose deposit hasn't landed. Record a public deposit's tie independently of the entries (see the depositAccountOf finding).

**Test idea.** Set up two Bootstraps of two boxes each in one pool, listed oldest first, and bring back twice the box heldRequest picks. Then status still lists the older Bootstrap's two boxes as held with no due time, held().pools[0] shows bootstrap 2 and boxes 0, and ten hours on withdrawDue sends nothing.

**Skeptic (confirmed, high).** It survives on HEAD, and I reproduced it. countBack credits every box a Bootstrap held to the pool's oldest open Bootstrap (openIn sorts by `at`), whichever deposit the box sat at. heldRequest takes `bootstrap.at(-1)`, and the listing is oldest first, so each Bring one back spends the newest Bootstrap's deposit box. Once the oldest entry's count reaches 0, update drops it (filter(open)), and its deposit leaves bootstrapOf's `deposits`. Its boxes are `known` (from the record, then from `leaves` kept as "public"), so the unknown-box fallback never holds them. They become free, get due times and come back by themselves. Nothing re-squares this: squareUp sees found = out. Two Bootstraps in one pool is a natural path, not an exotic one. The Bootstrap form leads the pool page while others < floor, which the wallet's own boxes never lift (Lovejoin.tsx:2195). Bring one back is the designed way back. The 'oldest Bootstrap' rule is Claude's 34a′ design (plan:569), not an owner's call, and it breaks the owner's decision 6 ('never come back by themselves'). The related window before a deposit is listed is real but minor: due times get redrawn later, so it is low on its own.

Evidence: HEAD lovejoin.ts:1983-1993 (target = unmixed ?? candidates.find(..) ?? candidates[0] ?? released[0], candidates = openIn(s,p,true)), 2057-2069 (bootstrapOf: deposits only of holding entries; fallback `!known(b)`), 6500 (mixes filtered by open), 4825-4829 (gone leaves kept with ownerOf); ui/screens/Lovejoin.tsx:741-743; private-index.ts:128-131 and seedelf-data/api/src/chain.rs:289-293 (order by o.id). Throwaway Vitest (tests/zz-review-316-skeptic-a.test.ts, deleted) set up two public Bootstraps b1 and b2 of 2 LJTEST boxes each in PR #163's pool, listed oldest first, 48 h later (chains 0, leaves all "public"). Two withdrawNow(status.pools[0].bootstrap.at(-1)) calls spent b2#1 then b2#0, each origin box:..+public:0. Then mixes held only b2 {boxes:2}, status showed held [] and due 2, and held().pools[0] showed {boxes:2, bootstrap:2}. Later withdrawDue runs sent b1#0 and b1#1 by themselves, each history origin undefined. privacy.md:198 says a Bootstrap's boxes 'never come back by themselves'.

**Reproduction (confirmed, high).** I reproduced it on HEAD 499768f6 with a throwaway Vitest, tests/zz-review-316-repro-bootstraps.test.ts, now deleted (the tree is clean). I used the helpers from lovejoin-release-rules.test.ts with the real WebAssembly, PR #163's preprod token pool, 12 strangers' boxes and POOL.

Setup: a public Bootstrap B1 (deposit b1…, 2 boxes, account 0: recordChain bootstrap:true, then chainSent and chainEnded). A minute later B2 (b2…, 2 boxes). The listing is b1#0, b1#1, b2#0, b2#1. Then 24 h on (both chain records gone, RECORD_KEEP_MS = 3 h), I pressed Bring one back twice exactly as the page does it: `lj.withdrawNow("preprod", heldRequest(status.pools[0]).box)`, taking each spent box out of the listing. Then 10 h on, I ran `withdrawDue`.

What it printed:
- Held at start: [b1#0, b1#1, b2#0, b2#1], 0 due.
- Bring one back #0 picked b2#1; #1 picked b2#0.
- `mixes` after: [{id: b2…, shares: [{boxes: 2}]}]. B1's entry was gone.
- `leaves` kept: b1#0 and b1#1 as "public".
- status after: bootstrap [] (nothing held), due 2, boxes listed [b1#0, b1#1].
- Home held(): pools [{boxes: 2, bootstrap: 2}].
- The two by-hand history origins were `box:<tx>+public:0`.
- withdrawDue sent 1 withdraw by itself, spending b1#0. Its history origin was undefined.
- The test asserted B1's boxes stay held. It failed: `expected [] to deeply equal ['b1b1#0','b1b1#1']`.

The trace on HEAD:
1. status lists the held boxes as bootstrapOf orders them: boxes at a deposit first, in listing order (lovejoin.ts:2066, 5155, 5173). The data layer's token feed is `order by o.id`, oldest first (seedelf-data/api/src/chain.rs:293, used by lovejoin/routes.rs:252). So heldRequest's `pool.bootstrap.at(-1)` (ui/screens/Lovejoin.tsx:742) is always the newest Bootstrap's box.
2. The withdraw goes out with `bootstrap: true` (5791, 5796). dropWithdrawing calls countBack(..., true) (6257).
3. In countBack, the box is a leaf of its chain: at depth 0 the leaves are the deposit's boxes (seedelf-core/src/lovejoin/mod.rs:2155-2188), so `unmixed` is undefined (1986). The target is `openIn(s,p,true)` sorted by `at` (1966-1969, 1989), which is B1. After two returns B1 is out 0, and update drops it (`filter(open)`, 6501).
4. bootstrapOf then holds B2's out of 2 using only B2's deposit (2058-2060). b1#0 and b1#1 are `known`, through the record or then `s.leaves` (1606-1608, 4828-4831). So the unknown-box fallback at 2066 skips them, and nothing is held.
5. squareUp sees found 2 = out 2 (2028-2030) and changes nothing.
6. sortOut marks them free (4776-4779). scheduleFound gives them due times (4314-4323). withdrawDueNow sends one (5530-5641).
7. depositAccountOf finds no record, no entry and no origin (1843-1850), so no tie and no history origin (6176-6178, 6239).

Why: This is real on HEAD, and it was introduced by PR #316 (countBack, openIn and bootstrapOf all come from it).

The owner's decision 6 (chunk-34 plan, "Decided" 6) and privacy.md:198 both say a Bootstrap's boxes never come back by themselves. They come back only by hand, after a question. Crediting by-hand returns to "the pool's oldest Bootstrap" is Claude's 34a′ rule (plan:569), not an owner's call. The owner's decision 5 ("oldest open mix") is about mixed boxes, which are interchangeable. Boxes sitting at a deposit are not.

The path is natural:
- A second Bootstrap in the same pool: the form leads the pool page while others < floor (Lovejoin.tsx:2195), and the wallet's own boxes never lift that.
- Bring one back is the designed way back.
- Once the user brings back as many boxes as the older Bootstrap had, the older one's still-unmixed deposit boxes come back by themselves. Each ties its deposit's funder to a new private UTxO on chain, with no question asked.
- Once the record is gone (3 h after the deposit, nearly always), the history entry has no `public:N` tie. The UTxOs screen and the reviews then treat that UTxO as a mixed box, so a later merge that links it to the public account goes unnamed.
- Home also shows those boxes twice: 2 on their way back and 2 held.

With two different funders (two accounts, or a private Bootstrap and a public one), the link is one the user never chose. With one account, it adds unasked, unlabeled links to that account. That is a broken privacy promise, so high. The only thing narrowing it is that few users run Bootstraps; I'd go no lower than medium. No money is lost.

**Fix notes.** 1. **countBack (lovejoin.ts:1983-1993)**: credit a held box to the Bootstrap whose deposit it sits at (`depositOf(s,e) === box.txHash`) before anything else. A Bootstrap's deposit boxes are leaves, so `unmixed` never catches them.

2. **The suggested snippet (match by deposit, then fall back to the oldest) is not enough, because of moved boxes.** Example:
   - B1 has 2 boxes at its deposit. B2 has 1 at its deposit and 1 that someone else's mix moved.
   - heldRequest picks the moved box first, because it is listed last. It is credited to the oldest, B1.
   - Later, B1's own box b1#1 is credited correctly. B1 closes while b1#0 still sits at its deposit, and b1#0 comes back by itself.

   A moved box has to count against an entry whose out exceeds its boxes still listed at its deposit. countBack has no listing, so the cleaner fix is to choose the entry in withdrawNowNow, which has `owned`, and store its id on Withdrawing (for example `bootstrap: <entry id>`). dropWithdrawing and settleWithdrawing then credit that entry. Keep the current rule for a `bootstrap: true` already sealed by an earlier build.

3. **squareUp (2024-2038) has the same root.** It credits Bootstraps oldest first. If another device brings back B2's boxes, squareUp closes B1 and frees B1's boxes. It has `listed`, so it can credit the Bootstrap whose deposit boxes are actually missing.

4. **bootstrapOf (2066)**: use the unknown-box fallback only for entries that are `found`. Before a deposit is listed, the fallback holds other unknown boxes in its place. A Bring one back in that window credits a box that isn't the Bootstrap's, and one of its deposit boxes is later freed. A run in that window also trims due times (5545).

5. **Ties**: a public deposit's tie is lost once the record and entry are gone (depositAccountOf, 1843-1850). With correct crediting, the entry stays open until its last box's withdraw is built, so the tie survives. Keeping it independently is still safer.

6. **Test to add**: two Bootstraps of 2 boxes each in one pool, listed oldest first. Bring back twice with the box heldRequest picks. Then:
   - status still holds the older Bootstrap's 2 boxes with due [].
   - held().pools[0] shows bootstrap 2 and boxes 0.
   - 10 h later, withdrawDue sends nothing.

   Add a variant where one box was moved by someone else's mix.

## 318-rust#0

**high · confirmed · money** — A Bootstrap from the private balance can never deposit: its chain's return can't be built from what the deposit leaves

At `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:1795`

**Detail.** Since 62162483 a private Bootstrap's session is funded with `lovejoinFunding` at depth 0 and nothing else. That is `funding_for(n, 0, denom)` = DEPOSIT_RESERVE (1.5 ₳) + n × box ADA (seedelf-core/src/lovejoin/mod.rs:1750-1752; the worker's mixFunding, sessions.ts:1968-1970: no 5 ₳ collateral, reserve 0 for a Bootstrap). `chain_at` builds the deposit, whose ADA change at the session is 1.5 ₳ less the deposit fee. With no collateral, `with_return` makes the return a plain sweep of that change alone (wasm/src/lovejoin.rs:1790-1797). `external_sweep` needs a Seedelf output of at least `wallet_minimum_lovelace_with_assets` (1.456780 ₳ under today's parameters) plus its own fee. The change never reaches that: 1,328,031 lovelace for 1 box, down to 984,787 at `bootstrap_most`'s 53. So the sweep fails, `built_or_without_strangers` returns the error (no strangers to drop) and `chain_at` fails. `bootstrap_most` (mod.rs:1754-1810) builds only the deposit, never the return, and its doc still says a collateral sits beside the funding. The worker catches the failure in backBuild (`skipped = leftOut(e)`, sessions.ts) and brings the whole funding back directly.

**Scenario.** A user starts a Bootstrap from the private balance (the default side) of 1 to 53 boxes in the classic pool, or any number in a token pool. The review shows N boxes going in and being held. The funding transaction goes out and its fee is paid. When the session runs, WebAssembly refuses the chain with "A Seedelf deposit of these tokens needs at least 1.456780 ADA". The session page shows "the chain failed: …" and everything, tokens too, comes back directly with a second fee. No box ever goes in. Every retry costs both fees again (about 0.4 ₳), and only a Bootstrap from the public account works. The "Bootstrap 1 to 53 boxes" cap the form shows is meaningless.

**Confirmed how.** Both. I wrote a throwaway test, seedelf-web-wallet/wasm/tests/zz_review_318_rust_bootstrap.rs (now deleted). It funds session 0 with exactly `lovejoin::funding(FundingRequest{boxes: n, depth: 0})` in one UTxO (11.5, 21.5 and 531.5 ₳), with no collateral, own = its funding tx, depth 0, boxes Some(n). It then calls `lovejoin::chain`. It printed REFUSED "A Seedelf deposit of these tokens needs at least 1.456780 ADA" for n = 1, 2 and 53 (bootstrap_most_in gave 53). Core's `deposit` alone left change 1,328,031 / 1,321,431 / 984,787. The test added in 62162483 funds 30 ₳ for 2 boxes, which is why it passes. I also read the worker's catch-and-return-directly path.

**Suggested fix.** Give a private Bootstrap what its return costs. Either: (a) add a Bootstrap-only reserve in mixFunding, outside `funding_for` so 1.5.0's depth-0 gate holds, the way the tail reserve is added: at least the Seedelf output's minimum plus a sweep's fee, beyond what DEPOSIT_RESERVE leaves after the largest deposit; or (b) pay the Bootstrap deposit's change straight into the wallet contract under a fresh register, so a Bootstrap needs no return transaction at all. In both cases, have `bootstrap_most` (and the plan's count) build the return as well as the deposit, and fix its doc, which still names a collateral.

**Test idea.** In wasm/tests: fund session 0 with exactly `lovejoin::funding(boxes n, depth 0).lovelace` (plus Q×n of the token for a token pool), with no collateral. Call `lovejoin::chain` at depth 0 with boxes Some(n), for n = 1 and n = `bootstrap_most_in(..)`. Assert the transactions are [deposit, back] and that back pays the wallet contract. A Vitest twin: mixOutBuild(…, {bootstrap: true}), leave only that funding UTxO at the session account, run backBuild, and expect no lovejoinSkipped and lovejoin.boxes == n.

**Skeptic (confirmed, high).** I couldn't refute it. On HEAD a private Bootstrap's session gets one UTxO of lovejoinFunding at depth 0: DEPOSIT_RESERVE (1.5 ₳) plus n × the box's ADA, with no 5 ₳ collateral and no reserve. The deposit leaves 1.5 ₳ less its fee (0.17 to 0.52 ₳) as ADA change. With no collateral, with_return makes the return a plain external_sweep of that change alone. Nothing else is there to sweep: the deposit spends every coin and token UTxO, and kept and token_change are empty for a fresh session. A Seedelf output needs at least 1.456780 ₳ plus the sweep's fee, so deposit_outputs fails with TooLittle. built_or_without_strangers has no strangers to drop and returns the error, and attempt(None)? passes it up out of chain_at. Nothing checks this before the funding goes out: mixOutBuild only checks privateBootstrapMost, and bootstrap_most builds the deposit alone. Once the funding lands, the worker's catch sets skipped = leftOut(e), and the runner's bringBack builds and sends the direct return on its own. The user pays the funding fee and the return fee, and no box goes in. The private side is the form's default, so every default Bootstrap fails, in the classic pool and in token pools alike. This isn't the owner's call: the owner chose no collateral and said a sweep brings it back (flows.md, privacy.md, commit a6ab608d), not that the return can't be built. The tests miss it because they overfund: the WebAssembly test puts 30 ₳ in for 2 boxes, and the Vitest setUp puts 40 ₳ in for 1. A note for the fix: the reviewer's option (b), paying the deposit's change straight into the wallet contract, also needs more ADA. That change (0.98 to 1.33 ₳) is below a Seedelf output's 1.456780 ₳ minimum. So a reserve for a Bootstrap alone is needed either way, at least about 0.65 ₳ at 53 boxes under today's fees, and bootstrap_most must count it and build the return too.

Evidence: HEAD sessions.ts:1916, 1961 (`reserve = mix.bootstrap ? 0n`), 1968-1970 (one payment of mix.lovelace, no SESSION_COLLATERAL for a Bootstrap); core lovejoin/mod.rs:1591 (DEPOSIT_RESERVE 1_500_000), 1750-1752 funding_for, 1754-1761 (bootstrap_most's doc still says 'beside a collateral the deposit never spends'; it builds the deposit only); wasm/src/lovejoin.rs:1784-1796 (no collateral: merge &[], so a sweep), 1808 (build::external_sweep), 1838/1840 (attempt(None)? propagates); core build.rs:361-380 (deposit_outputs: TooLittle 'A Seedelf deposit of these tokens needs at least … ADA'); sessions.ts:4199 (skipped = leftOut(e)), 3868-3876 (bringBack sends the direct return); ui/screens/Lovejoin.tsx:2177 (source defaults to "private"); tests overfund: wasm/tests/lovejoin_test.rs:321 (30 ₳ for 2 boxes), extension/tests/lovejoin-planner.test.ts:1184/1191 (40 ₳ for 1). Throwaway test (wasm/tests/zz_review_318_rust_skeptic_bootstrap.rs, run then deleted, tree clean): bootstrap_most_in = 53 under preprod's parameters; for n = 1, 2, 10, 53, funded with exactly lovejoin::funding(depth 0) (11.5, 21.5, 101.5, 531.5 ₳) and no collateral, lovejoin::chain REFUSED 'A Seedelf deposit of these tokens needs at least 1.456780 ADA' every time. Control: the same funding plus a 5 ₳ collateral BUILT [deposit, back] every time, with deposit fees 171,969 / 178,569 / 231,369 / 515,213. That leaves change of 1,328,031 down to 984,787, matching the reviewer.

**Reproduction (confirmed, high).** I reproduced it twice with throwaway tests. Both are deleted and git status is clean.

1) Rust test: seedelf-platform/seedelf-web-wallet/wasm/tests/zz_review_318_rust_repro.rs. Session 0 holds one UTxO of exactly lovejoin::funding(FundingRequest{boxes n, depth 0}).lovelace, with no collateral. own is its funding tx, depth 0, boxes Some(n). Params come from seedelf-core/tests/fixtures/epoch_params.json (44/155381/4310, the same as mainnet's). The test called lovejoin::chain for the classic pool, and lovejoin::chain_in for the LJTEST token pool (a box is 2 ₳ + Q). It asserted the txs are [deposit, back]. It printed:
- The Seedelf output's least is 1456780, and bootstrap_most_in(96) = 53.
- Classic pool, every one REFUSED "A Seedelf deposit of these tokens needs at least 1.456780 ADA":
  - n=1, funding 11.5 ₳ (core deposit alone: fee 171969, change 1328031)
  - n=2, funding 21.5 ₳ (fee 178569, change 1321431)
  - n=10, funding 101.5 ₳ (fee 231369, change 1268631)
  - n=53, funding 531.5 ₳ (fee 515213, change 984787)
- Token pool: n=1 (3.5 ₳ + Q) and n=5 (11.5 ₳ + 5Q) were REFUSED the same way.
- Control: n=1 with 0.7 ₳ more built OK as [deposit, back], returned 1857470. So the sweep's fee is 170561, and the change needs about 1627341.

2) Vitest twin, on the real WebAssembly: extension/tests/zz-review-318-rust-bootstrap.test.ts.
- mixOutBuild("preprod", 1, {bootstrap:true}) made one payment of 11500000, with a funding fee of 230260.
- Session 0 was recorded as mix {boxes:1, bootstrap:true} and held only that UTxO.
- backBuild gave: lovejoin undefined, and lovejoinSkipped = mix.skipped = "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA". No chain. It built a direct return of 11329439 at a fee of 170561.
- The same run with 0.7 ₳ more passed.

Trace on HEAD:
- sessions.ts:1909 checks only privateBootstrapMost. :1914 asks for the funding at depth 0, which is core funding_for_in = DEPOSIT_RESERVE (mod.rs:1591, 1.5 ₳) + n×denom (mod.rs:1632). :1961 sets reserve 0n for a Bootstrap. :1968 makes one payment of exactly mix.lovelace. :1970 pays no 5 ₳.
- The runner: sessions.ts:3355 → bringBack → buildBack. :4160 finds no collateral. depositOnly is true, so :4164 takes the else branch, and :4175 calls lovejoin.chain at depth 0. lovejoin.ts:2964 lets that pass, :3042 skips the floor at depth 0, and :3107 calls buildLovejoinChain → lib.rs:5730 chain_at.
- wasm lovejoin.rs:1490: mixes_collateral returns None, which is allowed at depth 0. :1565 chain_across → core deposit_across. That only requires change ≥ least_change (mod.rs:677), and the change is 1.5 ₳ less the fee (mod.rs:717).
- with_return: tail is None (:1753-1771). merge is &[] (:1796). plan_return makes a sweep (lib.rs:1186). :1808 build::external_sweep → build.rs:593 deposit_outputs → :375-376 TooLittle.
- built_or_without_strangers returns the Err, since there are no strangers to drop (lib.rs:1337). with_return's `attempt(None)?` (:1840) passes it up, and chain_at fails.
- sessions.ts:4199 sets skipped = leftOut(e), :4208 records it, :4268 builds the direct return, and bringBack sends it (:3877).
- bootstrap_most (core mod.rs:1762-1810) builds only the deposit.

Why: This is real on HEAD and deterministic. Every Bootstrap from the private balance fails: in the classic pool at every count from 1 to 53 (the cap the form allows), and in token pools too. The private balance is the form's default side (Lovejoin.tsx:2177).

What a user sees: the funding goes out (fee about 0.23 ₳), the chain is refused, and the runner sends everything back directly on its own (about 0.17 ₳ more). No box ever goes in. That is about 0.40 ₳ of fees lost per try, for a 1-box Bootstrap. The session shows a confusing reason: "a Seedelf deposit of these tokens needs at least 1.456780 ADA". The amount itself always comes back, so nothing is locked. But it hits every user on the default path and costs fees every time, and only a Bootstrap from the public account works. So it's high.

It's a regression from 62162483 (PR #323). Before that commit, the session's 5 ₳ collateral paid for the return. It isn't an owner's call: the owner chose no collateral, and flows.md:522 promises "what comes back later is a sweep into new private UTxOs". That sweep can't be built. The doc on bootstrap_most (mod.rs:1755-1761) still names a collateral.

Checked and found sound:
- A Bootstrap from the public account has no return transaction, so it isn't affected.
- 1.5.0 seeds, and Bootstraps funded with a 5 ₳ collateral before 62162483, merge or sweep using that collateral. Not affected.
- After the failure, everything comes back, tokens included. Nothing is locked.
- seedelf-cli doesn't use funding_for or bootstrap_most.
- Depth 0 is reached only by mix sessions marked seed or bootstrap.

**Fix notes.** - **Where to fix:** a Bootstrap from the private balance needs a reserve of its own, for its return. It must cover the Seedelf output's least (wallet_minimum_lovelace_with_assets, 1,456,780 today) plus a sweep's fee (about 170,561), less what DEPOSIT_RESERVE leaves after the deposit's fee. Measured shortfall: 299,310 at 1 box, 642,554 at 53 boxes. Prefer measuring it in WebAssembly from the epoch's params, the way lovejoinCollateralReserve does, over a constant, since coins_per_utxo_size moves the minimum.
- **Not in core's shared reserve:** keep it out of DEPOSIT_RESERVE, funding_for, funding_for_in and boxes_affordable. Those also plan every mix and 1.5.0's depth-0 seed sessions.
- **Trap in mixFunding (sessions.ts:1961-1990):** `reserve` there is the collateral tail's. A nonzero value sets tailReserved, then record.collateralReserve, and then chain_at and plan subtract COLLATERAL_TAIL_RESERVE (1.5 ₳) from spare. Reused for a Bootstrap, it can drop the count below n, so countAt < 1 and the session comes back directly. Use a separate amount, and don't set tailReserved.
- **bootstrap_most (core mod.rs:1762):** it must build the return too: the deposit, then external_sweep of its change at a base address with no collateral, on the new funding. Fix its doc. Its test, a_private_bootstrap_is_held_to_what_its_reserve_pays_for (seedelf-core/tests/lovejoin_pools_test.rs:1449), and the docs ("fixed 1.5 ₳", "53 in the classic pool", flows.md:522) will change.
- **The form:** Lovejoin.tsx:3101 BOOTSTRAP_RESERVE = 1.5 ₳ mirrors DEPOSIT_RESERVE for cantAfford, and the cost line uses it too. Add the new reserve there, or the build refuses someone the form accepted (NotEnoughPrivate).
- **Option (b), the deposit's change straight into the wallet contract:** it also needs more ADA, since the change of 0.98 to 1.33 ₳ is below 1.456780 ₳. It would also change core's shared deposit_across and the [deposit, back] chain the runner and records expect. Riskier.
- **Tests:** the existing ones overfund and hide this: wasm lovejoin_test.rs a_bootstrap_with_no_collateral_deposits_and_sweeps_back (30 ₳ for 2 boxes), and the Vitest in lovejoin-planner.test.ts (40 ₳ for 1). Add tests that fund exactly mixOutBuild's payment, at n=1 and at n=bootstrap_most_in, in the classic and LJTEST pools. Assert [deposit, back] and that back pays the wallet contract, and in Vitest that there is no lovejoinSkipped and lovejoin.boxes == n.

## 323-rust#0

**high · confirmed · correctness** — A private Bootstrap funded with no collateral can't build its return, so every one comes back without a box

At `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:1796`

**Detail.** Since 62162483, a private Bootstrap is funded with `funding_for(n, 0, denom)` alone. That is one payment, with tail reserve 0 and no 5 ₳ (sessions.ts:1961-1970), so the session holds only DEPOSIT_RESERVE (mod.rs:1591, 1.5 ₳) beside the boxes. Its chain is [deposit, back]. With `held.collateral` None, `with_return`'s `attempt(None)` (lovejoin.rs:1787-1797) has no merge, so the return is `build::external_sweep` of the deposit's change alone. That change is 1.5 ₳ less the deposit's fee: 1,328,031 lovelace for one classic box, and less for more boxes. After the sweep's ~170,561 fee it can't hold a Seedelf output's least of 1,456,780 lovelace (preprod's 4,310/byte). `deposit_outputs` refuses with TooLittle, and `chain_at` returns Err. Before this commit, the 5 ₳ collateral came back in that same return and paid for its least. `bootstrap_most` (mod.rs:1755-1762) still says the session holds "a collateral the deposit never spends", and it builds only the deposit, so the cap never catches this. `funding_for` at depth 0 can't simply grow, because 1.5.0's gate holds it (chunk-34 plan, 34d review 3). Neither test models the real funding: the wasm test `a_bootstrap_with_no_collateral_deposits_and_sweeps_back` funds 30 ₳ for 2 boxes, and the Vitest Bootstrap test reuses setUp's 40 ₳ account.

**Scenario.** A user picks Bootstrap the pool with 1 to 53 boxes from the private balance. The review shows the boxes plus 1.5 ₳ and no collateral row. For one classic box the funding is 11.5 ₳, and it lands. buildBack → lovejoin.chain(depth 0, no collateral) → buildLovejoinChain throws "A Seedelf deposit of these tokens needs at least 1.456780 ADA". leftOut makes that sess.skip.warn.chainFailed, a confusing message about tokens when there are none. The session then comes back directly and no box ever goes into the pool. Each try costs the funding's fee (a Seedelf spend through giveme.my) and the return's fee, and it ties the private UTxOs to a one-time account for nothing. From the private side, Bootstrap never works; only the public account's Bootstrap still does.

**Confirmed how.** Read the code, then a throwaway wasm test zz_review_323_rust_bootstrap (deleted). It called `lovejoin::chain` at depth 0 with collateral None, one UTxO of funding_for(n, 0, 10 ₳), boxes Some(n) and own = the funding. For n = 1, 2, 5, 10 and 53 (bootstrap_most's cap) every build was refused with "A Seedelf deposit of these tokens needs at least 1.456780 ADA". The same funding with a 5 ₳ collateral beside it (a Bootstrap funded before this commit) built [deposit, back] and returned 6.16 ₳ for n = 1.

**Suggested fix.** Fund a private Bootstrap's way back on top of DEPOSIT_RESERVE without touching funding_for at depth 0. For example, add a core constant (a Seedelf output's least plus a sweep's fee, about 1.63 ₳ today; a further 1.5 ₳ is enough for every n up to the cap, since 3.0 ₳ less the deposit's fee stays above 1.63 ₳), expose it through WebAssembly, and have mixFunding add it for a Bootstrap. Have bootstrap_most and privateBootstrapMost build the return sweep as well as the deposit when they cap. Correct bootstrap_most's doc.

**Test idea.** A wasm test: a Bootstrap funded exactly as mixFunding pays (one UTxO, no collateral) builds ["deposit","back"] for n = 1 and for n = bootstrap_most(...). It fails today. In the Vitest Bootstrap test, fund the session's account with the `mix.lovelace` that mixOutBuild returned, not setUp's 40 ₳.

**Skeptic (confirmed, high).** Survives every refutation I tried. A private Bootstrap's funding is one UTxO of funding_for(n, 0, denom) = DEPOSIT_RESERVE (1.5 ₳) + n × denom. It has no 5 ₳ and no reserve, and nothing else lands at the session: the Seedelf change goes back to the contract. The deposit leaves 1.5 ₳ less its fee (1.328 ₳ for one box, 0.985 ₳ at the 53-box cap). With held.collateral None, with_return's attempt(None) uses no merge. The return is then build::external_sweep of that change alone, and after the sweep's ~0.17 ₳ fee it can't carry a Seedelf output's 1.456780 ₳ least. deposit_outputs refuses with TooLittle, built_or_without_strangers rethrows it (there are no strangers), and chain_at fails. Nothing upstream catches it. plan() still counts n boxes, and fanOut/unstale rethrow anything that isn't StalePool. buildBack catches it into leftOut → sess.skip.warn.chainFailed and builds the plain session_return, and bringBack sends that by itself. bootstrap_most only builds the deposit, so its cap never sees the failure, and its doc still says "beside a collateral". The path is reachable from the UI (Lovejoin.tsx:2406 → handlers.ts → mixOutBuild) on mainnet too, since nothing here depends on a 5 ₳ pool. It is not an owner-call: the owner chose no collateral and a sweep, not a sweep that can't be built. What the user sees: every private Bootstrap, for every n, is funded (a Seedelf spend with giveme.my's collateral), then comes back directly with no box, under a warning about "tokens". Both fees are lost on each try, though the principal comes back and nothing is locked. This blocks the release of the private Bootstrap. Fix: add a way-back amount in mixFunding, not in funding_for at depth 0, which 1.5.0's gate holds. Something like +1.5 ₳ works: 3.0 ₳ less the 0.515 ₳ deposit fee at the cap still leaves 2.3 ₳ after the sweep. Or restore the 5 ₳. Have bootstrap_most build the return as well, correct its doc, and fund both tests as mixFunding really does.

Evidence: HEAD sessions.ts:1961-1970 (bootstrap: reserve 0n, one payment of mix.lovelace, no SESSION_COLLATERAL); lovejoin.ts:2893-2930 (funding at depth 0 → wasm funding_at → core funding_for_in = DEPOSIT_RESERVE + n·per_box, mod.rs:1591,1632-1634); wasm lovejoin.rs:1787-1797 (attempt(None): no collateral → merge &[]), :1801-1806 (external_sweep); lib.rs:1317-1340 (built_or_without_strangers returns Err with no strangers); build.rs:361-383 (deposit_outputs → TooLittle); sessions.ts:4162-4198 (chain caught → leftOut), 4264-4280 (direct buildSessionReturn), 3868-3878 (bringBack sends it), 5653-5658 (leftOut → chainFailed); mod.rs:1755-1762 (bootstrap_most builds the deposit only; stale doc). Throwaway test zz_review_323_rust_skeptic (wasm, now deleted): lovejoin::chain at depth 0, collateral None, utxos [funding_for(n,0,10 ₳)], boxes Some(n), merge [funding change], own [funding]. n=1,2,5,10,53 (bootstrap_most on preprod params = 53) all gave "ERR A Seedelf deposit of these tokens needs at least 1.456780 ADA". The same funding with a 5 ₳ collateral beside it gave OK ["deposit","back"] for every n, deposit fees 171,969 → 515,213. Existing tests miss it: wasm lovejoin_test.rs:321 funds 30 ₳ for 2 boxes; Vitest lovejoin-planner.test.ts:1487-1512 runs on setUp's 40 ₳ UTxO (line 1191).

**Reproduction (confirmed, high).** I reproduced it with a throwaway test, seedelf-platform/seedelf-web-wallet/wasm/tests/zz_review_323_rust_repro.rs, which is now deleted (git status is clean). It was run alone with `nice -n 19 cargo test -j 1 -p seedelf-wasm --test zz_review_323_rust_repro -- --test-threads=1 --nocapture`.

**What the test did.** For n = 1, 2, 5, 10 and 53 it funded the session exactly as mixFunding does:
- One UTxO of `lovejoin::funding(FundingRequest{depth:0}).lovelace`, which it asserted equals 1.5 ₳ + n × 10 ₳. No 5 ₳ beside it and no reserve.
- 53 is the cap: `bootstrap_most_in(preprod params, most 96)` returns 53.
- It checked that `lovejoin::plan(collateral None, depth 0)` counts n boxes.
- It then called `lovejoin::chain` with depth 0, `collateral: None`, `boxes: Some(n)`, `merge: [funding change]`, `own: [funding tx]`, and no collateral_pool.
- The test asserted that no count was refused.

**What it printed:**
```
bootstrap_most (classic, preprod params, most 96) = 53
n = 1: funded 11500000, plan.boxes = 1
  no collateral: REFUSED: A Seedelf deposit of these tokens needs at least 1.456780 ADA
  with 5 ₳ collateral: built ["deposit", "back"], deposit fee 171969, returned 6097941, merged 1
n = 2 / 5 / 10: REFUSED (same message); with 5 ₳: deposit fees 178569 / 198369 / 231369
n = 53: REFUSED (same message); with 5 ₳: deposit fee 515213, returned 5754653
```
So the assertion failed for all five counts. The control (the same funding plus a 5 ₳ UTxO named as collateral, which is what a Bootstrap was funded with before 62162483) built [deposit, back] every time.

**Trace on HEAD, from the review to the outcome:**
1. **The review.** Lovejoin.tsx:2406 calls `lovejoin-mix-private-build` with bootstrap set, which reaches handlers.ts:513 and then sessions.ts mixOutBuild. mixOutBuild checks the count only against privateBootstrapMost, which builds the deposit alone.
2. **The funding.** In mixFunding, sessions.ts:1961 sets the reserve to 0n for a Bootstrap, and :1966-1970 makes one payment of mix.lovelace with no 5 ₳. mix.lovelace = funding_for_in = DEPOSIT_RESERVE (mod.rs:1591, 1.5 ₳) + n × denom. With inParts false it is one UTxO.
3. **The run.** Once the funding lands, sessions.ts:3355 calls bringBack, then buildBack.
4. **The worker asks for the chain.**
   - :4109 depositOnly means no collateral pool is read.
   - The guard at :4164 passes, and :4175 calls lovejoin.chain with no collateral and fixed = 0.
   - The check at lovejoin.ts:2964 passes, and :3107 calls buildLovejoinChain.
5. **The deposit.**
   - wasm lovejoin.rs:1490: mixes_collateral returns Ok(None) at depth 0.
   - :1565 chain_across builds the deposit.
   - Its change (core mod.rs:717) is 1.5 ₳ less the deposit fee: 1,328,031 lovelace for n = 1, and 984,787 at n = 53.
6. **The return.**
   - with_return has no tail, so :1840 runs attempt(None).
   - At :1795-1796 there is no merge, so the rows are the change alone.
   - :1801 plans a sweep, and :1808 build::external_sweep sends it into deposit_outputs.
   - core build.rs:376 refuses it with TooLittle. The change less the sweep fee (about 0.17 ₳) is under a Seedelf output's least, 1,456,780 lovelace at 4310 per byte.
   - wasm lib.rs:1337 built_or_without_strangers returns the error, since there are no strangers to drop, and chain_at returns Err.
7. **The fallback.**
   - lovejoin.ts unstale (3610-3622) rethrows anything that isn't StalePool.
   - sessions.ts:4199 turns it into sess.skip.warn.chainFailed ("the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA") and stores it as mix.skipped.
   - :4268 buildSessionReturn sweeps the whole funding back directly, and bringBack sends it.

**Why the tests miss it.** All three fund more than mixFunding pays:
- wasm lovejoin_test.rs:317 funds 30 ₳ for 2 boxes.
- lovejoin-planner.test.ts:1487 uses setUp's 40 ₳ UTxO.
- lovejoin-flows.test.ts:254 lands `out.mix.lovelace` plus a 5 ₳ UTxO the real funding hasn't paid since 62162483.

Why: This happens every time. It covers every private Bootstrap at every count from 1 to the cap (53 classic boxes on preprod parameters) and in every pool: a token pool's deposit costs more, so its change is smaller still. It covers both networks, since mainnet's 4310 per byte and fee parameters match preprod's.

The review says "Bootstrap the pool with N boxes", with N × denom + 1.5 ₳ shown as "For the boxes and network fees". After signing, the funding (a Seedelf spend under giveme.my's collateral) lands. The session then comes back directly, no box ever goes in, and the warning talks about "tokens".

Each try loses the funding's fee and the return's fee (about 0.17 ₳). The principal comes back, nothing is locked, and no privacy promise is broken. I keep it at high because:
- the 1.6.0 feature never works from the private side;
- the user pays fees on every try for an outcome the review promised and the wallet can't deliver;
- the owner chose "no collateral and a sweep", not a sweep that can't be built, so it is not an owner-call.

If you weigh only the amount at stake (fees), medium is the floor.

Every other part of the finding holds:
- bootstrap_most's doc (mod.rs:1757) still says "beside a collateral the deposit never spends".
- bootstrap_most builds only the deposit, so its cap never sees this failure.
- funding_for at depth 0 is pinned by the 1.5.0 gate (tests/lovejoin-1-5-0.test.ts:286-304; chunk-34 plan line 711).

**Fix notes.** **Where to fix it.**
- **Don't grow `funding_for(n, 0, denom)` or `lovejoin.funding(…, depth 0)`.** The 1.5.0 gate pins it for both networks (tests/lovejoin-1-5-0.test.ts:286-304).
- **Add a separate way-back amount to a private Bootstrap's one payment in mixFunding** (sessions.ts:1961-1970). Make it a core constant exposed through wasm, the way COLLATERAL_TAIL_RESERVE and lovejoinCollateralReserve are.
- **Size it with the deposit fee in mind.** It must cover a Seedelf output's least (1,456,780 at 4310 per byte) plus a one-input sweep's fee (about 0.17 ₳), less what the deposit's change leaves. That change shrinks as n grows: the deposit fee is 171,969 at n = 1 and 515,213 at n = 53 in the classic pool, and more in a token pool. So at the cap it needs at least about 0.65 ₳; 1.5 ₳ leaves room for fees or parameters to drift.
- **Restoring the 5 ₳ also works** (the control built and merged), but it reverses the owner's no-collateral call.

**The cap.** Make core's bootstrap_most (mod.rs:1754-1806) build the return too, not just the deposit: external_sweep of the deposit's change, on funding_for plus the new amount. Then the cap can't drift from what the chain needs. Correct its doc at :1757.

**Box counts stay safe.** The extra amount can't buy an extra box: the worker's countAt caps the count at mix.boxes, and a token pool is also capped by token_boxes. A record flag like collateralReserve would keep it that way if a later path drops the cap.

**Screens.** These must count the amount and say it comes back:
- bootstrapLimits' costs (Lovejoin.tsx:3150);
- the review's "For the boxes and network fees" row (lessReserve, :3238);
- lovejoin.bootstrap.cantAfford in en, es and ja;
- privateBootstrapMost's range.

**Tests.** Each of these fails on HEAD once it is funded as mixFunding really pays:
- The wasm test lovejoin_test.rs:317: fund exactly `funding(n, 0).lovelace` plus the new amount in one UTxO, with no collateral, at n = 1 and at n = bootstrap_most.
- The Vitest test lovejoin-planner.test.ts:1487: fund the session with `bootstrap.payments[0].lovelace` alone.
- lovejoin-flows.test.ts:254: drop the 5 ₳ UTxO, which the funding no longer pays.

**Docs.** architecture.md, flows.md, privacy.md and the chunk-34 plan's item 4 describe a sweep back that can't be built today. flows.md's "as many as its funding's fixed 1.5 ₳ pays … for" needs the new amount.

**Wording (nit).** The TooLittle text (core build.rs:533-541) says "of these tokens" for an ADA-only sweep, and the user sees it inside chainFailed. The CLI shares it, so reword it there carefully or catch it in the worker.

**Upgrade.** No migration is needed:
- 1.5.0 seeds and Bootstraps funded before 62162483 keep their 5 ₳ and still build (the control).
- A Bootstrap funded on this branch (only the owner's preprod testing; 1.6.0 hasn't shipped) just comes back directly, with nothing locked.

## docs-small#0

**high · confirmed · tests** — CI fails on HEAD: two unit tests still expect a Bootstrap's 5 ₳ collateral, so no e2e has run on the release tree

At `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin.test.ts:1907`

**Detail.** Found while checking that #313's hold test passes on HEAD. Commit 62162483 (PR #323, "a Bootstrap is funded with no collateral") stopped paying the 5 ₳ in a private Bootstrap's funding (sessions.ts mixFunding). It touched neither of these tests. CI run 40109672647 ran on a6ab608d, whose tree is HEAD's (`git diff --stat a6ab608d 499768f6` is empty), and failed at "Extension unit tests" with 2 of 228 files failing. (1) tests/lovejoin.test.ts:1907 expects `seeded.payments` to be ["11500000","5000000"] and gets ["11500000"]. (2) tests/sessions-review-fixes.test.ts:435 expects mixOutBuild("preprod", 1, { bootstrap: true }) over spread()'s 40 × 0.7 ₳ to reject with "That Bootstrap needs more UTxOs than one transaction can spend". Without the 5 ₳, the funding now fits in 21 inputs and resolves, so no test reaches that refusal any more. The web-wallet workflow runs only on pull_request (web-wallet.yml:3-5), and its e2e steps come after the unit tests. So neither `npm run e2e`, `e2e:data` (this slice's hold test) nor the store build's e2e has run on HEAD. The last fully green run was d5b53625, before 62162483. #323 merged with this check failing. The 1.5.0 gate (lovejoin-1-5-0.test.ts) passed in the same run.

**Scenario.** 1.6.0 is packaged from a commit whose CI never passed. Nothing has run the e2e suite on it: not the Bootstrap flows 62162483 rewrote (the funding with no 5 ₳, and the return as a sweep with nothing put up), and not the data layer's hold test. The guard that refuses a Bootstrap needing more UTxOs than one transaction can spend is also left without a test that reaches it.

**Confirmed how.** Read the CI log of run 40109672647, job 120918569798: "Test Files 2 failed | 225 passed | 1 skipped", the two assertions above, and lovejoin-1-5-0.test.ts passing. Checked that `git diff --stat a6ab608d HEAD` is empty and that 62162483's file list doesn't include either test. Read both tests and spread() (sessions-review-fixes.test.ts:90-97). No local run.

**Suggested fix.** In lovejoin.test.ts:1907, expect ["11500000"] (one payment, no collateral) and update the comment above it. In sessions-review-fixes.test.ts:435, make the refused case need more inputs again: for example, Bootstrap 2 boxes from the same spread(), about 23 ₳ in about 35 UTxOs of 0.7 ₳. Keep the 3 × 40 ₳ success half. Then let the review branch's PR run the whole workflow (e2e, e2e:data, the store build's e2e) before packaging.

**Test idea.** The corrected input-cap case fails if the refusal in mixOutBuild is removed, and passes with it. It also asserts that giveme.my wasn't asked and nothing was submitted.

**Skeptic (confirmed, medium).** The CI failure holds on HEAD. The tree is unchanged: the working tree is clean at 499768f6, and `git diff --stat a6ab608d 499768f6` is empty. Both assertions are stale against a change the owner chose on purpose (plan item 4 at chunk-34-token-pools.md:956: a Bootstrap needs no collateral). mixFunding no longer pays the 5 ₳ for a Bootstrap (sessions.ts:1961 sets reserve 0n, and :1970 adds no collateral payment). Commit 62162483 touched neither test file. sessions.ts:1983 is the only path to sess.bootstrapTooMany, and grep finds no other test that reaches it, so that guard now has no test. web-wallet.yml runs only on pull_request. Five steps came after the failing unit tests and were all skipped on this tree: the preprod-only unit run (step 15), the extension build (16), the e2e (17), e2e:data, which is #313's hold test (18), and the store package's e2e (19). The last green run was 40060515681 on d5b53625. One correction to the finding: #323 merged at 16:02:25Z, 24 s after the check started. It merged before the check finished (it failed at 16:14:33Z), not after seeing it fail. Users aren't directly affected. The one e2e Bootstrap test compares 300 ₳ with 28 ₳, so the dropped 5 ₳ likely doesn't touch it. A user hitting a regressed guard would see core's English refusal before anything is sent. Still, CI is certain to be red for the review branch's PR. Nothing has run the e2e on code that changed a money path: the Bootstrap funding, and its return as a sweep. I keep medium because this blocks release readiness.

Evidence: CI job 120918569798 log (via gh api), lines 3618-3700: 'FAIL tests/lovejoin.test.ts > mixing from the tile > mixes from the private balance ... expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]' at lovejoin.test.ts:1907:52; 'FAIL tests/sessions-review-fixes.test.ts > a Bootstrap's funding ... promise resolved "{ …(15) }" instead of rejecting' at :435:74; 'Test Files 2 failed | 225 passed | 1 skipped (228)'; lovejoin-1-5-0.test.ts passed (log line 2460). Steps 15-19 were skipped (gh run view 40109672647). HEAD lovejoin.test.ts:1907 still expects ["11500000","5000000"]. sessions-review-fixes.test.ts:435-437 still expects the refusal from spread() (40 × 700000, :90-97). sessions.ts:1956-1985. .github/workflows/web-wallet.yml:3-7. gh run list: 40060515681 d5b53625 success, 40109672647 a6ab608d failure. gh pr view 323: mergedAt 16:02:25Z, check completed FAILURE at 16:14:33Z.

**Reproduction (confirmed, high).** HEAD is 499768f6. Its tree, c5d82f2e, is the same as a6ab608d's, so CI run 40109672647 tested exactly this code. Job 120918569798's log reads "Test Files 2 failed | 225 passed | 1 skipped (228)", and lovejoin-1-5-0.test.ts passed. Steps 15-19 were skipped: the preprod-only unit run, the build, e2e, e2e:data and the store e2e. The last fully green run is 40060515681 on d5b53625, and the only changes since are 62162483 plus a6ab608d (docs only).

I ran a throwaway file, tests/zz-review-docs-small-bootstrap.test.ts, on its own (nice 19, 1 worker) and then deleted it:
- A1 copies lovejoin.test.ts:1898-1907 and expects payments ["11500000","5000000"]. It fails: "AssertionError: expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]", the same message CI gave.
- B1 copies sessions-review-fixes.test.ts:430-437 (spread()'s 40 × 0.7 ₳, Bootstrap 1 box, expected to reject with sess.bootstrapTooMany). It fails: "promise resolved "{ …(15) }" instead of rejecting". The funding resolved as one transaction: 21 inputs, payments ["11500000"], fee 953040 lovelace, no parts.
- A2 passes: a Bootstrap pays ["11500000"] with no collateralReserve, and a 1-box mix still pays ["15300000","5000000"].
- B3 passes: mixOutBuild("preprod", 2, {bootstrap:true}) over the same spread() rejects with sess.bootstrapTooMany's exact text, submits nothing and never asks giveme.my. So the finding's suggested replacement does reach sessions.ts:1983.
- C1 is a new problem. It copies lovejoin.test.ts:1830-1872 (the seed test), but gives session 0's account exactly what the submitted funding paid, decoded with builtOutputs. The funding's outputs are #0 = 11,500,000 to the session's key address and #1 = 13,269,740 change to the contract. After advance("preprod",0,true) the session's txs are ["out","back"], and mix.skipped reads "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA". The back returns 11,329,439 to the contract and no box goes into the pool. The test expected ["out","deposit","back"], so it fails.
- C2 is the control: C1 plus the 5 ₳ at #1 that lovejoin.test.ts:1858 still pushes. It gives ["out","deposit","back"] and passes.
- C3, with 2 boxes (21.5 ₳), fails the same way; the back returns 21,329,439.

Why C1 fails, step by step on HEAD:
1. sessions.ts:1961 sets the reserve to 0n for a Bootstrap and :1970 pays no 5 ₳. The session holds only funding_for(boxes,0): boxes × 10 ₳ plus DEPOSIT_RESERVE's 1.5 ₳ (seedelf-core/src/lovejoin/mod.rs:1591 and :1750).
2. The runner's buildBack goes on without a collateral (sessions.ts:4164, depositOnly at :970), and lovejoin.ts:2964 lets a depth-0 chain through.
3. In the WebAssembly, mixes_collateral is None (wasm/src/lovejoin.rs:885). The deposit pays the boxes and its change, about 1.33 ₳, stays at the session (:958).
4. with_return has no collateral, so it sweeps that change alone into the wallet contract (:1795). The Seedelf output is below its 1.45678 ₳ minimum, so seedelf-core/src/build.rs:537 raises TooLittle.
5. The chain fails with sess.skip.warn.chainFailed and the session comes back directly.

Why: The finding holds as written. Both tests fail on HEAD exactly as in CI, and 62162483 touched neither file. The web-wallet workflow runs only on pull_request (web-wallet.yml:3-7), and the e2e, e2e:data and store-package steps all come after the unit tests. #323 merged at 16:02:25Z, 24 s after its check started; the check failed at 16:14:33Z. With nothing else wrong, that would be medium: the release gate is red and the guard at sessions.ts:1983 has no test that reaches it.

I'm raising it to high because the money path those checks would have covered is broken. With the funding 62162483 builds, no private Bootstrap's chain can be built:
- What the user sees: the session comes back directly, with a skip note in core's English ("needs at least 1.456780 ADA").
- What it costs: two fees for nothing, about 0.40 ₳ in C1 (0.230 for the funding, 0.171 for the return). The funding fee grows with the number of inputs: 0.953 ₳ at 21 inputs.
- What doesn't happen: the pool gets no box, on every try, classic pool and token pools alike, since the reserve is the same 1.5 ₳ for any number of boxes.

Why the reserve no longer works: the 1.5 ₳ was sized for a return merged with the 5 ₳ collateral. Core's bootstrap_most doc at mod.rs:1756-1758 still says "beside a collateral the deposit never spends". Without the 5 ₳, those 1.5 ₳ must pay the deposit's fee, the sweep's fee and a 1.45678 ₳ Seedelf output, which they can't.

Why no test caught it: 62162483's tests never funded the exact amount. The WebAssembly test gives 30 ₳ for 2 boxes. The planner test's session holds 40 ₳ (lovejoin-planner.test.ts setUp, :1184-1191). lovejoin.test.ts:1858 still feeds the 5 ₳ the funding no longer pays.

So the finding's suggested fix (change :1907, rework :435) would turn CI green and ship this bug. e2e wouldn't catch it either: the one e2e Bootstrap test (extension.spec.ts:3302) never submits, and the "not enough for that many" text it checks still matches.

#313's hold test (e2e:data) last passed on d5b53625, and nothing since touches the reads it pins. It's very likely fine, but it hasn't run on HEAD.

**Fix notes.** 1) This needs a code fix, not only test fixes. A private Bootstrap with no collateral needs a reserve that covers the deposit's fee (which grows with the boxes), the return sweep's fee and the Seedelf output's minimum of about 1.457 ₳. That's roughly 0.35 ₳ more than today's 1.5 ₳ for one box, and more for more boxes. Options:
- (a) A reserve for depth 0 only, in core's funding_for / lovejoinFunding, keeping DEPOSIT_RESERVE for mixes. bootstrap_most (mod.rs:1762) must then build the deposit and the sweep, not the deposit alone. Lovejoin.tsx's BOOTSTRAP_RESERVE (:3101) and bootstrapLimits (:3150) must match, and so must the review's "For the boxes and network fees" row.
- (b) Have the deposit pay its change straight into the wallet contract. That saves the sweep, but 1.5 ₳ minus the deposit fee (about 1.33 ₳) is still under 1.457 ₳, so the reserve has to rise anyway.
- (c) Put the 5 ₳ back for a Bootstrap. This reverses the owner's 2026-10-23 call.

The amount, and what the form shows, is the owner's call: put it in user terms (what a Bootstrap costs, what comes back). Keep 1.5.0 seeds and Bootstraps funded before 62162483 (5 ₳ at the account) on the merged path; C2 shows that path still works. Don't touch the frozen templates or variant 1.

2) Tests:
- lovejoin.test.ts:1907: expect ["11500000"], or the new figure, and fix the comment above it.
- lovejoin.test.ts:1858: push only what the funding pays. Decode it with builtOutputs and sessionSwap.keyHash, as paidTheAccount in sessions-review-fixes.test.ts does. Don't assume #0: in the 2-box case the session's output was #1. Keep the 5 ₳ only in a separate, labelled legacy case.
- Add funding-to-deposit tests at the exact amount, for 1 and several boxes, in the classic pool and a token pool. Make the WebAssembly test (lovejoin_test.rs a_bootstrap_with_no_collateral_deposits_and_sweeps_back) fund exactly funding_for(boxes,0).
- sessions-review-fixes.test.ts:435: a 2-box Bootstrap from the same spread() reaches sessions.ts:1983 today (I checked: exact text, nothing submitted, giveme.my not asked). If the reserve rises, check that this case still exceeds the input cap and doesn't become "Not enough ADA". Keep the 3 × 40 ₳ half.

3) Fix core's stale doc at seedelf-core/src/lovejoin/mod.rs:1754-1761. a6ab608d's docs (architecture.md, flows.md, privacy.md, the chunk-34 plan) describe a no-collateral Bootstrap that works; re-check them after the fix. funding_for is used only by Lovejoin, so the CLI's transactions shouldn't change, but check.

4) Before packaging, let the review PR run the whole workflow: the preprod-only unit run, the build, e2e, e2e:data (#313's hold test) and the store package's e2e. It triggers only on pull_request and only for changes under seedelf-platform/**.

## x-compat#0

**high · confirmed · tests** — HEAD's Vitest suite is red: two tests still expect a Bootstrap to pay its old 5 ₳ collateral

At `seedelf-platform/seedelf-web-wallet/extension/tests/sessions-review-fixes.test.ts:435`

**Detail.** PR #323's last CI run failed at 'Extension unit tests' with 2 failures (Web Wallet run 40109672647, job 120918569798, on a6ab608d, whose tree equals HEAD 499768f6), and the PR was merged anyway. web-wallet.yml runs on pull_request only, so main shows no red. Both failures come from 62162483 ('a Bootstrap is funded with no collateral'): mixFunding (sessions.ts:1955-1990) now pays a Bootstrap's boxes alone. (a) tests/lovejoin.test.ts:1907 expects the Bootstrap funding's payments to be ["11500000","5000000"]; HEAD pays ["11500000"]. (b) tests/sessions-review-fixes.test.ts:435 expects mixOutBuild(…, {bootstrap: true}) over spread() (40 × 0.7 ₳) to refuse with sess.bootstrapTooMany. Without the 5 ₳ it now fits one transaction (21 inputs, 0.95 ₳ fee) and resolves. So the cap refusal at sessions.ts:1983 is no longer reached by any test.

**Scenario.** The review branch's PR to main runs the Web Wallet workflow, which fails at Extension unit tests, so the 1.6.0 release PR can't go green. Also, the Bootstrap cap refusal ('That Bootstrap needs more UTxOs than one transaction can spend') has lost the only test that reaches it, so a regression there would pass CI.

**Confirmed how.** Read CI job 120918569798's log (Tests 2 failed | 2582 passed). Then ran each test alone at HEAD (vitest -t, maxWorkers=1); both fail with the same assertions.

**Suggested fix.** lovejoin.test.ts:1907: expect ["11500000"] and drop the collateral from its comment. sessions-review-fixes.test.ts: spread the private balance thinner for the refusal case (e.g. spread(60, "500000")), so a one-box Bootstrap's 11.5 ₳ again needs more computation than one transaction allows and sess.bootstrapTooMany is reached. Keep the second half (3 × 40 ₳ funds it as one transaction).

**Test idea.** The two tests, updated: the first fails if a Bootstrap funding pays a 5 ₳ collateral again; the second fails if the TOO_MANY → sess.bootstrapTooMany mapping in mixFunding stops firing.

**Skeptic (confirmed, medium).** Confirmed on HEAD. 62162483 removed a Bootstrap's 5 ₳ collateral payment. It updated three test files but missed these two, so they still expect the old behaviour. The tree CI tested is identical to HEAD's. PR #323 merged at 16:02:25Z, 26 s after its last Web Wallet run began (16:01:59Z), so the red result arrived after the merge. web-wallet.yml runs on pull_request only, so main shows no red, but the review branch's PR to main will fail 'Extension unit tests'. No user is harmed. I keep it medium because it blocks the release PR, and because the Bootstrap cap refusal (sessions.ts:1983) has lost its only test. Both suggested fixes work, checked with throwaway copies that I ran alone and then deleted. Changing line 1907 to ["11500000"] makes test (a) pass in full; it has no later failures hidden behind the first. spread(60, "500000") makes test (b) pass in full: sess.bootstrapTooMany is reached again, nothing is submitted, giveme.my is not asked, and the 3 × 40 ₳ half still funds as one transaction. Separately, for the fixer: the neighbouring test at lovejoin.test.ts:1857 ('seeds from the private balance on an empty pool under a floor') still lands a 5 ₳ UTxO at index 1 of a Bootstrap's funding. HEAD's funding no longer makes that output. The test passes, but it now exercises a pre-change Bootstrap's return, not HEAD's.

Evidence: CI job 120918569798 (run 40109672647, head a6ab608d): 'FAIL tests/lovejoin.test.ts:1907 expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]' and 'FAIL tests/sessions-review-fixes.test.ts:435 promise resolved … inputs: 21, fee total 953040 … instead of rejecting'; 'Tests 2 failed | 2582 passed | 4 skipped'. git rev-parse a6ab608d^{tree} = 499768f6^{tree} = c5d82f2e. gh pr view 323: mergedAt 2026-10-24T16:02:25Z, Web Wallet check FAILURE. HEAD sessions.ts:1959-1976: the reserve is 0n for a bootstrap, and the 5 ₳ payment is `...(mix.bootstrap ? [] : [...SESSION_COLLATERAL])`. grep: sess.bootstrapTooMany is used only at sessions.ts:1983 and tested only at sessions-review-fixes.test.ts:436. Throwaways tests/zz-review-x-compat-a.test.ts and -b.test.ts: each 1 passed with the fix, both deleted, git status clean.

**Reproduction (confirmed, high).** THE STATED FINDING, REPRODUCED
- CI: Web Wallet run 40109672647, job 120918569798, ran on a6ab608d. `git diff a6ab608d 499768f6` is empty, so that tree is HEAD's. Result: "Tests 2 failed | 2582 passed".
  - Failure 1: lovejoin.test.ts:1907, "expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]".
  - Failure 2: sessions-review-fixes.test.ts:435, "promise resolved … instead of rejecting" (inputs 21, fee.total 953040, payments ["11500000"]).
  - The previous run, on d5b53625 (62162483's parent), was green, so 62162483 caused both.
  - PR #323 merged at 16:02:25Z. Its check started at 16:02:01Z and failed at 16:14:33Z.
  - web-wallet.yml has `on: pull_request` only, so main shows no red.
- Local runs at HEAD, each test alone (nice -n 19, --maxWorkers=1, -t): both fail with the same assertions.
- The `sess.bootstrapTooMany` refusal (sessions.ts:1983) is named only by sessions-review-fixes.test.ts:436, which no longer reaches it.

THE FIXES SUGGESTED, CHECKED (throwaway copies, now deleted)
- lovejoin.test.ts:1907 changed to ["11500000"]: the whole test passes.
- spread(60,"500000"), and also spread(40,"500000"): the whole test passes. The refusal is reached, nothing is submitted, giveme.my isn't asked, and 3 × 40 ₳ still funds as one transaction.
- Probe of the cap: a one-box Bootstrap fits up to 22 inputs (60 × 0.65 ₳: fee 989178). From 0.6 ₳ per UTxO down it is refused.

WHAT THE STALE FIXTURES HIDE
Four tests build a HEAD Bootstrap funding, then land a 5 ₳ output at index 1 that the funding no longer pays. In copies that land only what HEAD pays, all four fail:
- lovejoin.test.ts:1858: the session's txs are ["out","back"], and mix.skipped is "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA".
- lovejoin-flows.test.ts:254: no chain is recorded (s.chains is undefined at :261).
- lovejoin-merged-review.test.ts:555: sealed().mixes is undefined at :562.
- lovejoin-merged-review.test.ts:1180 (token pool, 2 boxes): intoToken is false at :1193, with the same skip reason.

An end-to-end throwaway landed the funding's real outputs, decoded from its bytes with paidTheAccount/land (sessions-review-fixes.test.ts:100-111):
- FUNDING payments ["11500000"], fee 230260
- LANDED [[0,"11500000"]]
- KINDS ["out","back"], with the same skip reason.

TRACE OF THE HIDDEN FAILURE (HEAD file:line)
1. sessions.ts:1916 sends a Bootstrap to mixFunding. At :1961 the reserve is 0n. At :1968 it pays mix.lovelace, which is boxes × denom + DEPOSIT_RESERVE (1.5 ₳). At :1970 it pays no 5 ₳.
2. Once the funding lands, buildBack runs. At sessions.ts:4160 `collateral` is undefined. At :4164 depositOnly skips the no-collateral branch. At :4175 it calls lovejoin.chain(…, undefined, …, depth 0).
3. wasm/src/lovejoin.rs:1787-1797: with no collateral, merge is [] and the return's rows are the deposit's change alone.
4. lovejoin.rs:1806 calls external_sweep, which seedelf-core/src/build.rs:537 refuses (TooLittle). The error propagates through :1838 attempt(None)?.
5. sessions.ts:4198-4199 catches it: leftOut gives sess.skip.warn.chainFailed. :4206-4209 records mix.skipped.
6. sessions.ts:4268 buildSessionReturn sweeps the 11.5 ₳ straight back (wasm/src/lib.rs:1472 merges only with a session collateral; otherwise the sweep at :1500).

Root cause: DEPOSIT_RESERVE (seedelf-core/src/lovejoin/mod.rs:1591) is sized for the deposit's fee and its change's minimum "beside a collateral the deposit never spends" (mod.rs:1755-1760). The return now has under 1.5 ₳ minus the deposit's fee. A Seedelf output needs at least 1.45678 ₳, plus the sweep's own fee.

The test protocol parameters use mainnet's terms (min_fee_a 44, min_fee_b 155381, coins_per_utxo_size 4310), so mainnet behaves the same.

Why: The finding reproduces exactly as stated: same two tests, same assertions, same cause (62162483), and both suggested test edits work. On its own it is medium: it blocks the release PR, and no user is harmed.

I raise it to high because the red tests are symptoms of an incomplete change. 62162483 removed a private Bootstrap's 5 ₳ collateral but kept its funding at the boxes plus 1.5 ₳. That 1.5 ₳ was sized on the assumption that the 5 ₳ would join the chain's return. Without it, the return after the deposit can't pay for a Seedelf output.

So at HEAD every private Bootstrap fails, whatever the pool (classic or token) and however many boxes, because the deposit's change is always under 1.5 ₳. What the user sees and loses:
- They sign a funding reviewed as "For the boxes and network fees".
- They pay its fee (0.23 ₳ from 3 UTxOs, about 0.95 ₳ from 21) and then the return's fee.
- No box goes into the pool. They get the warning "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA", and the rest comes back to the private balance. Nothing is locked.
- Retrying costs the fees again.

Three things kept CI from showing it:
- Four tests land a 5 ₳ the funding no longer pays.
- The planner test funds 40 ₳ (lovejoin-planner.test.ts:1191).
- The WebAssembly test funds 30 ₳ for 2 boxes.

Applying only the two suggested test edits would turn CI green while a headline 1.6.0 flow stays broken.

**Fix notes.** 1. Fix the Bootstrap first; the two test edits alone are not enough.
   - Option A (no owner call needed): give a Bootstrap its own reserve. Size it by building the deposit and the return's sweep: a Seedelf output's minimum of 1.45678 ₳, plus the sweep's fee, plus a deposit fee that grows with the boxes.
     - Don't raise DEPOSIT_RESERVE (seedelf-core/src/lovejoin/mod.rs:1591). Every mix's funding uses it (mod.rs:1628-1647).
     - Keep these in step with the new reserve: core's bootstrap_most (mod.rs:1758+, which checks only the deposit's change), the worker's privateBootstrapMost, lovejoin.ts funding's mix.lovelace, and the screen's BOOTSTRAP_RESERVE (Lovejoin.tsx:3101) and bootstrapLimits (Lovejoin.tsx:3150).
   - Option B: have a depth-0 chain with no collateral pay the deposit's change straight into the Seedelf balance, or leave it at the account.
   - Option C: pay the 5 ₳ again.
   - B and C are owner calls. The owner decided on 2026-10-23 that a Bootstrap takes no collateral.

2. Use the four stale fixtures as the failing tests for that fix. Make each land what HEAD's funding really pays, decoding its outputs as paidTheAccount/land do (sessions-review-fixes.test.ts:100-111).
   - lovejoin.test.ts:1858
   - lovejoin-flows.test.ts:254
   - lovejoin-merged-review.test.ts:555
   - lovejoin-merged-review.test.ts:1180, for bootstrap=true only. The mix variant keeps its 5 ₳.
   - Each of these fails on HEAD once landed that way.
   - Tighten lovejoin-flows.test.ts:258. Its "deposit" is any transaction spending out#0, so it also matches a direct return. Check for an output at mix_box instead.
   - Add a WebAssembly test funded with exactly funding_for(boxes, 0, denom), at 1 box and at the cap.
   - Pre-change Bootstraps and 1.5.0 seeds still have their 5 ₳ and merge as before. Keep one test for that path, e.g. a copy of today's lovejoin.test.ts:1858.

3. Then the two red tests:
   - lovejoin.test.ts:1907: expect ["11500000"], and drop the collateral from its comment. The rest of the test passes.
   - sessions-review-fixes.test.ts:432: use spread(60,"500000") or spread(40,"500000"). Both reach sess.bootstrapTooMany.
   - Up to 22 inputs fit; 0.5 ₳ UTxOs leave about 3-4 inputs of margin.
   - If the fix raises a Bootstrap's funding, recheck both: the 11.5 ₳ figure and that margin will move.

4. A public Bootstrap is paid in one transaction from the account, with no session and no return, so this doesn't reach it.

5. CI:
   - PR #323 merged 24 s after its check started.
   - On this tree, CI never ran the preprod-only unit tests, the build or the three e2e steps.
   - I checked the e2e specs. The one Bootstrap e2e (extension.spec.ts:3302) expects "not enough for that many", which the new string still says, and no e2e reaches a private Bootstrap's review.
   - Wait for the full green run on the release PR before merging.

All my throwaway tests are deleted, and no tracked file was touched.

## x-release#0

**high · confirmed · tests** — main is red: two Vitest tests still expect a Bootstrap's 5 ₳ collateral, and CI's later steps never ran on that change

At `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin.test.ts:1905`

**Detail.** 62162483 (PR #323) changed a private Bootstrap's funding to pay for the boxes alone: sessions.ts:1970 adds the SESSION_COLLATERAL payment only when it isn't a Bootstrap, and sessions.ts:1961 gives a Bootstrap no tail reserve. Two existing tests still assume the old shape. (1) lovejoin.test.ts:1899-1905 says giveme.my puts the collateral up and expects payments ["11500000","5000000"]; HEAD gives ["11500000"]. (2) sessions-review-fixes.test.ts:430-436 expects a one-box Bootstrap from spread() (sessions-review-fixes.test.ts:90, 40 UTxOs of 0.7 ₳) to be refused with sess.bootstrapTooMany (sessions.ts:1983). That spread was sized to need too many inputs only while the 5 ₳ was included; without it, one transaction funds the box. CI run 40109672647 (job 120918569798, head a6ab608d) failed at 'Extension unit tests' with exactly these two. It then skipped the preprod-only unit tests, the extension build, both e2e suites and the store package with its e2e. PR #323 merged at 16:02:25Z, 24 s after that CI started, and the run finished red at 16:14:33Z. main's branch protection requires no status checks (required_status_checks.contexts is empty). The last fully green run was d5b53625 (run 40060515681), before the Bootstrap change.

**Scenario.** The review PR into main fails the Web Wallet check at its unit tests, and release step 1's `npm test` fails the same way. Meanwhile the build, e2e and store-package e2e have never run on the Bootstrap change. The refusal 'That Bootstrap needs more UTxOs than one transaction can spend' also has no working test now: the old test passes its first assertion and never reaches it. A regression back to 'parts its deposit, then can't pay' (the 1.6.0 review's bootstrap-cap-vs-funding-parts bug) would go unseen.

**Confirmed how.** Both: I read CI log 40109672647 (the two AssertionErrors, and steps 15-19 skipped), and checked the timings with gh pr view 323 and gh run list. I wrote a throwaway test, tests/zz-review-x-release-bootstrap.test.ts (now deleted), with the same setup as sessions-review-fixes' Bootstrap block. It printed: 40 × 0.7 ₳ with 1 box builds as one transaction, parts none, payments ["11500000"]. 40 × 0.5 ₳ with 1 box, and 40 × 0.7 ₳ with 2 boxes, are both refused with 'That Bootstrap needs more UTxOs than one transaction can spend. Bootstrap fewer boxes.'

**Suggested fix.** lovejoin.test.ts:1905 should expect ["11500000"], and its comment at 1899-1901 should say a Bootstrap pays no collateral. sessions-review-fixes.test.ts:432 should use spread(40, "500000") (or Bootstrap 2 boxes), so the refusal is reached again; keep the 'fewer' half as it is. Then get the whole Web Wallet workflow green on the release PR: both unit runs, the build, e2e, e2e:data and the store package with its e2e. Wait for the check before merging; making it required is the owner's choice.

**Test idea.** Both tests fail on HEAD and pass after the edit. Mutation-check: adding SESSION_COLLATERAL back to a Bootstrap's funding (sessions.ts:1970) fails the edited lovejoin.test.ts line, and removing the sess.bootstrapTooMany mapping (sessions.ts:1983) fails the edited sessions-review-fixes case.

**Skeptic (confirmed, medium).** This one holds up. HEAD's tree (c5d82f2e) is the same tree as a6ab608d, the PR head CI tested, and the working tree has no changes to these files, so both failures are on HEAD as it stands. The code is what the owner asked for: commit 62162483 and the plan's Session 11, call 4, say a Bootstrap needs no collateral. So the tests are out of date, not the code. sess.bootstrapTooMany is used at sessions.ts:1983 and checked in one test only, sessions-review-fixes.test.ts:436. That test now fails at its first assertion, so the refusal has no test that works. main's branch protection requires no checks, so nothing stopped the red merge. The release PR's Web Wallet check and release step 1's `npm test` will fail until both tests are fixed. Until then the build, both e2e suites and the store package's e2e have not run on the Bootstrap change. One correction to the suggested fix: the comment at lovejoin.test.ts:1899-1901 is about giveme.my's collateral on the funding's own Seedelf spend, and that is still true. Only the expected payments at :1905 are stale.

Evidence: CI job 120918569798 (run 40109672647, head a6ab608d, ran 16:01:59Z-16:14:34Z, PR #323 merged at 16:02:25Z), log lines 3618-3640: 'FAIL tests/lovejoin.test.ts > mixing from the tile > mixes from the private balance… AssertionError: expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]' and 'FAIL tests/sessions-review-fixes.test.ts > a Bootstrap's funding … promise resolved "{ …(15) }" instead of rejecting' (the resolved summary shows inputs: 21). Line 3700: 'Test Files 2 failed | 225 passed'. Steps skipped: preprod-only unit tests, Extension build, e2e, Data layer e2e, Store package. `git rev-parse 499768f6^{tree} a6ab608d^{tree}` gives the same hash for both. Last green: run 40060515681 at d5b53625. HEAD sessions.ts:1961 (`mix.bootstrap ? 0n`), :1970 (no SESSION_COLLATERAL output for a Bootstrap), :1983 (the TOO_MANY → sess.bootstrapTooMany mapping). lovejoin.test.ts:1905. sessions-review-fixes.test.ts:90 spread(40,'700000') and :430-436. gh api …/branches/main/protection: required_status_checks.contexts [] and checks [].

**Reproduction (confirmed, high).** HEAD is 499768f6. Its tree, c5d82f2e, is the same tree as a6ab608d, the commit CI tested. Every throwaway test below was run alone with `nice -n 19 npx vitest run <file> --maxWorkers=1` and then deleted. No zz-review files are left.

1) The two red tests, reproduced. File: tests/zz-review-x-release-repro.test.ts, which copied each test's exact setup.
- A1 used lovejoin.test.ts's tile wallet() and the SessionService from :1875-1896, then `mixOutBuild("preprod",1,{bootstrap:true})`. Asserting the old `payments == ["11500000","5000000"]` FAILED with "AssertionError: expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]". It printed mix.lovelace 11500000, collateralReserve undefined, parts undefined. CI failed the same way at tests/lovejoin.test.ts:1907:52.
- B1 used sessions-review-fixes.test.ts's spread() (:90, 40 × 0.7 ₳) and withLovejoin() (:418-428). Asserting the old refusal with sess.bootstrapTooMany FAILED with "promise resolved "{ …(15) }" instead of rejecting". It printed: one transaction, inputs 21, payments ["11500000"], fee 953040, change 2246960, nothing submitted. CI failed the same way at :435:74.

2) The suggested fixes, checked. All of these passed:
- `payments == ["11500000"]` with no collateralReserve.
- The whole lovejoin.test.ts:1875-1951 test with only :1907 changed runs to its end, so nothing else was hiding behind that first failure.
- spread(40,"500000") with 1 box, spread(40,"600000") with 1 box and spread(40,"700000") with 2 boxes are all refused with "That Bootstrap needs more UTxOs than one transaction can spend. Bootstrap fewer boxes." Nothing is submitted and giveme.my isn't asked.
- The 'fewer' half (3 × 40 ₳) builds with no parts.

3) CI and the merge, checked with gh:
- Run 40109672647, job 120918569798: 2 failed | 2582 passed. Step 14 (Extension unit tests) failed; steps 15-19 (preprod-only unit tests, build, e2e, e2e:data, store package and its e2e) were skipped.
- The check started at 16:02:01Z. PR #323 merged at 16:02:25Z. The check failed at 16:14:33Z.
- main's protection has required_status_checks contexts=[] and checks=[], and enforce_admins is false. web-wallet.yml runs on pull_request only, so nothing has run on main since the merge.
- The last green run was 40060515681, on d5b53625.
- Line corrections: the stale assertion is lovejoin.test.ts:1907, with its comment at :1898-1900 (the finding said 1905 and 1899-1901). In sessions-review-fixes.test.ts the spread() call is :432 and the refusal assertion is :435.

4) What this hides: a real regression from the same change, found by dropping the 5 ₳ UTxO the tests make up. The tile flow was copied exactly; the funding then lands only as HEAD builds it.
- 1 classic box, funding ["11500000"]. advance() recorded ["out","back"] with mix.skipped "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA". The direct return sent back 11329439 (fee 170561). No box went in.
- 2 classic boxes, funding ["21500000"]: same skip.
- Token pool, 2 boxes, funding ["5500000"] + 2Q tokens (tests/zz-review-x-release-token.test.ts, lovejoin-merged-review.test.ts's helpers copied). Without the extra 5 ₳: intoToken false, kinds ["out","back"], same skip. The control, with lovejoin-merged-review.test.ts:1180's extra 5 ₳ UTxO at #1, went in: ["out","deposit","back"].
- Threshold for 1 classic box: extra lovelace at the account of 0, 200000 and 300000 all fail. 350000 builds the chain (chain fees 344114, returned 1505886). So the account needs at least 10 + 0.344114 + 1.45678 = 11.800894 ₳, and it is funded with 11.5.

The trace on HEAD:
- sessions.ts:1914 takes `lovejoin.funding(...,0,...)`, which is funding_for_in = DEPOSIT_RESERVE 1.5 ₳ + boxes × box (seedelf-core/src/lovejoin/mod.rs:1591, :1633; wasm lovejoin.rs:1959).
- sessions.ts:1961 sets the reserve to 0, and :1964-1971 pays that one output, with no 5 ₳.
- After the funding lands, buildBack finds no collateral (sessions.ts:4160). For a deposit-only chain (:4164) it calls lovejoin.chain with collateral undefined.
- wasm chain_at → with_return: tail is None (lovejoin.rs:1752), rows = [deposit change] and merge = [] (:1795), so the return is build::external_sweep (:1808).
- The deposit's change is 1.5 ₳ minus its fee, about 1.32 ₳. Minus the sweep's fee that is under the Seedelf minimum, so deposit_outputs bails TooLittle (seedelf-core/src/build.rs:376).
- sessions.ts:4199 sets skipped = leftOut(e), and the session comes back directly.

Why: Confirmed exactly as reported. On HEAD, lovejoin.test.ts:1907 still expects the 5 ₳ collateral payment that 62162483 removed (sessions.ts:1970). sessions-review-fixes.test.ts:432's spread() no longer reaches sess.bootstrapTooMany (sessions.ts:1983), so that refusal has no working test. CI went red on PR #323's head and skipped the build, both e2e suites and the store package. The PR merged 24 s after CI started, and nothing requires the check.

On their own the two red tests are medium, as reported. I rate the report high because the same out-of-date assumption is hiding a real regression. Four Bootstrap tests that pass still add a 5 ₳ UTxO at #1 that HEAD's funding no longer pays: lovejoin.test.ts:1858, lovejoin-flows.test.ts:254, and lovejoin-merged-review.test.ts:555 and :1180. Without that UTxO, every private Bootstrap fails, classic or token pool, 1 or 2 boxes.

The 1.5 ₳ reserve was sized for a return that took the 5 ₳ back with it. Without the 5 ₳, the deposit's change of about 1.32 ₳ can't pay a sweep back into the private balance. The chain can't be built.

What a user sees: they review "Bootstrap N boxes" and send it. When the funding lands, no box goes in. Everything comes back directly with "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA". They lose the funding's fee and the return's fee (about 0.17 ₳) on every try. A token pool can't be bootstrapped from the private balance.

Fixing only the two tests makes CI green over this bug. None of the steps CI skipped (build, both e2e suites, store package) builds a Bootstrap's chain, and neither does the live run, so none of them would catch it.

**Fix notes.** A. The two red tests.
- lovejoin.test.ts:1907 should expect ["11500000"]. Keep the comment at :1898-1900: it's about giveme.my's collateral on the funding's own Seedelf spend, which is still true. The rest of that test passes once :1907 is fixed.
- sessions-review-fixes.test.ts:432 needs a spread clearly past the limit. 0.7 ₳ with 1 box builds with 21 inputs and 0.6 ₳ is refused, so the edge sits close. spread(40,"500000"), or 0.7 ₳ with 2 boxes, is refused. Keep :438-443 as they are. Mutation check: drop the TOO_MANY mapping at sessions.ts:1983 and the test must fail.

B. The trap: don't merge A alone. A private Bootstrap at HEAD can't build its chain.
- The cause: DEPOSIT_RESERVE is 1.5 ₳ (seedelf-core/src/lovejoin/mod.rs:1591). funding_for/funding_for_in (:1750, :1633) give a Bootstrap boxes × box + 1.5 ₳. bootstrap_most (:1762) only builds the deposit, and its doc at :1753-1761 still says the funding sits "beside a collateral the deposit never spends".
- With no collateral, with_return sweeps only the deposit's change (wasm lovejoin.rs:1795, :1808). That sweep must hold minimum_seedelf_payment (1456780) after its own fee.
- Measured for 1 classic box: deposit plus sweep fees are 344114. The reserve needs to be about 1.80 ₳ or more, and it grows with the deposit's fee for each box.

Fix it in core and the WebAssembly, for a deposit-only chain with no collateral only:
- Give a private Bootstrap its own reserve: deposit fee + sweep fee + Seedelf minimum. Build it, don't estimate it, as bootstrap_most already builds the deposit, and have bootstrap_most check the sweep as well.
- The extra comes back with the return, so a user pays nothing more in the end.
- Leave mixes alone: they put up a collateral and merge. The public-account Bootstrap (lovejoin.rs:2079) pays its change to a key address and needs nothing.
- Putting the 5 ₳ back would also work, but it goes against the owner's call of 2026-10-23/24.
- The CLI doesn't use core's lovejoin module.

Keep these in step with the new reserve:
- the Bootstrap funding amount that lovejoin.funding returns (sessions.ts:1914) and the review's "For the boxes and network fees" figure
- the form's bound bootstrapLimits, and lovejoin-release-rules.test.ts:481-487's 302/302.5 ₳
- the lovejoin.bootstrap.cantAfford words (en, es, ja)
- the reserve figures in docs flows.md, architecture.md and privacy.md

C. Tests that must model HEAD's funding:
- Drop the made-up `atSession(out.txHash, 1, "5000000")` at lovejoin.test.ts:1858, lovejoin-flows.test.ts:254, and lovejoin-merged-review.test.ts:555 and :1180. With that UTxO there, sessions.ts:4160 takes it as collateral and the return merges under it, which is the pre-62162483 shape.
- Over-funded tests of the same path: lovejoin-planner.test.ts:1184 (40 ₳) and wasm/tests/lovejoin_test.rs:321 (30 ₳ for 2 boxes). Fund them at exactly funding_for, or add tests that do.
- Add tests at the exact funding: 11.5 ₳ for 1 classic box, and 5.5 ₳ + 2Q for 2 token-pool boxes. Each must give deposit + back with no skip. Both fail on HEAD.

D. Release:
- Get the whole Web Wallet workflow green on the release PR: both unit runs, the build, e2e, e2e:data, and the store package with its e2e. That has never run on the Bootstrap change.
- Before release, do one real private Bootstrap on preprod at the funded amount.
- Making the check required is the owner's call.

## x-scenarios-lj#0

**high · confirmed · correctness** — A private Bootstrap never puts a box in: with no collateral, its deposit's change can't pay for the sweep back, so the chain fails and the session comes straight back

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1970`

**Detail.** Since 62162483, mixFunding funds a private Bootstrap with the boxes alone. sessions.ts:1961 sets the reserve to 0, and sessions.ts:1970 drops the 5 ₳ collateral payment, so the one-time account holds exactly funding_for(N, 0, denom) = DEPOSIT_RESERVE (1.5 ₳, core lovejoin/mod.rs:1591, 1750) + N × box ADA, plus the token for a token pool. The worker's chain() now lets the missing collateral through for depth 0 (lovejoin.ts:2964), and WebAssembly's chain_at builds the deposit. Its change is 1.5 ₳ minus the deposit fee, about 1.3 ₳ of ADA alone. Before, with_return merged that change with the 5 ₳ collateral. Now, with held.collateral None, it sweeps the change alone with no merge (wasm/src/lovejoin.rs:1786-1797, then api::plan_return at :1801). A sweep's Seedelf output must hold at least 1.456780 ₳, so the build fails with "A Seedelf deposit of these tokens needs at least 1.456780 ADA". buildBack catches that as a chain failure (sessions.ts:4199, leftOut → sess.skip.warn.chainFailed), sets mix.skipped, and builds a direct return of the whole funding (sessions.ts:4268). The runner sends it by itself (act, sessions.ts:3355). core's bootstrap_most (mod.rs:1762) still describes the session as holding "a collateral the deposit never spends". The new tests pass only because they over-fund: wasm/tests/lovejoin_test.rs:321 funds 30 ₳ for 2 boxes, and lovejoin-planner.test.ts:1487 uses setUp's 40 ₳ for 1 box. Neither funds what mixFunding pays.

**Scenario.** A user opens a pool's Help start the pool (the form's side defaults to private) and asks for 1 classic box. The review says 1 box goes into Lovejoin and nothing is mixed. They send it, and the one-time account receives 11.5 ₳. When it lands, the runner builds the chain: the deposit is fine, but the sweep of its ~1.3 ₳ change is refused. The session then comes back directly: 11.329439 ₳ returns to the private balance, no box ever enters the pool, and the warning reads "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA". The funding fee and the return's ~0.17 ₳ are gone. Every retry does the same, for any count and for token pools (1 or 5 boxes of a 4.5 ₳ token pool fail identically). So the private side of Bootstrap, the owner's "must be done" feature and the form's default, does nothing but spend fees. The launch review's 'Bootstrap next' leads to the same form.

**Confirmed how.** Three throwaway tests, all deleted. (1) wasm/tests/zz_review_x_scenarios_lj_bootstrap.rs: lovejoin::chain at depth 0 with collateral None, utxos exactly lovejoin::funding(...).lovelace, for 1, 2, 5, 10 and 30 classic boxes. Every case was refused with "A Seedelf deposit of these tokens needs at least 1.456780 ADA" (funded 11500000 … 301500000). (2) zz_review_x_scenarios_lj_bootstrap_token.rs: a 4.5 ₳ LJTEST pool through chain_in, funded by funding_in plus its token, for 1 and 5 boxes. Same refusal. (3) extension/tests/zz-review-x-scenarios-lj-bootstrap.test.ts, real WebAssembly: mixOutBuild("preprod", 1, {bootstrap: true}) gave one payment of 11500000. With the account holding exactly that, backBuild returned lovejoin: null, lovejoinSkipped "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA", lovelace 11329439, and no chain. Also read the code end to end.

**Suggested fix.** Fund a private Bootstrap with what its return needs, not just its deposit. One way is a Bootstrap reserve whose deposit change pays a sweep's least Seedelf output plus the sweep's fee (about 1.5 ₳ more; measure it with minimum_seedelf_payment and the sweep's fee), held to by core's bootstrap_most, privateBootstrapMost and the form's bootstrapLimits. Another is to pay the deposit's change straight into a fresh Seedelf register inside the deposit, so there is no return transaction at all. Or restore the 5 ₳ collateral for Bootstraps until one of these lands. Either way, the deposit's change must pay its own way back, or a lock between the deposit and the return leaves it stuck at the one-time account (sess.tooLittleBack). The docs' "its funding's fixed 1.5 ₳ pays the deposit's fee and change" and "what comes back later is a sweep" (flows.md, architecture.md, privacy.md) should follow.

**Test idea.** WebAssembly: chain_at/chain_in at depth 0, collateral None, the account holding exactly lovejoin::funding / funding_in's lovelace (and token) for N boxes, classic and a token pool. Expect kinds ["deposit","back"], and the back's Seedelf output at or above its minimum. Vitest: mixOutBuild(..., {bootstrap: true}), put exactly payments[0] at the session's account, backBuild. Expect review.lovejoin.boxes === N and no lovejoinSkipped. Both fail on HEAD.

**Skeptic (confirmed, high).** This holds on HEAD, and I reproduced it myself. A private Bootstrap is now funded with exactly DEPOSIT_RESERVE (1.5 ₳) plus N boxes and no 5 ₳ collateral. With no collateral, the return has nothing to merge, so it sweeps the deposit's change on its own: 1.5 ₳ minus the deposit fee, about 1.33 ₳. A sweep needs a Seedelf output of at least 1.456780 ₳ plus about 0.17 ₳ of fee, so the build is refused. Nothing else catches this. unstale only retries StalePool. leftOut turns the error into sess.skip.warn.chainFailed. The runner (bringBack, then sendBack) then sends a direct return of the whole funding without asking. No box ever goes in, on either network, for any count and for token pools too. The private side is the form's default (Lovejoin.tsx:2177). Every attempt burns the funding fee and about 0.17 ₳ for the return, and the review had said N boxes go into the pool. Each attempt gets its ADA back, so nothing is locked, but every use loses money and this blocks the release. It is not an owner-call. The owner chose no collateral and a sweep back (chunk-34 plan, Session 11 item 4), not a Bootstrap that never deposits. The doc comment on core's bootstrap_most is stale too: it still describes 'a collateral the deposit never spends'.

Evidence: HEAD: sessions.ts:1961 (reserve 0n for a Bootstrap) and :1970 (no 5 ₳ payment). seedelf-core/src/lovejoin/mod.rs:1591 (DEPOSIT_RESERVE) and :1750-1751 (funding_for = 1.5 ₳ + N×denom at depth 0); :1758-1761 is the stale comment. wasm/src/lovejoin.rs:1787-1801: with held.collateral None, merge is &[] and plan_return/external_sweep take [change] alone. seedelf-core/src/build.rs:537 is the TooLittle refusal. lovejoin.ts:3610-3616: unstale rethrows. sessions.ts:4199 calls leftOut (sessions.ts:5653-5657, chainFailed), then the direct buildSessionReturn at about 4268; sessions.ts:3355 calls bringBack (3868-3877), which runs sendBack unasked. I wrote a throwaway Vitest on the built WebAssembly, a copy of lovejoin-planner.test.ts's Bootstrap case with the account holding exactly mixOutBuild's payment and the 5 ₳ removed, and deleted it after. 1 box at 11500000: backBuild gave lovejoin null; lovejoinSkipped and mix.skipped both read 'the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA'; 11329439 came back directly (fee 170561). 2 boxes at 21500000: the same. Adding 0.3 ₳: still refused. Adding 0.4 ₳: it builds deposit and back (fees 342530), so the shortfall is 0.3 to 0.4 ₳ for one box. The existing tests over-fund: wasm/tests/lovejoin_test.rs:321 funds 30 ₳ for 2 boxes, and lovejoin-planner.test.ts:1487 funds 40 ₳ for 1.

**Reproduction (confirmed, high).** I reproduced it on HEAD 499768f6 with a throwaway Vitest file, now deleted: seedelf-platform/seedelf-web-wallet/extension/tests/zz-review-x-scenarios-lj-repro.test.ts. It used the real WebAssembly from wasm/pkg and the harness from lovejoin-flows.test.ts (fake Koios, giveme.my stood in). Each case ran sessions.mixOutBuild("preprod", N, {bootstrap:true[, pool:TOKEN]}), then mixOutSubmit. The funding then landed exactly as paid, one UTxO of out.mix.lovelace (plus N×Q LJTEST for a token pool), and sessions.advance(index, true) ran. It asserted that record.mix.skipped is undefined and that one sent tx spends the funding and pays the pool's mix_box.

Results on HEAD:
- **Control:** 11.5 ₳ plus the 5 ₳ the funding paid before 62162483. It PASSED: deposit then back, 1 box in, chain recorded {bootstrap:true}.
- **Classic, 1 box:** payments ["11500000"] (one output), funding fee 230,260. It FAILED: 1 tx sent, a direct return spending only the funding UTxO, 11,329,439 back. Session txs were [out, back], no chain was recorded, and mix.skipped read "the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA".
- **Classic 5, 30 and 53 boxes:** 53 is privateBootstrapMost on preprod; the fundings were 51.5, 301.5 and 531.5 ₳. All failed the same way, return fee 170,561.
- **Token pool, 1 box (3.5 ₳ + LJTEST) and 5 boxes:** same failure, return fee 172,717, funding fee 232,416.
- **Extra ADA in the funding UTxO:**
  - 1 classic box: +200,000 and +300,000 still failed; +400,000 deposited (deposit fee 171,969, sweep output 1,557,470).
  - 53 boxes: +600,000 failed; +800,000 deposited (deposit fee 515,213).

Trace on HEAD:
1. The form's side defaults to private (Lovejoin.tsx:2177).
2. sessions.ts:1914 calls funding at depth 0, which is core funding_for_in (lovejoin/mod.rs:1632-1634): DEPOSIT_RESERVE (1.5 ₳, mod.rs:1591) plus N×denom.
3. sessions.ts:1961 sets reserve 0, and :1965-1970 pays one output with no 5 ₳.
4. The runner, sessions.ts:3355, calls bringBack, then buildBack (:3871).
5. collateralFits (sessions.ts:982) wants exactly 5 ₳, so there is no collateral. depositOnly (:970) is true, so lovejoin.chain runs with fixed 0 (:4172-4196).
6. lovejoin.ts:2964 lets the missing collateral through. WASM chain_at follows, where mixes_collateral (wasm/src/lovejoin.rs:885-891) is None and the deposit builds. Its change is 1.5 ₳ minus the deposit fee, about 1.33 ₳.
7. with_return: no tail. attempt(None) takes the change alone with merge &[] (:1786-1797), then plan_return (:1801), then build::external_sweep (:1808).
8. settle drafts first at a 200,000 fee (core build.rs:255). deposit_outputs refuses that draft with TooLittle (build.rs:376). With no strangers to drop, the error propagates through attempt(None)? (:1840).
9. unstale (lovejoin.ts:3616) rethrows it. buildBack's catch (sessions.ts:4199) turns it into leftOut, so sess.skip.warn.chainFailed, and sets mix.skipped (:4208). It then falls to the direct return, buildSessionReturn (:4268), and bringBack's sendBack sends that without asking.

Why: The finding holds on HEAD. Since 62162483, every private Bootstrap, any count and classic or token pool, is funded with exactly 1.5 ₳ beside its boxes and no collateral. The deposit's change is about 1.33 ₳. With no 5 ₳ to merge with, the return must sweep that change alone, and core refuses it, because it needs 1,456,780 plus the sweep's first draft fee. The chain is dropped, mix.skipped is set, and the runner sends a direct return of the whole funding by itself. No box ever goes in, while the review said N boxes would.

Nothing is locked or sent to anyone else: the principal comes back. But every try burns about 0.40 ₳ (230,260 funding fee + 170,561 return fee for a classic box; 232,416 + 172,717 for a token box) and does nothing. A retry fails the same way. This is the form's default side of a headline 1.6.0 feature.

I measured on preprod only. Mainnet should fail the same way, since it uses the same code, the same fixed 1.5 ₳ and, as far as I know, the same per-byte and fee parameters; I didn't run it.

It is not an owner-call. The owner chose no collateral and a sweep back (chunk-34 plan line 956, Session 11 item 4), not a Bootstrap that never deposits. The control, the same Bootstrap with the old 5 ₳, deposits and comes back fine. So it is the missing collateral, combined with the 1.5 ₳ reserve, that breaks it.

This is high because it hits every user of that path and loses fees on every try. The only reason to rate it medium would be that the loss is bounded fees, not principal.

**Fix notes.** 1. **Where to fix: the funding, not with_return.** With no collateral, the deposit's change is all the return has, so the change has to pay its own sweep. Use a reserve for a private Bootstrap alone. Don't raise DEPOSIT_RESERVE (mod.rs:1591) globally: boxes_affordable_in, again_affordable_in, plan_across, funding_for and every mix's funding share it.

2. **One reserve, used in four places.** The same Bootstrap reserve must go to:
   - WASM lovejoinFunding's Bootstrap path, called from sessions.ts:1914;
   - core bootstrap_most (mod.rs:1762-1808). Today it builds only the deposit and accepts change down to a key address's least: at preprod's cap of 53 boxes the change is 984,787. It must also require the change to cover the sweep;
   - the worker's privateBootstrapMost (lovejoin.ts:2491);
   - the form's bootstrapLimits (Lovejoin.tsx).

3. **Trap: the sweep's first draft fee.** settle drafts at a 200,000 fee first (core build.rs:255), and deposit_outputs refuses that draft before the fee settles. So the change must be at least minimum_deposit(params, no tokens) (1,456,780 today) + 200,000, not + the real fee of about 170,561. That is why +300,000 still failed for 1 box. Measured over today's funding: 1 classic box needs more than +300,000 and no more than +400,000 (deposit fee 171,969). The 53-box cap needs more than +600,000 and no more than +800,000 (deposit fee 515,213). Roughly: deposit fee(N) + 1,456,780 + 200,000 − 1,500,000. The cap shrinks as a result, so either build the sweep inside bootstrap_most too, or derive the reserve from the deposit fee at the cap.

4. **Alternatives:**
   - Pay the deposit's change straight into a fresh register and end the chain at the deposit. This is riskier: a session chain's id is its return's, and the records expect a "back".
   - Pay the 5 ₳ again for a Bootstrap (the control shows that works). This reverses the owner's 2026-10-23/24 call, so only with the owner.

5. **What isn't affected:** a public-side Bootstrap, whose change goes back to the public account, and Bootstraps or seeds funded with 5 ₳, which still work.

6. **Tests that hide the bug by over-funding:**
   - wasm/tests/lovejoin_test.rs:321 (30 ₳ for 2 boxes);
   - extension/tests/lovejoin-planner.test.ts:1487-1510 (setUp's 40 ₳ for 1 box);
   - extension/tests/lovejoin-flows.test.ts:254, which adds a 5 ₳ UTxO HEAD's funding never pays. Line :432 is a normal mix and is fine.

   New tests should fund exactly payments[0], or lovejoin::funding_in's lovelace and token, for 1 box and at bootstrap_most's cap, in the classic and a token pool. Expect a deposit and a back, and no mix.skipped.

7. **Docs to follow the fix:**
   - privacy.md:198 ("a fixed 1.5 ₳ for the deposit's fee and change", "53 … 35 to 40");
   - flows.md:522 (the same claims, and "what comes back later is a sweep");
   - flows.md:512 (the 1.5 ₳ "Room for network fees");
   - core mod.rs:1755-1761, which still says "beside a collateral the deposit never spends", stale since 62162483.

The throwaway test is deleted and the working tree is clean.

## 309#0

**medium · confirmed · state** — Opened from Home's row while waiting, the Collateral page competes with Home's watch; when the page sees the landing first, Home's banner stays on "sent" and Home holds payments for up to 10 minutes

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:78`

**Detail.** Collateral.tsx:78-98 runs the page's own `pending-tx` watch whenever the status is "waiting", whichever way the page was opened. Its header (lines 11-17) says only Settings' page waits and asks; opened from Home or Lovejoin, the payment is Home's banner's. But Home.tsx:664 mounts the page in place, so Home stays mounted, and its own watch keeps polling `pending-tx` (Home.tsx:498-502). In the worker, `pending()` (pending.ts:1030) calls `settleNow`. At the landing (pending.ts:754 onward) it removes the watch and answers only the first caller with the confirmations; every later call gets null. Home's `watch` (Home.tsx:358-363) keeps an ordinary sent payment as it was when the answer is null (it drops only a maybe-sent one) and never calls `load`. So `watching` (Home.tsx:495) stays true until HOLD_MS, 10 minutes after the send. While watching, the banner shows "Collateral payment sent. Waiting for the network…" with no Dismiss (PendingBanner.tsx:302,308). After that it says "Collateral payment not confirmed yet. It can land until about … If it hasn't by then, nothing was sent" (en.json:1484-1485). The Public tab row keeps "Waiting for the network to confirm it", because its effect (Home.tsx:385-395) re-reads only on a new `balances` or a tab change. flows.md:143 ("Sent from Home or Lovejoin, it goes to Home's banner, which follows it to 'Collateral set'") is then false. Pages in two windows starve each other the same way: Settings' page in a tab now competes with Home in the side panel.

**Scenario.** Public tab → Collateral row → Set collateral → Send. Home shows "Collateral payment sent. Waiting for the network…" and the row says "Waiting for the network to confirm it". The user taps the row to follow it, and the page polls at once and every 15 s. About half the time its poll sees the block before Home's next 15 s tick, and it shows "Set: 5 ₳ kept aside for running contracts." The user presses Back. Home still says the payment is waiting, with no Dismiss. Send, Make private, Create and Staking are disabled with "Wait for the last transaction to confirm" until 10 minutes after the send, and the row still says it's waiting. Then the banner says the payment isn't confirmed and may not have been sent, though it is on chain. The only ways out are waiting, or opening Settings and coming back so Home remounts.

**Confirmed how.** Read the code, and ran a throwaway Vitest, tests/zz-review-309-two-watchers.test.ts (deleted). After buildCollateral and submitCollateral on the 12-word account, and the payment landing (addedToAccounts, confirmations = 1), the first PendingService.pending() returned confirmations 1, and coins.collateral() then said "set". The second pending() returned null. Applying Home's null branch kept the unconfirmed payment, and `watching` was still true 9 minutes after the send.

**Suggested fix.** Opened in place (onSent given), the page should not ask `pending-tx`. Home's watch already follows the payment and reads the balances again when it lands. The page can re-read `collateral` from the last reading every 15 s, as Lovejoin's form does, e.g. `if (!onSent) { const p = await call("pending-tx", {}); if (still waiting) return; }` before the `collateral` read. Separately, Home's `watch` could treat a null answer for an ordinary unconfirmed payment as settled by another page: call `load(false)` and stop holding. That also fixes the two-window case.

**Test idea.** e2e: send from the Public tab row, then `koios.addedToAccounts.push(collateralMadeBy(tx)); koios.confirmations = 1;` and click the row straight away, so the page's first poll settles it. Wait for "Set", press Back. Expect `pending-tx` to say "Collateral set" (or be gone), `home-collateral` to have count 0, and Send to be enabled. On HEAD the banner still says "sent. Waiting for the network…" and Send is disabled.

**Skeptic (confirmed, medium).** This survives every refutation I tried. On HEAD the page's own `pending-tx` look runs whenever the status is "waiting". It isn't gated on `onSent`, although the header says only Settings' page waits and asks. Home stays mounted under the page opened in place, and Home's watch interval doesn't depend on `screen`, so in one window two askers poll every 15 s. Home's Public tab row stays clickable while it says "Waiting for the network to confirm it", so the race is reached by tapping that row after sending. The worker tells only the first asker about the landing: `settleNow` removes the watch, and later calls return null. The `pending-tx` handler also returns null, since a collateral payment has no parts. On null, Home's `watch` keeps an ordinary unconfirmed payment and never calls `load`. So `watching` stays true until HOLD_MS. Until then: no Dismiss, every payment held, and Dapps and Staking blocked. After that the banner says the landed payment is "not confirmed yet… If it hasn't by then, nothing was sent", which is false about money, and flows.md:143 is false on this path. The way out (Settings and back so Home remounts, or reopening the panel) isn't obvious. It isn't an owner call: chunk 35's record covers Settings' page only ("Home then has no banner for it, since the page's question settled it") and gives the in-place payment to Home's banner. Nothing weighs re-opening the page while it waits. Lovejoin can't reach it: its Set collateral is offered only for "none". Severity stays medium, though no money is at risk and it clears by itself in 10 minutes. Fix: when `onSent` is given, skip `pending-tx` and re-read `collateral` every 15 s, as Lovejoin's form does (Lovejoin.tsx:2214-2226). Optionally, also have Home treat a null answer for an ordinary unconfirmed payment within HOLD_MS as settled elsewhere and call `load(false)`.

Evidence: HEAD: Collateral.tsx:11-17 (header) vs 78-98 (watch with no onSent gate); Home.tsx:663-665 (page mounted inside Home), 356-367 (null keeps a non-maybe-sent payment, no load), 495 (watching until HOLD_MS, line 130), 496-502 (interval keyed on watching/settling only), 384-395 and 1117 (row re-read only on tab/balances change, shown while "waiting"); pending.ts:754-770 (landing removes the watch, returns `seen` once), 1030-1034 (no watch -> null); handlers.ts:216-224; PendingBanner.tsx:297-310; en.json:1484-1485; flows.md:143; docs/archive/plans/chunk-35-small-fixes.md section 1. Throwaway Vitest tests/zz-review-309-skeptic-collateral.test.ts (since deleted): after buildCollateral and submitCollateral, then addedToAccounts plus confirmations=1, the first PendingService.pending() gave confirmations 1, the second gave null, and balances.get then coins.collateral() gave state "set" by "you". Passed.

**Reproduction (confirmed, medium).** I wrote a throwaway Vitest, tests/zz-review-309-indep-row-race.test.ts, ran it alone (nice -n 19, --maxWorkers=1) and deleted it.

**Test setup**
- Worker side: the real handlers.ts `handle` with the real services from tests/fakes.ts `testBalances()`, plus a real PartsService wired as sw.ts:258 does it. So "pending-tx" runs its parts fallback too.
- UI side: modelled line for line on HEAD:
  - Home.tsx:356-366 `watch`, :495 `watching`, :1417 `unsettled`, :545-558 `sent`/`sentHere`, :385-395 the row's effect.
  - Collateral.tsx:78-98 `look`.
- Steps:
  1. 12-word preprod account; `collateral` says none.
  2. `collateral-build`, then `collateral-submit`. Home takes the pending and the kept reading. The row reads "waiting".
  3. Home ticks once; the payment isn't in a block yet.
  4. The page opens in place, reads "waiting" and asks at once; still unconfirmed.
  5. The payment lands: 5 ₳ at 0/0 in addedToAccounts, confirmations = 1.
  6. The next two ticks run, in either order.

**Results**
- Control, Home's tick first: passed. The page said "set", Home had confirmations 1, watching was false, and the row said "set".
- The page's tick first: failed on HEAD.
  - It asserts that 9 min after the send, {homeConfirmations, watching, rowSays} equals {1, false, "set"}. It received {null, true, "waiting"}, and Home never read again (0 loads since the landing).
  - Banner printed at +9 min: "Collateral payment sent. Waiting for the network… c1a5eec086…4271a8 on Cardanoscan". No Dismiss.
  - Banner printed at +11 min: "Collateral payment not confirmed yet It can land until about 15 Jan, 02:00. If it hasn't by then, nothing was sent and its UTxOs count in your balance again. … [button: Dismiss]".

**Trace on HEAD**
1. The row is a clickable button while the state is none or waiting (Home.tsx:1117-1118, 1584-1597).
2. Send (Collateral.tsx:110-116) calls `onSent`, which is Home's `sent` (Home.tsx:664, 545-558): pending set, screen "home", tab "cardano". coin-control.ts:359-361 gives "waiting", so the row says "Waiting for the network to confirm it" (e2e extension.spec.ts:1974).
3. While watching, Home's interval calls `watch` every 15 s (Home.tsx:498-502). That hook sits above the early return at :663-664, so it keeps running while the page shows in place.
4. Tapping the row opens the page (:1118 sets screen "collateral"). The page reads "waiting" (Collateral.tsx:67-68), then asks pending-tx at once and every 15 s (78-93). This isn't gated on `onSent`.
5. In the worker, handlers.ts:216-224 calls pending.ts:1030-1034, which settles (`settleNow` 753-770). At the landing it removes the watch (758) and drops the kept reading (760), and it answers only that caller (`seen`, 770). Only calls in flight at the same moment share the answer (728-737). Every later call gets null: the watch is gone, and parts.shown has nothing for a collateral payment (handlers.ts:221).
6. If the page asked first, it reads `collateral` and gets "set" (Collateral.tsx:85-87). Home's next null keeps its ordinary, unconfirmed pending (Home.tsx:359-362) and returns before `load` (365).
7. `watching` then stays true until 10 min after the send (495):
   - The banner says "sent. Waiting…" with no Dismiss (PendingBanner.tsx:297-309).
   - Send, Make private, Create, Staking and dApps are held (Home.tsx:522, 664, 671, 749). The row stays on "waiting".
   - After 10 min, `settling` (497; the payment carries a slot) asks every 60 s and still gets null. The banner flips to the false "not confirmed yet… nothing was sent" (en.json:1484-1485) with Dismiss.
   - It stays until Dismiss or until Home remounts: Settings and back (App.tsx:157-170) or reopening the panel; Home's pending starts at null (311).

Why: The bug is real and happens in one window. PR #309 introduced it: 1.5.0's Collateral page never asked pending-tx, and Home's null branch hasn't changed since 1.5.0. It isn't an owner call. Chunk 35's record covers only Settings' page ("Home then has no banner for it, since the page's question settled it") and gives the in-place payment to Home's banner. flows.md:143 says that banner "follows it to 'Collateral set'", which is false on this path.

No money is at risk. The worker's status is right, so the page and Settings both say "Set" and no second payment can be built. The hold clears by itself 10 min after the send.

It stays medium because:
- the banner says something false about a payment ("not confirmed yet… nothing was sent" for one on chain);
- every payment is held for up to about 10 min while the page says Set;
- the way out (Settings and back, or reopening the panel) isn't obvious;
- the case is plausible: the row invites a tap while it says waiting, and each tick is about a coin flip.

It sits at the low end of medium.

**Fix notes.** - **Where to fix:** Collateral.tsx:78-98.
  - Ask pending-tx only when the page was opened from Settings (`!onSent`).
  - Opened in place (`onSent` given, under Home, whose watch runs), re-read only `collateral`, at once and every 15 s, as Lovejoin's form does (Lovejoin.tsx:2218-2226).
  - Home's watch then sees the landing and pending.ts:760 drops the kept reading. The banner goes to "Collateral set", and the page's next `collateral` read says Set within 15 s.
  - Update the page's header (Collateral.tsx:11-17) so flows.md:143 stays true.
- **Trap: don't fix it in the worker** by having pending() keep answering the landed transaction to every asker.
  - A freshly mounted Home would then show "Collateral set" after Settings' page saw it land.
  - Chunk 35's record and the e2e at extension.spec.ts:1939-1944 (`pending-tx` count 0) rule that out.
  - If the worker must change, scope it to an asker that names the txHash it follows.
- **Same race, not fixed by the page gate:**
  - Settings' page in the side panel against Home in a tab.
  - Two Homes (panel and tab); this one predates 1.5.0.
- **Optional hardening for that race,** at Home.tsx:359-362:
  - On null, while Home holds an ordinary (not maybeSent) unconfirmed payment within HOLD_MS, call `load(false)` and stop holding (`setPending(null)`). Within 10 min the worker drops such a watch only when it lands. A lock also clears it, but the lock screen remounts Home.
  - Keep the null branch as it is past HOLD_MS: pending.ts:880-890 lets a private payment go unseen after WATCH_MS, and "not confirmed yet" is the intended word there.
- **Lovejoin can't reach it:** Set collateral is offered only for "none" (Lovejoin.tsx:2659), and its `onSent` closes the page (2463-2476).
- **Regression test:** Vitest here runs with no DOM (vite.config.ts `test.environment: "node"`), so it can't render Home. Write an e2e, with `test.slow()` like its neighbours:
  1. Send from the Public tab's row.
  2. Tap the row while it says waiting.
  3. Push the landing so the page's at-once ask comes first, then press Back.
  4. Expect `pending-tx` to say "Collateral set" (or be gone), `home-collateral` to have count 0, and Send to be enabled.

## 316#1

**medium · confirmed · privacy** — A box from a public account's deposit comes back recorded as tied to nothing once its chain record and mix entry are gone (a 1.5.0 public seed's, a released public Bootstrap's)

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1843`

**Detail.** depositAccountOf finds the account whose deposit put a box where it is in one of three places: the chain record (1844), an open MixEntry (1847), or a Koios origin (1849-1850). A public depth-0 chain's record (a seed's or a Bootstrap's) goes RECORD_KEEP_MS after it ends, because its boxes are leaves, not 'not mixed yet' (keep, 4795-4796). Its leaves then live in `leaves` with the owner "public", which makes them `known`, so found() never asks Koios and no origin is ever kept. That leaves only the entry. (a) For a 1.5.0 seed whose record went before the update, no entry ever existed: entries() is built from the chains still kept (1955-1956). (b) Entries close by count, not by box. countBack credits an untracked box's return (a restore's, another device's, a box from before the list, a direct return's collateral leaf) to `released[0]` when no normal mix is open (1988-1989), and the Bootstrap finding above credits the oldest Bootstrap. In both cases withdrawOne writes no `ties` (6176-6178) and the history entry gets no origin (tiedOrigin, 1859-1860). privacy.md:210 says a box brought back from where a public account's deposit put it, a 1.5.0 public seed's included, is recorded as the account's.

**Scenario.** A 1.5.0 user seeded the classic pool from the public account. A pool read more than three hours later dropped the seed's record, and its box, due five hours out, was still there when 1.6.0 installed. After the update its due time comes and withdrawDue brings it back by itself. On chain, the public account's deposit and the new private UTxO are tied. The history entry, though, has no `box:…+public:0`, so a later private Send can pick it together with other private UTxOs and no review names the account it ties. The last boxes of a released public Bootstrap end the same way when a restore's box came back first and closed its entry early.

**Confirmed how.** Read the code, then the same throwaway Vitest (deleted). A 1.5.0-shaped schedule `{ due: [past], chains: [], notMixed: 0, leaves: { "<seed>#0": "public" }, unlock }` with the seed's box listed in the classic pool: withdrawDue sent it by itself, and its history entry's origin was undefined where `box:<tx>+public:0` was expected. The released-Bootstrap path is confirmed by reading only (countBack's `released[0]`).

**Suggested fix.** Keep the tie somewhere that outlives the record. When sortOut drops the record of a public chain that has a deposit and no mixes (a seed or a Bootstrap), write `origins[c.deposit] = { mixed: false, public: true, ...(c.account ? { account: c.account } : {}), seen: now }`, as Koios would say it. sortOut already refreshes `seen` while a box there is listed, and depositAccountOf's third path then finds it. For 1.5.0 seeds whose record is already gone, there are two options, and the choice is the owner's: ask Koios once (made()) about the public-owned `leaves` that have no record before such a box goes back, or correct privacy.md:210.

**Test idea.** Store a 1.5.0 schedule with a public seed's leaf in `leaves` and a past due time: withdrawDue's history entry is `box:<tx>+public:0`. Then release a public Bootstrap with a restore's box in the same pool and let everything come back past RECORD_KEEP_MS: every Bootstrap box's history entry is the account's.

**Skeptic (confirmed, medium).** Both paths reproduce. (a) A 1.5.0 public seed whose record went before the update has no entry, because entries() is built only from the chains kept. Its leaf is `known` through `leaves`, so Koios is never asked and no origin is kept, and depositAccountOf finds nothing: ties are undefined and the history entry is a plain box. (b) Entries close by count. An untracked box coming back while a released public Bootstrap is the pool's only open entry is credited to released[0]. That closes the Bootstrap one box early, so its last box comes back with no tie once its record is gone. This is not a regression from 1.5.0, which recorded no ties at all. But the 1.6.0 doc and depositAccountOf's own comment promise this tie, a 1.5.0 seed's included. Without it, the review of a later private Send that merges the UTxO calls it a box back from Lovejoin and names no account. The cases are narrow but plausible, hence medium.

Evidence: HEAD lovejoin.ts:1843-1852 (chain, then entry, then origins), 1955-1956 (entries from kept chains), 4795-4796 (keep), 4825-4829 (leaves kept as owner), 4899-4901 (found skips known boxes), 6176-6178 and 1859-1860 (ties, tiedOrigin), 1988-1989 (released[0]). Throwaway Vitest (deleted): (a) a store of {due:[past], chains:[], notMixed:0, leaves:{<seed>#0:"public"}}, then withdrawDue sent <seed>#0 and its history origin was undefined, not box:<tx>+public:0. (b) A released public Bootstrap b0 (2 boxes) plus a restore's box f1 that Koios says a mix made, same token pool: f1 came back first with shares back:1, b0#0 came back tied +public:0 and the entry closed, then b0#1 came back with origin undefined. privacy.md:210 promises the tie.

**Reproduction (confirmed, medium).** I wrote a throwaway Vitest, tests/zz-review-316-repro-ties.test.ts, and deleted it afterwards; the working tree is clean again. It used the real WebAssembly, the fakes in tests/fakes.ts and preprod's recorded classic pool, and the same harness as the PRIV-3 tests in tests/lovejoin-release-rules.test.ts. Each test asserts that the history entry of a box brought back from its deposit has the origin `{ id: "box:<tx>+public:0", origin: "own" }`.

Results:
- **control: PASSED.** A 1.5.0 public seed record (ended an hour ago, so still kept) plus one past due time. withdrawDue sent the seed's box and the entry was tied.
- **(a): FAILED.** The schedule was 1.5.0-shaped: `{ due:[now-1m], chains:[], notMixed:0, leaves:{"5e…#0":"public"}, unlock }`. withdrawDue sent the seed's box by itself. Its history origin was `undefined`, `origins` stayed empty, and no tx_info request was made.
- **(b): FAILED.** A real public Bootstrap of 2 boxes (publicBuild, publicSubmit, pumpPublic), its boxes listed at the deposit, plus one box of the wallet's that a mix made (madeByMix), in the same pool. A status read 4 h later dropped the record: chains 0, leaves `{dep#0,dep#1:"public"}`. Then releaseBootstrap, and withdrawDue every 3 h:
  - run 1 brought back the other box (backOrder puts a box that isn't one of ownLeaves first), and the entry became `shares [{boxes:2, back:1}]`;
  - run 2 brought back dep#0, tied (`+public:0`), and the entry was closed and dropped (`mixes []`);
  - run 3 brought back dep#1 with origin `undefined`.
- **(c): FAILED.** This case is wider than the finding: a 1.5.0 seed whose record was still kept at the update. The schedule held a seed record of 2 boxes (ended an hour ago) and an older 1.5.0 session leaf in `leaves` (its record gone, so it has no entry).
  - run 0 brought back the old leaf, which was counted against the seed's entry (made from the record at the first update);
  - 3 h later the record dropped, and the seed's first box came back tied while the entry closed;
  - the second seed box came back untied.
- **(b-fix): PASSED.** This was (b) with `origins[deposit] = {mixed:false, public:true, seen}` injected right after the record dropped. All 3 boxes came back and both Bootstrap boxes were tied.

Trace on HEAD:
1. The record goes. For a depth-0 chain the boxes are its leaves (core fan_out, depth 0), so unmixedOf is empty and keep is false 3 h after it ends (lovejoin.ts:4795-4796). Its leaves move into s.leaves with the owner "public" (4828-4832).
2. recorded() counts s.leaves (1606-1608). So found() leaves the box out of `unknown` (4901), withdrawDue's mixedOf check passes (5624) and made() is never asked. No origin is ever kept.
3. depositAccountOf (1843-1851) finds:
   - no chain record (1844);
   - no entry (1847). For (a), entries() is built only from s.chains (1955-1956). For (b) and (c), countBack credits an entry-less box to `candidates[0] ?? released[0]` (1988-1989), and update() then drops closed entries (6501);
   - no origin (1849-1850).
4. withdrawOne computes no ties (6176-6178), tiedOrigin gives `{}` (6239), and activity classOf records it as `box:<tx>` with origin lovejoin (activity.ts:653-654).

The promise that breaks is in privacy.md:209-210 and in depositAccountOf's own comment (1837-1838).

Why: The bug is real, and medium is the right severity. privacy.md:209-210 promises that a box brought back from a public deposit is recorded as the account's (`box:<tx>+public:N`), so coin selection keeps it apart and reviews name the link. In these cases the box is recorded as tied to nothing, and three things follow:
- a later private Send that merges it says only "a box back from Lovejoin"; histories.ts:191 finds no account in it, so the review names none and skips the two-account warning;
- withdrawOne's private-paid way back (6125) picks it first, as one that "ties no account";
- on chain, the public account's deposit still leads to wherever this private UTxO goes.

Medium, not high, because it takes one of these narrow but plausible starting states:
- a 1.5.0 public seed (offered only when the classic pool was below its floor) with boxes still out at the update;
- a released public Bootstrap, with another box of the wallet's coming back first in the same pool while no other mix of the wallet's is open there.

It isn't a regression: 1.5.0 recorded no ties at all. But 1.6.0's docs claim it, so it counts as a doc stating something false about privacy.

The scope is wider than reported. Case (c) shows that a 1.5.0 seed whose record survived the update also loses its tie. All it takes is a box with no entry coming back first in that pool, and after an upgrade every 1.5.0 box whose record had already gone is such a box.

**Fix notes.** **Where to fix:** sortOut's record drop (lovejoin.ts:4828-4832). Not countBack, not entries.
- Counting returns by number of boxes is the design. A box that someone else's mix moved comes back with no record and must still close its mix, a released Bootstrap's included.
- update() drops closed entries (6501).
- So the tie must not depend on an entry still being open.

**The write:** for each chain whose record goes (`!keep(c)`) where `c.session === undefined && c.deposit && c.mixes.length === 0` (a public seed's or Bootstrap's, whose leaves are its deposit's boxes), do `(s.origins ??= {})[c.deposit] ??= { mixed: false, public: true, ...(c.account ? { account: c.account } : {}), seen: now }`.
- Put it before the origins prune at 4834-4838, which then refreshes `seen` while a box from that deposit is listed.
- It costs no new request.
- `??=` keeps any origin Koios already gave.
- With `mixed: false` and no `mixedIn`, mixedFor (991-992) reads it as a deposit in token pools too, which is right.
- It covers (b), (c), every 1.6.0 Bootstrap, and 1.5.0 seeds whose record is still kept at the update.
- Injecting this exact origin made (b) pass, with all three boxes still coming back by themselves.

**Trap:** an origin with `mixed:false` turns that deposit's boxes into depositsOf boxes (not mixed yet: held, and counted on Home) once they drop out of `s.leaves`, for example after one lagging listing. That is the same answer Koios would give on a later look-up. While a box is still a leaf, recorded() wins (depositsOf 1641-1647, mixedOf 1631-1633, originOf 1761-1766). Cover it with a test anyway.

**Not covered by that fix: case (a),** a 1.5.0 seed whose record was already gone at the update. Its leaf in `s.leaves` ("public" or "public.N") can't be told apart from a public mix's last-mix leaf without asking. This is the owner's call:
- Option 1: look it up once before such a box goes back.
  - lookUp takes the private index's `made_by` from the pool listing with no request on mainnet while the data layer is up (inputsOf 5034ff).
  - Otherwise it costs one Koios tx_info, so the privacy policy's list of Koios reads must allow it.
  - found() and made() skip known boxes, so this needs its own ask.
- Option 2: correct privacy.md:210 and depositAccountOf's comment (1837-1838) to say "a 1.5.0 public seed's whose record was still kept at the update".

**Every way back is covered by one fix:** withdrawDue (5641), withdrawNow (5796) and bringAllBackNow (5959) all go through withdrawOne's depositAccountOf, and settleWithdrawing's late history write (6343) reuses the ties withdrawOne kept.

**Tests to add:**
- (a) a 1.5.0 schedule with a public leaf and a past due time;
- (b) the real Bootstrap flow, as the PRIV-3 Bootstrap test in tests/lovejoin-release-rules.test.ts builds it: clock past RECORD_KEEP_MS (3 h), releaseBootstrap, and a box with no entry (madeByMix) coming back first;
- (c) a kept 1.5.0 seed record plus an older 1.5.0 leaf.

**Related:** with two Bootstraps in one pool, a held box brought back by hand is counted against the pool's oldest Bootstrap (countBack with bootstrap=true). That case ends the same way for ties, and the same origin fix covers its ties.

## 316#2

**medium · confirmed · tests** — Web Wallet CI is red on main's tree: two unit tests still expect a Bootstrap's 5 ₳ collateral (outside PR #316, found checking the gate's CI)

At `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin.test.ts:1907`

**Detail.** PR #323's last code commit, 62162483 ("a Bootstrap is funded with no collateral"), changed mixFunding. The Web Wallet workflow's last run (40109672647, on a6ab608d, whose tree c5d82f2e is main's 499768f6's) failed at 'Extension unit tests'. tests/lovejoin.test.ts:1907 expects `["11500000", "5000000"]` and gets `["11500000"]`. tests/sessions-review-fixes.test.ts:435 expects mixOutBuild of one Bootstrap box to reject with "That Bootstrap needs more UTxOs than one transaction can spend", and it resolves. The workflow runs only on pull requests, so main shows nothing red. The second test's guard (bootstrap-cap-vs-funding-parts) is now never reached, because without the 5 ₳ output its spread fits in one transaction.

**Scenario.** The 1.6.0 release PR to main runs the Web Wallet workflow, and 'Extension unit tests' fails on these two before anything this review changes. Meanwhile the guard against a Bootstrap funding that one transaction can't spend has no test that reaches it.

**Confirmed how.** `gh run view 40109672647` shows these two annotations, and `git rev-parse 499768f6^{tree}` equals `a6ab608d^{tree}`. Not run locally.

**Suggested fix.** Bring lovejoin.test.ts:1903-1907 in line with the owner's call: one payment of 11.5 ₳, and a comment that says no collateral. Give sessions-review-fixes.test.ts's case a spread that still needs more UTxOs than one transaction can spend without the 5 ₳ output (more or smaller UTxOs), so it rejects again.

**Test idea.** The same two tests, passing. Check the second one by mutation: remove the one-transaction check in mixFunding and confirm it fails.

**Skeptic (confirmed, medium).** Real and not fixed. Since 62162483, HEAD's mixFunding pays a Bootstrap's boxes with no 5 ₳ collateral output, the owner's call of 2026-10-23. Two unit tests still expect the old shape. CI failed on a tree identical to HEAD's, and PR #323 was merged while that check was still running. The workflow fires only on pull_request, so main shows nothing red. The release PR's 'Extension unit tests' will fail on these two before any review fix. Meanwhile the sessions-review-fixes case no longer reaches the bootstrapTooMany guard, because 21 inputs now fit one transaction, so that guard has no test that reaches it. Nothing changes for users; it is medium only as a release blocker.

Evidence: gh run 40109672647 (headSha a6ab608d, conclusion failure at step 'Extension unit tests'). Its annotations: tests/sessions-review-fixes.test.ts:435 'promise resolved ... instead of rejecting' (inputs 21, one 11500000 payment); tests/lovejoin.test.ts:1907 'expected [ 11500000 ] to deeply equal [ 11500000, 5000000 ]'. git rev-parse 499768f6^{tree} and a6ab608d^{tree} both give c5d82f2e. HEAD sessions.ts:1961-1970 ('None for a Bootstrap', no SESSION_COLLATERAL output). .github/workflows/web-wallet.yml:3-7 is pull_request only. gh pr view 323: mergedAt 16:02:25Z, check completed failure at 16:14:33Z.

**Reproduction (confirmed, medium).** CI: run 40109672647 (pull_request, head a6ab608d; `git rev-parse` shows a6ab608d^{tree} = 499768f6^{tree} = c5d82f2e) failed at 'Extension unit tests', 2 files failed | 225 passed | 1 skipped. Job 120918569798's log: "tests/lovejoin.test.ts > mixing from the tile > mixes from the private balance through a one-time account that runs itself once funded: AssertionError: expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]" and "tests/sessions-review-fixes.test.ts > a Bootstrap's funding (1.6.0's review: bootstrap-cap-vs-funding-parts) > stays one transaction...: promise resolved "{ …(15) }" instead of rejecting". PR #323 merged at 16:02:25Z, 26 s after the run began (16:01:59Z); the run failed at 16:14:34Z. web-wallet.yml has only `on: pull_request` (paths seedelf-platform/**), and continuous-integration.yml (push to main) never runs npm test, so main itself never shows red.

Local, on HEAD (the WebAssembly pkg was built 2026-10-24 09:07:30, after 62162483 at 09:01:52): throwaway tests/zz-review-316-bootstrap-collateral.test.ts copied both tests' setups. I ran only that file (nice -n 19 npx vitest run ... --maxWorkers=1), then deleted it; git status is clean.
- A-old (lovejoin.test.ts:1903-1907 as written) FAILED: "expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]". It logged payments ["11500000"] and collateralReserve undefined.
- B-old (sessions-review-fixes.test.ts:432-437 as written) FAILED: "promise resolved "{ …(15) }" instead of rejecting". It resolved with inputs 21, one payment of 11500000, fee.total 953040, changeLovelace 2246960, and no parts.
- A-fixed (the whole original test with :1907 as ["11500000"]) PASSED, including the depth-2 mix after it, which still pays ["15300000","5000000"] over 6 chain transactions.
- B-fixed: spread(40,"500000") and spread(60,"400000") each reject with the exact sess.bootstrapTooMany words, with nothing submitted and giveme.my not asked. spread(3,"40000000") still goes as one. PASSED.
- B-mutant: buildFunding's inParts forced on at runtime makes spread(40,"500000") resolve as parts: 2 over 29 inputs. So the fixed case fails without the one-transaction check.

Trace at HEAD:
- sessions.ts:1916: mixOutBuild calls mixFunding({..., bootstrap: true}).
- :1960: the reserve is 0n for a Bootstrap.
- :1969-1970: one output of mix.lovelace, then `...(mix.bootstrap ? [] : [5 ₳])`, which adds nothing.
- :1979: inParts is false, so buildFunding (:2678) runs wasm.buildWithdraw as a single transaction.
- seedelf-core build.rs:2003-2004 raises TooMany only when the measured budget exceeds MAX_TX_BUDGET. 11.5 ₳ plus fee from 0.7 ₳ UTxOs takes 21 inputs, which is under it.
- So the catch at sessions.ts:1982-1984 (sess.bootstrapTooMany) is never reached. sessions-review-fixes.test.ts:436 is the only test of that guard.

Why: Real, and not fixed on HEAD. 62162483 (the owner's call, 2026-10-23/24: chunk-34-token-pools.md:956, flows.md:522) drops a private Bootstrap's 5 ₳ collateral and its reserve in mixFunding, but two older Vitest cases were never updated.
- lovejoin.test.ts:1907 still expects two payments.
- sessions-review-fixes.test.ts:432's spread (40 × 0.7 ₳) now fits one transaction without the 5 ₳. The refusal shown to the user (flows.md:513 describes it) therefore has no test that reaches it.

Users see no change. The production behaviour is the intended one. By the user-harm rubric alone this is low (a risky path untested). It is medium only as a release blocker, and that part is certain, not hypothetical:
- The release PR's 'Extension unit tests' will fail on these two before any review fix.
- Because that step fails first, every later step is skipped: the preprod-only unit run, the extension build, the Chromium end-to-end tests, the data-layer end-to-end tests, and the store package. None of them has run on 62162483's code. The last full green run was 40060515681, on its parent d5b53625.

Checked and found sound:
- HEAD's mixFunding matches the owner's call, and the cantAfford words (en/es/ja) no longer mention collateral.
- The end-to-end Bootstrap case (e2e/extension.spec.ts:3302-3355: 28 ₳ held against 300 ₳, 'not enough for that many') is unaffected by dropping the 5 ₳.
- These were the only two failures in the 227 files that ran. lovejoin-planner.test.ts's new 'funds a Bootstrap with no collateral, and brings it back through its deposit with none put up' covers the new shape and passed.

**Fix notes.** Tests only. Don't touch mixFunding: no collateral for a Bootstrap is the owner's call.

1. tests/lovejoin.test.ts:1907: expect `["11500000"]`. Update the comment at 1905-1906 to say there is no collateral (a Bootstrap's deposit alone runs no script; the owner, 2026-10-23). Optionally add `expect(seeded.collateralReserve).toBeUndefined()`. Leave 1912-1913 alone: the depth-2 mix still pays `["15300000","5000000"]`. Verified: the whole test passes with only that change.

2. tests/sessions-review-fixes.test.ts:432: replace `spread()` with `spread(40, "500000")` (or `spread(60, "400000")`); keep 441's `spread(3, "40000000")`. Both values reject on HEAD with the exact "That Bootstrap needs more UTxOs than one transaction can spend. Bootstrap fewer boxes.", with nothing submitted and giveme.my not asked.
   Trap: don't change `spread()`'s defaults at :90. Five other tests in that file (lines 208, 480, 505, 598, 657) use `spread()` bare.
   Mutation check: forcing `inParts` on for a Bootstrap makes `spread(40, "500000")` resolve as 2 parts over 29 inputs. So the new case fails without the one-transaction check at sessions.ts:1979, and the exact-words `toThrow` also fails if the translation at :1983 goes.

3. Release gate: after this fix, the release PR is the first run since d5b53625 to reach 'Extension unit tests (preprod-only build)' (VITE_ENABLE_MAINNET=false npm test), 'Extension build', the Chromium end-to-end tests, the data-layer end-to-end tests and the store package. Wait for that check to finish green before merging; #323 was merged 26 s into its run. The Web Wallet workflow fires only on pull requests (paths seedelf-platform/**), so main never shows its state. No formatter (no prettier config).

## 318-worker#0

**medium · confirmed · ux-words** — A Bootstrap from the public account: Home's banner says its boxes are on their way to the private balance

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PendingBanner.tsx:101`

**Detail.** publicSubmit gives every chain from the public account the kind "lovejoin-mix", a Bootstrap's single deposit included (src/background/lovejoin.ts:4029, `{ kind: "lovejoin-mix", ..., chain }`, with no Bootstrap flag). The pool page passes it to Home's watch (src/ui/screens/Lovejoin.tsx:2420, onPending). PendingBanner then words it from SENT/CONFIRMED by kind alone (PendingBanner.tsx:77 and :101): first "Mixes into Lovejoin sent. Waiting for the network…", then, once the deposit is in, "In Lovejoin, on their way to your private balance" (en.json:1492, :1456). Since 34d a Bootstrap's boxes are held. chainSent draws them no due time (lovejoin.ts chainSent, `!record.bootstrap`), bootstrapOf keeps them out of every withdraw, and the page itself says they "don't come back by themselves" (lovejoin.bootstrap.held_other). In 1.5.0 a public seed's boxes did come back by themselves (scheduleFound), so the same words were true then. PR #318 changed what happens to the boxes but kept the banner. A private Bootstrap is unaffected: its banner is the funding's "Private session funded".

**Scenario.** A user bootstraps the MIN pool (or the classic pool) with 30 boxes from the public account. Home's banner says "Mixes into Lovejoin sent", then "In Lovejoin, on their way to your private balance". Nothing ever comes back: the boxes stay in the pool until the user presses Bring one back or Bring them all back. The user waits for money that won't arrive. The words also say the account's boxes are heading straight into the private balance, which would tie the account to it, the opposite of what the review said.

**Confirmed how.** Read the code: publicSubmit (lovejoin.ts:4021-4035), the pool page's send (Lovejoin.tsx:2409-2425), PendingBanner's SENT/CONFIRMED maps and render (PendingBanner.tsx:77, 101, 233, 270-280) and the English strings (en.json:1456, 1492). No e2e or unit test sends a public Bootstrap through to the banner: the floor's e2e stops at the review (e2e/extension.spec.ts:3302-3353).

**Suggested fix.** Mark a Bootstrap's PendingTx when publicSubmit sends one (`built.bootstrap`): a `bootstrap: true` field, or a kind of its own. Give it its own words, for example "Bootstrap sent" and "In Lovejoin, held there until you bring them back", in en, es and ja. The confirmed text is a money statement, so it belongs in the critical set.

**Test idea.** In lovejoin-flows' public Bootstrap test, take the PendingTx publicSubmit returns, mark it confirmed, render <PendingBanner> with it, and assert the text doesn't contain "on their way to your private balance" (or does contain the held wording). It fails on HEAD.

**Skeptic (confirmed, medium).** This holds on HEAD and I found no owner decision behind it. A public Bootstrap goes in through the same Send as a mix: Lovejoin.tsx:2407 builds it with bootstrap:true, :2420 sends it with lovejoin-mix-public-submit, and onPending hands the result to Home. publicSubmit makes the PendingTx with a fixed kind, "lovejoin-mix" (lovejoin.ts:4029), and drops the Bootstrap mark, even though publicStart records `bootstrap` on the chain at :4076. PendingTx has no field that could carry it (rpc.ts:875-955). Home's watch (Home.tsx:555-558) and PendingBanner (:233, :277) pick their words by kind only. Nothing on HEAD tells a Bootstrap apart (I searched pending.ts, Home.tsx and PendingBanner.tsx for bootstrap: nothing). So the user first sees "Mixes into Lovejoin sent. Waiting for the network…" and then the done banner "In Lovejoin, on their way to your private balance" (en.json:1456). Every other screen says the opposite: the Bootstrap's own cost line just before Send (en.json:1306-1307, "They stay in the pool until you bring them back"), the held callout (:1163) and Home's row (:792-793). In 1.5.0 the banner was consistent: a seed's words said "The boxes come back by themselves after a while, unmixed" (63f87b8 en.json:1082, 1104). 1.6.0 changed what happens to the boxes but kept the banner. No money is at risk, since the boxes stay the user's and Bring one back works. But a done banner stating something false about where money is fits the rubric's medium (a screen stating something false about money), and the public Bootstrap is a main path, the one that needs no collateral. I don't count the reviewer's privacy angle: the words leak nothing. They are only false.

Evidence: lovejoin.ts:4029 `{ kind: "lovejoin-mix", network, txHash, submittedAt: now(), confirmations: null, chain }` vs :4076 `...(built.bootstrap ? { bootstrap: true } : {})`; rpc.ts:875-955 (no bootstrap field on PendingTx); PendingBanner.tsx:77, :101, :233, :270-281; en.json:1456, :1492 vs :1163, :1306-1307, :792-793; Lovejoin.tsx:2403-2425; 1.5.0 (63f87b8) en.json:1082, :1104-1105, :1253. No test covers it: the e2e (extension.spec.ts:3302-3353) stops at the Bootstrap's offer, and lovejoin-flows.test.ts:213-223 checks the record but not the banner.

**Reproduction (confirmed, medium).** I wrote a throwaway Vitest test, extension/tests/zz-review-318-worker-bootstrap-banner.test.ts, ran it on its own (nice -n 19, --maxWorkers=1) and then deleted it. It uses the real WebAssembly and the fakes from lovejoin-flows.test.ts.

What the test did:
- A public Bootstrap of 2 classic boxes: atAccount e1 40 ₳ and e5 5 ₳ plus the recorded POOL, then lj.publicBuild("preprod", 2, { bootstrap: true }). Its summary matched { bootstrap: true, depth: 0, mixes: 0, txs: 1 }.
- `sent = await lj.publicSubmit(...)`, which is the PendingTx Lovejoin.tsx:2420 hands to Home's setPending.
- koios.confirmations = 1, then pumpPublic. `confirmed = await new PendingService({...t.deps, depositLanded}).pending("preprod")`, which is Home's watch as sw.ts wires it.
- Both rendered through `<PendingBanner>` with renderToStaticMarkup.

What it printed:
- kindSent and kindConfirmed are both "lovejoin-mix".
- The PendingTx keys are only kind, network, txHash, submittedAt, confirmations and chain {total: 1}. Nothing marks it as a Bootstrap.
- sentBanner: "Mixes into Lovejoin sent. Waiting for the network…"
- doneBanner: "In Lovejoin, on their way to your private balance … Dismiss"
- The worker's own record at the same moment: chain bootstrap: true, due times 0, MixEntry {bootstrap: true, found: true}. So the boxes are held and nothing comes back by itself.

The assertions on the sealed record passed. Both soft banner assertions failed:
- `expected 'Mixes into Lovejoin sent. Waiting for…' not to contain 'Mixes into Lovejoin'`
- `expected 'In Lovejoin, on their way to your pri…' not to contain 'on their way to your private balance'`

The same path, step by step on HEAD:
1. Lovejoin.tsx:2407: the public bootstrap() calls lovejoin-mix-public-build with bootstrap: true. Sending goes through :2420, onPending(lovejoin-mix-public-submit), and :2425 moves to the hub, which shows Home's banner through Dapps' `banner` prop.
2. handlers.ts:530-531 passes it to publicSubmit.
3. lovejoin.ts:4076: publicStart writes `bootstrap` onto the chain record but returns only {first, total} (:4093).
4. lovejoin.ts:4029: publicSubmit builds `{ kind: "lovejoin-mix", ..., chain }`. It is stored by watchSent (:4032, pending.ts:395-401), and `shown()` (pending.ts:405-421) keeps the kind as it is.
5. rpc.ts:875-955: PendingTx has no field that could carry a Bootstrap.
6. Home.tsx:356-366, 495-502: the watch runs every 15 s on every screen.
7. PendingBanner.tsx:233 and :302 give the sent words, :77 → en.json:1492 and :1508. PendingBanner.tsx:270-277 give the done words, :101 → en.json:1456.
8. Meanwhile lovejoin.ts:4458 (`!record.bootstrap`) draws no due time, and bootstrapOf (:2057-2058) holds the boxes.

In 1.5.0 (63f87b8) the kind was the same (lovejoin.ts:2044), but a seed's boxes came back by themselves (en.json:1082, :1104), so the same words were true then. PR #318 (84c2775f) made the boxes held without changing the banner.

Why: The finding holds on HEAD. I reproduced it with a test, not only by reading. After a public Bootstrap, Home's banner first says "Mixes into Lovejoin sent", although a Bootstrap makes no mixes (depth 0). Once the deposit is in, it says "In Lovejoin, on their way to your private balance". The worker holds those boxes with no due time, and they come back only by hand.

Everything else the user sees says the opposite:
- the review (en.json:1138)
- the cost line before Send (:1306-1307)
- the pool page's held callout (:1163)
- Home's own row (:792-793)

So Home can show two statements that contradict each other.

I found no decision by the owner on these banner words. chunk-34's notes cover MONEY-4 (Home's row) and MERGED-5 (the hold through the watch), but not the banner. The e2e Bootstrap test stops before Send (e2e/extension.spec.ts:3302-3353), and no unit test renders a Bootstrap's banner.

Severity is medium: a screen states something false about where money is going, on a main path. The public Bootstrap needs no collateral, and it is the only way a new token pool can reach its floor. It is not high: nothing is lost or misdirected, what was signed matches its review, and nothing leaks. The boxes stay the user's, and Bring one back, Bring them all back and Settings' Bring every box back now all work. The cost is a user waiting for money that won't come back by itself, told by a done banner that it will.

**Fix notes.** 1. Mark the PendingTx with an optional field, `bootstrap?: true` on PendingTx (rpc.ts:875). Don't give it a kind of its own. The "lovejoin-mix" kind does more than choose words:
   - pending.ts:424, LOVEJOIN_KINDS → feedOf (:431-435). A classic-pool watch has no `feed`, so this kind is what keeps it on the Lovejoin feed. A new kind left out of the set would send a tx_status request naming the transaction, which is a privacy regression.
   - pending.ts:768: `if (w.kind === "lovejoin-mix") depositLanded(...)` is MERGED-5's hold for a public Bootstrap. A new kind would silently drop it (lovejoin-merged-review.test.ts:522-546).
   - PRIVATE_KINDS (PendingBanner.tsx:31-41), Home.tsx:164 SPENT_FROM, ui/activity.ts:75.
   If someone does add a kind anyway, it has to go in every one of those places.

2. Where to set it: publicStart reads `built.bootstrap` (lovejoin.ts:4076) and then deletes the kept review (SESSION_LOVEJOIN_PUBLIC, :4084). So publicSubmit can't read it afterwards: publicStart has to return the flag along with {first, total}. Then `{ kind: "lovejoin-mix", ..., ...(bootstrap ? { bootstrap: true } : {}) }` at :4029. watchSent/take stores the object whole, and shown() strips only the fields it lists, so the field reaches Home's watch.

3. Words: in PendingBanner, choose the SENT and CONFIRMED keys by `pending.bootstrap` when the kind is lovejoin-mix. `what` also feeds notConfirmed, maybeSentTitle, the dropped titles and partsStoppedTitle (:233, 264, 285, 292, 302), so replace `what` itself, not only the two maps. Suggested wording: "A Bootstrap" / "In Lovejoin, held there until you bring them back".

4. i18n traps:
   - Add each new key to en, es and ja, and to docs/i18n/es-provenance.json and ja-provenance.json, or tests/i18n.test.ts:211 fails.
   - The critical set is worked out from the source (scripts/i18n-critical.mjs), so editing critical-keys.json by hand is undone. No `pending.*` key is critical today. Making one critical means a `.warn.` or `.privacy.` name, plus back-translated entries in verified-critical-*.json.

5. Keep an ordinary mix's words: e2e/extension.spec.ts:3047 and :3061 assert them.

6. Test: in lovejoin-flows.test.ts's Bootstrap describe (:209-226), take publicSubmit's PendingTx and PendingService.pending after the deposit is confirmed (as lovejoin-merged-review.test.ts:527-533 does), and render PendingBanner the way lovejoin-screens-review.test.ts:28-36 and :52-58 do. Assert the held wording, and assert that neither "on their way to your private balance" nor "Mixes into" appears. My repro failed on HEAD with exactly that setup.

Also checked:
- A private Bootstrap is unaffected: it is a session funding, so the banner says "Private session funded".
- Activity's "Into Lovejoin" (en.json:113) is true for a Bootstrap.
- A 1.5.0 seed's chain still comes back by itself (lovejoin-flows.test.ts:323-366), so its old words stay true and need no change.

## 321-lj-worker#0

**medium · confirmed · correctness** — Bring every box back now ends as soon as a chain of the wallet's finishes sending, before its boxes land: it says nothing was left, wipes their due times, and they don't come back by themselves until the next unlock or Lovejoin page read

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5916`

**Detail.** bringAllBackNow (lovejoin.ts:5850) waits while a chain is being sent (5862). Once the chain's last transaction is submitted, the chain is `ended`, and the same runner pass runs the bring (runs.ts pumps chains in its first loop and calls withdrawDue in the second). At that moment the chain's deposit and mixes are still in the mempool. The boxes they spend are spent-marked, so they aren't `owned`, and the boxes they make aren't listed yet. So `ours` and `takes` are empty.

The `confirming` wait (5907) applies only when the bring itself sent something (`back > 0`). With back == 0 the end branch (5916) runs:
- its guard (5919) only defers for chains not ended, or scheduled since the read;
- it sets each pool's due times to the number of owned boxes (5922-5923). Here that's 0, so the due times the chain drew at its deposit are wiped;
- it clears the counts and deletes `bringing` (5928).

The page's doneOf (ui/components/BringAllBack.tsx:31) then sees held.boxes 0 and shows "Nothing of yours was left in Lovejoin." (line 227).

When the chain's boxes land a block later they have no due time. The regular run reads no pool when nothing is due, except at unlock (5522), and returning() (5481) is false, so the alarm stops. The box stays in Lovejoin, uncounted on Home, until the next unlock or a Lovejoin page read (status → scheduleFound) draws it a fresh wait.

The same happens in two other cases:
- a mix sent after the ask whose box isn't listed by the ending run: its due time, which the design says it keeps, is wiped;
- a public Bootstrap whose deposit is in flight: its boxes then stay held and never come back by themselves.

The regular path has had the same trim since 1.5.0 (5543-5546; 1.5.0's lines 3162-3163), but only when another box happens to be due that minute. The bring makes it happen every time.

**Scenario.** 1. The user mixes one box from the public account. Its deposit and mix go out together (window of 4).
2. While it's being sent, they press Settings → Bring every box back now, which says it waits for a chain being sent.
3. The run right after the mix is all sent sends nothing and ends. Settings says "Nothing of yours was left in Lovejoin.", Home's In Lovejoin shows nothing, and the account is 10+ ₳ lighter with nothing shown for it.
4. The box lands a block later and sits in the pool with no due time.
5. With the wallet kept unlocked it never comes back by itself (8 hours of runs in the test). Only after the next unlock, or opening Lovejoin, does it get a due time, and then it waits a fresh 1–6 hours.

**Confirmed how.** Throwaway Vitest test tests/zz-review-321-lj-worker-bring.test.ts, using the real WebAssembly and lovejoin-bring-all-back.test.ts' harness; deleted afterwards.

1. A public mix was recorded with its progress, and its deposit marked sent (1 due time). Bring was asked, and the run waited.
2. chainSent(…,1) and chainEnded were called with nothing of the chain listed.
3. The next withdrawDue sent 0. Sealed `bringing` was undefined and `due` was []. held().boxes was 0, and doneOf({back:0}, held) returned 0, i.e. "Nothing of yours was left".
4. The leaf was then listed. 8 hours of withdrawDue runs withdrew nothing, due stayed [], and returning() was false.
5. status() then drew a 3.5 h due time.

Variant: a mix recorded after the ask, its box not yet listed. Its due time went from 1 to 0 after the ending run.

**Suggested fix.** Treat a chain of the wallet's that was all sent recently (done, and ended within RECORD_KEEP_MS or until its last transaction is seen) whose leaves aren't listed yet as still putting boxes in. The run then:
- keeps `bringing`, with a short word as `held` has;
- keeps that chain's due times when it trims (as moreThanDue's theirDue counts a sending chain's);
- takes those boxes once they're listed, or keeps their waits when the chain was recorded after the ask.

A simpler alternative: count the in-flight spends of the wallet's own chains as `confirming` whatever `back` is. The regular path's trim (5545) could keep those due times too.

**Test idea.** In lovejoin-bring-all-back.test.ts:
1. publicMix(lj, false) with its progress set, then bringAllBack and withdrawDue (it waits).
2. chainSent(…,1) and chainEnded.
3. withdrawDue with nothing of the chain listed must keep `bringing` and the chain's due time.
4. Push classicBox(t, "d1"); the next withdrawDue must withdraw d1#0.

A second case: the mix is recorded after the ask, and the ending run must keep its due time.

**Skeptic (confirmed, medium).** Reproduced on HEAD. pumpChain returns true once the last transaction is submitted, while up to a window of them are still in the mempool. pumpPublic then calls chainEnded, and the same runNetworks pass calls withdrawDue, which reaches bringAllBackNow. chainsSending is now false. The chain's spent boxes aren't owned, and its leaf isn't listed (poolRows reads the tip, with no mempool overlay). So ours and takes are empty, and the confirming wait is skipped because back is 0. The end branch's guard only defers a chain not ended, or one scheduled after the read, and this chain was scheduled at its deposit, so it doesn't defer. setDue trims the chain's due time to the 0 owned boxes and deletes bringing. Settings then says "Nothing of yours was left in Lovejoin." and Home counts nothing. Once the box lands, nothing reads the pool: withdrawDueNow returns early with no due time unless it's the unlock run, and returning() is false. Only the next unlock or a Lovejoin page read (status → scheduleFound) gives it a fresh 1–6 h wait. No doc records accepting this. The design says the bring waits for a chain being sent, and that a box recorded before the ask was there, so the box is meant to be taken. No money is lost, but a screen says something false about money and the emergency exit misses the box for hours. Medium stands. The regular path's trim at 5543-5546 has the same gap since 1.5.0 (63f87b8:3162-3163), but only fires when another box is due that minute. The existing tests miss it: "waits while a chain … is being sent" passes because c1 is there to take, and "leaves its end to a later run" lists d1 before the ending run.

Evidence: lovejoin.ts:504 (pumpChain done once all are submitted, `flying` may be non-empty); lovejoin.ts:4239-4240 (chainEnded on done); runs.ts:59,68 (pump, then withdrawDue in the same pass); lovejoin.ts:4733-4735 (chainsSending = !c.ended); lovejoin.ts:5907 (confirming gated on back > 0); lovejoin.ts:5916-5929 (guard, setDue to the owned count, delete bringing); lovejoin.ts:5522 and 5481 (no read with nothing due; returning false); BringAllBack.tsx:31-35,227. Throwaway Vitest tests/zz-review-321-lj-worker-skeptic-bring.test.ts (real WebAssembly, the bring test's harness; deleted). (1) Public mix recorded and its deposit sent, giving 1 due time; bring asked; run waits. Then chainSent(…,1) and chainEnded with nothing listed. The next withdrawDue gave {"due":[]} with bringing undefined, held.boxes 0, doneOf({back:0}) 0, returning false. After d1 was listed, 16 runs 30 min apart sent 0, due stayed [] and returning stayed false. status() then drew a 3.5 h due time. (2) A mix recorded after the ask, its box unlisted at the ending run: due went from 1 to 0.

**Reproduction (confirmed, medium).** Throwaway Vitest file tests/zz-review-321-lj-worker-repro.test.ts. It used the real WebAssembly and copied the harness of lovejoin-bring-all-back.test.ts. I ran it alone with nice and --maxWorkers=1, then deleted it.

Test A sets up a public mix: deposit d0, mix d1, one box, recorded and its deposit sent. Its progress is where it waits. Nothing of the wallet's is in any pool.
- A minute later, bringAllBack is asked, and withdrawDue waits (bringing {back:0}).
- Then chainSent(…,1) and chainEnded run, with nothing of the chain listed. withdrawDue runs again.
- Its expect.soft assertions follow the design: bringing kept, the chain's due time kept, doneOf not "none left", and the box back while unlocked. All 4 failed on HEAD. It printed:
  - A1: due after the deposit: 1
  - A4, after the ending run: {"sent":0,"bringing":null,"due":[],"heldBoxes":0,"notMixed":0,"doneOf":0,"returning":false}
  - A5, after classicBox d1 is listed and 48 runs over 8 h unlocked: {"withdrawnTotal":0,"asked":[],"due":[],"bringing":null,"returning":false}
  - A6, after status(): due [3.5] hours

Test B is the variant: c1 is taken by the bring, then a mix recorded a minute after the ask is all sent, then c1 is spent, and its leaf is not listed. It printed {"dueBefore":1,"dueAfter":0,"bringing":null,"heldBoxes":0}, so "the later mix's due time kept" failed.

Trace on HEAD:
1. The chain is recorded before the ask (recordChain 4357). chainSent i=0 draws the box's due time and sets `scheduled` (4451-4495). bringAllBack sets `bringing.at` later (5824).
2. While the chain is sent, bringAllBackNow returns at 5862: chainsSending (4733-4736) is `!c.ended`.
3. runs.ts:59 calls pumpPublic. pumpChain returns true as soon as the last transaction is submitted (lovejoin.ts:504). Up to the window is still in the mempool: CHAIN_WINDOW 4 (292), or 2 for a four-wide chain (298). chainEnded runs at 4240 and sets ended/done (4510-4512). Session chains end the same way at sessions.ts:4707.
4. In the same pass, runs.ts:68 calls withdrawDue, which reaches bringAllBackNow through 5503-5504.
   - The check at 5862 now passes, and `scheduled` at 5869 already holds the chain.
   - ours() (2657) reads through poolRows (2560ff) at the tip, with no mempool view. Nothing of the chain is in owned or listed.
5. At 5886-5887, ours and takes are both empty. The branch at 5893 is skipped. confirming is 0 (5906), and 5907 needs back > 0 anyway.
6. The end branch at 5916 runs:
   - The guard at 5919 is false: the chain is ended and was scheduled before the read.
   - 5922-5923 call setDue(pool, []), wiping the chain's due time.
   - 5925-5926 clear the counts, and 5928 deletes bringing.
7. In BringAllBack.tsx, the read sees bringing gone, so doneOf runs (31-36). back is 0 and held().boxes = due.length (lovejoin.ts:5459) = 0. So line 227 shows "Nothing of yours was left in Lovejoin." (en.json:1938), and Home counts nothing.
8. After the leaf lands:
   - withdrawDueNow returns at 5522 with no pool read, because nothing is due and it isn't the unlock's run.
   - returning() (5481) is false, so runs.ts:74 lets the alarm stop.
   - Only the next unlock's run, or the Lovejoin page's status() (5134-5140, which calls scheduleFound at 4314), draws a fresh due time.

Reachable with default settings: depth 2 means 4 mixes a box (1432; preferences.ts:172), so a one-box public mix is 5 transactions, more than the window. publicSubmit sends only the first window (4028), so the chain is "being sent" for at least a block. Settings shows the button all the time (Settings.tsx:914).

Why: Reproduced independently on HEAD 499768f6. Bring every box back now's wait for "a chain being sent" ends when the chain's last transaction is submitted (pumpChain:504, then chainEnded), not when its boxes are listed. In the same runner pass the bring reads the pool at the tip and finds nothing. It ends, wipes that chain's due times (5922-5923) and deletes `bringing`. Settings then says "Nothing of yours was left in Lovejoin." and Home shows none of the 10+ ₳ that just left the public account. The box gets no due time, and `returning()` is false, so it doesn't come back by itself until the next unlock or a Lovejoin page read, and then waits a fresh 1–6 h.

The variant is real too: a mix sent after the ask loses its due time if its leaf isn't listed when the bring ends. That contradicts flows.md:527 ("the boxes of a mix sent since keeping their due times"; "never says 'Nothing of yours was left in Lovejoin.'") and privacy.md:226 ("keeps its boxes' waits"). No doc or owner call accepts this.

Medium stands, not high:
- No money is lost or locked. A page read, an unlock, a second Bring once the box is listed, or a restore all find it.
- But a screen states something false about money, and the emergency exit misses the box.
- The trigger is natural: a user regretting a mix they just started.

It's narrower for multi-box chains. Leaves already listed are taken, and the confirming wait usually outlasts the last mix's landing. So the clean case is a chain whose wallet leaves are all in the last in-flight window, such as one box. When the alarm's own pump ends the chain, the bring's run comes seconds later, so the case is nearly certain once that holds.

**Fix notes.** Where to fix:
- Fix it in the worker's bringAllBackNow, before and in the end branch (lovejoin.ts:5893-5931). doneOf in BringAllBack.tsx can't tell.
- The root cause is that chainsSending (4733) means only `!c.ended`. A chain is ended at its last submit (pumpChain 504, then chainEnded at 4240, and sessions.ts:4707 for session chains) while its last window is still in the mempool, and poolRows reads the tip.
- So the fix must work on the ChainRecord, for public and session chains alike.

Two ways to do it:
- Treat a done chain whose boxes aren't listed yet as still putting boxes in. ChainRecord doesn't keep pumpChain's `flying`: the progress is removed at 4243-4246. One option is to record the hashes still in flight at chainEnded, and wait until onChain sees them (the feed check pumpChain already uses).
- Simpler: wait while a done chain ended within a bound and none of its in-scope leaves (`c.leaves`, without a tail leaf, which has its own due time) is in `listed`.

Traps:
- Bound the wait. A node can drop a chain's last mix after it was all sent (comment at 5617-5620). Unbounded, the bring never ends, and returning() (5481) keeps the alarm going forever.
- Don't count the wait as a failed run toward BRING_FAILED_RUNS.
- The UI's `confirming` needs back > 0 (BringAllBack.tsx:177). A wait with back 0 needs its own short words, as `held` has, or none.
- Keeping `bringing` alone isn't enough. The trim at 5922-5923 must also keep the due times of such in-flight chains, for example by adding their shareOf(c, pool) to `since`. Otherwise a mix recorded after the ask (madeSince 1818) still loses its wait.

The regular path's trim (5544-5545, `sending`) has the same gap, inherited from 1.5.0 (63f87b8:3161-3163). It only drops the due time when another box is due in that pass, and usually heals at the next read. Use the same predicate there.

Tests: the existing ones miss this.
- "waits while a chain … is being sent" (test file line 194) has c1 to take.
- "takes only the boxes there" (327) and "leaves its end to a later run" (425) list d1 before the ending run.

Add these to lovejoin-bring-all-back.test.ts:
1. publicMix(lj,false), with progress "test.d0" set, then bringAllBack and withdrawDue (it waits). Then chainSent(…,1) and chainEnded. withdrawDue with nothing listed must keep `bringing` and due length 1. Push classicBox(t,"d1",0); the next withdrawDue must withdraw d1#0.
2. c1 taken, a mix recorded after the ask and ended, c1 spent: the ending run must keep the mix's due time.

Also update bringAllBackNow's comment (5847-5848) and flows.md:527 to describe the wait.

## 323-worker#1

**medium · confirmed · money** — The swap and site approvals' cost totals leave the collateral's mix out and count its reserve as coming back

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/swap.ts:78`

**Detail.** swapCosts (swap.ts:78-93) prices the funding's and later network fees, the DEX and Minswap fees, and the boxes' mixes. `paid` (Swaps.tsx:1272) sums every payment, the 1.5 ₳ reserve included. So `back = leaving - swapped - cost + proceeds` counts all of the reserve, and the 5 ₳ collateral, as coming back.

`cost` has nothing for:
- the collateral's deposit (about 0.18 ₳);
- its mix under giveme.my (MIX_FEE_ESTIMATE 0.95 ₳, 0.82 ₳ measured; the screens test fixture uses 1.1 ₳ for the two);
- the 5 ₳ box's way back (BOX_BACK_ESTIMATE 0.3 ₳).

swaps.costs.noteLovejoin (en.json:2221) names only the order, Lovejoin's deposit and the return.

The site's funding review has the same gap: FundingWayBack (DappApprovals.tsx:444-468, used at 748) says "Its network fees, about 0.5 ₳: Lovejoin's deposit and the return" (en.json:342) and gives "Network fees both ways" without the collateral's mix.

Stop's dialog (stopCost, sessions.ts:3060-3069, through spareOf at 5700) prices boxes on the account's ADA, reserve included, while the return sets the reserve aside first (WebAssembly chain_at: spare minus reserve). At the boundary it can promise one more box than comes back.

All of these sit on reviews that also show "For its collateral's mix: 1.5 ₳". Live wherever collateralReserve is set; dormant on mainnet until a 5 ₳ pool reaches its floor.

**Scenario.** Preprod with a 5 ₳ pool, a 10 ₳ → MIN swap approval:
- "Costs in all, about X ₳" is about 1.3-1.4 ₳ under what the session spends.
- "Comes back, about Y ₳" is over by the same amount, and counts the 5 ₳ as if it came back with the rest.
- On a site's funding review, "Network fees both ways" is about 1.1 ₳ short.

**Confirmed how.** Read the code: swapCosts' inputs (Swaps.tsx:1272-1274), FundingWayBack, stopCost and spareOf, against what buildBack sends when collateralTail is set.

**Suggested fix.** When summary.collateralReserve is set:
- add the tail's estimate (its deposit at SESSION_FEE_ESTIMATE, MIX_FEE_ESTIMATE, and BOX_BACK_ESTIMATE for the box's way back, or a figure the worker returns with the reserve) to swapCosts' cost, and take it out of back;
- add it to FundingWayBack's fees (pass collateralReserve in);
- name the collateral's mix in the cost notes.

In stopCost, price boxes on spare minus the reserve where the record has collateralReserve.

**Test idea.** Render SwapApproval with summary.collateralReserve "1500000". swap-cost-total should rise and swap-comes-back fall by the tail's estimate. Likewise FundingWayBack's dapp-funding-both-ways.

**Skeptic (confirmed, medium).** This holds and nothing chose it. swapCosts has no input for the collateral's tail. Swaps.tsx sums every payment, the reserve included, into `leaving`, so `back` counts all of the 1.5 ₳ (and the 5 ₳) as coming back. `cost` leaves out the tail's deposit (about 0.18 ₳ per core's comment), its giveme.my mix (planned on MIX_FEE_ESTIMATE; the screens fixture uses 1.1 ₳ for both) and the 5 ₳ box's own way back (about 0.3 ₳). This also hits a swap whose spare ADA pays for no 10 ₳ box, since the direct return builds the tail too, so most small swaps are affected. FundingWayBack takes no reserve: it prices 'Lovejoin's deposit and the return' (2 × 0.25 ₳), and 'Network fees both ways' is about 1 ₳ short. Stop's dialog prices on spareOf, which keeps the reserve in, while the WebAssembly plan subtracts it, so at a boundary it can promise one box too many (narrow). No doc or test records this: flows.md describes only the reserve row, and #323's screens test renders CollateralReserveRow alone. The 'Total leaving' row (TotalRows) is right. Medium: on the consent screen of a swap that then runs itself, and on a site's funding review, 'Costs in all' is about 1.3 ₳ low and 'Comes back' about 1.3 ₳ high wherever collateralReserve is set. That's live on preprod now, and on mainnet once a 5 ₳ pool holds 30 other people's boxes, which anyone's Bootstrap can make happen.

Evidence: ui/swap.ts:78-93 (cost = network + dex + aggregator + mixing; back = leaving - swapped - cost + proceeds); Swaps.tsx:1268-1277, 1405-1418 (swap-cost-total, swap-comes-back); DappApprovals.tsx:444-468, 748 (FundingWayBack, no reserve); en.json:341-342, 2221; sessions.ts:3057-3069 (stopCost via spareOf), 5700-5704; wasm/src/lovejoin.rs:1110-1127 (plan subtracts tail_reserve); seedelf-core/src/lovejoin/mod.rs:1593-1600; tests/lovejoin-screens-review.test.ts (only CollateralReserveRow rendered)

**Reproduction (confirmed, medium).** Throwaway test tests/zz-review-323-worker-costs.test.ts (run alone, then deleted; git status clean). It used the planner tests' harness: real WebAssembly, fake Koios, Minswap and giveme.my, and a 5 ₳ ADA pool launched from the public account holding two strangers' boxes (preprod's floor is 0).

1. The worker's swap funding. sessions.quote plus outBuild for the recorded 10 ₳ → MIN swap returned:
   - collateralReserve "1500000";
   - payments [17500000, 5000000];
   - funding fee 233208;
   - lovejoin.boxes 0 (the spare pays for no 10 ₳ box).

2. SwapApproval rendered from that summary. Costs block: "Costs in all, about 2.73 ₳ · DEX fee 2 ₳ · Network fees, about 0.73 ₳ · Comes back, about 906.5941 MIN and 10 ₳". Note: "Network fees: this payment's, then about 0.25 ₳ each for the order and the return". Plan: "The proceeds and everything left, directly".
   - Without the reserve (payments[0] 1.5 ₳ less): cost 2.73, back 8.5.
   - So the reserve adds 1.5 ₳ to Comes back and nothing to Costs in all.

3. The session after its fill:
   - the order's change, 17.5 − 14 − 0.205189 ₳;
   - the fill's 2 ₳ with the MIN;
   - the 5 ₳;
   - record collateralReserve: true.
   backBuild built deposit 0.173553, then mix 0.829738 (the giveme.my one), then back 0.173993. Skipped: "its spare ADA is too little for a box". Tail fee 1.003291. At once 4.117527 ₳.
   - Real cost 3.915681 ₳ against 2.73 shown: 1.19 ₳ short.
   - Real back 8.817527 ₳ (4.12 now plus a 4.7 ₳ box later) against 10 shown: 1.18 ₳ over.
   - Assertion `expect(costOf(page)).toBeGreaterThanOrEqual(realCost - 150_000n)` failed: "expected 2730000 to be greater than or equal to 3765681".

4. FundingWayBack (lovejoin true) said: "Its network fees, about 0.5 ₳: Lovejoin's deposit and the return … Network fees both ways, about 0.73 ₳ … The rest and the 5 ₳ come back at once." The real figure is 1.41 ₳ (funding fee plus the return's three fees, no 10 ₳ box).

Trace on HEAD:
- swapCosts, swap.ts:78-93, has no input for the tail: `later` 2 or 3 at :84, cost :88, back :91.
- Swaps.tsx:1272: `paid` sums every payment, the reserve included, and :1274 passes it on.
- sessions.ts:1752 and :1761: outBuild adds the reserve to the first payment; :1826 returns it.
- The return:
  - sessions.ts:4107-4115: intoPool is worked out whether or not there's a box;
  - :4205 marks noBox;
  - :4264-4282 calls buildSessionReturn with collateralPool;
  - wasm/src/lib.rs:1419 builds direct_tail;
  - sessions.ts:4295-4309 sends deposit, mix, back as a chain;
  - wasm/src/lovejoin.rs:219-221: the tail's fee is the deposit's plus the mix's.
- DappApprovals.tsx:446: back = 2 × 0.25 ₳; "both ways" at :459; called at :748 with no reserve. Words at en.json:342 and :346.
- Stop's dialog: sessions.ts:3061 prices on spareOf (:5700-5704, which keeps the reserve), then `affordable` (:1689). The chain subtracts the reserve (wasm/src/lovejoin.rs:1481-1482). Before an order goes out, where the spare's remainder over a box's price is under 1.5 ₳ (about 1 amount in 9), the dialog names one box more than goes, and its mix fees. Low on its own; read, not tested.

Why: The bug is real, and no owner call covers it. Session 11 records only that "a session's funding adds about 1 ₳". Nothing in the plan, flows.md or the archive says the totals leave the tail out.

Every swap or site session funded while a 5 ₳ pool would take the collateral is affected. That includes small swaps whose spare pays for no 10 ₳ box, because the direct return builds the tail too.

What the user sees on the consent screen of a swap that then runs itself:
- Costs in all: about 1.2 ₳ low (2.73 ₳ shown against about 3.92 ₳ real on a 10 ₳ swap).
- Comes back: about 1.2 ₳ high. It counts the 5 ₳ as coming back with the rest, but it comes back later as a mixed box, less about 0.3 ₳.
- The same screen's own row says "For its collateral's mix: 1.5 ₳, and what it doesn't use comes back". The totals count none of that 1.5 ₳ as used.
- The site's funding review is about 0.7 ₳ short with no box and about 1.0 ₳ with one. Its note says the 5 ₳ comes back at once.

Why medium and not high: it's a screen stating something false about money, but nothing is lost or misdirected. "Total leaving" is right, and the reserve row discloses the extra 1.5 ₳.

Exposure: live on preprod now. On mainnet it starts once a shown 5 ₳ pool holds 30 other people's boxes, which any Bootstrap can make happen.

**Fix notes.** **Where to fix:**
- **swapCosts** (swap.ts:78): give it the reserve. Swaps.tsx:1274 passes `summary.collateralReserve`. Only where it's set:
  - add the tail's estimate to `cost` and take it out of `back`: SESSION_FEE_ESTIMATE for the deposit, `mixFeeEstimate(3)` (LovejoinReturn.tsx:70, 0.95 ₳) for its mix, and BOX_BACK_ESTIMATE for the box's way back. That's about 1.5 ₳; measured, 0.17 + 0.83 + about 0.29;
  - add a part row in SwapCosts (Swaps.tsx:1405-1418) so the parts still add up to the total;
  - count two more transactions in the note (en.json:2220-2223).

**Traps:**
- Keep `paid` and `leaving` as they are: TotalRows is right.
- `forSwap` (Swaps.tsx:1277) already subtracts the reserve; don't subtract it twice.
- `summary.collateralReserve` is the only trigger the screens have. A tail can still be built with no reserve (call 3), or skipped despite one (the pool gone); "about" covers both.
- **FundingWayBack** (DappApprovals.tsx:444): pass `review.collateralReserve` at :748 and add the tail's fees to "Its network fees" and "both ways".
  - Its note `dappUi.back.privacy.noteLovejoin` (en.json:346, "The rest and the 5 ₳ come back at once") is false with the tail.
  - That key is in docs/i18n/critical-keys.json: a reword needs es and ja, and the blind back-translation (docs/i18n/verified-critical-*.json).

**The same gap elsewhere:**
- The swap Plan's last step (Swaps.tsx:1443, en.json:2351, "The proceeds and everything left, directly") is false for the 5 ₳, and Plan takes no reserve.
- SwapApproval has no note that giveme.my backs and sees the collateral's mix. CollateralTailNote is only on the return review you open by hand (Swaps.tsx ~2255), which an automatic swap never shows.
- **stopCost** (sessions.ts:3061): subtract `wasm.lovejoinCollateralReserve()` from `held` when `s.collateralReserve`. `funded` already leaves it out.

**Traced, not tested:**
- The swap form's maxAdaIn and adaShort (swap.ts:116-122, 147-150) know nothing of the reserve: the quote doesn't carry it, and tailReserve is read only at Review. Max leaves a 1 ₳ FEE_ROOM, but the funding then needs 1.5 ₳ more. So Review is likely refused as short, unless rounding to whole ₳ leaves about 0.75 ₳ or more.
- The Mix form's boxesAffordable and mixCosts (Lovejoin.tsx:253-263, 399-411) also miss it: "Total leaving" there is 1.5 ₳ under its review's.

**Tests:** none renders SwapApproval or FundingWayBack with a reserve (the T10 test in screens.test.ts, dapp-prompt.test.ts:152, swap-form.test.ts:126-166). Add one with payments[0] at 17.5 ₳ and collateralReserve "1500000", asserting that swap-cost-total rises, swap-comes-back falls by the estimate, and dapp-funding-both-ways rises.

## gap-1#1

**medium · confirmed · state** — Remove wallet goes ahead at the first yes while a payment's parts still wait, wiping them and leaving the recipient part-paid without a word

At `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:588`

**Detail.** atStake (handlers.ts:588-605) reads pending.maybeSentOn, sessions.atStake, lovejoin.chainsSending and publicMaybe. None of them knows parts.ts's waiting payments, which live only in session storage (seedelf.waiting.<network> and seedelf.waitingPart.<hash>; parts.ts:8-14, 30-35). A Send or Make public that goes in parts (transfer.ts:166, withdraw.ts:153) can have later parts that spend the part before's carry. Each of those waits for its parent to be in a block: about a minute a part, up to 20 minutes unseen, 3 minutes more when giveme.my is behind, 25 parts at most. Koios answered the first part, so maybeSentOn is empty (pending.ts:1003; unsettled requires maybeSent). A Send's payment isn't a session either. reset-check therefore returns [], and reset-wallet (handlers.ts:233) needs no second yes. wallet.reset() calls wipe(), which calls session.clear() (wallet.ts:473-480, 702), so the waiting parts and their reservation are deleted and never go. The lock countdown's question, chains-sending (handlers.ts:178-181), doesn't know them either. So the countdown also stays silent before a lock cuts them, which is the lock-cuts-parts finding seen from the guard side. A session's funding in parts is at least listed, as its session.

**Scenario.** A user leaving Seedelf Wallet makes everything public with Max. 400 tokens in 20 bundles go as 3 parts: 1 sent, 2 waiting (the review said "Keep Seedelf Wallet unlocked until they go"). They open Settings and Remove wallet right away. There is no list and no "Remove it anyway", only the typed confirmation, and the wallet is gone. Two thirds of the tokens never reach the public account. They stay at the Seedelf contract under the user's registers, seen only if this phrase is restored in Seedelf Wallet. Opened in another Cardano wallet, the public account looks short, and nothing ever said the payment stopped partway.

**Confirmed how.** Read the code, and ran a throwaway test, zz-review-gap-1-parts, now deleted. It used payment-parts-chain's walletA(20): a 3-part transfer with 1 part sent and 2 waiting. reset-check returned [] and chains-sending returned false. reset-wallet without force returned state no-wallet, seedelf.waiting.preprod was gone afterwards, and only 1 of the 3 parts had been submitted.

**Suggested fix.** Give atStake the parts' records: a PartsService method returning each payment whose parts aren't all sent and haven't stopped, leaving out a session's funding since its session is listed already. Return it as a new AtStake field, with a Settings line such as "{{network}}: a payment is still going out in parts ({{sent}} of {{total}} sent). Removing the wallet now stops the rest: the recipient gets only what went, and the rest stays in your private balance." Also count waiting parts in chains-sending, or a sibling call the countdown asks, so the countdown says a lock stops the rest.

**Test idea.** Like the throwaway: a 3-part transfer with 1 part sent. reset-check lists the waiting payment, reset-wallet without force throws RESET_AT_STAKE(), and with force the wallet is removed. The countdown's question returns true while parts wait.

**Skeptic (confirmed, medium).** It holds on HEAD, and medium is right. atStake reads four things: pending.maybeSentOn, sessions.atStake, lovejoin.chainsSending and lovejoin.publicMaybe. None of them sees parts.ts's waiting parts. maybeSentOn only returns a watch with maybeSent set, so a first part that Koios answered isn't there. sessions.atStake lists session records, and a Send or Make public is not a session. So with a Send or Make public whose later parts still wait, reset-check returns []. Settings then shows no 'still open' callout and no 'Remove it anyway' switch, and reset-wallet goes through on the typed confirmation alone. wallet.reset → wipe → session.clear deletes seedelf.waiting.<network>, every seedelf.waitingPart.<hash> and the parts' reservation, so the rest never go. Nothing else stops this: the Remove wallet row is always reachable, no handler asks PartsService on reset, and no test covers reset with waiting parts. Not an owner call: the docs record only that a lock (or a closed browser) wipes what waits. That was Claude's call #1 in Session 8, 'yours to overturn', still on Session 11's list for the owner to look at. Remove wallet's list is not mentioned, and flows.md:104's list has no parts line, though it lists the analogous Lovejoin chain 'which removing the wallet stops partway'. What a user sees and risks: they Make public with Max, which with many token bundles is exactly when parts chain, then open Remove wallet within the minutes the parts take (tens of minutes for many parts or a slow giveme.my). The screen says nothing is open, and the wallet is gone. Only part of the money reaches the public account or the recipient. The rest sits in the private balance, which only restoring the phrase in Seedelf Wallet shows again, and nothing ever says the payment stopped partway. Nothing is lost on chain: the phrase restores it, and the review did say to keep the wallet unlocked. That keeps this at medium, not high. The countdown half (chains-sending doesn't count waiting parts) is real but secondary. A lock stopping them is documented and accepted, so a countdown line there would be an improvement, not a fix of something false.

Evidence: handlers.ts:588-605 (atStake: maybeSentOn, sessions.atStake, chainsSending, publicMaybe; nothing from ctx.parts); handlers.ts:233 (no RESET_AT_STAKE when atStake is []); pending.ts:237-239 (unsettled needs w.maybeSent) and 1003-1006 (maybeSentOn); sessions.ts:5584-5594 (atStake lists session records only); parts.ts:8-14 and 30-35 (waiting parts and their record in chrome.storage.session); wallet.ts:473-480 (reset → wipe) and 702 (session.clear()); Settings.tsx:1571-1596 (atStakeLines has no parts line) and 1615, 1650 (held false → button enabled on the typed confirmation alone); handlers.ts:178-181 (chains-sending asks lovejoin alone); docs/flows.md:104 (Remove wallet's list has no waiting parts) versus flows.md:369 and architecture.md:171 (only 'A lock wipes what waits' is documented); chunk-34-token-pools.md Session 8 'For the owner' call 1 (lock or closed browser, yours to overturn) and line 915 (10b's calls still for the owner to look at); en.json:1673 (review.partsWait asks to keep the wallet unlocked); no test calls reset-check or reset-wallet with waiting parts (grep of tests/).

**Reproduction (confirmed, medium).** I reproduced it with a throwaway test, now deleted: extension/tests/zz-review-gap-1-parts-reset.test.ts. The tree is clean again.

**Setup.** It used payment-parts-chain.test.ts's walletA(20): 400 tokens in 20 bundles held at their least, plus one 409 tADA UTxO. Signing was stubbed as that test does. TransferService.build made 3 parts, and submit sent 1 with 2 waiting. Then it called the real handlers.ts `handle()` with a Context from testBalances carrying that transfer and a PartsService.

**What it asserted (the correct behaviour).** reset-check is not [], chains-sending is true, and reset-wallet without force throws RESET_AT_STAKE(). All four soft assertions failed on HEAD.

**What it printed:**
- `submit -> {"parts":{"sent":1,"total":3},"maybeSent":null}`
- `reset-check -> []`
- `chains-sending -> false`
- `before reset: waiting = {"e1d20b3f":{"sent":1,"total":3}} reserved inputs = 16`
- `reset-wallet (no force) -> {"state":"no-wallet"}`
- `after reset: waiting = null waitingParts = [null,null] reserved = null pump -> threw Error: The wallet is locked. submitted 1 of 3`

**Trace on HEAD:**
1. transfer.ts:165-167 and withdraw.ts:152-154 call sendParts (parts.ts:573-608). splitParts (parts.ts:192-220) writes, all to chrome.storage.session:
   - each waiting part under seedelf.waitingPart.<hash> (:213)
   - its reservation, parts.<first> (:215, :162-170)
   - the record in seedelf.waiting.<network> (:217)

   The first part is sent at :593, and holdWaiting runs at :606.
2. Koios answered the first part, so unsettled() (pending.ts:237-239) is false and maybeSentOn (pending.ts:1003-1006) returns undefined.
3. Settings → Remove wallet: the row at Settings.tsx:220 is always there. The screen sends reset-check (Settings.tsx:1620 → handlers.ts:226-227). atStake (handlers.ts:588-605) reads:
   - pending.maybeSentOn (:593)
   - sessions.atStake (:594; sessions.ts:5584-5594, the sessions book only)
   - lovejoin.chainsSending (:595; lovejoin.ts:4733-4736, Lovejoin chains only)
   - lovejoin.publicMaybe (:596)

   None of them sees the waiting parts, so nothing is pushed at :597 and it returns [].
4. Settings.tsx:1615 sets held = false. No callout shows (:1662) and no "Remove it anyway" switch (:1674). The button turns on with the typed phrase alone (:1653) and sends force: false (:1632).
5. handlers.ts:233 sees atStake().length = 0 and goes on. wallet.reset() (:248) runs wallet.ts:473-480, then wipe() (:698-709), then session.clear() (:702). That deletes the waiting record, both parts and the reservation. KEPT_ON_RESET (private-store.ts:60-65) covers only maybeSent and lovejoinMaybe. Parts 2 and 3 never go, and no screen says so.
6. The lock countdown asks chains-sending (LockCountdown.tsx:80 → handlers.ts:178-181), which asks only Lovejoin, so it answers false.

Why: **It's real and reachable.** Nothing else guards it: no handler asks PartsService on reset, and no test covers a reset with waiting parts. The two tests that pair reset with "waiting" are about orders.

**It isn't an owner call.** The owner's accepted call (chunk-34, Session 8, "For the owner" #1) is that a lock or a closed browser stops the rest of the parts. Nothing records a decision about Remove wallet. That screen exists to list what removing the wallet leaves behind. flows.md:104 lists the matching case, "a Lovejoin chain still being sent, which removing the wallet stops partway", but has no line for parts. So the empty list amounts to "nothing open", which is false.

**It's plausible.** A user leaving the wallet naturally does Make public with Max, then Remove wallet. For a wallet heavy in tokens, that is exactly what chains parts: Max covers every UTxO and chains the parts made only of bundles. The rest can take up to about 20 minutes a part to go: up to 25 parts, 20 minutes for a parent unseen, 3 more if giveme.my is behind.

**What the user sees and risks.** No warning on the Remove wallet screen. The recipient, or their own public account, gets only the parts that went. The rest stays in the private balance under the user's own registers. Only restoring the phrase in Seedelf Wallet shows it again, and nothing ever says the payment stopped partway.

**Why medium, not high.** Nothing is lost on chain, nothing is paid to anyone else, and nothing was signed unreviewed. The review did say to keep the wallet unlocked until the parts go.

**The countdown half is secondary (low).** A lock cutting the parts is documented and accepted, so a countdown line would be an improvement, not a fix of something false.

**Fix notes.** **PartsService read.** Put it in PartsService (parts.ts:518-561), for example open(network). Return each Waiting where `!w.stopped && w.sent < w.hashes.length`.
- Keep `sending: true` records: a Send mid-flight is cut too.
- Leave out `w.session !== undefined`. sessions.atStake already lists that session, because its txs[0] isn't unsent.
- Never count stopped records. They're kept up to an hour (STOPPED_KEEP_MS, parts.ts:47) for Home's banner, and counting them would make Remove wallet ask for "anyway" for an hour after nothing is left to lose.
- waitingOn uses withKeys, which is fine because atStake requires the wallet unlocked.

**atStake (handlers.ts:588-605).**
- Read inside the try, so a failure falls to `unreadable`.
- Add the new field to the push condition at :597. Without that, a network whose only open item is waiting parts is still never pushed.
- ctx.parts is optional (handlers.ts:54), so call `ctx.parts?.…`.
- Make the AtStake field optional, spread in like maybeSent and mixMaybeSent. remove-wallet.test.ts, remove-wallet-mix.test.ts and restore-scan.test.ts assert exact AtStake shapes with toEqual, and testBalances has no PartsService.

**account-use (handlers.ts:350)** filters atStake to maybeSent, mixMaybeSent and chainSending, so the new field won't block an account switch unless it's added there. It needn't be: waiting parts are Seedelf spends whose destination was fixed at build, and send() (script-spend.ts:373-450) never checks the active account.

**Lock countdown.**
- Don't make LovejoinService.chainsSending (lovejoin.ts:4733) count parts. lovejoin.ts:5514, 5707 and 5862 use it for Lovejoin's own decisions.
- Don't OR parts into the `chains-sending` answer either: the countdown shows lock.warn.chainSending, "A Lovejoin chain is being sent", which would then be false.
- Give parts their own answer and words: a result like {chain, parts}, or a sibling RPC. Update LockCountdown.tsx:80-152 and chain-requests.test.ts:97-112.

**UI and i18n.**
- Add a line in atStakeLines (Settings.tsx:1571-1596), under a key named `settings.remove.warn.*`. The critical-set deriver reads only JSX (see Settings.tsx:1567-1569).
- Run `node scripts/i18n-critical.mjs` to update docs/i18n/critical-keys.json.
- Add the es and ja values with provenance, and blind back-translations in verified-critical-es.json and verified-critical-ja.json. i18n-critical-helpers.test.ts guards this.

**Docs.** Update flows.md:104 (add a parts line), flows.md:369 and architecture.md:171 ("A lock wipes what waits": say Remove wallet lists them first), the AtStake docs at rpc.ts:957-979, and the comment at handlers.ts:578-587.

**Test.** The throwaway's setup runs in about 10 s.
- Copy payment-parts-chain.test.ts's token, bundle, bigAda, services, bundleLeast and walletA(20).
- Build and submit, so 1 of 3 is sent.
- Make a Context from testBalances with transfer replaced by services(t).transfer and parts set.
- Assert reset-check lists the payment, and reset-wallet without force throws RESET_AT_STAKE() while force removes the wallet.
- Assert that once the parts stop (giveme.my refusing past GIVEME_BEHIND_MS), reset-check returns [] again.
- Assert that a session's funding in parts is listed once, as its session.

**Unaffected.** Forgot password, the locked path, needs nothing: the lock already wiped the parts, as documented.

## x-release#1

**medium · owner-call · owner-call** — 34g's own pre-PR gate is still open: the collateral mix never ran live or through the real giveme.my, and the owner's live db-sync tests and calls are pending

At `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md:915`

**Detail.** 'Start here' (line 915) puts these before the PR and the package: item 11's mixed collateral live on preprod, 'giveme.my's first witness of a Lovejoin mix among it', and the lock-and-resume; then the owner's own test of item 11; then the owner's look at Session 9's calls (1017), 10b's six (1059), Session 10's (976-981) and Session 11's (929-933); then the owner's items (1200). Session 11 itself records 'Not run here: e2e, and a live run on preprod' (935). The tail's mix runs under giveme.my's collateral (core mix_giveme, worker witnessTail at sessions.ts:4780-4808) and has only ever met a fake giveme.my. The data layer's token-pool SQL has never run against home's db-sync: 'Waiting on the owner' (653), live_lovejoin (1200 item 4). Item 5 (1201) asks for lovejoin/pools and lovejoin/tokens to be checked by hand for 200 after the deploy, because /health says nothing of them. The API was deployed from 68150b39 (run 39982806550, 2026-10-23), but no check of those routes is recorded. The token list, DRep list and head start were last written 2026-10-18 (8cc00445; dreps 'recorded' 2026-10-18), while development.md:161 refreshes them on the release branch. The policy's date question (1188) and the 'For the owner' list (1291-1301) are open too.

**Scenario.** Preprod has a floor of 0 and shows the 5 ₳ pool 18c4df77…, so today every return through Lovejoin there (on by default) deposits the session's 5 ₳ and asks giveme.my to sign a Lovejoin mix. Suppose giveme.my refuses that shape. After GIVEME_BEHIND_MS (3 min, parts.ts:44) and TAIL_TRIES (2, lovejoin.ts:326), the rest of the return comes back, but the 5 ₳ sits as a 'Not mixed yet' box tied to the session. The page says it never comes back by itself, and bringing it back costs a fee. On mainnet the path stays dormant (sessions.ts:4323-4328 need the floor of 30, networks.ts:71) until someone's 5 ₳ ADA pool holds 30 boxes that aren't the user's; then it switches on for every 1.6.0 user at once, never tried live. Separately, if the token routes answer 503 on real db-sync, every mainnet wallet reads token pools from Koios and asks Koios what made its boxes, which tells Koios which boxes are the user's. The policy discloses that fallback, but nobody would notice it had become the norm.

**Confirmed how.** Read the plan's handoff and the code paths it names, and checked deploy runs with gh run list --workflow data-layer-deploy.yml, plus git diff 68150b39..499768f6 (nothing under seedelf-data/, list.json unchanged). Nothing was run against live services.

**Suggested fix.** Before the release PR: (1) Do the live preprod run of a session return with the 5 ₳ pool shown, through giveme.my's witness of the mix, including one lock and unlock mid-chain. (2) The owner runs `cd seedelf-data && cargo test --test live_lovejoin -- --ignored --test-threads=1 --nocapture` and curls /seedelf/v1/mainnet/lovejoin/pools and /lovejoin/tokens for 200. (3) The owner takes or overturns the open calls. (4) Refresh `npm run tokens`, `npm run dreps` and `npm run lovejoin-pools` on this branch. If this review changes seedelf-data/ or list.json, deploy again before the package.

**Test idea.** Live: a preprod session return whose chain makes the collateral box, then a giveme.my-witnessed mix that lands, after which the pool page lists the box as mixed. Server: live_lovejoin's existing checks against home's db-sync.

**Skeptic (owner-call, medium).** The facts check out: the plan's own pre-PR gate is still open. Session 11's collateral mix under giveme.my's collateral has never run live, and only a fake giveme.my has ever been asked to sign one. PR #323 says so itself. No record shows the live_lovejoin db-sync test was run, or that anyone checked lovejoin/pools and lovejoin/tokens by hand after the 2026-10-23 deploy, though PR #321's 'After the merge' step 2 asks for that check. These are the owner's steps ('ask, don't do'), so this is an owner call, not something this branch can fix. What users face at launch is limited. On mainnet the collateral tail stays off until a 5 ₳ pool holds 30 boxes that aren't the user's, and the head start lists no mainnet token pools. The classic pool still reads its 1.5.0 routes, so if a token route fails, only token pools fall back to Koios, which the policy discloses. If giveme.my refuses, the code stops after a wait and two builds, the rest comes back, and the 5 ₳ box waits where the user can still get it. The policy already says 'If the mix can't go, the box waits there'. I keep medium because the untried giveme.my path would switch on for every user at once, and the data layer's token SQL has never met real db-sync. One detail is wrong: src/tokens was last changed 2026-10-07 (d5bb3c21), not 10-18. Only dreps and the pools' head start were written 10-18. Refreshing the lists again is optional, since it was already done on release branch #321.

Evidence: chunk-34-token-pools.md:915 ('Next: item 11's mixed collateral (Session 11) live on preprod, giveme.my's first witness of a Lovejoin mix among it…'), Session 11's Tests ('Not run here: e2e, and a live run on preprod'), :653 'Waiting on the owner', :1200-1201 (items 4 and 5). PR #323 body: 'Not in this PR: A live run on preprod. giveme.my has never been asked to sign a Lovejoin mix, so that run is the real check.' PR #321 body: 'After the merge … 2. Check by hand that lovejoin/pools and lovejoin/tokens answer 200'. No record of either check in docs/. Deploy run 39982806550 at 68150b39 was a deploy (its build job runs only for deploy). `git diff 68150b39..499768f6 -- seedelf-data/ extension/src/tokens/list.json` is empty. sessions.ts:4780-4808 (witnessTail), lovejoin.ts:325-326 (TAIL_KEEP_MS, TAIL_TRIES=2), :3488-3500 (tailOf→tailOver), networks.ts:71 (poolFloor 30), private-index.ts:227,232 (the classic pool on lovejoin/pool and lovejoin/since), :341 (TokensDown), privacy-policy.md:28.

## x-scenarios-sessions#0

**medium · confirmed · money** — After a restore, a session funded in parts gets back only one part's tokens: the other parts' tokens are left at the one-time account for good

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2609`

**Detail.** The restore scan builds a found session's record from one transaction only. recoveredRecords takes the oldest transaction the key didn't sign as the funding (sessions.ts:2609) and writes txs: [that one, ...swaps] (2616-2626). recovered.own lists only the transactions the key signed (2626). Funding parts are Seedelf spends, never signed by the session key, so parts 2..N of a 1.6.0 funding appear nowhere in the record. buildBack's `own` is record.txs + siteOuts + recovered.own (sessions.ts:4091). WebAssembly's plan_return therefore treats every other part's token UTxO as a stranger's (wasm/src/lib.rs:1198-1210). A stranger's UTxO is taken only if its own ADA covers the deposit outputs its tokens add plus STRANGER_MARGIN, otherwise it is left out as "cost" (1275-1279), and the session's ADA never pays for it. A token part of a funding pays its share with exactly its least ADA for an address, or a little more, which is less than a Seedelf deposit with a register needs. leftBy then records these UTxOs as leftBehind (sessions.ts:4431-4445), returnable() skips them, and the session closes pointing at them. 1.5.0 fundings were one transaction, so this is new with funding in parts.

**Scenario.** A user funds a site's private session (CIP-30) with 25 NFTs spread over 25 private UTxOs, so the funding goes as 2 parts (20 NFTs + the 5 ₳ collateral, then 5 NFTs). They restore the wallet on a new device before using the NFTs, run Find leftovers, and press Bring it back on the found session. The return brings back only the part the scan recorded. The other part's NFTs are listed as "holds tokens its own ADA doesn't pay the deposit for, so it stays there" and stay at the one-time account (24301'/i) for good. A top-up doesn't help, and nothing in the wallet can move them, although the phrase still holds their key.

**Confirmed how.** Read the code, then a throwaway Vitest (tests/zz-review-x-scenarios-sessions-restored-parts.test.ts, now deleted). It built a site session's funding with the real WebAssembly from 25 private UTxOs, one distinct token each: 2 parts, part 1 paying 20 tokens with 6.676 ₳ plus the 5 ₳ collateral, part 2 paying 5 tokens with 2.409 ₳. It then called buildSessionReturn on the rows the parts paid session 0. With own = every part (the live record), leftOut was [] and 25 tokens came back. With own = part 1 only (the restore scan's record), part 2's UTxO was left out with reason "cost" and 20 tokens came back. With own = part 2 only, part 1's 20-token UTxO (6.676 ₳) was left out with reason "cost" and 5 tokens came back.

**Suggested fix.** In recoveredRecords, count as the session's own (in recovered.own, or as more funding records) every transaction that paid the account from the wallet's own Seedelf UTxOs. The tx_info the scan already fetches shows inputs at the wallet contract's payment credential; better still, check their registers against the phrase. Then plan_return takes these UTxOs as the session's own. An alternative is for buildBack to treat the outpoints the scan recorded in txs[0].outs as own.

**Test idea.** Restore-scan test: a site session funded in two parts, each holding distinct tokens, is found by the scan (records written as recoveredRecords writes them). Assert that Bring it back's leftOut is empty and every token comes back. It fails on HEAD with a "cost" entry for the part the scan didn't record.

**Skeptic (confirmed, medium).** This holds on HEAD, end to end through the restore scan. recoveredRecords writes a found session with one funding: the oldest transaction its key didn't sign. recovered.own lists only the transactions the key signed. Funding parts spend Seedelf UTxOs and never the account, so every part but one is missing from the record. buildBack's `own` covers only record.txs, siteOuts and recovered.own. The scan does write every UTxO it read at the account into txs[0].outs, but `outs` only decides when the session ends; plan_return never reads it. plan_return then counts the other part's token UTxO as a stranger's. It takes it only if that UTxO's own ADA covers the deposit outputs its tokens add. A later part pays exactly the least its tokens need at a key address: in_parts pays part 1 `owed - least(later)`, so later parts get exactly their least. That is less than a Seedelf deposit with a register, so the UTxO is left out as "cost". leftBy then records it as leftBehind "fee", and the session closes. A closed session in the book is never scanned again, and a top-up can't help: the session's ADA never pays for a stranger's tokens. My test also narrows the case. The loss needs the parts' token kinds to spill into another output (more than 20 kinds in all, MAXIMUM_TOKENS_PER_UTXO). One token spread over both parts merges into the same output, pays its own way, and comes back, so the owner's single-token test case is safe; many distinct NFTs funded in parts are not. It also needs a restore, or Find leftovers in a second browser, while the parts are still unspent at the account. The same class already existed in 1.5.0 for a site's token top-up: topUpBuild took tokens at 1.5.0's 63f87b8:1585, and a restore never recorded top-ups either. Funding in parts makes it reachable from a funding alone. Medium is right: tokens locked in an unlikely but plausible case, with no way out in the wallet, though the phrase still holds the key.

Evidence: seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2609 (`const funding = txs.filter((t) => !own.has(t.tx_hash)).at(-1)`), :2616-2626 (txs: [funding, ...swaps]; recovered.own = signed only), :2497 (outs = every row, used only by ownOuts/ownGone), :4091 (own = record.txs + siteOuts + recovered.own), :4431-4445 (leftBy -> leaveBehind "fee"); wasm/src/lib.rs:1198 (is_own by tx_hash), :1075 (20 tokens to an output), :1276-1279 (stranger left as "cost"); :4140-4146 in_parts pays part 1 `owed - keep`. Throwaway Vitest through the real scan and real WebAssembly (tests/zz-review-x-scenarios-sessions-skeptic.test.ts, now deleted): account 0 used with P1 (20 distinct NFTs on 2.4 ₳, plus 5 ₳) and P2 (5 more NFTs on 1.5 ₳). The scan recorded txs [P1] and own []; backBuild(direct) gave leftOut [{P2#0, reason "cost"}], 20 tokens back, and leftBehind [{P2#0, "fee", 1500000}]. Control with P2 in recovered.own: leftOut [], 25 tokens back. With one token across both parts: leftOut [], everything back.

**Reproduction (confirmed, medium).** I reproduced it end to end with a throwaway Vitest, tests/zz-review-x-scenarios-sessions-restore-parts.test.ts (now deleted). It used the real WebAssembly and the test fakes, and runs the real scan and return code.

Setup and checks:
- The private balance held 25 UTxOs, each with one NFT on 2 ₳, plus one UTxO of 60 ₳ of ADA alone.
- I called sessions.siteOutBuild("preprod", ORIGIN, "10000000", 25 NFTs), then siteOutSubmit. The funding went out as 2 parts.
- Control: the live device's record (both parts in txs, parts: 2) went through backBuild(direct). leftOut was [] and 25 tokens came back.
- Then a fresh device with the same phrase (unlocked()/signing()). Account 0 is used, account_txs lists the two parts newest first, and both parts' outputs are at the account. I ran scan, then backBuild("preprod", 0, true), sent the return with backSubmit, let it land, refreshed, and ran scan again.
- The test asserted back.leftOut toEqual [] and back.tokens toHaveLength(25). Both fail on HEAD.

Printed, 25 distinct policies:
- Part 1 paid #1 5000000 lovelace and #2 8237210 lovelace with 20 tokens. Part 2 paid #0 1762790 lovelace with 5 tokens, which is exactly the least for those tokens at a key address.
- The found record: txs [part 1], parts undefined, recovered.own [], txs[0].outs holding all 3 rows.
- The return: leftOut [{part2#0, reason "cost"}], 20 tokens back, 2 inputs.
- leftBehind afterwards: [{part2#0, reason "fee", lovelace "1762790"}].
- After the return landed: stage "closed", with part 2 still listed in leftBehind.
- Scan again: {"used":1,"found":[]}.

Printed, one collection (one policy, 25 names): the same result. Part 2 paid 1271450 lovelace with 5 tokens, it was left out as "cost", 20 tokens came back, and the session closed.

Same-block variant (both parts in one block, part 2 sorting last by hash):
- Asking 10 ₳: the scan picked part 2 as the funding. Part 1's 8.237 ₳ pays for its 20 tokens, so all 25 came back.
- Asking 1 ₳: part 1 paid 4090190 lovelace with 20 tokens. The scan picked part 2, part 1's UTxO was left out as "cost", and only 5 tokens came back. Up to 20 NFTs can be stuck.

Trace on HEAD:
1. sessions.ts:1838 siteOutBuild calls buildFunding (2678), whose inParts defaults to true (2686), then buildWithdrawParts (2704).
2. lib.rs:4514 build_withdraw_parts calls in_parts (4083). An earlier part pays `owed - least(later)` (4128-4137). The last pays `owed.max(least(&tokens))` (4152-4156), which is exactly its tokens' least at the session's key address.
3. The live record has every part (fundingRecords, 5317-5325).
4. Restore: scanNow (2449) calls recoveredRecords. Funding parts spend Seedelf UTxOs, never the session's key, so they are missing from `signed` (2581). The funding is only the oldest unsigned transaction (2609). txs = [it, ...swaps] (2616-2625). recovered.own lists only signed transactions (2626), and no `parts` is written.
5. scanNow puts every row it read into txs[0].outs (2497). Only the end check reads that (ownGone, 932-940). Nothing in the return reads it.
6. buildBack's own = record.txs + siteOuts + recovered.own (4091). That is one part.
7. plan_return: is_own goes by tx_hash (lib.rs:1198). The other part's token UTxO falls in strangers (1208-1210). With more than 20 token items, its tokens need a new deposit output with a register (deposit_measure, 1070-1086), which costs more than its own ADA. So it is left out as "cost" (1275-1278).
8. The Lovejoin path (Settings' lovejoinReturns defaults to true, shared/preferences.ts:170) uses the same rule: with_return calls plan_return with request.own (wasm/src/lovejoin.rs:1770-1801).
9. leftBy records the UTxO as leftBehind "fee" (sessions.ts:4431-4446).
10. A found session has no `site`, so once its return lands it closes (5068-5070). returnable leaves the UTxO out (885), and ownGone counts a listed leftBehind as gone (936).
11. scanNow scans only indexes the book doesn't know (2475-2476). live() refuses a closed session (5242).
12. The page then calls the user's NFTs "too little ... to pay for its own way back" (en.json:1868). The return's review said "holds tokens its own ADA doesn't pay the deposit for" (en.json:1871).

Why: The finding holds on HEAD exactly as described. A restore records only one part of a funding in parts. The return treats every other part as a stranger's UTxO: a part carrying only its least ADA can't pay for the extra output its tokens need, so its tokens stay at the one-time account. The session then closes and is never scanned again. There is no way out in the wallet: live() refuses a closed session, top-up ADA never pays for a stranger's tokens, and even a fresh scan would pick part 1 again as the funding. The phrase still holds the key, so the tokens are recoverable only outside the wallet.

Medium is right. It takes a site session funded with more than 20 token items across more UTxOs than one transaction spends (typically many NFTs), and then a restore, or Find leftovers in a second browser, while the parts are still at the account. A single token spread over the parts merges into one output and comes back. Swaps and mixes fund one token; a Bootstrap's funding never goes in parts. In the second-browser case the first browser's full record still brings the part back. A restore is where it sticks. The amount at stake is up to 20 NFTs plus a little ADA per stuck part.

**Fix notes.** Where to fix: recoveredRecords (sessions.ts:2605-2629). The scan already fetches tx_info for every transaction it lists (2555), including each input's payment_addr.cred.

What to record as the session's own: every unsigned transaction that spent the wallet's own Seedelf UTxOs and paid the account. Don't simply count all unsigned transactions. A DEX fill or refund is unsigned too, and so is anyone's payment. Counting those would break the H1/H2 rule (the session's ADA never pays for a stranger's tokens) and turn token dust into a drain on the session's ADA. Matching inputs at the wallet contract's credential is not enough either: anyone can pay the account from their own Seedelf UTxOs. Check the spent registers against the phrase, through utxo_info of the inputs or the private index.

Don't rely on part order. The scan's pick, `.at(-1)` under Koios's block_height.desc,tx_hash.asc (koios.ts:863), means any part can become "the funding" when parts share a block. In my variant that left part 1's 20 NFTs behind instead of part 2's 5.

Scope: cover top-ups too. 1.5.0 already had this class (topUpBuild took tokens at 63f87b8:1585-1598; the restore recorded one funding at 63f87b8:2126/2143). HEAD's topUpBuild (sessions.ts:2037-2061) still takes tokens.

How to record them, and what each choice changes:
- In recovered.own: buildBack (4091) and lovejoin.chain read them. foundUntouched (1170-1172) stays right. collateralTopUp (2176) then rightly classes their change in the private balance as the session's (C36). fundingChange (4460) won't merge into them, which is harmless.
- As extra txs entries: also set `parts` to their count, with confirmed: true. Otherwise afterFunding/foundUntouched change how a found session ends, and fundingOf/fundingState misread the funding.
- Don't use txs[0].outs alone as own. It would include a stranger's token UTxO that was at the account when the scan ran.

Test to add: in restore-scan.test.ts, a site session funded with 25 distinct NFTs in 2 real parts. Assert that backBuild's leftOut is [] and 25 tokens come back. Repeat with both parts in one block, the later part sorting last. Both fail on HEAD with a "cost" entry.

Words: SessionLeft.tsx's "too little ... to pay for its own way back" (en.json:1868) is false for the user's own tokens. It disappears once the fix keeps them from being left behind.

## 309#1

**low · confirmed · money** — After 10 minutes, a collateral payment still on its way reads "Not set" on the new Home row, Lovejoin's form and a freshly opened page, which offer a second payment while Home's banner says the first can still land

At `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:359`

**Detail.** `collateral()` says "waiting" only for WAIT_MS, 10 minutes from `collateralSentAt` (coin-control.ts:359). The pending watch keeps a public-account payment for up to VALID_FOR_MS plus 30 minutes, about 2.5 hours (pending.ts). Home's hold, HOLD_MS, is also 10 minutes, so both lapse together. Then the PR's new ways in all flip to "none". The Home row shows "Not set" (Home.tsx:1117). Lovejoin's form stops its 15 s interval, because `collateralComing` turns false (Lovejoin.tsx:2218-2226), says "…which isn't set." and offers Set collateral again; it passes no `blocked`. The page opened then has Set collateral enabled (Collateral.tsx:209, `blocked` undefined after HOLD_MS). `collateral-build` → `pay()` refuses only a maybe-sent payment (`settleMaybeSent`), so a second 5 ₳ payment is built from the other UTxOs. Chunk 35's own record names this exact invitation ("then 'Not set', which invited a second 5 ₳ payment") as the bug it fixed, but the fix covers only Settings' page left open. The 10-minute wait itself is chunk 12's documented design, from when the page was in Settings alone.

**Scenario.** On a congested mempool, the collateral payment isn't in a block after 10 minutes. Home's banner: "Collateral payment not confirmed yet. It can land until about 16:40…". The Public tab row: "Not set. Some sites need it…". Lovejoin: "Lovejoin's mixes need your public account's collateral, which isn't set." with Set collateral. The user presses it and sends again. Both land: two 5 ₳ UTxOs, the second recorded as the collateral, and one fee (about 0.17 ₳) wasted. A maybe-sent first payment is safe, because the build is refused.

**Confirmed how.** Read the code. The existing coin-control test "stops being waited for after 10 minutes" shows "none" at 11 minutes while the payment is unconfirmed, and pay() gates only on settleMaybeSent.

**Suggested fix.** Have the worker's `collateral` answer "waiting" for as long as the pending watch still holds, unsettled, the transaction that set `choices.collateral`. That's a session read with no request. Alternatively, have `collateral-build` refuse while that payment may still land. Either way the row, Lovejoin and the page agree with Home's banner.

**Test idea.** Vitest: build and submit the collateral payment, advance the clock 11 minutes with tx_status unconfirmed and the watch still holding it. Expect the `collateral` handler to say "waiting" and `collateral-build` to be refused. On HEAD it says "none" and a second build succeeds.

**Skeptic (confirmed, low).** The mechanism holds. `collateral()` says "waiting" only for WAIT_MS (10 minutes from `collateralSentAt`). The pending watch keeps a public-account payment until its slot plus 30 minutes (VALID_FOR_MS is 2 h), and Home's banner says it can land until then. `collateral-build` → `pay()` refuses only a maybe-sent payment (`settleMaybeSent`). At 10 minutes, Lovejoin's form stops its interval, shows "needsCollateral" and offers Set collateral. Home's row reads "Not set" on its next reading, and a freshly opened page has Set enabled, since Home's `blocked` lapses at HOLD_MS, the same moment. The 10-minute wait is documented design (chunk 12 row 21, architecture.md:366). But chunk 35's record names "then 'Not set', which invited a second payment" as a problem, and its fix covers only a page left open (the look returns early while the watch says unconfirmed). So this isn't the owner's choice. It stays low: it needs a payment still not in a block after 10 minutes. Such a payment was most likely dropped, and the watch never resends an ordinary one, so a second payment is then the right step. If both land, the cost is one fee (~0.17 ₳) and an extra 5 ₳ UTxO the user still holds. Mostly pre-existing: Settings' page, which passes no `blocked`, did the same before #309. #309's Lovejoin form makes it most visible.

Evidence: HEAD: coin-control.ts:65 (WAIT_MS), 359; account.ts:207 (VALID_FOR_MS 2 h); pending.ts EXPIRED_AFTER_SLOTS and the expired/unseen rules in settleNow (about lines 772-790); send.ts pay() -> settleMaybeSent only; pending.ts settleMaybeSent (refuses only unsettled = maybe-sent); Lovejoin.tsx:2218-2226, 2652-2659; Home.tsx:130 (HOLD_MS), 384-395, 1117; Settings.tsx:132 (no blocked); existing test tests/coin-control.test.ts:131. Throwaway test (deleted): at +11 min, coins.collateral() said "none", pending() still held the first payment (confirmations null, not dropped), and a second buildCollateral succeeded with a new txHash.

## 309#2

**low · confirmed · state** — A collateral payment is recorded on whichever account is active when its submit returns, not the account it was built on (pre-existing)

At `seedelf-platform/seedelf-web-wallet/src/background/send.ts:96`

**Detail.** `submitCollateral` (send.ts:94-98) calls `coins.sent(network, txHash#0)` after `send()`. `sent()` reads and saves through `choices()` and `save()` (coin-control.ts:388-395, 405-408), which use `activeIndex()`, the account active now. The payment itself was built on, and pays, the build-time account: `buildCollateral` uses `keys.cardano.receiveAddress(net, 0)`. `keep()` stores that account (script-spend.ts:358-360), and `send()` passes it on to the watch (`account: built.account`), but not to `coins.sent`. If the account is switched from another window while Koios or the data layer is being asked (seconds), the choice, its sent time and `collateralPaid` go to the wrong account. The page itself re-keys on the switch (App.tsx:280-283), but the worker's call carries on. This is not in #309's diff, but #309's new ways in all reach this path.

**Scenario.** The user has Account 1 and Account 2. In the tab, they press Send on Account 1's collateral review; while it's sending, they switch to Account 2 in the side panel. Account 2's own chosen collateral is replaced by a UTxO that isn't Account 2's, or its reclaim is undone, and the wallet then takes its oldest 5 ₳ UTxO by itself. Account 1 records nothing: if it had reclaimed, after the landing it shows "Not set" and offers another payment, and its Activity calls the payment "Sent" instead of "Set collateral".

**Confirmed how.** Read the code (send.ts:94-98, coin-control.ts:388-408, script-spend.ts:358-360 and send()'s submitWatched call). No test: narrow race.

**Suggested fix.** Record it on the account it was built on: have `submitCollateral` read the kept build's `account` (SESSION_COLLATERAL) before sending, and pass it to `CoinControlService.sent(network, utxo, account)`, which saves through `withChoices(stored, account, …)`.

**Test idea.** Vitest with two accounts: build the collateral payment on account 0, set the active account to 1, then submitCollateral. Expect choicesOf(stored, 0).collateral to be tx#0 and account 1 unchanged. On HEAD it is recorded on account 1.

**Skeptic (confirmed, low).** The defect is real. `submitCollateral` records through `coins.sent`, and both `choices()` and `save()` there resolve `activeIndex()`, not the kept build's `account`. Everything else around it uses the build's account: the watch (`record.account = s.account ?? keys.account`, commented "which another window may have switched from since") and mint.ts:164's minted-by record. privacy.md:72 promises the mint's record holds "even if another window switched accounts before Send". My test confirmed it: the worker doesn't refuse a send whose build account differs from the active one, and the choice lands on the active account. The finding's stated scenario is mostly refuted, though. `writeAhead` marks the payment maybe sent before Koios is asked, and `account-use` refuses a switch while anything is maybe sent, so the side panel can't switch "while it's sending". A switch also re-keys every screen in the tab, which drops the review. What's left is a millisecond coincidence: a switch whose `atStake` check ran just before the write-ahead, or one that lands between the watch's `take` and `coins.sent`'s read. Or a tab whose `accounts` read failed, so it didn't re-key. So it's low, arguably nit. The fix is small and follows the release review's pattern: read `built.account` before `send()`, as mint.ts does. Then save through `withChoices(stored, account, …)`, with one account for both the read and the write. Today `choices()` and `save()` each read `activeIndex()`, so a switch between them could also copy one account's locks onto the other.

Evidence: HEAD: send.ts:94-98; coin-control.ts:221-226 (choices -> activeIndex), 388-395 (sent), 406-408 (save -> activeIndex again); script-spend.ts:359 (keep stores keys.account), 440 (send passes built.account to the watch only); pending.ts:564-620 (writeAhead maybe-sent before submit; 594 record.account), 514-518 (take after Koios answers); handlers.ts:345-351 (account-use refused while maybeSent); mint.ts:160-166; privacy.md:72; App.tsx:280-283 and accounts.tsx:128-137 (re-key on the switch). Throwaway test (deleted): build on account 0, set LOCAL_ACCOUNT to 1, then submitCollateral. No refusal; choicesOf(stored,1).collateral was txHash#0 and choicesOf(stored,0).collateral was undefined. Passed.

## 310#0

**low · confirmed · docs** — The rollback note never got chunk 36's line, and now describes a `.prev` two deploys old

At `seedelf-data/deploy/README.md:142`

**Detail.** PR #310 said that once its API was deployed, the rollback note needed a line for it, because `.prev` would lack account_update_history (docs/archive/plans/chunk-36-delegation-history.md:45; docs/roadmap.md:52). The route went out in the 2026-10-15 deploy at #311's merge (304f1d1), together with chunk 37's pool_history. deploy/README.md:142 only got chunk 37's sentence ("Once web wallet chunk 37's API is deployed, `.prev` lacks `pool_history`"). From 2026-10-15 to 2026-10-23 the note therefore left out that a rollback also took away Delegation history's route. The 2026-10-23 deploy at #321's merge (68150b3) made `.prev` the 304f1d1 build. `git diff 68150b3 HEAD -- seedelf-data` is empty, and account.rs and query.rs are unchanged since #310, so that build has account_update_history in the same shape: chunk 36's route is now safe from a rollback. The note itself is still out of date. It describes `.prev` as the 1.5.0-era build that lacks pool_history, which is false now. It does not say what the current `.prev` lacks: everything after #311, including the Lovejoin pool routes (`git diff --stat 304f1d1 68150b3 -- seedelf-data/api/src` shows api/src/lovejoin/routes.rs as new).

**Scenario.** During the 1.6.0 release an operator considers a `rollback` and reads line 142 to judge the cost. The note says `.prev` lacks pool_history, which is no longer true. It says nothing about the routes `.prev` really lacks: those 404s would send every 1.6.0 wallet's reads that use them to Koios. Users see nothing unless a rollback happens; the risk is a rollback whose effect the operator has misjudged. For chunk 36 itself nothing breaks today.

**Confirmed how.** Read the code and history: deploy/README.md:142 on HEAD, and `gh run list --workflow data-layer-deploy.yml`, which shows deploys at 63f87b8 (2026-10-13), 304f1d1 (2026-10-15) and 68150b3 (2026-10-23). `git merge-base --is-ancestor 62c4acc6e` confirmed both later deploys contain #310. `git diff --stat 304f1d1 68150b3 -- seedelf-data/api/src` shows account.rs untouched and lovejoin/ new, and `git diff 68150b3 HEAD -- seedelf-data` is empty. deploy/edge/seedelf-data-deploy:89-98 keeps the running binary as `.prev` on each deploy.

**Suggested fix.** Rewrite the end of line 142 to describe the current `.prev`: #311's build at 304f1d1, which has account_update_history and pool_history but lacks the Lovejoin pool routes added after it. Better, make it generic: name the deploy commit `.prev` came from and list the routes added since. Add "update the rollback note" to development.md step 7, so each deploy updates it.

**Test idea.** Docs only, so no unit test applies. A check that fails without the fix: have the deploy workflow's `status` print the commits of the running binary and of `.prev`, and have a release-checklist step (or a small script in CI) fail when the commit named in deploy/README.md's rollback note is not the one `status` reports for `.prev`.

**Skeptic (confirmed, low).** Survives every refutation attempt. The deploy logs fix the chain: the 63f87b8 deploy (10-13) kept 1c33984's build f814… as .prev; the 304f1d1 deploy (10-15, #311's merge, which contains all of #310) kept 63f87b8's build c5e8… as .prev; the 68150b3 deploy (10-23, #321's merge) kept 304f1d1's build f948… as .prev. No run since, and git diff 68150b3 HEAD -- seedelf-data is empty. So on HEAD the running binary is 68150b3's and .prev is 304f1d1's. Line 142 is now wrong both ways. (1) It overstates the cost to the shipped 1.5.0 wallet: '.prev is the build deployed at #302's merge … answers 1.5.0's Rewards history with a 400' and '.prev lacks pool_history' are both false now. 304f1d1's build has the oldest-first rewards fix (2121b5f0 is its ancestor), account_update_history (account.rs untouched after #310) and pool_history. (2) It omits what .prev really lacks: 304f1d1..68150b3 adds only the token-pool routes in lovejoin/routes.rs:40-44 and changes no public route or existing request shape. row.rs's `own` defaults to MIXBOX_HASH for the classic routes; chain.rs only adds functions. #310 never touched deploy/README.md, though its plan said the note 'needs its line for this build'. Chunk 37's commit d9cc68ca added only the pool_history sentence, so from 10-15 to 10-23 the note left out account_update_history. That gap harmed no released wallet: git grep at 63f87b8 shows 1.5.0 calls neither route, so it is moot now. Low, not medium: it is an operator runbook, not a statement about money or privacy, and it only matters if someone rolls back. A rollback after 1.6.0 ships also degrades gently, which the finding's scenario roughly matches. private-index.ts:341 turns a token route's 404 into TokensDown and leaves the part up; the comment at :323-325 names this exact case, 'a server older than the route, deployed back'. lovejoin.ts:2600-2608 then reads the token pools' boxes from Koios, and feed.ts:276-288 has a watch use tx_status. lovejoin-pools.ts:423-425 drops the crowds, and look() at :388-393 scans Koios's holder for discovery. No 5-minute hold, no money at risk; the operator would misjudge only Koios load and the crowd display. The suggested fix is sound: rewrite the end of :142 to name .prev as 304f1d1's build, which has everything 1.5.0 asks for plus account_update_history and pool_history and lacks only lovejoin/pools, lovejoin/tokens and lovejoin/tokens/since. Optionally add 'update the rollback note' to development.md step 7. If the review's fixes change seedelf-data and cause another deploy before the upload, .prev becomes 68150b3's build and the note needs rewriting again then.

Evidence: HEAD seedelf-data/deploy/README.md:142 (unmodified in the working tree). gh api actions/jobs/<vps>/logs: run 38419150936 (63f87b8) 'DEPLOYED c5e8… (f814… kept as .prev)'; run 38765078629 (304f1d1, 2026-10-15) 'DEPLOYED f948… (c5e8… kept as .prev)'; run 39982806550 (68150b3, 2026-10-23) 'DEPLOYED 3b03… (f948… kept as .prev)'. All three were deploy runs (build job ran, step named 'deploy'); the latest run is 10-23. seedelf-data/deploy/edge/seedelf-data-deploy:89-98 keeps the old binary as .prev only once the new one passes. git diff 68150b3 HEAD -- seedelf-data: empty. git diff --stat 304f1d1 68150b3 -- seedelf-data: lovejoin/* new, private.rs merges crate::lovejoin::routes::routes(), public/ untouched; seedelf-data/api/src/lovejoin/routes.rs:40-44. git merge-base --is-ancestor: 62c4acc6e and aa8b39e15 are in 304f1d1, not in 63f87b8; 2121b5f0 and 63f87b8 are in 304f1d1. git log 0cab60a94..aa8b39e15 -- seedelf-data/deploy/README.md: empty; d9cc68ca changed :142. docs/archive/plans/chunk-36-delegation-history.md:45 and docs/roadmap.md:52 asked for the line. git grep at 63f87b8 over extension/src for account_update_history|pool_history|lovejoin/tokens|lovejoin/pools: no matches. Wallet handling on HEAD: extension/src/background/private-index.ts:323-325,341 (TokensDown on 404, part left up); lovejoin.ts:2586-2608 (Koios credentialUtxos fallback); feed.ts:276-288 (undefined, so tx_status); lovejoin-pools.ts:388-393,401-426 (crowds dropped, Koios holder scan). docs/plans/chunk-34-token-pools.md:1201 (the 1.6.0 release steps: deploy and hand-check the token routes, nothing about the rollback note).

## 311#0

**low · confirmed · tests** — e2e's 'Back from its review asks neither again' can't catch a second pool_history read

At `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:4183`

**Detail.** After Back, the test waits only until `pool-details-return` contains the words "Return on stake" (e2e/extension.spec.ts:4183), then checks `expect(asked).toHaveLength(2)` straight away (4184), and the test ends there. That row shows its label whatever its value. While a read is in flight, PoolFacts draws "Return on stake Reading…" (Staking.tsx:805, with returnValue at 721-725), and pool-return-screen.test.ts asserts exactly that text. So if PoolPage read the history again on Back (it relies on `knownHistory`, Pools.tsx:337, and on the `if (!history)` guard at 351), the wait would pass on the 'Reading…' row, before the worker's fetch reaches Playwright's route, and `asked` would still be 2. pool_info is covered, because the figures (and the return row with them) aren't drawn until the details are known, which forces the wait. The fold-and-unfold check on Staking (4166-4169) is just as immediate, but the later `[LOGIC, TPREP]` assertion (4178) would catch a second LOGIC read, so only the Back path is unguarded.

**Scenario.** A later change stops PoolPage taking `view.history` (say a refactor of PoolsView, or an onStake that rebuilds the view without `history`). Every Back from a pool's review then asks pool_history again: one more request naming the pool, and a flash of 'Reading…' in its figures. The e2e that claims to guard this path still passes.

**Confirmed how.** Read the code: e2e lines 4176-4185, PoolFacts and returnValue (Staking.tsx:721-725, 805), PoolPage's history state and effect (Pools.tsx:337-352). pool-return-screen.test.ts's own `Return on stake Reading…$` expectation shows the label is there while reading. Not run: e2e and Playwright aren't allowed on this machine.

**Suggested fix.** After Back, wait for the value rather than the label, e.g. `await expect(page.getByTestId("pool-details-return")).toContainText(/Return on stake\d+(\.\d+)?% a year/)`. Today the value is there at once. A second read would match only once it had finished, and `asked` would then hold 3. Optionally do the same, or an `expect.poll` on `asked.length` after a short settle, at the fold-and-unfold check (4166-4169).

**Test idea.** Temporarily render PoolPage with `knownHistory={undefined}` in Pools.tsx and run the chunk 37 e2e. Today it passes. With the value wait, it fails with three pool_history requests.

**Skeptic (confirmed, low).** On HEAD, a second pool_history read on Back would not be reliably caught. After Back the test waits only for the label (e2e/extension.spec.ts:4183). Row (src/ui/components/ReviewRows.tsx:28-56) puts data-testid on the wrapper that holds both the label and the value. returnValue gives 'Reading…' while the history is undefined (Staking.tsx:721-725), and the row draws as soon as the details are known (Staking.tsx:797-806). With `known` details passed, it draws on mount. So in the regression the wait passes on Playwright's first check. `asked` is then checked at once (4184) and the test ends (4186). The extra read still has a long way to go: UI port to the worker (handlers.ts:304), then StakingReader.poolHistory, 'read fresh and kept nowhere' (staking.ts:392-398), then the Koios fetch, then the route. At best a race catches it. Nothing else guards this path. pool-return-screen.test.ts uses renderToStaticMarkup, so no effects run, and no unit test mounts PoolPage. The older staking e2e (3678-3683) never presses Back from the pool's review. The fold-and-unfold path is guarded in practice by the later toEqual([LOGIC, TPREP]) at 4178, as the reviewer says. Behaviour on HEAD is correct: PoolPage starts from knownHistory (Pools.tsx:337) and skips the read (351). Staking keeps `history` in the view: onHistory at Staking.tsx:367, and onStake spreads the view at 370. So this is test strength only. If it regressed, the wallet would ask again for the pool it just named and briefly show 'Reading…'. No money is at risk and no privacy promise is broken, which puts this at the bottom of low. The suggested fix (wait for the value regex) is deterministic: the route handler pushes to `asked` before route.fulfill, and the value can't show until the answer arrives.

Evidence: e2e/extension.spec.ts:4172-4186 (4183 waits for the label 'Return on stake', 4184 checks expect(asked).toHaveLength(2)); src/ui/components/ReviewRows.tsx:51-56 (testId on the div wrapping <dt> and <dd>); src/ui/screens/Staking.tsx:721-725 (returnValue: 'Reading…' while there is no history), 797-806 (facts drawn once details are known, return Row at 805), 367-371 (view keeps history); src/ui/screens/Pools.tsx:146 (knownHistory={view.history}), 337, 349-352; src/background/staking.ts:392-398 (kept nowhere); tests/pool-return-screen.test.ts ('Return on stake Reading…$' expectation, static markup only). Not run: e2e and Playwright aren't allowed on this machine.

## 311#1

**low · confirmed · docs** — Runbook's rollback note says .prev lacks pool_history: since the 2026-10-23 deploy it has it, and lacks the token pools' routes instead

At `seedelf-data/deploy/README.md:142`

**Detail.** #311 added "Once web wallet chunk 37's API is deployed, `.prev` lacks `pool_history`: rolled back to it, every pool a wallet opens sends its public reads to Koios for 5 minutes." That was true after the 2026-10-15 deploy (304f1d163, when `.prev` was 1.5.0's 63f87b8). The deploy workflow ran again on 2026-10-23 at 68150b39 (#321; gh run 39982806550, build and deploy jobs), so `.prev` is now 304f1d163, which added pool_history. What it lacks is everything merged after it: chunk 34's token-pool routes (`crate::lovejoin::routes::routes()`, merged into private.rs between 304f1d163 and 68150b39). The runbook doesn't name those. The same paragraph's "After 1.5.0's deploy, `.prev` is the build deployed at #302's merge" is stale in the same way. HEAD's seedelf-data equals 68150b39 (`git diff 68150b39 HEAD -- seedelf-data/` is empty), and history.rs hasn't changed since #311, so the route a 1.6.0 wallet calls is live.

**Scenario.** During 1.6.0's first week the API misbehaves and the owner checks the runbook before pressing `rollback`. The note warns that pool pages will go to Koios, which won't happen. It says nothing about the token pools' routes, which a rollback to 304f1d163 takes away from every 1.6.0 wallet. The owner weighs the wrong cost.

**Confirmed how.** `gh run list/view` for data-layer-deploy.yml: 2026-10-15 at 304f1d163 and 2026-10-23 at 68150b39, both with build and deploy jobs. `git diff 304f1d163 68150b39 -- seedelf-data/api/src/private.rs` shows the lovejoin routes merged in. `git diff 68150b39 HEAD -- seedelf-data/` is empty.

**Suggested fix.** Rewrite the paragraph's tail for the current pair: running is 68150b39 (#321), `.prev` is 304f1d163 (#311). `.prev` has `pool_history` but not the token pools' routes. Say what a 1.6.0 wallet does when those answer 404 (chunk 34's slice owns that behaviour). Drop the 1.5.0 sentence, or give it a date.

**Test idea.** A release-checklist step rather than a unit test: run the deploy workflow's `status`, then diff the routes in public/mod.rs and private.rs between `.prev`'s commit and the release commit, and check that the runbook names what's missing.

**Skeptic (confirmed, low).** The note at seedelf-data/deploy/README.md:142 is unchanged since #311 (d9cc68ca). It's now false: `.prev` has pool_history, and what it really lacks goes unnamed. Both later runs of data-layer-deploy.yml were deploys. Run 38765078629 (2026-10-15, 304f1d163, #311's merge) and run 39982806550 (2026-10-23, 68150b39, #321's merge) each ran a `build` job, which runs only for `deploy` (data-layer-deploy.yml:27), and a successful `vps` job whose exit is the remote script's. The script keeps the old binary as `.prev` only after the new one passes its check. Otherwise it puts the old one back and exits 1 (seedelf-data-deploy:89-105). So `.prev` is 304f1d163's binary, and it serves /api/v1/pool_history (git show 304f1d163:seedelf-data/api/src/public/mod.rs:71). What it lacks are the token pools' three routes, merged by #321: lovejoin/routes.rs:38-46, added at private.rs:85. HEAD's seedelf-data equals 68150b39 (empty diff). The paragraph's general sentence is also wrong for these routes. It says a missing route 'holds the wallet's whole public part on Koios for 5 minutes'. A 1.6.0 wallet instead turns their 404 into TokensDown and leaves the part up (private-index.ts:341; chunk-34 plan line 646, 'a server deployed back'). It then drops the crowds (lovejoin-pools.ts:420-427) and reads the token pools' boxes from Koios at every read (lovejoin.ts:2608). Koios is also asked what made the wallet's boxes, the fallback privacy.md:200 documents. The 1.5.0 sentence ('`.prev` is the build deployed at #302's merge') is stale too. Roadmap.md:52 and the chunk 36 plan (line 45) record that each deploy's rollback note 'needs its line for this build'. #321's deploy added none, so this isn't an owner choice. The doc is the owner's runbook, not a user-facing page, and its stopgap/fix-forward rule still stands, so low. One caveat for the fix: if this review branch changes seedelf-data, the deploy before the upload makes `.prev` 68150b39. Write the line at that deploy, naming what that `.prev` lacks, rather than hardcoding 304f1d163.

Evidence: seedelf-data/deploy/README.md:142 (last changed in d9cc68ca); gh run list --workflow data-layer-deploy.yml: 39982806550 at 68150b39 and 38765078629 at 304f1d163, both with build and vps jobs successful; .github/workflows/data-layer-deploy.yml:27 and 90-105; seedelf-data/deploy/edge/seedelf-data-deploy:89-105; git show 304f1d163:seedelf-data/api/src/public/mod.rs:71 (pool_history route); seedelf-data/api/src/lovejoin/routes.rs:38-46 and private.rs:85 (absent at 304f1d163); git diff 68150b39 HEAD -- seedelf-data/ is empty; extension/src/background/private-index.ts:341, lovejoin-pools.ts:420-427, lovejoin.ts:2586-2608; docs/plans/chunk-34-token-pools.md:646; docs/privacy.md:200; docs/roadmap.md:52; docs/archive/plans/chunk-36-delegation-history.md:45.

## 312#0

**low · confirmed · tests** — Nothing tests the guard that refuses a mix over a transaction's CPU limit: the five-box test passes for another reason

At `seedelf-platform/seedelf-core/tests/lovejoin_width_test.rs:725`

**Detail.** `the_wallet_refuses_five_boxes` (lovejoin_width_test.rs:707-727) only asserts that `lovejoin::mix` returns an error. On HEAD the five-box mix fails before the guard at seedelf-core/src/lovejoin/mod.rs:999-1001 (`total > MAX_TX_BUDGET` → "Mixing {n} boxes at once needs more computation…"). Here is why: the draft is measured by `eval::evaluate` (eval.rs:302-310) under MEASURE_LIMIT (eval.rs:31, 14B steps), and uplc 1.1.23 shares that one budget across all of a transaction's redeemers (uplc-1.1.23/src/tx.rs:164 `remaining_budget`, reduced at :202). Five boxes need 15.05B, so mix_logic runs out of budget. `evaluate` then returns an Ogmios-shaped error, and `Budgets::from_ogmios` bails (build.rs:1256-1257). eval.rs:27-30 calls MEASURE_LIMIT 'the most a single script may use', which is not how uplc applies it. No Rust test makes a mix total between 10B and 14B or checks the computation message; the extension's lovejoin-planner.test.ts:599 only mocks that text. So removing or weakening mod.rs:999-1001 leaves the whole suite green. Yet that guard is the only check of a mix's *sum* against the ledger limit. The network's check of a chain's first mix (lovejoin.ts:3726-3746) compares the declared budgets with Ogmios's measure, script by script, and Ogmios gives each script the whole limit (as this file's own comment at :885-887 says). The guard is what makes D3's promise true ('refused when it's built, or it works', lovejoin-mix-width.md:10) and what triggers FOUR_REFUSED's fallback (lovejoin.ts:3128-3133) for a four-box mix pushed over 10B.

**Scenario.** A later edit drops or narrows the guard (for example, it checks each script against the limit instead of their sum), and CI stays green. Then a cost-model update makes the BLS12-381 builtins 2% dearer. A four-box mix now measures about 10.08B steps: the wallet builds it, and the first mix passes the network check because each script fits and the declared budgets cover what Ogmios measures. The deposit goes, and the node refuses the four-box mix (ExUnitsTooBigUTxO). The chain stops with the user's boxes unmixed in the pool, waiting for Mix my boxes again, and it never fell back to three as the review said it would.

**Confirmed how.** Read the code: lovejoin/mod.rs:991-1001, eval.rs:27-31 and :302-310, build.rs:1255-1257, uplc-1.1.23 src/tx.rs:164-203 (one remaining budget for every redeemer) and src/tx/eval.rs:96-125; the doc's five-box total (15,045,897,606 steps) is over 14B; grep found no Rust test of the mix's computation refusal. Not run (low).

**Suggested fix.** Make the five-box test assert the reason (the error text contains 'needs more computation than a transaction may use'), and add a four-box case between the limits. For that case, raise every entry of the V3 cost model by 2–3% so a four-box mix lands near 10.1–10.2B steps, under MEASURE_LIMIT, and assert that lovejoin::mix refuses it with that message. Correct eval.rs's MEASURE_LIMIT comment: uplc spends it across the whole transaction.

**Test idea.** In lovejoin_width_test.rs, copy `pool.params` with each cost_model_v3 entry multiplied by 103/100. Build four boxes on the classic pool and assert `lovejoin::mix(...)` errs with 'needs more computation than a transaction may use'. With mod.rs:999-1001 removed, the mix builds and the test fails.

**Skeptic (confirmed, low).** This survives. The five-box test only asserts is_err(), and on HEAD the five-box mix fails at measurement, before the guard. The draft is measured at mod.rs:992 under MEASURE_LIMIT, which is 14B steps (eval.rs:31). mix_logic alone needs 14,907,813,166 steps at N=5, so the measurement fails even per script. uplc also spends one remaining budget across all redeemers, so eval.rs:27's 'the most a single script may use' is inaccurate. The failed measurement makes Budgets::from_ogmios bail (build.rs:1256-1257). With today's cost model, no width lands between 10B and 14B (four is 9.88B), so no Rust test reaches mod.rs:999-1001. The only test of its message mocks the text. Nothing else checks a mix's sum. declared_covers compares redeemer by redeemer (eval.rs:406-428, build.rs:1335-1346). crossCheck relies on Ogmios, which measures each script against the whole limit. lovejoin has no other MAX_TX_BUDGET check. check_fee's 10 ₳ cap wouldn't catch it either. So deleting or narrowing the guard leaves CI green. Yet the guard is what keeps D3's 'refused when it's built, or it works' true, and what sends a four-box mix pushed over 10B to the FOUR_REFUSED fallback. Seedelf spends' TooMany guard does have a test (apart_test.rs:408); Lovejoin's doesn't. Low: today's code is right, and harm needs both a regression and a cost-model rise.

Evidence: seedelf-core/tests/lovejoin_width_test.rs:709-727 (assert at :725); seedelf-core/src/lovejoin/mod.rs:991-1001; seedelf-core/src/eval.rs:27-31, :302-310; seedelf-core/src/build.rs:1255-1257; ~/.cargo/registry/.../uplc-1.1.23/src/tx.rs:164 and :202 (one remaining_budget), src/tx/eval.rs:126-129; docs/lovejoin-mix-width.md:87 (mix_logic N=5 14,907,813,166); grep 'needs more computation' in Rust tests: none for a mix; extension/tests/lovejoin-planner.test.ts:599 mocks it; extension/src/background/lovejoin.ts:3128-3133 (fallback), :3726-3746 (crossCheck); grep MAX_TX_BUDGET: lovejoin uses it only at mod.rs:999

## 312#1

**low · confirmed · tests** — The harness-vs-wallet check re-measures the wallet's mix instead of reading what it declares, and covers the classic pools only

At `seedelf-platform/seedelf-core/tests/lovejoin_width_test.rs:698`

**Detail.** `the_harness_builds_the_wallets_mix` (:677-705) loops only over `classic(flag)` (:680). It compares `measure(&pool, &wallets.tx.tx_bytes.0, &ours.known)` (:698), a fresh evaluation of the wallet's transaction, with the harness's budgets, plus the fee and the unsigned length. uplc ignores the budgets a transaction declares: it runs each redeemer on the remaining budget and returns the cost it used (uplc-1.1.23 src/tx/eval.rs:96-125). So the test never sees what `lovejoin::mix` declares. Suppose a builder put the right budgets on the wrong redeemers (a permutation, the 'matched by purpose and index' trap; mod.rs:906-914 stages them). The measured list would be the same. The fee would be the same, since it is priced from the measured list (mod.rs:1006). The CBOR length would be the same too. The test would pass. Yet its comment and the doc (lovejoin-mix-width.md:33) say the wallet 'declares the same budgets'. The token-pool rows (doc :59-67, which the 'on every pool' choice rests on) are the harness's alone: on HEAD lovejoin::mix builds token-pool mixes (lovejoin_pools_test.rs:773-793, three wide), but no test in core, wasm or Vitest builds a four-box token-pool mix with the wallet's builder, whether by reference or inline. Also, lovejoin_pools_test.rs:1264-1265 says this file checks 'a mix and a withdraw' against an independent builder. It checks no withdraw.

**Scenario.** A refactor of mix_with's staging looks up each box's budget by the wrong position, so it declares 19.67M steps for the spend that needs 29.98M and the reverse. This test, the classic pool's backward-compatibility guard for 1.5.0 mixes, still passes. The wallet's mixes would then fail their scripts. Only the runtime check of each chain's first mix (declaredCovers) catches it, so every return through Lovejoin comes back directly, unmixed, and every mix from the tile is refused.

**Confirmed how.** Read the code: lovejoin_width_test.rs:677-705; lovejoin/mod.rs:906-914 and :1004-1008; uplc-1.1.23 src/tx/eval.rs:96-125 (the declared ex_units aren't the budget, and the result carries the measured cost); lovejoin_pools_test.rs:773-793 and :1262-1266. Grep for four-wide token-pool builds in seedelf-core/tests, wasm/tests and extension/tests found none.

**Suggested fix.** Also compare what the wallet's transaction declares: decode it (MultiEraTx::redeemers(): tag, index, ex_units) and assert those equal the harness's `used`. Add the token pool: build `lovejoin::mix` from `verify_pool` on the fixture's reference and seed (as lovejoin_pools_test.rs's lj_pool does) at three and four boxes, and compare budgets. The wallet carries this pool's scripts inline, so compare fee and size against a harness build with the scripts inline, or leave them out. Drop 'and a withdraw' from lovejoin_pools_test.rs:1264.

**Test idea.** Swap two spends' ex_units in the wallet's built transaction before comparing. The declared-units assertion fails, while today's re-measured assertion still passes.

**Skeptic (confirmed, low).** This survives. The test's `measure` re-runs the wallet's transaction through uplc and keeps result.cost(). uplc never reads the declared ex_units: it writes the measured cost back into the redeemer. So the test sees what the wallet's transaction uses, never what it declares. The fee is priced from the measured `used` (mod.rs:1006). A permutation of the measured values keeps every integer's CBOR length, so the length check misses it too. Only a gross error, such as DRAFT_BUDGET's 10B being declared (a 9-byte integer), would change the size. The test covers only classic(flag). No Rust test checks a mix's declared spend budgets by index. declared_covers is run on Seedelf spends, orders, a bring-back and recorded fixtures. lovejoin_mainnet_test.rs:182-186 sums the declared budgets, which a permutation doesn't change. The extension's mocked evaluate returns `result: []`. No test anywhere builds a four-box token-pool mix with lovejoin::mix; the token pool is mixed three wide only (lovejoin_pools_test.rs:773-793). lovejoin_pools_test.rs:1265 says this file checks 'a mix and a withdraw'; it checks no withdraw. Two things soften it. HEAD's code does declare exactly the measured budgets by purpose and index, with no margin (mod.rs:911, :954, staged_units at :524), so doc :33 is true of the code even though the test doesn't prove it. And the runtime crossCheck of each chain's first mix would catch a mis-index before anything is sent. Low: a test gap over a trap CLAUDE.md names.

Evidence: seedelf-core/tests/lovejoin_width_test.rs:678-705 (loop over classic at :679-680, re-measure at :698), measure() at :391-450 uses result.cost(); uplc-1.1.23 src/tx/eval.rs:126-129; seedelf-core/src/lovejoin/mod.rs:903-915, :954, :1006, :524-529; seedelf-core/tests/lovejoin_pools_test.rs:773-793, :1264-1266; seedelf-core/tests/lovejoin_mainnet_test.rs:182-186; grep declared_covers in tests: eval_test.rs, orders_test.rs, lovejoin_flows_test.rs:782 (a bring-back), api_test.rs (Seedelf spends) only

## 312#2

**low · confirmed · docs** — The width page and the README still say every mix takes three boxes, and the fallback paragraph doesn't match Mix my boxes again

At `seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md:3`

**Detail.** lovejoin-mix-width.md:3 opens: 'Every Lovejoin mix the wallet makes takes three boxes (N = 3): a session's return, a mix from either side, Mix my boxes again.' README.md:81 describes the page as 'Why a Lovejoin mix takes three boxes … and what four would need'. Since 1.6.0 each of those can go four wide: Settings → Lovejoin → Four boxes a mix (Settings.tsx:876-880), plus the Mix form's own switch and Mix my boxes again's switch (Lovejoin.tsx:317; flows.md:520), which the page doesn't mention. Line 15 lists 'the pool too short for four' as a reason a mix 'goes three'. That doesn't hold for Mix my boxes again: there four goes with the boxes four has room for, and the rest wait for the next press; it goes three only where four takes none (againWay, lovejoin.ts:2169-2173; flows.md:516; the owner's 'Four now, rest next press'). chunk-34-token-pools.md:210 still ends 'so token pools stay three wide like the classic one'.

**Scenario.** Someone reading the README's docs table, or the page's first line, is told every mix is three boxes, as 1.5.0 did. Someone checking Mix my boxes again at four against line 15 expects three a mix when the pool is short, and instead sees four a mix with fewer of their boxes.

**Confirmed how.** Read the docs against HEAD: lovejoin-mix-width.md:3 and :15; README.md:81; lovejoin.ts:2169-2173; Settings.tsx:876-880; Lovejoin.tsx:317; flows.md:516 and :520; chunk-34-token-pools.md:210.

**Suggested fix.** Line 3: 'Every Lovejoin mix the wallet makes takes three boxes by default …; since 1.6.0 four is an option (below)'. README.md:81: 'Why a Lovejoin mix takes three boxes by default: each width's measured cost on both networks and on the token pools, and why four is an option'. Line 15: name the per-mix switches, and say that Mix my boxes again goes four with what fits and leaves the rest for the next press. Drop 'so token pools stay three wide' from the chunk-34 plan's line 210.

**Test idea.** None: a docs fix.

**Skeptic (confirmed, low).** This survives as stale docs. Line 3 says every mix the wallet makes takes three boxes. Line 15 of the same page says four has been a choice since 1.6.0. The README's docs table still calls the page 'Why a Lovejoin mix takes three boxes … and what four would need'. Line 15 cites only `widthFor`. It never names the Mix form's or Mix my boxes again's own switches (Lovejoin.tsx:317), nor againWay's rule. Under that rule, Mix my boxes again goes four with the boxes four has room for and leaves the rest for the next press. It goes three only where four takes none (lovejoin.ts:2161-2172; flows.md:516, the owner's 'Four now, rest next press'). Line 210 of the chunk-34 plan ('so token pools stay three wide like the classic one') sits in its pre-D3 'What PR #163 changes' section. The same plan's D3 later supersedes it. These are developer docs; nothing a user sees is wrong.

Evidence: seedelf-web-wallet/docs/lovejoin-mix-width.md:3 vs :15; seedelf-web-wallet/README.md:81; extension/src/ui/screens/Settings.tsx:876-880; extension/src/ui/screens/Lovejoin.tsx:317; extension/src/background/lovejoin.ts:2161-2172 (againWay); docs/flows.md:516, :520; docs/plans/chunk-34-token-pools.md:210 vs :1372-1415 (D3)

## 312#3

**low · confirmed · docs** — The width page's details that HEAD changed: the touch list and the token pool's measured shape

At `seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md:132`

**Detail.** (1) 'What changing the width touches' (:130-147) says 'each item below now takes the width'. But extension/src/networks.ts's `mixCost` (networks.ts:19-20, 58, 73) is still a three-box figure, and nothing reads it. The core items now live in seedelf-core/src/lovejoin/mod.rs, not lovejoin.rs (:135). For 'a fifth width' the list also misses eval::MEASURE_LIMIT (eval.rs:31): uplc spends it across the whole transaction, so a 15.05B five-box mix fails measurement whatever MAX_TX_BUDGET says. It misses `WIDTHS`/`check_width` (mod.rs:1541-1549) and LOVEJOIN_WIDTHS (preferences.ts:92) too. (2) The token-pool rows (:59-67) come from the fixture's launch, whose mix_box and mix_logic reference scripts sit at a key address (output 0 of each: base address 0x00, key bf53dc99…). HEAD's wallet never builds that shape. `pool_of` trusts a reference only at the holder (pool.rs:391-409) and otherwise carries the script inline. So the wallet's own mix of this pool carries 629 + 3,458 bytes of scripts, about 4.1 KB and 0.12 ₳ more a mix than the table's 4,324 B and 1.227 ₳ at four. Its CPU should be no higher, with one reference input instead of three, and the planner adds INLINE_SCRIPTS_ESTIMATE (0.15 ₳), so no estimate is short. But the page's 'The wallet's mix always has the same shape' (:10) isn't true for token pools.

**Scenario.** Whoever plans a fifth width or a new default from this list changes `mixCost`, which affects nothing, misses the evaluator's limit, and finds five boxes still refused. Whoever compares a four-box mix in a pool without holder references against the table sees about 0.12 ₳ more than it says.

**Confirmed how.** Read the code: networks.ts:19-20, :58, :73 (grep found nothing that reads mixCost); eval.rs:31; mod.rs:1541-1549; pool.rs:381-409. Decoded lovejoin-token-preprod.json's three outputs with Python cbor2: scripts of 629 and 3,458 bytes at a base key address.

**Suggested fix.** In the list, mark `mixCost` as still three-box and unread (or remove the field), cite seedelf-core/src/lovejoin/mod.rs, and add MEASURE_LIMIT, WIDTHS/check_width and LOVEJOIN_WIDTHS to what a fifth width touches. Under the token-pool table, say its scripts were read by reference from a key address, which the wallet doesn't trust. For such a pool the wallet carries them inline, about 4.1 KB and 0.12 ₳ more a mix, at no more CPU.

**Test idea.** None: a docs fix.

**Skeptic (confirmed, low).** Part (1) survives. Line 132 says each item on the touch list 'now takes the width'. But networks.ts's `mixCost` is still the three-box figure (877,000 and 825,000 lovelace), and grep finds nothing that reads it. The core path it names, seedelf-core/src/lovejoin.rs, is now lovejoin/mod.rs. For a fifth width, line 134 names only MAX_TX_BUDGET. Yet MEASURE_LIMIT, at 14B, would still refuse five at measurement, since mix_logic alone needs 14.9B. The list also misses WIDTHS/check_width (mod.rs:1541-1549) and LOVEJOIN_WIDTHS (preferences.ts:91). Part (2) is refuted. The wallet shows only pools whose scripts are at the holder: lovejoin-pools.ts:451 and :515 drop any pool with scriptsInline !== 0, per the plan's decision 22. So every token-pool mix the wallet makes reads both scripts by reference: three reference inputs, the shape the table measured. The script outputs only sit at the holder rather than a key address, and a reference input in the body is the same size either way. The table's size, fee and 'same shape' claim therefore hold for shown pools. Inline scripts happen only for a pool read otherwise, which INLINE_SCRIPTS_ESTIMATE prices. Low: stale developer docs.

Evidence: extension/src/networks.ts:19-20, :58, :73 (grep mixCost: no reader); docs/lovejoin-mix-width.md:132-147 (path at :135, mixCost at :143, MAX_TX_BUDGET only at :134); seedelf-core/src/eval.rs:31; mod.rs:1541-1549; extension/src/shared/preferences.ts:91; refuting (2): extension/src/background/lovejoin-pools.ts:449-452, :515; seedelf-core/src/lovejoin/pool.rs:381-409; mod.rs:1569-1586; docs/plans/chunk-34-token-pools.md:113 (decision 22); the fixture decoded with cbor2: the script outputs at a base key address (bf53dc99…), the NFT reference at the holder 288fea77…

## 312#4

**low · confirmed · tests** — Outside this slice (PR #323): the Web Wallet CI is red on HEAD; two extension tests still expect a Bootstrap's 5 ₳ collateral

At `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin.test.ts:1907`

**Detail.** PR #323's last code commit, 62162483 ('a Bootstrap is funded with no collateral'), made a private Bootstrap's funding a single payment with no 5 ₳ output (sessions.ts:1970-1971). Two Vitest tests still expect the old funding. tests/lovejoin.test.ts:1907 expects ['11500000', '5000000'] for a Bootstrap and now gets ['11500000']. tests/sessions-review-fixes.test.ts:430-436 expects a Bootstrap at its cap with spread UTxOs to be refused ('That Bootstrap needs more UTxOs than one transaction can spend'), and without the 5 ₳ output it now fits one transaction. The Web Wallet workflow's run on a6ab608d (run 40109672647, PR #323's head, the same tree as HEAD 499768f6) failed at 'Extension unit tests' (2 failed, 225 passed). It skipped the extension build, the e2e and the store package. That workflow runs only on pull requests (web-wallet.yml:3-7), so main hasn't run it since.

**Scenario.** The release PR from this branch opens with the Web Wallet check red. The CI steps that build and check the store package never run, so 1.6.0's zip has no green CI behind it until the two tests are updated.

**Confirmed how.** Ran gh run view 40109672647 and read its job log (both assertion failures quoted, '2 failed | 225 passed'); read git show 62162483 and both tests on HEAD. Not run locally.

**Suggested fix.** Update both tests to the owner's call. lovejoin.test.ts:1907 should expect ['11500000'] for a Bootstrap's funding. In sessions-review-fixes.test.ts:430-436, spread enough UTxOs that a Bootstrap at its cap still needs more than one transaction without the 5 ₳ output, keeping its 'never parts its deposit' check. Then re-run the Web Wallet workflow before the release PR.

**Test idea.** The two tests themselves: they fail on HEAD (run 40109672647) and pass once they expect the funding without collateral.

**Skeptic (confirmed, low).** This survives, though it's outside slice 312. Commit 62162483 made a Bootstrap's private funding a single payment with no 5 ₳ collateral (sessions.ts:1969-1971), which is the owner's call of 2026-10-23. Two Vitest tests weren't updated. The Web Wallet run on PR #323's head a6ab608d failed at Extension unit tests: 2 test files failed, 225 passed. Both assertions are deterministic. a6ab608d's tree is HEAD's: git diff a6ab608d 499768f6 is empty. The run before it, d5b53625, was green. The workflow fires only on pull_request, and PR #323 was merged red. Its extension build, e2e and store-package steps were skipped, so none of them has run on this tree. The code is right; the tests are stale. In the second test, a Bootstrap still never goes in parts (inParts is false for it); only its premise changed, since without the 5 ₳ the funding fits one transaction. Low for users, but it must be fixed before the release PR: no green CI stands behind 1.6.0's zip until it is.

Evidence: gh run 40109672647, job 120918569798 log: 'FAIL tests/lovejoin.test.ts > mixing from the tile > mixes from the private balance… expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]'; 'FAIL tests/sessions-review-fixes.test.ts > a Bootstrap's funding … promise resolved "{ …(15) }" instead of rejecting'; 'Test Files 2 failed | 225 passed | 1 skipped (228)'; extension/tests/lovejoin.test.ts:1907; extension/tests/sessions-review-fixes.test.ts:430-444; extension/src/background/sessions.ts:1961, :1969-1971, :1980; .github/workflows/web-wallet.yml:3-7; gh run list: d5b53625 success, a6ab608d failure

## 314-core#0

**low · confirmed · performance** — A private launch re-derives its pool and measures a whole withdraw for every input choice it tries

At `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:340`

**Detail.** `launch_apart`'s closure (launch.rs:340-344) calls `launch()`, which runs `made()` every time (launch.rs:295, body 178-261). Each run derives the scripts (182), verifies the pool, which derives them again (217, pool.rs:359), and runs `usable` (227). `usable` builds, proves and evaluates a whole withdraw, up to 8 rounds (pool.rs:525-581, then mod.rs:1466-1526). `select_script_inputs` goes to `apart` whenever histories are known, as the web wallet's always are (build.rs:2572-2574), and hands the closure every choice it tries. First comes each single UTxO, smallest first, with none skipped since `floor` is 0 (build.rs:2611-2637, 2686). Then each class grows k=2..n, then the merging orders. `usable`'s answer is the same for every seed, because mix_box and mix_logic take P, a fixed-size hash. Only the spend depends on the inputs. `launch_from_account` already computes `made()` once (launch.rs:577-578).

**Scenario.** A user's private balance holds 40 UTxOs, each below a launch's ~24 ₳. This is typical after Lovejoin returns: each ~9.7 ₳ box comes back as its own UTxO and history class. Start a pool's Review runs 40+ withdraw builds and script evaluations in WebAssembly before it can show anything, and the worker builds each start twice (with and without the certificate). The screen hangs for tens of seconds or more, and the worker is busy the whole time. No money is at stake.

**Confirmed how.** Read the code: launch.rs:340-344, then 295, then 178-261, then pool.rs:525-581 and mod.rs:1466-1526; build.rs:2543-2868 for how many choices `apart` makes. Not timed.

**Suggested fix.** Hoist what doesn't depend on the inputs out of the closure. Run `check_terms` and `usable` once before `select_script_inputs`, and memoize derive/`verify_pool` by the first input (the seed), the way `launch_from_account` computes `made()` once. The closure then builds and estimates only the `ScriptSpend`.

**Test idea.** Call `launch_apart` over 30 ADA-only Seedelf UTxOs of 9 ₳ with distinct history classes, with `usable`/`made` behind a cfg(test) counter. Assert that `usable` runs once and derive runs once per distinct first input. Today both run once per attempt.

**Skeptic (confirmed, low).** The mechanism is real. `launch()` calls `made()` before anything else, and `launch_apart`'s selection closure calls `launch()` for every choice it tries. So each attempt derives the scripts twice (once in made, once in verify_pool) and runs `usable`, which builds, proves and locally evaluates a whole withdraw over several rounds. Only the first input (the seed) changes the pool, and `usable`'s answer doesn't depend on it, because the applied parameters are fixed-size hashes. Only the ScriptSpend depends on the inputs. `launch_from_account` already computes `made()` once. The web wallet always sends classes, so `apart` runs, and `floor` is 0 where every other caller passes what the spend pays out. Singles below the ~23.6 ₳ a launch needs (23.12 ₳ locked plus about 0.5 ₳ fee) are therefore all tried. Two things make the reviewer's picture worse than what happens. (1) `one_more` skips any ADA-only single no larger than one already found short. Singles are tried only while their values keep rising: about one attempt per distinct value, not per UTxO. Lovejoin boxes differ only by withdraw-fee hairs, so this is still tens of attempts for a heavy mixer. (2) The second (bare) build only gets the first build's inputs (`utxos.filter(among(only))`), so it adds a few attempts, not a second full search. The plan records a way back (a measured withdraw plus a spend) at about 20 ms natively. A few dozen attempts is therefore likely seconds in WebAssembly, not the claimed tens of seconds (not timed). No money or privacy is involved and launching is a rare action, so this stays low. The fix stands: pass the seed-independent `Locked` total as `floor`, and run `verify_pool`/`usable` once on the chosen seed.

Evidence: launch.rs:295 (`made` first in `launch`), 178-261 (182 derive, 217-223 verify_pool, 227 usable), 340-344 (closure, floor 0), 575-578 (account path hoists made); pool.rs:359 (derive again), 525-581 (measured -> withdraw); mod.rs:1466-1526 (up to 8 prove+measure rounds); build.rs:1826-1835 (estimate evaluates nothing); build.rs:2572-2574 (apart when not blind), 2618-2637 (`one_more`, short_at skip), 2686 (floor), 3025-3026/3154-3158/3443-3447 (other callers pass a floor); extension/src/background/lovejoin-launch.ts:244-247, 293-299 (bare build restricted to the first's inputs); docs/plans/chunk-34-token-pools.md:525 (23.12 ₳ locked, ~0.52 fee), 668 (~20 ms per way back natively).

## 314-core#1

**low · confirmed · correctness** — Planner and deposit sums on a pool's box ADA (taken from its datum) are unchecked and wrap in the WebAssembly build

At `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1618`

**Detail.** `ReferenceDatum::decode` accepts any box_lovelace in (0, 2^64), as `one_shot_mint` does (pool.rs:171-174). The worker shows an ADA pool at any amount but 10 ₳ (extension/src/background/lovejoin-pools.ts:457). Several sums on it use plain u64 `+`/`*`: `per_box` (mod.rs:1604), `per_box_in` (1618), `funding_for_in` (1633), `funding_for` (1751, which `bootstrap_most` builds with), and `deposit_across`'s `boxed + kept_lovelace + fee` (676) and change (717). `[profile.wasm-release]` inherits `release` and sets no overflow-checks, so in the extension these wrap silently (a debug or test build panics instead). `usable` doesn't catch it: its made-up withdraw of one such box builds and measures, since local evaluation checks no balance.

**Scenario.** Someone spends ~23 ₳ to launch an ADA pool whose datum says box_lovelace = 2^64 − 1. It's genuine, finished and the earliest of its value, so every wallet shows it ('18,446,744,073,709 ₳ a box'), and it takes new boxes. A user who tries a Bootstrap there is quoted funding_for_in(1, pool, 0, 3) = 1.5 ₳ + (2^64 − 1), which wraps to 1.499999 ₳. At depth 2 a box is priced at about 3.8 ₳, so boxes_affordable_in offers many. A one-box deposit is built with a 2^64−1-lovelace output (line 676 wraps too) and is refused only at submit. From the private balance, the session's funding has already gone out and must be brought back, at the cost of its fees. No one takes money, but the review states a false cost.

**Confirmed how.** Read the code: the sums are unchecked u64 arithmetic, and seedelf-platform/Cargo.toml's [profile.wasm-release] has no overflow-checks. Not run.

**Suggested fix.** Use checked arithmetic in per_box/per_box_in/funding_for*/again_funding*/boxes_affordable* and in deposit_across's sums, and refuse in words. Alternatively, bound box_lovelace when a pool is read (for example at ADA's 45 billion ₳ supply), in both core's decoder and the data layer's copy, since the two are held to shared vectors.

**Test idea.** A Protocol with denom u64::MAX: funding_for_in(1, &pool, 0, 3) and deposit_from with one owner and a 50 ₳ input should return an error, not a wrapped figure. Under `cargo test` today they would panic with 'attempt to add with overflow'.

**Skeptic (confirmed, low).** This holds on HEAD. Core's decoder and the data layer's copy accept any u64 box_lovelace above 0. The worker shows an ADA pool at any value but 10 ₳, and the plan says an ADA pool's amount has "no upper limit", so even the wallet's own launch form allows one. `per_box`, `per_box_in`, `funding_for_in` and `funding_for` use plain u64 `+`/`*`. In `deposit_across`, `boxed` itself is checked (checked_mul/checked_add), but `boxed + kept_lovelace + fee` at 676 and `total - boxed - kept_lovelace - fee` at 717 are not. `[profile.wasm-release]` inherits release with no overflow-checks, and build.sh adds only path-remap flags, so the extension wraps silently. The reviewer's arithmetic checks out: depth 0 gives 1.5 ₳ + (2^64−1), which wraps to 1,499,999. `bootstrap_most`'s fits(1) then builds a one-box deposit that 'fits', and fits(2) dies on the checked `Too many boxes`, so a private Bootstrap offers one box at about 1.5 ₳. At depth 2 a box wraps to about 3.8 ₳. `usableNow` gates only below-minimum and copies, so such a pool takes new boxes. Limits on impact: only a box_lovelace above ADA's total supply (~4.5e16) can wrap, meaning a pool no box could ever enter. Someone must spend ~23 ₳ launching it on purpose, and the page shows ~18.4 trillion ₳ a box. The built deposit can't balance, so the node refuses it and nothing reaches anyone. At worst a private-side funding already sent comes back at the cost of fees. It's a false quote in a contrived case, so low. It isn't an owner call: the owner chose no upper limit on the value, and nothing records weighing wrap-around. Bounding box_lovelace at read time in both decoders (they're held to shared vectors), or using checked sums, fixes it.

Evidence: seedelf-core/src/lovejoin/pool.rs:171-174; seedelf-data/api/src/lovejoin/datum.rs:176-179; extension/src/background/lovejoin-pools.ts:455-459 (listedValue); docs/plans/chunk-34-token-pools.md:373 ("For an ADA pool, it is the amount, with no upper limit"); seedelf-core/src/lovejoin/mod.rs:1603-1605, 1617-1619, 1632-1634, 1750-1752 (unchecked), 655-664 (boxed checked), 676 and 717 (unchecked), 1782-1786 (bootstrap_most's fits uses funding_for(boxes, 0, denom)); seedelf-platform/Cargo.toml:37-42 (wasm-release, no overflow-checks); seedelf-web-wallet/wasm/build.sh:56-61; wasm/src/lovejoin.rs:1955-1960 (funding quote), 2079 (public chain's needed).

## 316#3

**low · confirmed · state** — A chain with no boxes of its own (a direct return's collateral mix, or a tail built again) gets no entry: Your mixes never shows it, and its box is counted against another mix

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4476`

**Detail.** recordChain adds entryOf(record) (4423), and an entry's shares come from poolsOf(c), the pools where shareOf is above 0. Some records have `boxes: 0`: sessions.ts:4591 records one for a return that skips Lovejoin but sends its collateral's deposit and mix as a chain (buildBack: `chain: [...tail txs, back]`, `leaves: []`, no `lovejoin` field), and a tail built again after its chain stopped is another. Such a record gets no shares, and update drops the entry as not open (6501). chainSent then finds no entry to add the collateral's leaf to (4475-4476). When the leaf comes back, countBack credits the oldest open mix in the 5 ₳ pool instead (1987-1989).

**Scenario.** A swap's return comes back directly (too little for a box), with its 5 ₳ collateral mixed into the 5 ₳ pool, while one of the user's own mixes is out in that pool. Your mixes never lists the collateral's mix. When its box comes back by itself, the other mix's card shows one more box back than actually came back, and closes one box early.

**Confirmed how.** Read the code: recordChain (4421-4423), update's `filter(open)` (6501), chainSent's tail branch (4470-4477), countBack (1983-1993), sessions.ts buildBack's direct tail (about 4296-4307) and sendChain's record (4591).

**Suggested fix.** In chainSent's tail branch, create the entry when there is none: if `entries(s)` has no entry for `c.id` and `c` isn't a Bootstrap, push `{ ...entryOf(c), shares: [] }` and add the tail's share to it. An entry with no shares would be dropped before the tail is sent, so it has to be added at the send, not at recordChain.

**Test idea.** Record a return with `boxes: 0` and a tail, then send its transactions. mixes() lists one entry with `{ pool: <5 ₳ pool>, boxes: 1 }`, and the leaf's withdraw closes that entry rather than another mix's.

**Skeptic (confirmed, low).** Confirmed by reading. A direct return with its collateral mixed records `boxes: 0` with a tail. poolsOf filters out pools with no share, so entryOf gives shares [], and update drops that entry in the same write that records it. chainSent's tail branch then finds no entry, so the tail's 5 ₳ share is never added, though the plan says 'its entry gains a share in the 5 ₳ pool'. When the leaf comes back by itself, countBack credits it to the oldest open non-Bootstrap mix in the 5 ₳ pool, or a released Bootstrap. The visible effects are small: the collateral's mix never shows in Your mixes, and another mix's entry leaves the list one box early. The card shows no 'x of N back' count since the owner's call (plan:1083). Mainnet has no 5 ₳ pool yet. One reachable tail: credited to a released public Bootstrap, it feeds index 1's lost tie. The existing direct-tail test checks the record, not the entry. Low.

Evidence: HEAD sessions.ts:4296-4306 (chain [...txs, back], leaves []), 4587-4590 (boxes: summary.lovejoin?.boxes ?? 0); lovejoin.ts:1538-1539 (poolsOf), 1935-1946 (entryOf), 4421-4423 (recordChain adds entryOf), 6500 (filter(open)), 4470-4477 (chainSent: `if (e && !e.bootstrap) shareIn(..).boxes += 1` finds no entry), 1983-1993 (countBack). Plan chunk-34-token-pools.md:926. tests/lovejoin-planner.test.ts:1454-1470 never checks mixes().

## 317-data#0

**low · confirmed · compat** — `lovejoin/pools` can take the wallet's whole 10 s read budget, and a read that times out marks the whole private index down

At `seedelf-data/api/src/lovejoin/routes.rs:235`

**Detail.** `pools` first waits up to READ_TIMEOUT (5 s) for `stable()`, a `block_before` on the private index's two connections (routes.rs:209-212). It then waits up to another READ_TIMEOUT for the cursor's list task (routes.rs:235) before falling back to the last list (routes.rs:240). So one request can spend about 10 s on the server. The wallet aborts at DATA_READ_TIMEOUT_MS = 10_000 (extension/src/background/data-layer.ts:49). An aborted fetch lands in `catch { throw await this.failed(); }` (private-index.ts:337-338), which marks the whole private part down for DOWN_MS (5 minutes, data-layer.ts:43); it does not throw `TokensDown`. Separately, routes.rs:236 passes on the task's own error (a 503) whenever the task fails inside the 5 s, even though the last list is kept (:240). README.md says a request waits for the list "up to its 5 s".

**Scenario.** Home's two private connections are slow: one may still be running a query that a timed-out request abandoned (RecyclingMethod::Fast and no statement_timeout on that pool), or the hourly holder read is running. A wallet's pool read asks `lovejoin/pools` just after the cursor moved. `stable()` gets its turn after about 4.5 s, the new cursor's list isn't ready, and the handler waits 5 s more before answering with the last list. The answer leaves after about 9.5 to 10 s, but the wallet's fetch has already aborted at 10 s. For 5 minutes that wallet then reads its contract rows and the classic pool from Koios as well, and the hub loses its crowd line. A db-sync error inside the task likewise turns into a 503 and a Koios holder scan, though a last list was there to give.

**Confirmed how.** Read the code: routes.rs:201-241, private.rs:169 (READ_TIMEOUT), chain.rs:55-81 (two private connections, no statement_timeout), private-index.ts:327-348, data-layer.ts:43,49.

**Suggested fix.** Give the handler one deadline: take `let deadline = tokio::time::Instant::now() + READ_TIMEOUT;` before `stable()`, and wait for the task with `tokio::time::timeout_at(deadline, task)`. Answer `state.kept(LATEST)` when the task fails, not only when it is slow. Optionally, on the wallet side, treat an aborted token-route fetch as `TokensDown`.

**Test idea.** Put the handler's two waits behind a seam that takes the cursor future and the list task. With tokio's paused clock, a cursor read of 4.9 s and a list of 60 s must give an answer (the last list) by 5 s; today it comes at 9.9 s. A list task that fails at once, with a last list kept, must answer 200 with that list.

**Skeptic (confirmed, low).** This survives on HEAD. routes.rs has not changed since #317's 6e7e2d49. The handler makes two waits in a row, each capped at READ_TIMEOUT (5 s). The first is stable(). The second is the cursor's list task. So the server can take about 10 s, which is exactly when the wallet aborts. The wallet's fetch has no answer at its abort, so the catch marks the whole private part down for DOWN_MS. TokensDown only covers answers that arrive. Treating no answer as the part down is deliberate wallet design (the doc comment on get). The defect is on the server, which can run past the wallet's limit on its own. The narrow window is what keeps this low. Only the request that starts a cursor's task waits the second 5 s: when start() returns None, the handler answers LATEST at once. And stable() has to finish within about the network round trip of its own 5 s timeout. If it times out at 5 s, the answer is a 503, which is TokensDown and leaves the part up. stable() can get that close to 5 s. The private pool's get() alone can take up to 2 s waiting for a connection plus 3 s creating one. A connection can also come back with an abandoned query still running: RecyclingMethod::Fast, and no statement_timeout on the private pool. What the user sees: for 5 minutes one wallet reads the contract and the classic pool from Koios. That is the silent fallback privacy.md documents for an outage, including asking Koios about its own boxes' making. The hub's crowd line drops to boxes alone, as it does on any refusal. No money or signing is involved. The second part is also confirmed. When the task fails inside the 5 s, for example on a 2 s pool wait under load, the handler passes on its 503, though LATEST is kept for an hour. Pools stay shown, and the wallet re-verifies each one anyway. So the wallet gets TokensDown, drops the crowds, and does a Koios holder scan when the page opens. README.md:177's "waits for it up to its 5 s" undersells the worst case. No test covers a token route that never answers.

Evidence: seedelf-data/api/src/lovejoin/routes.rs:209-212 (timeout(READ_TIMEOUT, stable(..))), :219 (only start()'s winner waits), :235 (timeout(READ_TIMEOUT, task)), :236 (`??` returns the task's own error), :240 (LATEST only when slow); private.rs:169 (READ_TIMEOUT 5 s), :209-214 (stable = block_before); chain.rs:56 (2 private connections), :61 WAIT 2 s, :72 CONNECT 3 s, :77 OPTIONS without statement_timeout (vs :81), :169 RecyclingMethod::Fast, :174-175 wait+create timeouts; extension/src/background/data-layer.ts:43 (DOWN_MS 5 min), :49 (DATA_READ_TIMEOUT_MS 10 s), :160-163 down(); private-index.ts:321-338 (abort -> catch -> failed() -> parts.down("private")), :341 (TokensDown only for a received non-ok); lovejoin-pools.ts:405, :418-427 (crowds deleted), :388-394 (look -> Koios scan); seedelf-data/README.md:177; tests/lovejoin-discovery.test.ts:300-314 cover refusals only.

## 317-data#1

**low · confirmed · performance** — `lovejoin/tokens` isn't one of the always-kept answers, though every wallet reads it once a token pool is shown

At `seedelf-data/api/src/state.rs:51`

**Detail.** Once a tip's cache is past its budget (4,096 answers or 64 MB), `Cached::cell` (state.rs:116-129) only gives a cell to a key in ALWAYS_KEPT (state.rs:51-57). The classic `lovejoin/snapshot` is in that list; the token pools' snapshot `lovejoin/tokens` (routes.rs:245) isn't. Without a cell, `cached_in` runs `make()` for each request, with no sharing (state.rs:273-276). README.md:158 promises that "The answers every wallet reads (the snapshots, the names, `epoch_params`, `totals`) are kept whatever the budget holds", and once a token pool is shown that no longer holds for this snapshot.

**Scenario.** Mainnet has a shown token pool, so every wallet's pool read asks `lovejoin/tokens` (lovejoin.ts:2588 `tokensNow`). Someone fills one block's cache from a handful of addresses: 4,096 `lovejoin/since/{slot}.{made-up hash}` requests (each a cheap reset at 1 unit), or a few dozen `since` answers from old cursors. For the rest of that block, every wallet's `lovejoin/tokens` runs `stable()`, `shown()` and `unspent_as_of_any` on its own, on home's two private connections, where the classic snapshot is still worked out once. The classic private reads queue behind them and fall over to Kupo, and the token reads time out into 503s and go to Koios. The flood itself already loads home; this route repeats its work per wallet on top of that.

**Confirmed how.** Read the code: state.rs:46-57 and 116-129, routes.rs:243-267, README.md:158.

**Suggested fix.** Add "lovejoin/tokens" to ALWAYS_KEPT (it becomes `[&str; 6]`).

**Test idea.** In state.rs's tests, fill a tip's cache past MAX_CACHED with other keys. Then call `cached_in(Upstream::DbSync, tip, "lovejoin/tokens", read)` twice and assert the read ran once, as `contract/snapshot` does today. It fails without the fix.

**Skeptic (confirmed, low).** ALWAYS_KEPT has the classic "lovejoin/snapshot" but not "lovejoin/tokens". Once a tip's cache passes 4,096 cells or 64 MB, Cached::cell gives no cell to that key. cached_in then runs make() for every request, with no sharing. That breaks the stated intent ("What every wallet reads: always kept") and README.md:158's "the snapshots ... are kept whatever the budget holds". Nothing records this as a choice: ALWAYS_KEPT dates from 74e63d76 (1.5.0 era), and #317 left it alone. It is reachable only when both of these hold. (a) A deliberate flood fills the count inside one block. Each made-up since cursor makes a new cell, even when its read fails. It costs 1 edge unit against a per-/64 bucket of 300 that refills 10 a second, so about 20 addresses sustained. (b) Mainnet has a shown token pool. The bundled head start has 0 mainnet pools today, and tokensNow runs only when a token pool is in the read set. The impact is small. Per uncached request: one block_before and one unspent_as_of_any. shown() answers from what it keeps within a cursor. These run on home's two private connections, which such a flood already saturates. Token reads then 503 and go to Koios. The fix only gives parity with poolNow, not full protection: tokens/since/{C}, like the classic lovejoin/since/{C} since 1.5.0, isn't kept either. Low, as a stale doc claim plus a hardening gap.

Evidence: seedelf-data/api/src/state.rs:49-57 (ALWAYS_KEPT, 5 keys, no lovejoin/tokens), :116-129 (cell only if room || ALWAYS_KEPT), :273-276 (no cell -> make() per request); lovejoin/routes.rs:245 (key "lovejoin/tokens"); private.rs:225 (classic key "lovejoin/snapshot"); seedelf-data/README.md:158; edge.rs:29-34, :49-62 (1 unit for private routes), :65-77 (/64 buckets); lovejoin/discovery.rs:161 (shown() answers from kept within a cursor); extension/src/background/lovejoin.ts:2586-2588 (tokensNow only with a token pool); extension/src/lovejoin-pools.json mainnet pools: 0 on HEAD; git log -S ALWAYS_KEPT -> 74e63d76.

## 317-wallet#0

**low · confirmed · money** — A pool the data layer lists is taken on its word that it exists on chain: a Bootstrap or a session's 5 ₳ collateral can go into a pool whose NFT was never minted, and is locked for good

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:441`

**Detail.** `PoolDiscovery.refresh` (lovejoin-pools.ts:401-446) builds a PoolRef from each pool the data layer lists: its reference row, its seed, and script rows named only by hash. It keeps any pool that `lovejoinVerifyPool` accepts (lovejoin-pools.ts:441, `verified` at :449-453). That check is offline. WebAssembly's `protocol_of` (wasm/src/lovejoin.rs:102-158) fills in the derived script bytes for rows named by hash, and core's `verify_pool` (seedelf-core/src/lovejoin/pool.rs:352-377) checks only that the given row is shaped like a pool, that `one_shot_mint(seed)` hashes to the row's NFT policy, and that the datum names the scripts derived from that seed. So any seed works: pick one, compute P = policy_of(seed) and derive M, L, F, and you can build a reference row that passes, whether or not P was ever minted. Nothing in the data-layer path checks that the reference UTxO or its script rows exist, that `launch.tx` is the reference row's own transaction, or that L is registered: `usableNow` always passes `registered: true` (lovejoin.ts:3431). The code (lovejoin-pools.ts:31-33) and the plan (chunk-34-token-pools.md:473) both say the server "can leave a pool out, never make one look real", and that only holds for genuineness, not for existence. Once a pool is in the read set, money goes in without the chain being consulted. A deposit references nothing of the pool: core's `deposit_across` (seedelf-core/src/lovejoin/mod.rs:609-700) only pays the mix_box address, while mixes (mod.rs:928) and withdraws (mod.rs:1356) do carry `reference_inputs()`. The network check `crossCheck` evaluates only a chain's first mix that isn't the tail (lovejoin.ts:3729, :3733), so it never runs for a Bootstrap (depth 0, lovejoin.ts:3795) or for the collateral tail's deposit. `collateralPool` (lovejoin.ts:3474-3483) picks any shown 5 ₳ ADA pool, and the tail's mix is only measured after its deposit is on chain. Chains with depth 1 or more are protected only because Ogmios refuses the unknown reference input. Finally, STATE-2 keeps a handed-over pool on the device for good, so one bad answer from the server stays on every device that read it.

**Scenario.** Mainnet, with our server compromised, or with it serving a launch that a rollback deeper than its stable cursor later removed. `lovejoin/pools` lists a 5 ₳ ADA pool built from a seed no transaction ever spent, and `lovejoin/tokens` lists 30 or more boxes for it. Every mainnet wallet verifies it, shows it on the hub, and keeps it for good. From then on, every private session's return (swap, site or mix session, with Settings' collateral mix on, the default) deposits the session's 5 ₳ collateral into that pool's mix_box address. The ledger accepts the deposit because it is a plain payment. The collateral's mix and every way back read the pool's reference UTxO, which isn't on chain, so the node refuses them. Any Bootstrap into the pool from either side, or into a fake token pool of a listed token, also goes in. P can never be minted, so the wallet shows boxes waiting in a pool with no way out (Bring one back fails too) and the ADA, plus any tokens, is locked permanently. A dishonest Koios backend on the preprod or fallback path could do the same through the holder read.

**Confirmed how.** Throwaway test tests/zz-review-317-wallet-fabricated.test.ts (deleted after). It fed the data layer's `lovejoin/pools` (fake index) a 5 ₳ ADA pool built from core's vector seed 000b16212c37…4a55#0, a counting pattern that was never a UTxO, with a datum naming that seed's derived M/L/F (264a095c…, f33fe196…, 74df1afa…) and two script rows at the holder named by hash. It asserted that `serviceDeps(discovery).pools` and `known()` hand over pool a57cd7b8…, and that `lovejoinVerifyPool` returns id a57cd7b8…, boxLovelace 5000000, scriptsInline 0, mixBoxHash 264a095c…. It passed. The deposit, crossCheck and collateral-tail paths were confirmed by reading HEAD at the lines cited.

**Suggested fix.** Make a token pool's deposit carry the pool's reference UTxO (references[0], which holds no script, so no reference-script fee) as a reference input in core's `deposit_across`, for `Version::TokenV1` legs only, so the classic pool's deposits stay byte-identical to 1.5.0's. That adds about 1.6k lovelace per deposit, and the ledger then refuses any deposit into a pool that isn't on chain, rolled-back launches included, on the data-layer and Koios paths alike. As a cheaper extra guard in `refresh`, require `p.launch.tx` and every script row's transaction to equal the reference row's transaction hash. If the owner would rather confirm existence before hand-over, one Koios `utxo_info` per newly listed pool, made the same way for every wallet, would do it. Either way, correct the "never make one look real" wording.

**Test idea.** Using the fixture above (a data-layer pool from the never-spent vector seed, 5 ₳ ADA, with 30 fake boxes in `lovejoin/tokens`), run a public Bootstrap and a session return with the collateral tail into it. Assert that the built deposit's CBOR lists the pool's reference UTxO among its reference inputs, or that the flow is refused before anything is sent. Today both build and send a deposit with no reference input.

**Skeptic (confirmed, low).** The mechanism holds on HEAD, but I'd rate it low, not medium. Only a chain source that lies can trigger it: our server compromised, a dishonest Koios instance, or a launch rolled back from more than 200 slots deep that never comes back. That same lying source can already take money in this design, not just lock it. On mainnet the names route hands over a Seedelf's row, register included, and Send pays that register with nothing on chain to refuse it, since a transfer doesn't reference the recipient's UTxO. So the bug doesn't widen what the wallet trusts the server with. It adds a way for such a source to lock money: by default 5 ₳ per session return through Lovejoin, plus any Bootstrap.

The one aggravating part is that it outlasts the compromise. kept() never drops a pool, and the launch position comes from the server unchecked, so a fake pool can win shown() over a real 5 ₳ pool for good, and a real one already handed over stays as a copy. Once the server is clean, the fake pool's boxes drop out of lovejoin/tokens. collateralPool's floor then refuses the tail, so the lasting money risk is a user deliberately Bootstrapping the fake pool, where Bootstrap is the main button.

On the honest-server path (a rollback past the stable cursor), the tail is also gated by the 30-box floor, which a new pool rarely meets in that window, so again only a Bootstrap goes in.

The false claim is internal, in the plan and a code comment, not in any user-facing doc, screen or string. The server can't make a pool of other scripts look standard, but it can make one that isn't on chain look real. Fix that wording now. The reference-input hardening (TokenV1 legs only, about 1.6k lovelace a deposit, classic deposit unchanged) is cheap and the owner's to schedule. The suggested consistency guard (launch.tx and the script rows' transaction equal to the reference row's) matches the standard rule, because the data layer requires the launch itself to publish the scripts. It catches only an inconsistent server, though; a lying server meets it easily.

Evidence: Pools taken on the data layer's word: lovejoin-pools.ts:431-442 builds the PoolRef from the data layer's rows and the launch position from p.launch, unchecked. private-index.ts:164-182 (isPool/isRow) checks shape only. pool.rs:352-377 verify_pool is offline, and wasm/src/lovejoin.rs:102-158 fills in script bytes for rows named by hash. The fabricated pool is kept and handed over for good: lovejoin-pools.ts:275-294 and :345-369.

Money goes in with no chain check: core mod.rs:609-700 deposit_across has no reference input, and collateral_tail (mod.rs:2023-2046) uses deposit. Mixes and withdraws do carry reference inputs (mod.rs:928, :1356). lovejoin.ts:3795 makes a Bootstrap depth 0, so crossCheck checks nothing (lovejoin.ts:3729-3733, called from checked at :3887). The tail's mix meets the network only in tailWitness (lovejoin.ts:3570), after its deposit is on chain. The tail is the default: preferences.ts:170-171. It is gated by the floor at lovejoin.ts:3480.

The server already decides Seedelf payees: contract-scan.ts:333-336 takes the names route's row as the Seedelf's locator, which transfer.ts:172 and send.ts:171 pay. build.rs's transfer references only the wallet's reference script UTxOs (build.rs:2216, :2238), never the recipient's row.

Rollback window: seedelf-data/README.md:142 (stable cursor at least 200 slots back) and :172 (a block rolled back under the stable cursor is forgotten within the hour).

The false wording: plans/chunk-34-token-pools.md:473 and lovejoin-pools.ts:31-33. I found no user-facing claim in privacy.md, flows.md, store/ or en.json.

Scripts must come from the launch transaction itself: seedelf-data/api/src/lovejoin/standard.rs:235-237 ("its launch didn't put its scripts at the holder"), and on the Koios path lovejoin-pools.ts:496 (byTx of the reference row's transaction).

## 318-rust#1

**low · confirmed · correctness** — A start from the public account can pick a UTxO carrying a reference script, which its own in-wallet measure then refuses

At `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:571`

**Detail.** `launch_from_account` takes its inputs from `build::account_inputs` (build.rs:3801-3821). That keeps every UTxO whose reference script can be sized. Among pure-ADA UTxOs it sorts those after the rest, but still before any UTxO holding a token. `AccountLaunch::measure_locally` (launch.rs:523-528) then resolves every input with `eval::resolve_row`. That refuses any row with `reference_script` set (eval.rs:56-62). `account_mint` gets away with the same `account_inputs` because its draft is measured through Ogmios. The other account-paid Lovejoin builders filter `eval::refusal` first: chain_from_account_at, again_from_account_at, withdraw_paid_in. The worker passes every account UTxO (lovejoin-launch.ts fromPublic via readAccount).

**Scenario.** The public account holds 20 ₳ of ADA, 10 ₳ of ADA carrying a reference script that someone sent it, and 30 ₳ beside a token. The user starts a pool paid from the public account (about 23.3 ₳ locked plus the fee). One input is short. Two inputs take the reference-script UTxO, the guessed estimate passes, and `measure_locally` fails with "UTxO … holds a reference script, which the wallet can't evaluate with yet". The start is refused, although adding the token UTxO instead would pay.

**Confirmed how.** Read the code: `account_inputs`' filter is `reference_script_size(u).is_ok()`, which is Ok for any script whose bytes are given (utxos.rs:354-370). `resolve_row` bails on `reference_script.is_some()`. I didn't run a test, since this is a low.

**Suggested fix.** In `launch_from_account`, drop the UTxOs `eval::refusal` names from `spendable` before choosing, as the other in-wallet-measured account builders do. Or give `account_inputs` a flag for callers that measure locally.

**Test idea.** A core test: `launch_from_account` over [20 ₳ ADA, 10 ₳ ADA with a `reference_script` row, 30 ₳ + a token], with a set-aside 5 ₳ collateral. `measure_locally` must succeed, spending the token UTxO and not the reference-script one. Today it fails with "holds a reference script".

**Skeptic (confirmed, low).** The finding holds. launch_from_account takes its inputs from build::account_inputs. That drops only UTxOs whose reference script can't be sized (reference_script_size). It sorts pure ADA without a script first, then pure ADA with a script, then token UTxOs. So once the plain ADA UTxOs fall short (or there are none, and the seed itself carries a script), the next input taken is the one carrying a reference script. The guessed estimate passes, and AccountLaunch::measure_locally then runs eval::resolve_row on every input, which refuses any row with reference_script set. Nothing upstream filters such a row: the worker's fromPublic passes readAccount's UTxOs, and coins.account removes only the collateral and locked UTxOs. The other account-paid Lovejoin builders do filter eval::refusal; account_mint gets away without it because Ogmios measures it. No test covers a reference-script input to the launch. It stays low: the case needs someone to have sent the public account an ADA-only UTxO with a reference script, no money moves, and the user sees a refusal naming that UTxO. Locking it in coin control is a workaround, though not an obvious one.

Evidence: HEAD core lovejoin/launch.rs:571 (`let spendable = account_inputs(available, collateral)?`), 580-611 (first k inputs, estimate only), 523-528 (measure_locally: `.map(eval::resolve_row)`); core build.rs:3801-3821 (account_inputs: filter `reference_script_size(u).is_ok()`, sort `(!pure_ada, reference_script.is_some(), Reverse(lovelace))`); core eval.rs:56-62 and 78-82 (refusal / resolve_row bail on `reference_script.is_some()`); utxos.rs:354-370; wasm lib.rs:2595-2604 (build_launch_from_account calls launch_from_account then measure_locally); other builders filter it: wasm/src/lovejoin.rs:2093, 2145, 2344, 2618; worker lovejoin-launch.ts:315-332 and coin-control.ts:241-251 add no filter; core tests/lovejoin_launch_test.rs has no reference-script input case. Read only; no test run, as it's a low.

## 318-worker#1

**low · confirmed · money** — Starting the same pool again before a look finds the first isn't refused: the second is a copy that's never shown, and its ~23 ₳ is locked for good

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:237`

**Detail.** build()'s copy check (lovejoin-launch.ts:236-240) reads only discovery.known after discovery.look. A look takes a launch only SETTLE_MS (10 min) after its block (lovejoin-pools.ts:84), and on mainnet the data layer's list is asked at most every REFRESH_MS (5 min). So for roughly 10 to 15 minutes after its block, the wallet's own start is in no list. The wallet does keep its own start, sealed (lovejoin.ts recordLaunch, `launches`), but that record holds no values, and LaunchDeps.lovejoin is only `recordLaunch`, so build never consults it. The form's check reads status.pools (LovejoinLaunch.tsx:121-125), which can't hold an unfound start either. There is a second, rarer route. When choose() sent the build without the certificate, the hash sent differs from the reviewed one, and the kept copy is gone once Koios takes it. A later Send of the reviewed hash then reaches send()'s refuseSent with the reviewed hash only, and says "That pool's start isn't ready to send. Review it again." rather than "sent already": the very wording refuseSent exists to prevent, because it invites a second build.

**Scenario.** A user starts a pool of 100 MIN + 4.5 ₳ a box from the private balance and sends it. A few minutes later it still isn't under Pools, so they open Start a pool again, pick MIN, 100 and 4.5 ₳, and Review goes through, since nothing known has those values. They send it. The second launch lands after the first, so it's a copy (decision 30): never shown, never read, and its reference UTxO, two scripts and 2 ₳ deposit (~23.3 ₳) are locked for good. The hub's "A pool you started … shows here once a look finds it" note is on the hub, not on the form.

**Confirmed how.** Read the code: lovejoin-launch.ts:139-148 (LaunchDeps), 233-240 (copy check), 341-361 (submit) and script-spend.ts:384-387 (refuseSent with the hash asked); lovejoin-pools.ts:84 and 388-394 (SETTLE_MS, look); LovejoinLaunch.tsx:121-140 (the form's copy check over status.pools).

**Suggested fix.** Keep each start's values (box lovelace, token, Q) in LaunchRecord. In build() (and in the form, through status.started), refuse a start whose values match one of the wallet's own starts that no look has found and that is under STARTED_SAID_MS old, using lj.launch.copy's words or a variant that names the earlier start. It asks no one. In submit(), when the kept copy is gone, treat the reviewed hash as sent if a launch record or sent-txs holds the build sent in its place (keep `reviewed` on the LaunchRecord).

**Test idea.** With discovery still empty (launching(t)), build and submit a public start of 25 ₳ ADA, then build the same values again: expect a refusal (it succeeds on HEAD). Also register the credential so the build without the certificate goes, submit, then submit the reviewed hash again: expect "sent already", not "isn't ready to send".

**Skeptic (confirmed, low).** The main route holds. build() checks for a copy only against discovery.known, after discovery.look (lovejoin-launch.ts:236-240). The wallet's own record of a start, LaunchRecord (lovejoin.ts:898-904), keeps the pool id, txHash, time and payer, but not the values. LaunchDeps.lovejoin exposes only recordLaunch (:139-140), so nothing could compare values anyway. The form's check (LovejoinLaunch.tsx:124-125) reads only the pools found by reads. A start is invisible to look for a while. On the Koios path, holder() skips a launch whose block is under SETTLE_MS (10 min) old (lovejoin-pools.ts:84, :483-492). On mainnet, look() asks the data layer at most every REFRESH_MS (5 min) (:388-394, :406-414), and the data layer lists a launch only once it's 200 slots deep. So for several minutes, about 10 on preprod, the same values build and send. The second start is a copy that is never shown, and the plan puts its cost at about 23 ₳, gone for good. The owner's decisions (11, 30) cover a copy made by somebody else's earlier launch. None covers the wallet repeating its own start. The second route is real too. When choose() sends the build without the certificate, the kept copy holds that build's hash, and it's gone after the submit. A later Send of the reviewed hash then fails sentBefore, which matches by hash only (pending.ts:934-944), and says "That pool's start isn't ready to send. Review it again." (script-spend.ts:384-386, en.json:3017) instead of "sent already". But that route needs two rare things at once: someone registered L before the launch, and a Send whose answer the page never got. Low, not medium: to lose the money the user has to press past the sent page's note (en.json:1356, about 10 minutes after its block) and the hub's line right above Start a pool (Lovejoin.tsx:1570-1578, en.json:1255). Then they have to accept a fresh review that shows what never comes back.

Evidence: lovejoin-launch.ts:139-148, :236-240, :341-361, :367-382; lovejoin.ts:898-904 (LaunchRecord {id, txHash, at, from, account}), :5204-5210 (started), :5297-5302 (recordLaunch); lovejoin-pools.ts:74, :84, :388-394, :483-492; LovejoinLaunch.tsx:124-141, :170-181; Lovejoin.tsx:1570-1578; en.json:1255, :1356; script-spend.ts:383-387; pending.ts:934-953; chunk-34-token-pools.md decision 11 ("a junk pool costs about 23 ₳, gone for good") and 34f's review 11 (starts not found stop being shown after a day): no decision about the wallet's own repeated start.

## 318-worker#2

**low · confirmed · correctness** — Public activity calls a box the public account paid to bring back "Back from Lovejoin", and counts the account's change as money in while it's on its way

At `seedelf-platform/seedelf-web-wallet/extension/src/background/activity.ts:853`

**Detail.** withdrawOne with paid === true writes the private history's entry for the transaction as "lovejoin-withdraw" (lovejoin.ts:6241, and settleWithdrawing at 6345). Public activity passes the private entries to describe() as `own`. describe takes `mine.kind` before its own Lovejoin reading (activity.ts:853-857), so on the device that paid, the entry is "Back from Lovejoin", never 34d's "Paid for a box back from Lovejoin" (lovejoin-back-paid). Only a device without the private entry (a restore, another browser) names it so. While it's on its way, pendingEntries (incoming.ts:358) decides who paid from validUntil. WebAssembly's paid withdraw carries no validity interval (wasm/src/lovejoin.rs:2597 withdraw_paid_in), and its rememberSpent (lovejoin.ts ~6205) names no account. So it's taken as a private spend: `moved = sum(own)`, which is the account's own change, listed as money in.

**Scenario.** A token pool is stuck. The user brings a box back with "Pay from my public account", which pays from a 20 ₳ UTxO. Until the block, Public activity lists "Back from Lovejoin +16.94 ₳" (pending), though the account paid about 3.06 ₳: the fee and the 2.64 ₳ it made up for the Seedelf output. Afterwards it reads "Back from Lovejoin −2.64 ₳", with nothing saying the account paid for a box.

**Confirmed how.** A throwaway test, tests/zz-review-318-worker-paidactivity.test.ts, now deleted. It ran lovejoin-flows' escape-hatch setup (12930 lovelace a byte, the public account paying from a 20 ₳ UTxO), then withdrawNow(paid = true), then activity.cardano("preprod"). The pending entry printed {kind: "lovejoin-withdraw", direction: "in", lovelace: "16940422", pending: true}. describe() over a transaction of the same hash printed kind "lovejoin-withdraw" with the private entry in `own`, and "lovejoin-back-paid" without it. The existing test (lovejoin-flows.test.ts:778) passes an empty `own`, so it never reaches this.

**Suggested fix.** In describe(), name a box spent with the account's coins beside it "lovejoin-back-paid" even where the private history has the box's "lovejoin-withdraw" (for example, when mine.kind is lovejoin-withdraw and the account spent coins). In pendingEntries, either leave out a withdraw that spends a box, or name it back-paid at the amount WebAssembly reports (`paid`). Give buildLovejoinWithdrawPaid a validUntil as every account-paid transaction has (account.ts validUntil), and pass the paying account to rememberSpent.

**Test idea.** Run the escape-hatch test, then activity.cardano("preprod"). Assert the entry for pending.txHash has kind "lovejoin-back-paid" and direction "out" while it's pending, and again once Koios lists it (txRows plus credentialTxs for the account's key). Both fail on HEAD.

**Skeptic (confirmed, low).** This holds on HEAD and goes against 34d's design ("'Paid for a box back from Lovejoin' for the escape hatch"). With paid === true, withdrawOne still makes the PendingTx with kind "lovejoin-withdraw" (lovejoin.ts:6231) and records it in the private history (:6241; settleWithdrawing does the same at :6334/:6345). activity.sent writes that as kind lovejoin-withdraw, direction in, detail "Lovejoin" (activity.ts:345-346). Public activity passes every private entry that isn't "received" to describe() as `own` (activity.ts:492). There `kind = mine ? mine.kind : …` (:853-857) wins over the lovejoin-back-paid branch (:846-851). So on the device that paid, the confirmed row reads "Back from Lovejoin", with the account's net, minus the fee, as "−". The 34d test passes an empty `own` (lovejoin-flows.test.ts:782), so it never reaches this. While the withdraw is on its way: WebAssembly's paid withdraw sets no validity interval (wasm/src/lovejoin.rs:2597-2655), and rememberSpent is called without an account (lovejoin.ts:6198, spent.ts:54-69). In pendingEntries that gives paid = false (incoming.ts:358). A private entry exists and an output pays the account, so the row is listed with moved = sum(own), the account's whole change, as money in (incoming.ts:362, :368, :396-398). That is a wrong amount, but only until the block, on a rare path (a stuck pool, with the public account chosen to pay). No money moves and no privacy claim is broken: the link to the account was shown before Send and is on chain. Low.

Evidence: lovejoin.ts:6107-6118, :6198, :6231, :6235-6241, :6334-6345; activity.ts:307-347 (sent), :492 (own), :838-857 (describe's kind); incoming.ts:355-368, :396-398, :412-413; wasm/src/lovejoin.rs:2597-2655 (withdraw_paid_in: no validity interval); spent.ts:54-69; tests/lovejoin-flows.test.ts:778-784 (describe with new Map()); ui/activity.ts:73-83; en.json:111, :116; chunk-34-token-pools.md 34d Activity bullet.

## 319-rust#0

**low · confirmed · correctness** — plan_across fails the whole plan when a token leg gets no box and its token isn't held, beside another leg's held token

At `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1708`

**Detail.** `plan_across`'s `kept` closure (mod.rs:1705-1721) subtracts `token_total(n)` for every leg, n = 0 included. `BoxValue::token_total(0)` returns `Some((token, 0))` (lovejoin/value.rs:120-130). `Assets::separate` then goes through `Assets::sub`, which bails with "cannot subtract an asset that is not in the collection" when the token isn't in `tokens` at all (assets.rs:237-241). So as soon as `tokens` is non-empty (mod.rs:1722-1729), a token leg that plans 0 because the paying UTxOs hold none of its token turns the whole plan into an Err. It doesn't plan that leg as 0. `deposit_across` has the same subtraction (mod.rs:655-665), but `chain_across_pools` drops zero legs before calling it (wasm lovejoin.rs:1657-1667), so only the plan path is reached. The worker can send such a leg because the two sides count held tokens differently. `acrossOf` counts a token from every own-or-fill row (extension background/lovejoin.ts:3170-3174). `holdings_of` takes only rows the evaluator can take (wasm lovejoin.rs:933, 940: `eval::refusal`, which refuses a reference script or a too-deep datum).

**Scenario.** A private session for a site has signed the site's transactions. One of them paid the session at least Q of token A in an output that carries a reference script, and another paid at least Q of token B in a plain output. Both tokens have shown pools. The worker counts both and plans legs [A's pool, B's pool, classic]. WebAssembly sees no A, plans A's leg at 0, and throws "The UTxOs paying for these boxes don't hold enough of a pool's token". acrossOf's guess catches it (lovejoin.ts:3194-3204) and returns nothing, so the classic pool goes alone. B, which its pool would have taken, comes back to the private balance directly, tied to the session, and the return names no token way saying why. Swaps are mostly shielded: an approved swap's unnamed tokens are `only` and get no leg. A one-file core test confirmed it: plan_across with legs [made-up token pool held 0, LJTEST pool held 2Q, classic] gave Err(Can't Separate Assets: cannot subtract an asset that is not in the collection), and Ok([2, 8]) without the first leg. The test is deleted.

**Confirmed how.** Read the code. A throwaway test, seedelf-core/tests/zz_review_319_rust_zero_leg.rs (deleted), asserted plan_across errs with the absent-token leg and plans [2, 8] without it; it printed both results.

**Suggested fix.** Skip legs with no box in plan_across's `kept` (`if *n == 0 { continue; }`) and in deposit_across's token loop, or have the planner treat token_total(0) as nothing to take. Also have acrossOf count only rows WebAssembly can spend (no reference script), so the worker and the WebAssembly agree on what is held.

**Test idea.** In lovejoin_planner_test.rs, plan_across with two token legs (a second Protocol cloned from lj_pool_by_reference with another token and id), the first held 0 and the second held 2Q, plus the classic leg. Expect Ok([0, 2, n]). Today it fails with "Can't Separate Assets".

**Skeptic (confirmed, low).** The finding holds on HEAD. `BoxValue::token_total(0)` returns `Some((token, 0))`, and `Asset::new` accepts an amount of 0. `Assets::sub` bails whenever the asset is missing from the collection, whatever the amount. `plan_across`'s `kept` loops over every leg, legs with 0 boxes included. So once `tokens` is non-empty, a token leg whose token is missing makes the whole plan an Err. In WebAssembly's `counts_across`, `tokens` is the merge of every own-or-fill UTxO that holds a wanted token and that the evaluator can take. The leg's `held` is counted from those same UTxOs, so a token is missing only when the worker and WebAssembly count different rows. They do. The worker's `acrossOf` counts every own-or-fill row in `c.rows`. `buildBack` removes only rows whose reference script can't be read (`measurable`), so a row with a well-formed reference script, or a datum nested more than 128 deep, still counts there. WebAssembly's `holdings_of` puts such a row in `kept`. The error comes back as a JsError, not a trap, so `narrower()` is true: the guess's `.catch` returns undefined, `acrossOf` returns undefined, and the classic pool's chain goes alone. The token WebAssembly can see comes back directly, and the review lists no token way for it. Why it stays low: it needs two token legs. Swaps are `only`, so they get at most one, which leaves a site's or another non-swap return. It also needs an output from the session's own transactions that carries a reference script and at least Q of one shown pool's token, beside another own output with at least Q of a second shown pool's token. No money is lost, the ADA still mixes, and the result is no worse than 1.5.0. No planner test has two token legs: every `plan_across` test in lovejoin_planner_test.rs uses one. `deposit_across` has the same subtraction, but nothing reaches it with a zero leg: `chain_across_pools` drops zero legs, and `counts_across` fails before that anyway.

Evidence: seedelf-core/src/lovejoin/mod.rs:1704-1727 (`kept` subtracts `token_total(*n)` for every leg; reached once `tokens` is non-empty, at 1722-1729); lovejoin/value.rs:120-130 (`token_total(0)` is `Some((token, 0))`); assets.rs:230-243 (`Assets::sub` bails 'cannot subtract an asset that is not in the collection'); wasm/src/lovejoin.rs:933-946 (`holdings_of`: an own token row the evaluator refuses goes to `kept`), 1178-1199 (`counts_across`: `tokens` and `held` from `held.tokens` only); core/src/eval.rs:56-74 (`refusal` refuses any reference script); extension/src/background/koios.ts:92-97 (`measurable` drops only unreadable reference scripts) and sessions.ts:4048-4050; background/lovejoin.ts:3170-3174 (the worker counts every own or fill row, with no refusal check), 3194-3204 (the guess's catch returns undefined), 2184-2185 (`narrower`); wasm/src/lib.rs:5643-5657 (the error is a JsError via js_error, not a trap).

## 319-rust#1

**low · owner-call · owner-call** — Four wide across pools can leave a later leg (another token, or the ADA) with no box where three wide gives it one, and four still goes

At `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1683`

**Detail.** plan_across prices every leg at the chain's single width and pays the legs in order, token pools first (mod.rs:1683-1703). At four wide each box costs more: a 2 ₳ token box at depth 2 is 2 + 5×1.35 = 8.75 ₳, against 5.8 ₳ at three. So the earlier legs can take the ADA a later leg needed. wayOver (extension background/lovejoin.ts:2152-2160) requires only that the legs' four-wide counts sum to at least 1, and holds each leg to min(four's own pays, three's fits). A leg that four pays 0 for passes, so four goes with no fellBack. The PR and the plan left the token case open for the owner (chunk-34 plan, 34e's fixes' review, "Left open" 8). The classic leg is always last, so the ADA follows the same rule. In a single pool, by contrast, four is refused with FOUR_COST when it pays for no box.

**Scenario.** Four boxes a mix is on (off by default). At depth 2, a session holds 2 boxes' worth of a 2 ₳ token pool's token and 26.9 ₳ of spare ADA. Three wide plans [2 token boxes, 1 ADA box]; four wide plans [2, 0]. A throwaway plan_across test confirmed both results. wayOver picks four, so the roughly 11 ₳ the ADA box would have taken comes back to the private balance directly, tied to the session, with nothing saying three would have mixed it. With two tokens, the later token comes back directly the same way.

**Confirmed how.** Read plan_across and wayOver. The throwaway test zz_review_four_wide_can_leave_a_later_leg_with_no_box (deleted) asserted three = [2, 1] and four = [2, 0] for spare 26,900,000 at depth 2.

**Suggested fix.** This is the owner's call before release. Options: go four only where each leg's four-wide count is at least min(three's count, its room), and otherwise go three with fellBack cost; or accept it and have the review say a leg would have mixed at three.

**Test idea.** In lovejoin-planner.test.ts, a return holding two of a token's boxes with 26.9 ₳ spare at depth 2 and four asked. Expect width 3 with fellBack, not width 4 with the classic leg at 0.

**Skeptic (owner-call, low).** The docs record this as the owner's call, and no decision has been recorded since. The token half is the chunk-34 plan's 'Left open: 8, the owner's call' (34e's fixes' review). PR #319's description also put it to the owner as 'one call that's yours: at four, a token leg can pay four's price too ... comes back directly where three would have mixed it'. The ADA half follows from the plan's own rule, 'Four-wide mixes cost more, so a return's spare ADA makes fewer boxes four wide. That's four's price, not a fallback' (Claude's call, the owner's to overturn, not overturned). `wayOver`'s doc says the same. The mechanics check out. At depth 2, a 2 ₳ token box costs 5.8 ₳ three wide and 8.75 ₳ four wide, and a classic box 13.8 ₳ and 16.75 ₳. From a 26.9 ₳ spare (25.4 ₳ after the reserve), three plans [2, 1] and four plans [2, 0]. `wayOver` then returns width 4, because 2 ≥ min(2, 2) and 0 ≥ min(0, 1), with no fellBack. A single pool would go three with FOUR_COST. What a user would see: Four boxes a mix is on (off by default), and the return's review says its tokens go into their pools ('swaps.lovejoin.privacy.onTokens'). About 8 ₳ or more of ADA comes back directly with the return, tied to the session, and nothing says three would have mixed it in a classic box. With two tokens, the later token can come back directly the same way. No money is lost, and nothing on screen is false. Put it to the owner before release: either keep it as four's price, or hold every leg to at least min(three's count, its room).

Evidence: docs/plans/chunk-34-token-pools.md:787 ('Four's rule ... That's four's price, not a fallback') and :826 ('8, the owner's call: four's price applies to a token too ... Asked, the rule could hold every token leg to what three would make'); no later decision found by grep across the docs; gh pr view 319, 'Left open'; seedelf-core/src/lovejoin/mod.rs:1683-1702 (each leg priced at the chain's one width, paid in order, classic last); mod.rs:1562/1567 (0.95 ₳ and 1.35 ₳ per mix), 1553-1555 (4 and 5 mixes per box at depth 2); extension/src/background/lovejoin.ts:2144-2160 (`wayOver` and its doc); lovejoin.ts:3341-3352 (`across` uses `wayOver` with four's pays, fits and room against three's fits); i18n/translations/en.json:2271 (onTokens), ui/components/LovejoinReturn.tsx:377-385.

## 319-worker#0

**low · confirmed · ux-words** — With four asked and the classic pool short at both widths, the swap approval and Stop's dialog say the ADA "mixes three at a time" beside the warning that it comes back directly

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2159`

**Detail.** When the pool is under its floor or short of free boxes, priced() (sessions.ts:1688, 1701) gives each width's ADA leg fits 0 and room 0. wayOver (lovejoin.ts:2152-2160) only returns a reason-free {width:3} when nothing is paid for (pays < 1). When the spare pays for a box (pays >= 1) but no width has room, it falls through to the last branch and returns {width:3, fellBack: FOUR_SHORT}. lovejoinCost then puts fellBack on SwapLovejoin (sessions.ts:1554-1557, 1571), and priced()'s price() puts it on Stop's cost (sessions.ts:1706-1711). Its own skipped (poolShort at three, sessions.ts:1712) is set at the same time. The screens show WidthNote whenever through && fellBack (ui/screens/Swaps.tsx:1567, and 2827 for Stop), next to the pool-short note. In chains (fanOut/acrossOf) this branch is harmless: attempt(3) then throws needsMore, so no chain or review ever carries the reason. Only the swap approval and Stop's dialog show it.

**Scenario.** Settings has Four boxes a mix on. The user reviews a token->ADA swap whose proceeds pay for several 10 ₳ boxes while Lovejoin's classic pool is under its floor (or the wallet's own chains have reserved its free boxes). The approval shows "Lovejoin's pool has N boxes not yours…, so as things are, this swap's ADA comes back directly, tied to this session on chain." Right below it, it shows "Lovejoin's pool hasn't enough boxes free to mix four at a time, so this mixes three at a time." Stop's dialog says the same pair for any approved-at-four swap's funding. The second line tells the user their ADA will be mixed three wide, but nothing is mixed.

**Confirmed how.** Read the code: priced()'s leg at both widths under poolShort, wayOver's branches, lovejoinCost's width/fellBack, stopCost's price(), and the two WidthNote call sites with their skipped notes.

**Suggested fix.** In wayOver, return { width: 3 } with no reason when three's legs fit no box either (sum of three fits < 1). Chains still go three, so refusals still quote three's need, and lovejoinCost keeps the width asked "for its return to decide" as its comment already says. Alternatively, drop fellBack in lovejoinCost/priced when no box goes at three.

**Test idea.** wayOver([{ pays: 5, fits: 0, room: 0 }], [{ fits: 0 }]) has no fellBack. Also, a swap review (sessions.outBuild) for a token->ADA quote with lovejoinWidth 4 and the classic pool under its floor returns lovejoin.skipped set and lovejoin.fellBack undefined; this fails on HEAD.

**Skeptic (confirmed, low).** Holds for the swap approval only. The Stop's dialog part is wrong. At Review (outBuild calls lovejoinCost with pool=true), with Settings at four and the classic pool under its floor or short of free boxes at three, the pool is also short at four, since four always needs more free boxes (depth 2: 8 vs 15; depth 3: 26 vs 63). priced() then gives each width's ADA leg fits 0 and room 0. wayOver([{pays>=1, fits 0, room 0}], [{fits 0}]) misses its first two branches and returns {width:3, fellBack: FOUR_SHORT}. lovejoinCost sets fellBack beside skipped. LovejoinChoice renders whenever `any` is true, and `l.of` makes it true. It shows the pool-short callout ('...so as things are, this swap's ADA comes back directly...') and, gated only on `through`, the WidthNote ('...hasn't enough boxes free to mix four at a time, so this mixes three at a time'). In the floor case the reason is untrue as well: the pool may have the free boxes and simply be under its floor. Stop's dialog never shows the pair: its WidthNote is gated on `lovejoin = mixes && through`, and `mixes` requires !cost.skipped and boxes > 0. stopCost sets skipped whenever both widths are short. Chains never carry the reason either: fanOut throws the floor first, and attempt(3) throws needsMore. So it is words only. The approval keeps three, which the note truly says of any later mix, and nothing signed differs from the review.

Evidence: lovejoin.ts:2152-2160 (wayOver; 2159 the FOUR_SHORT branch); sessions.ts:1686-1701 (fits 0 under poolShort, leg), 1554-1557 and 1571-1572 (way, width, fellBack beside skipped), 5685-5693 (poolShort: the floor is width-free, free need grows with width); ui/screens/Swaps.tsx:1257-1258 (`any` via l.of), 1553-1557 (pool callout), 1567 (WidthNote gated only on through); Stop: Swaps.tsx:2762-2763 (mixes needs !cost.skipped and boxes > 0), 2827 (WidthNote only when lovejoin), sessions.ts:3068-3069 (stopCost sets skipped); en.json:2273 and 3091 (the two strings).

## 319-worker#1

**low · owner-call · owner-call** — Four boxes a mix can cost a later token its box: it comes back directly where three would have mixed it (34e's open call 8, still undecided)

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2155`

**Detail.** acrossOf pays the token legs first (counts → planAcross, lovejoin.ts:3244-3262). At four each box costs more, so an earlier token (legs are sorted by unit) can use up the ADA a later token needed. wayOver accepts four when every leg fits >= min(pays4, fits3) (lovejoin.ts:2155). A later leg with pays4 = 0 passes (0 >= min(0, 1)), so the chain goes four and that token's way gets boxes 0 and sess.skip.warn.noBox (lovejoin.ts:3329-3331). The PR and the plan (chunk-34-token-pools.md:826) leave this for the owner, and nothing at HEAD decides it.

**Scenario.** Settings has Four boxes a mix on, at the default depth 2. A site session (or a hand-run swap) holds a box's worth each of two tokens with shown pools of 5 ₳ boxes, plus about 18 ₳ spare. Three wide, a box costs about 8.8 ₳, so both tokens go in. Four wide, it costs about 11.75 ₳, so only the first token gets a box. The second comes back directly, unmixed and tied to the session on chain. Its review says "Comes back directly: its spare ADA is too little for a box" and shows no width note, so the user never learns that three would have mixed it.

**Confirmed how.** Read the code: wayOver's every-leg rule against counts' pays at width 4, and the way's noBox marking after the build. The plan lists it as 34e's open call 8.

**Suggested fix.** The owner should settle it before release. The plan's own option: hold every token leg to what three would make. In wayOver, require l.fits >= three[i].fits for token legs (pass a per-leg flag) and fall back to three with a reason otherwise.

**Test idea.** An across return at lovejoinWidth 4 with two token pools and spare ADA for one box of each at three but not at four: both tokens get a box, and the chain goes three with fellBack set. On HEAD the second token's way has boxes 0.

**Skeptic (owner-call, low).** The mechanism holds on HEAD. Core's plan_across pays legs in order, from what the earlier legs leave, and acrossOf pushes the token legs (sorted by unit) before the classic leg. wayOver's every-leg test lets a later token leg with pays4 = 0 pass (0 >= min(0, fits3)), so the chain goes four. That token's way gets boxes 0 and the noBox reason, and no fellBack is set. But this is recorded. Claude's call says fewer boxes at four is 'four's price, not a fallback'. 34e's fixes' review lists it under 'Left open' as '8, the owner's call', and PR #319's body put it to the owner as 'one call that's yours'. Nothing later at HEAD decides it. What a user sees and risks: only with Four boxes a mix on (off by default), and a return holding two or more tokens with shown pools plus spare ADA in a narrow band. The later token comes back directly, tied to the session on chain, as every token did in 1.5.0, and its review says it comes back directly ('its spare ADA is too little for a box'). The review doesn't say that three wide would have mixed it. This is no regression from 1.5.0, and Settings already says four costs more in fees.

Evidence: seedelf-core/src/lovejoin/mod.rs:1683-1702 (legs paid in order); lovejoin.ts:3214-3240 (token legs pushed, then classic), 3244-3263 (counts), 3341-3352 (across: wayOver), 2155 (every-leg rule), 3326-3332 (way.boxes 0 gets noBox); docs/plans/chunk-34-token-pools.md:787 (Claude's call, four's price) and 826 ('8, the owner's call'); gh pr view 319 ('Left open: ... one call that's yours'); en.json:1959 (Settings: more cover, for more in fees).

## 319-worker#2

**low · owner-call · owner-call** — At depth 1, a return that takes a token into its pool caps the whole deposit at 64 boxes, so up to 33 more ADA boxes come back directly than 1.5.0 would have

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3265`

**Detail.** counts() cuts every leg's fits to min(MAX_TOKEN_DEPOSIT_BOXES, floor(MAX_CHAIN_MIXES/perBox)), the ADA's first (lovejoin.ts:3263-3270). That holds however few token boxes are in the deposit. A classic-only return takes chainBoxes(depth) = min(MAX_DEPOSIT_BOXES 96, floor(130/perBox)) (lovejoin.ts:1469-1473, 3065). At depth 2 and 3 the chain length decides, so the two caps agree, but at depth 1 it's 96 against 64. MAX_TOKEN_DEPOSIT_BOXES is sized for a deposit made entirely of token boxes (226 B each, lovejoin.ts:1475-1480). One token box beside 95 classic boxes (150 B each) is about the bytes of 96 classic boxes. The plan records this as Claude's call (chunk-34-token-pools.md:790), but it goes against backward compatibility's "Token boxes only ever add to a plan".

**Scenario.** Settings depth is 1. Someone has launched a NIGHT pool (Q = 100). A site session's return holds about 1,000 ₳ spare and 100 NIGHT. 1.5.0, or 1.6.0 without the NIGHT, mixes 96 ADA boxes. Across pools, the review shows 1 NIGHT box and 63 ADA boxes, and about 330 ₳ more comes back directly with the return, tied to the session on chain.

**Confirmed how.** Read the code: chainBoxes and MAX_DEPOSIT_BOXES/MAX_TOKEN_DEPOSIT_BOXES with their size notes, fanOut's deposits cap, and counts' over-cut in acrossOf.

**Suggested fix.** Owner's call. Either cap the deposit by bytes (token boxes at 226 B, ADA boxes at 150 B, within MAX_DEPOSIT_BOXES' room), or, where the across chain would mix fewer ADA boxes than the classic pool alone, weigh the two and say so on the review.

**Test idea.** At depth 1, a return holding one token box's worth and about 100 boxes' worth of spare ADA: the classic leg's boxes are no fewer than MAX_DEPOSIT_BOXES minus the room the token box takes (more than 63).

**Skeptic (owner-call, low).** Accurate on HEAD. Across pools, counts() caps the deposit's total at min(MAX_TOKEN_DEPOSIT_BOXES = 64, floor(130/perBox)) and cuts the ADA leg first. A classic-only return takes chainBoxes = min(96, floor(130/perBox)). Only depth 1 differs: at depth 2 both caps are 32, at depth 3 both are 10. So at depth 1 a return across pools mixes at most 63 ADA boxes beside one token box, where the same return without the token mixes 96, and the rest comes back directly, tied to the session on chain. It's recorded as Claude's call, the owner's to overturn: 'One deposit holds MAX_TOKEN_DEPOSIT_BOXES (64) when a token pool is in it, all its boxes counted. Past it, or past one chain, the ADA's boxes go first.' That states this exact effect. It is narrow: depth 1 (not the default), roughly 700 ₳ or more of spare ADA at one session, and a held token with a shown pool (mainnet has none yet). There is a way out on the review: Change set to back directly for the token leaves no token leg, and the classic chain alone then takes 96. It does bend backward compatibility's 'Token boxes only ever add to a plan'. Also, architecture.md:699 still says one deposit holds at most 96 boxes, with no mention of the 64 cap across pools (a stale doc, low). Both are worth the owner's look, but this is a recorded call, not a bug.

Evidence: lovejoin.ts:3263-3270 (over-cut across pools, ADA first), 1460 (MAX_CHAIN_MIXES 130), 1469-1473 (MAX_DEPOSIT_BOXES 96, chainBoxes), 1480 (MAX_TOKEN_DEPOSIT_BOXES 64), 3065 (fanOut: classic takes chainBoxes), 3239 (no token leg: classic alone), 3005-3029 (caller builds the classic fanOut); docs/plans/chunk-34-token-pools.md:790 (the call), 173 ('Token boxes only ever add to a plan'); docs/architecture.md:699.

## 319-worker#3

**low · confirmed · tests** — No test covers a return chain across pools stopped partway: the per-pool bookkeeping for its unmixed boxes is untested

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1708`

**Detail.** When a chain across pools is cut (a lock or a closed browser, cuts() at lovejoin.ts:4705-4730) or stops, unscheduleUnfinished (1731) runs unfinished(c, p) for each pool (1708-1712) and records the classic pool's count in `unscheduled` and each token pool's in `unscheduledIn` (1721-1728). sortOut reads them again (4785). Reading it, the logic is right: the chain's order is the deposit, the token legs, the classic leg, then the collateral tail and the return, so slicing by `sent` works. But no test asserts unscheduledIn or a partly-sent chain with `pools`. The across-pool tests all send the whole chain (lovejoin-planner.test.ts:214, lovejoin-pools.test.ts:315).

**Scenario.** A swap's return goes across MIN's pool and the classic pool, and a lock cuts it after the deposit and MIN's mixes, before the classic leg's. The classic leg's boxes are left unmixed and must lose their due times, while MIN's keep theirs. If a later change miscounted per pool, either an unmixed deposit box would come back by itself, tying the session's deposit to the private balance on chain, or a mixed box would never come back by itself. No test would catch either.

**Confirmed how.** Read the code, and grepped the tests: `unscheduledIn` appears in none, and no test cuts or stops a chain whose record has token pool shares partway.

**Suggested fix.** Add a test of a cut chain across pools.

**Test idea.** Record a chain (deposit, two token-pool mixes, two classic mixes, back) with pools {TOKEN: 2} and leaves named by pool. Call chainSent for the deposit and the token leg's mixes, drop its progress, and run cuts(). Assert that the classic pool's due times lose two with unscheduled 2, that the token pool's stay with no unscheduledIn, and that a status read holds the classic leg's deposit boxes as not mixed yet.

**Skeptic (confirmed, low).** The gap is real, and the logic reads right, so this is a missing test on a privacy-relevant path with no bug found. No test mentions `unscheduledIn`. Every across-pools test sends the whole chain: sentChain sends every transaction before chainEnded. The merged-review tests write an already-ended, cut token-pool chain straight into the store (cutInto), so cuts() and chainEnded's unscheduleUnfinished never run for a token pool there. They also assert notMixed, not due times. Nothing cuts or stops a chain with token-pool shares partway after its deposit was scheduled. Reading HEAD: recordChain keeps `mixes` as the main chain's mixes in transaction order, and the collateral tail's transactions sit apart, after the fan-out. Each leg's mixes are contiguous, token legs first, then classic. unfinished(c, p) counts pool p's leaves whose making mix is in [deposit, ...mixes].slice(0, sent). So a cut after the token legs drops only the classic pool's due times and records only `unscheduled`. sortOut then subtracts unscheduledOf per pool, so nothing goes twice. A test of a cut chain across pools would guard it.

Evidence: lovejoin.ts:1708-1712 (unfinished), 1721-1728 (unschedule, unscheduledIn), 1731-1733 (unscheduleUnfinished), 1532-1542 (shareOf, poolsOf, unscheduledOf), 4396-4413 (recordChain: mixes from main txs, total, sent), 4451-4470 (chainSent draws per pool), 4705-4730 (cuts), 4519 (chainEnded stopped), 4785 (sortOut per pool); `grep -rn unscheduledIn tests` finds nothing; tests/lovejoin-pools.test.ts:168-185 and 315-334 (whole chain sent); tests/lovejoin-merged-review.test.ts:665-685 (cutInto writes an ended record directly).

## 320-screens#0

**low · confirmed · ux-words** — A started pool that will never show is said to be 'on its way' for a day, then dropped without a word

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1572`

**Detail.** The hub renders lovejoin.pools.startedNotFound for every status.started entry: "A pool you started (…) shows here once a look finds it, about 10 minutes after its block." (Lovejoin.tsx:1570-1574). The worker lists a start in `started` when no read holds its pool and it is under 24 h old (lovejoin.ts:5207-5209, STARTED_SAID_MS at 1329). It never checks whether the launch landed, or whether it lost to an earlier start of the same values.

The copy check runs only at build, against what discovery knows (lovejoin-launch.ts:236-240). A launch made in the last SETTLE_MS (10 min), or not yet in the data layer's list, isn't known. Send (submit/choose, lovejoin-launch.ts:341-382) doesn't look again.

- On mainnet the data layer lists shown pools only, so the device never learns of the copy.
- On Koios the copy is read once and leaves `started` silently.

flows.md:506 and lovejoin.launch.sentNote make the same promise.

**Scenario.** Two users start "100 NIGHT + 4.5 ₳" pools (4.5 ₳ is the suggested box ADA, and Q is a round number) a few minutes apart, right after 1.6.0 ships. The second start lands as a copy, so its ~23 ₳ is locked for a pool no wallet will ever show. That user's hub keeps saying the pool "shows here once a look finds it, about 10 minutes after its block" for 24 hours, then the line disappears. Nothing ever tells them an earlier start took those values. A dropped launch transaction reads the same way.

**Confirmed how.** Read the code: Lovejoin.tsx:1570-1574, lovejoin.ts:5199-5216, lovejoin-launch.ts:233-240 and 341-382, and lovejoin-pools.ts (SETTLE_MS, the data layer's shown-only list).

**Suggested fix.** Once a start is older than its block's settling plus a margin (say 30 minutes after `at`) and still not read, say it hasn't shown. Give the likely reasons: an earlier start of the same values (no wallet shows a copy), or a transaction that didn't land. Link the launch transaction. At Send, run discovery.look/known again and refuse a start whose values have turned up since its review.

**Test idea.** Give the hub a status whose started entry is 2 hours old with no read. Assert it no longer promises "about 10 minutes after its block" and names the copy/not-landed possibility. On the worker side, a launch build followed by a discovery update with an earlier same-value pool should make submit refuse it.

**Skeptic (confirmed, low).** This holds on HEAD. The hub shows lovejoin.pools.startedNotFound for every start that no read holds and that is under 24 h old. Nothing checks whether the launch landed or lost to an earlier launch of the same values. The worker's own comment admits such a start 'never will be' found ('a copy that lost the race, a rollback'), and then it drops the line without a word. The copy check runs only at build. At Send, choose() only asks whether mix_logic's credential is registered. One sub-claim is wrong: on Koios the copy does not leave `started` after one read. An unread copy holding none of the wallet's boxes is skipped from `reads` (`continue`), so the line stays for the full 24 h there too, even though the device's discovery has the copy on record. The dropped-transaction case is weaker, because Home's pending banner already reports it as dropped. The 24 h cutoff was the 34f review's own fix (item 11), not a decision the owner recorded, and nothing on the launch review warns about the race. It is narrow: the same values must be launched within about 10 minutes of each other. The ~23 ₳ is lost by the race itself, not by the words, so this stays low.

Evidence: Lovejoin.tsx:1569-1574; lovejoin.ts:1329 (STARTED_SAID_MS = 24 h), 5204-5209 (filter and comment); lovejoin.ts:2667-2672 (unread copy with no listed boxes skipped from reads); lovejoin-launch.ts:236-240 (copy refused at build only), 341-382 (submit/choose: registration check only); en.json:1255, 1356; flows.md:506; pending.ts:775-821 (dropped tx reported); chunk-34-token-pools.md:893 (34f review 11).

## 320-screens#1

**low · confirmed · i18n** — Start a pool's amount fields skip the wallet's amount guard: in Spanish '1,125' becomes 1,125 and the review reads as 1.125

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:96`

**Detail.** The quantity and box-ADA fields are plain <input>s (`setQuantity(e.target.value)` at 292, `setBoxAda` at 306), parsed directly by parseQuantity (96) and parseAda (120). In parseQuantity (format.ts:150-157), "1,125" (no point, three digits after the comma) is thousands grouping, so it reads as 1125.

Every other amount field goes through AmountField/sanitizeAmount. In Spanish, sanitizeAmount refuses a d,ddd entry and shows both readings (format.ts:262-264, format.warn.ambiguousComma). It also says when there are too many decimals; this form only says "Enter how much of the token each box holds."

The review shows the value in en-US format, "1,125 MIN + 4.5 ₳" (boxText at 204), which a Spanish reader takes as 1.125. A pool's values are permanent, and a copy of them is refused for everyone.

No test drives the form's typed values into the lovejoin-launch-build request, and no e2e starts a pool.

**Scenario.** A Spanish-speaking user wants 1.125 MIN a box and types "1,125". The worker builds Q = 1,125 MIN (1000 times as much). The review says "1,125 MIN + 4.5 ₳", which they read as 1.125, and they press Start the pool. About 23 ₳ is locked for good in a pool with values they didn't mean, and those values are now taken. In an ADA pool, which has no upper limit, "2,125" makes a pool of 2,125 ₳ boxes.

**Confirmed how.** Read the code: LovejoinLaunch.tsx:96, 120, 285-308; format.ts parseQuantity (150-157) and sanitizeAmount (239-278); every other amount field uses AmountField.

**Suggested fix.** Use AmountField with sanitizeAmount on both fields: token rules with the token's decimals and the 2^64−1 cap, and ADA_RULES for the box. The form's notes then match Send's and Make private's.

**Test idea.** With the language set to es, render LovejoinLaunch with call() stubbed, type "1,125" into the quantity field for a 6-decimal token, and press Review. Assert no lovejoin-launch-build request carries quantity 1125000000 and the ambiguity note shows. Fails today.

**Skeptic (confirmed, low).** This holds on HEAD, and it is broader than Spanish. The launch form's two amount fields are plain inputs read by parseQuantity/parseAda. parseQuantity takes a comma as a decimal mark only when at most two digits follow it, so '1,125' becomes 1125 (raw 1125000000 for a 6-decimal token). Every other amount field goes through AmountField with sanitizeAmount. There, a typed comma with at most two digits after it turns into the point as it is typed, so the keys '1,125' give 1.125 in any language. A pasted 'd,ddd' in Spanish is refused with both readings shown. So the same keystrokes mean values 1000 times apart in Start a pool and in Send, Swap or Make private. The review then shows '1,125 MIN + 4.5 ₳' (boxText, en-US grouping), which looks exactly like what was typed. Limits on the damage: box ADA in a token pool is capped at 9 ₳ by both form and worker, so a 1000× box ADA is refused there. 'Too many decimals' gets a generic 'Enter how much…' message. Q has no cap but 2^64−1, and an ADA pool's box ADA has no cap. The cost is a pool with values the user didn't mean, for the ~23 ₳ launch. That needs exactly three digits after a decimal comma, and the value is visible on review, so low. No test drives these fields.

Evidence: LovejoinLaunch.tsx:96, 120, 285-294, 300-308, 204 (review row); format.ts:150-160 (parseQuantity, DECIMAL_COMMA), 239-265 (sanitizeAmount: decimal comma at typing 245-253, es guard 263-264); Swaps.tsx:1008-1013 (AmountField + sanitizeAmount); lovejoin-pools.ts:44-48 (boxText via formatAda/formatQuantity, en-US); lovejoin-launch.ts:226-228, 245; no test references lovejoin-launch-quantity or lovejoin-launch-ada.

## 320-screens#2

**low · confirmed · money** — The Mix form's figures leave out the collateral's mix that a private mix's funding now pays for

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:407`

**Detail.** The form prices from `lovejoin-funding` (LovejoinService.funding, lovejoin.ts), which has no collateral-tail reserve. Since Session 11, mixFunding (sessions.ts:1961) adds tailReserve (1.5 ₳) to every non-Bootstrap mix's first payment wherever a 5 ₳ ADA pool past the floor would take the collateral. The review shows that reserve (CollateralReserveRow); the form does not.

mixCosts' `leaving` (Lovejoin.tsx:407) is funding.lovelace + 5 ₳ + fee. That figure feeds three places:
- "Into a one-time account" and "Total leaving your private balance, about" (2788-2804);
- boxesAffordable's aside of 6 ₳ (283) and lovejoin.mix.cantAfford's "about X";
- `soon`, shown as "Comes back once it's mixed, about" (2807).

`soon` counts the 5 ₳ collateral, but the tail deposits it into a 5 ₳ box that comes back hours later. Owner call 2 (Session 10) left the notes' wording alone; these are figures.

**Scenario.** On preprod today (the rehearsal's 5 ₳ pool, floor 0), or on mainnet once a 5 ₳ ADA pool holds 30 others' boxes: a 1-box mix's form says Total leaving about X ₳ and "Comes back once it's mixed, about 6.2 ₳". The review then shows X + 1.5 ₳, and about 5 ₳ of the 6.2 ₳ comes back only hours later as a mixed box. A balance that just covers N boxes is offered N by the stepper, and Review refuses it.

**Confirmed how.** Read the code: Lovejoin.tsx:253-291, 399-411, 2786-2807; sessions.ts mixFunding (1955-1989) and tailReserve (4323-4328); lovejoin.ts funding(). Inert on mainnet until such a pool exists.

**Suggested fix.** Give lovejoin-funding (or a sibling request) the tail reserve the build would add (tailReserve with through=true). Add it to the form's Into/Total rows and to boxesAffordable's aside. Leave the 5 ₳ out of 'Comes back once it's mixed' when the collateral goes into the 5 ₳ pool, and say it comes back later as a box.

**Test idea.** Use a worker with a shown 5 ₳ ADA pool past the floor and lovejoinCollateral on. Assert lovejoin-funding's total plus 5 ₳ plus the fee equals the review's FundingTotals leaving within the fee estimate. Today the gap is the 1.5 ₳ reserve.

**Skeptic (confirmed, low).** This holds on HEAD. It comes from the later collateral-mix PRs, not from #320's own diff. mixFunding adds tailReserve to the first payment of every non-Bootstrap private mix whenever a shown 5 ₳ ADA pool past the floor would take the collateral (COLLATERAL_TAIL_RESERVE = 1.5 ₳). LovejoinService.funding(), which the form prices from, has no such reserve. So the form's 'Into a one-time account' and 'Total leaving your private balance, about' are 1.5 ₳ under the review's exact FundingTotals, which sums the payments, reserve included. boxesAffordable's 6 ₳ aside and lovejoin.mix.cantAfford leave it out too, so in a window under 1 ₳ wide the stepper offers a box that Review refuses as short. The form's 'Comes back once it's mixed' still counts the 5 ₳ collateral, which instead comes back hours later as a mixed box. The owner's Session 10 call 2 left the notes' wording alone, not these figures. The review shows the reserve on its own row before signing, and this is inert on mainnet (no pools bundled; the floor is 30). It applies on preprod today (the 5 ₳ pool 18c4df77…). Low.

Evidence: Lovejoin.tsx:253-263 (boxesAffordable), 283 (aside COLLATERAL+FEE_ROOM), 399-411 (mixCosts leaving/soon), 2786-2807 (form rows); lovejoin.ts:2893-2932 (funding, no reserve); sessions.ts:1956-1989 (mixFunding adds reserve), 4323-4328 (tailReserve); seedelf-core lovejoin/mod.rs:1600 (1.5 ₳); Lovejoin.tsx:3211-3213 (FundingTotals sums payments), 3277 (CollateralReserveRow); src/lovejoin-pools.json (preprod has 5 ₳ pool, mainnet none); chunk-34 plan Session 10 'For the owner' 2.

## 320-screens#3

**low · confirmed · ux-words** — Start swap / Start mix / Send read 'Sending…' while the switch or Change only rebuilds the review

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:900`

**Detail.** Since 34f the swap approval's Lovejoin switch and Change call rebuild(), which sets busy (Swaps.tsx:793-806). Before, the switch only set state. The foot's button renders `busy ? tr("common.sending") : …` (900), so it reads "Sending…" while nothing is sent.

The same happens in three other places:
- the Mix my boxes again review's Four boxes a mix switch (againAt → act, Lovejoin.tsx:2373-2380). Its button (2505-2510) can even show another public mix's "Sending 4 of 5…" from `sending`.
- TokenWays' Change on a session's return review (Swaps.tsx:2214);
- TokenWays' Change on a site's return review (SiteSessions.tsx foot).

buildAgain already avoids this on the refusal foot (PY-1's lesson).

**Scenario.** A user on the swap approval turns *Bring it back through Lovejoin* off to compare costs. The Start swap button flips to "Sending…" for the second or two the funding is rebuilt, and they may think the swap has started. On a private again review, the button can read "Sending 4 of 5 transactions…" from an unrelated public mix.

**Confirmed how.** Read the code: Swaps.tsx:793-806, 893-915; Lovejoin.tsx:2373-2380, 2505-2510; SiteSessions.tsx return review foot.

**Suggested fix.** Track a separate `rebuilding` flag, or pass the pressed action as Lovejoin.tsx's `pressed` does. Show "Building…" (common.building) while rebuilding, and keep "Sending…" for send().

**Test idea.** Render NewSwap's review, trigger onThrough with the session-out-build promise held, and assert the primary button reads common.building, not common.sending.

**Skeptic (confirmed, low).** This holds on HEAD. rebuild() sets busy, and the swap approval's foot shows common.sending whenever busy, so moving the Lovejoin switch or Change makes Start swap read 'Sending…' while only a new review is built. In 1.5.0 this switch was onThrough={setThrough}, with no rebuild. Mix again's Four boxes a mix switch goes through act(), which sets busy, and that button shows `sending ? lovejoin.sendingOf : common.sending`. `sending` is the hub's public-mix progress, and the private Mix my boxes again button isn't disabled while a public mix is sent. So that button can read another mix's 'Sending 4 of 5…'. TokenWays' Change on a session's or a site's return review does the same through buildBack and backSending. The return-review switch already did this in 1.5.0, so part of it predates 1.6.0. The code's own rule (buildAgain, PY-1's lesson) is that a rebuild says Building…, never Sending…. The words are misleading for a second or two and nothing is sent, so low, close to a nit.

Evidence: Swaps.tsx:814-825 (rebuild sets busy), 893-901 (foot), 844 (PY-1 comment), 2214/2243; SiteSessions.tsx:258/287; Lovejoin.tsx:1349 (hub `sending`), 1176-1183 (private again not gated by publicSending), 2271-2283 (act), 2373-2380 (againAt), 2505-2510 (button); 63f87b8 Swaps.tsx:866 onThrough={setThrough}, 2015-2020 and SiteSessions.tsx:244-249 (1.5.0 return switch already rebuilt).

## 320-screens#4

**low · confirmed · correctness** — Mix again's Four boxes a mix switch stays turned when its rebuild fails, over a review built at the other width

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2376`

**Detail.** againAt sets `setFour(fourNow)` before rebuilding (Lovejoin.tsx:2373-2380). again() and againPublic() go through act(), which on a failure sets `error` and leaves `review` unchanged (2353-2369, 2283-2296). The FourSwitch (2526-2533) then shows the new width over a review whose rows (mixedValue, atThree) and kept build are still at the old width. Start mix stays enabled and sends the old build.

**Scenario.** On Mix my boxes again's review the user turns four on. The rebuild fails because the pool changed or Koios hiccupped, and an error shows. The switch now says four boxes a mix, but pressing Start mix sends the three-wide chain the rows describe. The user believes they mixed four wide.

**Confirmed how.** Read the code: Lovejoin.tsx:2283-2296, 2353-2380, 2526-2533.

**Suggested fix.** Set four only after the new review is in (inside privateReview/againPublic on success), or reset fourChosen to the review's own width (summary.mix.width / summary.width) when the rebuild throws.

**Test idea.** Drive PoolPage's again review with lovejoin-again-build rejecting on the second call. Turn the switch and assert aria-checked still matches the review's width.

**Skeptic (confirmed, low).** This holds on HEAD. againAt calls setFour(fourNow) before rebuilding. act() only sets `error` when the build throws, and privateReview/againPublic call setReview only on success, so the old review stays. The FourSwitch reads the page's `four`, so it shows the new width over rows (mixedValue, WidthNote) built at the old one. Start mix is disabled only while busy. The worker's kept build is replaced only after a successful build (keepFunding), so Send sends the old width. A plausible failure: four wide takes more mixes (mixesPerBox), and the private balance runs short of the extra fees, or Koios errors. The user may then press Start mix believing it goes four wide. That is weaker privacy than they think (f⁴ against f⁶), but the rows do show the real width and an error is on screen. Narrow, so low.

Evidence: Lovejoin.tsx:2237-2239 (four from fourChosen), 2271-2283 (act), 2351-2352 (privateReview sets review on success only), 2358-2380 (again/againPublic/againAt), 2505 (send button disabled={busy}), 2526-2533 (FourSwitch four={four}); sessions.ts:1987, 2753-2755 (keepFunding only after a successful build).

## 321-lj-rust-data#0

**low · confirmed · performance** — Discovery's read on re-gathers every holder output above the last candidate that holds no `lovejoin` token, at every cursor

At `seedelf-data/api/src/lovejoin/discovery.rs:178`

**Detail.** `Seen.high` is only ever the highest id among candidates. A read on sets it at discovery.rs:178 and a read from the start at :189. `db::found` returns only the rows that pass the outer `exists(... m.name = $3)` filter (db.rs:47-49), so `Found.id` (db.rs:73) is never the id of an output that isn't a candidate. DATA-4's fix bounds the CTE by `o.id > $4` (db.rs:39). But some outputs at the holder sit above the last candidate's id and hold no `lovejoin` token: each launch's two reference-script outputs (made in the same transaction, after the reference UTxO) and anything anyone pays the holder. All of them pass the bound, are materialized, and are joined again to tx, block, address, datum and the ma_tx_out subquery at every read on. A read on happens at every 200-slot cursor, in `pools`' task and in the first `tokens`/`tokens_since` request of that cursor. This continues until a later candidate lifts `high` past them. The custom index on tx_out (address_id, tx_id) in deploy/home/db-sync-indexes.sql can't bound `o.id` within the holder. So a candidate costs one check, but such an output costs a re-join at every cursor, for good.

**Scenario.** Someone pays the holder tens of thousands of ADA-only outputs (about 0.9 ₳ each, burned, a few hundred per transaction), and no pool launches after them. At each cursor move, db::found re-joins every one of them before the token filter drops them. That takes hundreds of milliseconds to seconds per read, and it runs inside `tokens`' 5 s READ_TIMEOUT (routes.rs from_db_sync, private.rs:169). As the count grows, `lovejoin/tokens` and `tokens/since` time out with 503, and every mainnet wallet reads its token pools from Koios instead. The README's 'spam there ... costs this server one check' doesn't hold for spam without the token. Today the only such outputs are the two script outputs after the last launch, so the cost is trivial.

**Confirmed how.** Read the code: db.rs found_sql and Found.id, discovery.rs found_with's two `high` assignments, routes.rs from_db_sync, and the db-sync index file. Not measured, because this laptop has no db-sync access.

**Suggested fix.** Have `db::found` also return the highest output id it gathered at the holder by slot `at`: the CTE's rows joined to tx/block with `b.slot_no <= $2`, taken before the token filter (for example a `max(o.id)` select over the same CTE). Then set `Seen.high` to the larger of that and the candidates' highest id, in both paths (:178 and :189). Optionally also bound the CTE by `o.tx_id >= <high's tx_id>` so idx_tx_out_address_id_tx_id can range-scan it.

**Test idea.** In discovery.rs's model chain, add outputs that aren't candidates, with `read` returning (candidates, highest id gathered). After a read where an output that isn't a candidate sits at id 50 above candidate 48, the next read on must pass `after` = 50; today it passes 48. Add a found_sql text test that the gathered max is taken before the `exists` filter.

**Skeptic (confirmed, low).** The mechanism holds on HEAD. `Seen.high` is only ever the highest candidate id: the max over `found` on a read on (discovery.rs:178), the max over `newer` on a read from the start (:189). `db::found` returns only the rows that pass the `lovejoin`-name `exists` filter (db.rs:47-49). So outputs at the holder that sit above the last candidate and hold no such token are gathered by the CTE's `o.id > $4` (db.rs:39) and joined again at every read on, once per new stable cursor, until a later candidate lifts `high`. Such outputs exist after every launch, because the outputs go out unshuffled in the order reference UTxO, mix_box script, mix_logic script (launch.rs:17-18, 296-300), and db-sync gives later outputs higher ids. The README's words overstate it: 'spam there is burned, and costs this server one check' (README.md:171, discovery.rs:6) and 'each read gathers only the outputs above the highest id read so far' (README.md:172) don't hold for outputs without the token. The impact is weaker than the failure scenario says, though. Today it's 2 rows per launch. The attack burns about 0.86 ₳ per output, so tens of thousands of ADA. The suggested max(o.id) fix removes only the join part. The hourly read from the start (READ_AGAIN, discovery.rs:158/166, after = 0) still joins every output at the holder, and the CTE's scan through (address_id, tx_id) still touches every one at every read on whatever `high` is, since that index can't bound `o.id`. Only the optional tx_id bound limits the scan. The same burned-ADA spam at a shown pool's mix_box is a cheaper lever: `tokens` gathers and joins every output ever there at every tip, with no bound at all (chain.rs:115-127 OUTS_ANY, unspent_as_of_any at chain.rs:289-299, called from routes.rs:252, inside the 5 s budget at routes.rs:139). So the holder isn't special. A 503 falls back to Koios as privacy.md:200 documents. Not measured: this laptop has no db-sync. I'd rate it low, as misleading README words plus a narrow, expensive edge case. If it's fixed, the gathered max is safe only when limited to slot <= at (ids rise with block order). Checked clean: DATA-3's generation merge and DATA-4's bound are both present and tested (discovery.rs:394-467, db.rs:272-278).

Evidence: seedelf-data/api/src/lovejoin/discovery.rs:6, :158-166, :178, :189; seedelf-data/api/src/lovejoin/db.rs:33-53 (CTE bound :39, exists filter :47-49, Found.id :73); seedelf-platform/seedelf-core/src/lovejoin/launch.rs:17-18, 296-300 (output order); seedelf-data/README.md:171-172; seedelf-data/api/src/chain.rs:115-127, 289-299; seedelf-data/api/src/lovejoin/routes.rs:139, 199, 245-252; seedelf-data/deploy/home/db-sync-indexes.sql (idx_tx_out_address_id_tx_id on (address_id, tx_id)); seedelf-platform/seedelf-web-wallet/docs/privacy.md:200

## 321-lj-rust-data#2

**low · confirmed · docs** — The WebAssembly README's export table is missing 1.6.0's collateral fields and new exports

At `seedelf-platform/seedelf-web-wallet/wasm/README.md:57`

**Detail.** The rows for `buildSessionReturn` (57) and `buildLovejoinChain` (66) still describe 1.5.0's requests and answers. #321 added `collateralPool` to both requests. #323 added `collateralBoxes`, `collateralReserve`, and `tail`/`collateralTail` in the answers: two transactions that go before the return. `buildCollateralMix`, `lovejoinCollateralReserve`, `buildTransferParts` and `buildWithdrawParts` have no row, and neither do chunk 34's `lovejoinBoxValue`, `lovejoinVerifyPool`, `buildLovejoinLaunch` and others: 26 `js_name`s in lib.rs aren't in the table. The README presents this table as the module's API.

**Scenario.** A developer drives `buildSessionReturn` from the README (in a test or a new screen). They never learn the answer can carry a `tail` whose deposit and mix must be sent first, so they send the return alone. The collateral and its reserve stay at the one-time account until a later return: no loss, but the session looks stuck.

**Confirmed how.** Read README.md against lib.rs's wasm_bindgen exports, with a shell loop over every js_name: 26 aren't mentioned.

**Suggested fix.** Add the new fields to rows 57 and 66, and add rows for the new exports.

**Test idea.** A doc check that every `js_name` in wasm/src/lib.rs appears in wasm/README.md. It fails today for 26 names.

**Skeptic (confirmed, low).** The WebAssembly README's API table is stale for 1.6.0, but the reviewer's count and failure scenario are off. I matched every js_name in wasm/src/*.rs (88 of them) by whole word against README.md: 12 aren't there at all, not 26. They are buildCollateralMix, buildLovejoinLaunch, buildLovejoinLaunchFromAccount, buildTransferParts, buildWithdrawParts, lovejoinBootstrapMost, lovejoinBoxValue, lovejoinCandidate, lovejoinCollateralReserve, lovejoinLaunchCheck, lovejoinUsable and lovejoinVerifyPool. All 12 were added after 1.5.0: two in #321 (39f588a0), two in #323 (24c5c62a), the rest in chunk 34's earlier PRs. The README was touched once since 1.5.0 (5550d156). Row 57 (buildSessionReturn) leaves out the request's collateralPool and collateralBoxes and the answer's tail. Row 66 (buildLovejoinChain) leaves out collateralPool, collateralBoxes and collateralReserve, and each tx's tail and giveme flags. The failure scenario can't happen as written: a tail comes back only when collateralPool is passed (lib.rs:1418-1428), and the README never mentions it, so a developer following it gets a plain return. Most of the missing exports are documented in architecture.md:733 (lovejoinVerifyPool, lovejoinCandidate, lovejoinLaunchCheck, lovejoinUsable, buildLovejoinLaunch). So the table is incomplete rather than false, and it misleads no one into losing money. Under this review's rubric, stale docs are low; nit would also be fair. The fix is cheap: add the fields to rows 57 and 66 and a row for each of the 12 exports.

Evidence: seedelf-platform/seedelf-web-wallet/wasm/README.md:57, :66 (the table is lines 9-81); seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:922-972 (SessionReturnRequest and Result with collateral_pool, collateral_boxes, tail), :1418-1428 (tail only with collateral_pool); seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:1278-1335 (ChainRequest with collateral_pool, collateral_boxes, collateral_reserve; ChainTxOut with tail and giveme); a shell loop over every js_name in wasm/src/*.rs with grep -w against README.md: 12 missing; git log -S per name puts each one after 63f87b8; seedelf-platform/seedelf-web-wallet/docs/architecture.md:733

## 321-lj-screens#0

**low · confirmed · state** — Bring every box back now can say "Done: N back" after the user pressed Stop

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:84`

**Detail.** The component reads `lovejoin-held` every 2 s (lines 58-75). It drops a read only when `sent !== presses.current`, and `ask()` bumps `presses.current` once, before its RPC (line 84). A read sent while `lovejoin-bring-all-back-stop` is still in flight carries the new press count, so it is kept. The worker's `held()` reads the schedule without the update queue (lovejoin.ts:6402 `read` is not serialized; only `update` at 6485 is), so that read can see the run as still going. If its answer arrives after the stop's answer, the callback runs after `ask()` has set `last.current = undefined`. It then sets `last.current` back to the old going state and shows the progress, with Stop, again. On the next read (no `bringing`) the over test at line 66 sees a covering, unstopped run that ended. It calls `setDone(doneOf(...))`, and `doneOf` returns `last.back` (line 32), so the page says the run finished.

**Scenario.** Settings → Lovejoin, Bring every box back now is running with 3 sent and 5 left. The user presses Stop just as the 2 s poll fires, and the poll's answer comes back after the stop's. The progress briefly reappears, then the page says "Done: 3 back in your private balance." Five boxes are still in Lovejoin, now on their normal random waits. The user is told the emergency exit finished when it was stopped. On a pool's page, onOver also refreshes the page.

**Confirmed how.** Read the code (BringAllBack.tsx 53-105, lovejoin.ts read/update 6402/6485, stopBringingAllBack 5831). No test run.

**Suggested fix.** Make every read sent before the RPC answers stale: bump `presses.current` again after the `await call(...)` in `ask()` (or keep a sequence number taken when each read is sent and drop answers older than the last press's resolution). After Stop, also never treat the next empty read as over: only count an empty read as over when `last.current` came from a read made after the last press.

**Test idea.** Vitest: render BringAllBack with a mocked `call`. The first `lovejoin-held` returns {back:3,left:5}. Press Stop, and hold the next `lovejoin-held` promise (resolve it with the old going state) until after `lovejoin-bring-all-back-stop` resolves. Then answer reads with no `bringing`, advance the timers, and assert `lovejoin-bring-done` never renders. It fails today.

**Skeptic (confirmed, low).** The race is real, but the window is narrow. The UI drops only reads sent before the press: presses.current goes up before the await (BringAllBack.tsx:84), so a read sent while the stop is still in flight is kept (:61-64). On the worker side, held() reads the schedule outside the update queue: cuts() then read(), lovejoin.ts:5421-5424 and 6402. Only update() goes through inTurn (6485-6486). PrivateStore.get takes its snapshot at local.get. Both decrypt and seal go through wallet.withStoreKey, which runs in the wallet's serial queue (wallet.ts:551-552). So a read that reaches the worker a few ms after the stop takes its second local.get before the stop's local.set, and gets its own withStoreKey turn only after the stop's. Its stale answer, with bringing still going, lands after the stop's answer. That answer sets last.current = undefined (BringAllBack.tsx:97-99); the stale read puts the going run back (:70-71), and Stop shows again. The next read finds no bringing, because stop deletes it (lovejoin.ts:5830-5835). The over test at :66 then calls doneOf, which returns last.back (:32), and the page says "Done: 3 back in your private balance." (en.json:1936). Nothing else guards this. Low: it takes a read sent within a few ms of a Stop press, on a 2 s poll. Nothing is lost: the boxes left come back on their own waits. But the page wrongly says the run finished.

Evidence: BringAllBack.tsx:58-75, 83-99, 31-32; lovejoin.ts:5421-5424 (held: cuts + read, not queued), 6402 (read), 6485-6486 (update in inTurn), 5830-5835 (stop deletes bringing); private-store.ts:136-158; wallet.ts:551-552 (withStoreKey serialized); en.json:1936

## 321-lj-screens#1

**low · confirmed · correctness** — The public Mix form's cap counts ADA the public chain never spends: staking rewards and ADA held with other tokens

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2263`

**Detail.** This PR (owner's test, item 1) made the public account's ADA cap the stepper: `side = source === "private" ? seedelf : cardano` (2263) → `mixMost` → `boxesAffordable(side.lovelace, …, 0n)` (283), plus `capBalancePublic`, `noneAffordPublic` and `cantAffordPublic`. `cardano` is Home's `free.cardano = withRewards(unlocked(balances.cardano), rewards)` (Home.tsx:514), so it includes staking rewards (spendRewards is on by default) and all ADA held in UTxOs that also hold tokens. The public chain spends neither. `publicBuild` (lovejoin.ts:3778) passes only the account's UTxOs and collateral, with no withdrawal, and WebAssembly takes the classic pool's ADA from UTxOs of ADA alone ('…that takes {} ₳ in UTxOs of ADA alone, besides the collateral', wasm/src/lovejoin.rs:2159). The form's own row says so too ('Needs … ₳ in ADA alone', en.json:1065). The HeldOnSide line beside the stepper shows the same inflated figure.

**Scenario.** A staked public account has 25 ₳ in ADA-only UTxOs, 30 ₳ sitting with NFTs and 8 ₳ of rewards, so the form shows 63 ₳. The stepper offers 5 boxes and says "Your public account pays for 5 boxes at most". The user picks 4 and presses Review. The build is refused: "Your public account's ADA doesn't pay for 4 boxes …". Nothing is signed, but the cap the owner asked for is wrong exactly where it matters.

**Confirmed how.** Read the code (Lovejoin.tsx 273-286, 2263-2264, 362; Home.tsx 508-515; lovejoin.ts publicBuild 3765-3830; wasm lovejoin.rs 2150-2168). No test run.

**Suggested fix.** Give the pool page the public side's spendable ADA as the chain spends it: without the rewards (`unlocked(balances.cardano)`, or Dapps passes `rewards` so the page can subtract them). For an ADA pool, count only ADA-only UTxOs; for a token pool, ADA-only UTxOs plus those holding the pool's token. Or have the worker answer the most it can build (as `lovejoin-bootstrap-most` does for the private Bootstrap), and show that figure beside the stepper.

**Test idea.** Render PoolPage on the public tab with `cardano` = {lovelace: 63 ₳ (incl. 8 ₳ rewards and 30 ₳ in token UTxOs), tokens:[NFT…]} and a 10 ₳ funding. Assert the + button stops at what 25 ₳ of ADA-only UTxOs pays (1 box), not 5. It fails today.

**Skeptic (confirmed, low).** On the public tab, side = cardano (Lovejoin.tsx:2263), and mixMost passes side.lovelace to boxesAffordable with nothing set aside (:282-283). cardano is Home's free.cardano = withRewards(unlocked(balances.cardano), rewards) (Home.tsx:509-515), with spendRewards on by default (shared/preferences.ts:163). So it counts rewards and the ADA in every UTxO, token-bearing ones included. The public build sends only utxos and collateral, with no withdrawal (lovejoin.ts:3802-3806). WebAssembly takes the ADA from UTxOs of ADA alone (wasm/src/lovejoin.rs:2141-2148); in a token pool it also takes UTxOs holding that pool's token (2088-2098), and never UTxOs holding other tokens. So the stepper, capBalancePublic and HeldOnSide can promise more boxes than the build will make. The plan records the owner's ask ("the public account's ADA holds the stepper", chunk-34 line 1082), but not rewards or token-held ADA, so this is not an owner-call. Low: the build is refused in words (lovejoin.rs:2159) before anything is signed. The cap is only loose, and the form's own row says "in ADA alone" (en.json:1065).

Evidence: Lovejoin.tsx:2263-2264, 273-286, 2604-2650, 2691; Home.tsx:509-515; format.ts:388-399; shared/preferences.ts:163; lovejoin.ts:3765-3830 (request at 3802-3810, no withdrawal); wasm/src/lovejoin.rs:2088-2098, 2141-2168; docs/plans/chunk-34-token-pools.md:1082

## 321-lj-screens#2

**low · confirmed · correctness** — Mix my boxes again's Four boxes a mix switch keeps the new width after the rebuild fails, while the review and Send stay at the old width

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2375`

**Detail.** `againAt` calls `setFour(fourNow)` (2375) before rebuilding with `again(publicToo, w)` / `againPublic(w)`. These go through `act()` (2271-2283), which on failure only sets `error`. `setReview` never runs, so the previous summary stays on screen and its Send stays live. The switch, `four` at 2527, now says four ('Each mix puts a box with three others, not two…', settings.lovejoin.privacy.fourOn). The rows (mixedValue without 'four boxes a mix') and the kept funding are still three-wide. For the private side the old kept funding is still sendable when the failure came before `keepFunding` (a Koios or pool read error, say).

**Scenario.** On a classic or token pool's Mix my boxes again review, the user turns on Four boxes a mix for more cover. The rebuild fails ('Lovejoin's pool changed while the wallet read it', or Koios doesn't answer). The error shows, but the switch stays on and its note promises three others per mix. Pressing Send funds and runs the three-wide chain the user turned away from.

**Confirmed how.** Read the code (againAt 2373-2379, again 2358-2364, act 2271-2283, FourSwitch render 2525-2533, sessions.ts mixFunding 1957-1988). No test run.

**Suggested fix.** Set the switch only once the rebuilt review is in: move `setFour(fourNow)` into the success path, or put it back (`setFour(!fourNow)`) on failure. Or clear the review on a failed rebuild so the stale one can't be sent.

**Test idea.** Render PoolPage on an again review with `lovejoin-again-build` mocked to resolve the first time and reject the second. Turn the switch and assert `lovejoin-again-four-switch` aria-checked is back to "false" (or the review is gone) after the rejection. It fails today.

**Skeptic (confirmed, low).** againAt calls setFour(fourNow) before it rebuilds (Lovejoin.tsx:2373-2379). act() only sets error when the task fails (:2271-2283), and privateReview and againPublic call setReview only after a successful build (:2348-2349, 2366-2369). So the old three-wide summary stays on screen, with Send enabled (:2500). The switch shows four, with the fourOn note "Each mix puts a box with three others, not two" (:2527-2533, en.json:1959). The rows show no "four boxes a mix" (mixedValue :3234). On the private side, keepFunding is the last step of mixFunding (sessions.ts:1987), so any earlier failure (againBoxes, funding, tailReserve, buildFunding) leaves the old SESSION_MIX_OUT, and mixOutSubmit still sends it by its txHash (sessions.ts:1992-1999). No test covers this path. Low: it takes a failed rebuild, and an error is shown. The chain sent is the one the rows describe, three-wide (the default cover), so no money is at risk. The fault is the switch and its note contradicting the review beside Send.

Evidence: Lovejoin.tsx:2271-2283, 2348-2349, 2358-2379, 2496-2505, 2526-2533, 3230-3235; sessions.ts:1928-1953, 1956-1988, 1992-1999; en.json:1959; no test references lovejoin-again-four

## 321-lj-screens#3

**low · confirmed · correctness** — The private Mix form's totals leave out the 1.5 ₳ the funding now adds for the collateral's mix

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:407`

**Detail.** Since session 11 (PR #323), `mixFunding` funds a mix's one-time account with `mix.lovelace + reserve` (sessions.ts:1961, 1969). Here `reserve` is COLLATERAL_TAIL_RESERVE (1.5 ₳), added wherever Settings' collateral switch is on (the default) and a shown 5 ₳ ADA pool holds the floor. The Mix form prices the mix from `lovejoin-funding` alone (lovejoin.ts funding(), which has no reserve). `mixCosts` (399-411) then shows 'Into a one-time account', 'Total leaving your private balance, about' and the cost split without it. `boxesAffordable`'s aside (COLLATERAL + FEE_ROOM = 6 ₳, 257/283) doesn't cover it either. The review is right: it has CollateralReserveRow, and FundingTotals counts every payment.

**Scenario.** On preprod today, or on mainnet once a 5 ₳ pool holds 30 other boxes: the Mix form says about 21.8 ₳ leaves the private balance for one 10 ₳ box, and the review then says about 23.3 ₳. With a balance just above the form's figure, the stepper offers a box that the funding then refuses at Review.

**Confirmed how.** Read the code (Lovejoin.tsx 253-263, 399-411, 2786-2808; sessions.ts tailReserve 4323-4328 and mixFunding 1957-1988; lovejoin.ts funding 2893-2932). No test run. The gap arrived with PR #323, after this PR, but the form is this slice's.

**Suggested fix.** Have `lovejoin-funding` return the tail reserve the build would add (`collateralReserve`, as the build's summary does), add it to `leaving` and the aside in `boxesAffordable`, and show CollateralReserveRow on the form as the review does.

**Test idea.** Worker+screen: with `adaPool` 5 ₳ shown and `lovejoinCollateral` on, compare the Mix form's `lovejoin-mix-leaving` with the private review's `review-total` for the same boxes. Assert they differ by no more than the fee estimate's slack, not by 1.5 ₳. It fails today.

**Skeptic (confirmed, low).** mixFunding pays mix.lovelace + reserve (sessions.ts:1961, 1969). The reserve is tailReserve = COLLATERAL_TAIL_RESERVE, 1.5 ₳ (seedelf-core lovejoin/mod.rs:1600), whenever the collateral switch is on (the default) and collateralPool finds a shown, usable 5 ₳ ADA pool at the network's floor with free boxes to draw (sessions.ts:4323-4328, lovejoin.ts:3474-3483). The form prices from lovejoin-funding, i.e. funding() (lovejoin.ts:2893-2932, handlers.ts:501), which has no reserve. So mixCosts' leaving and soon (Lovejoin.tsx:407-409) and the rows at 2790/2801 leave it out, and boxesAffordable's 6 ₳ aside (5 ₳ collateral + 1 ₳ fee room, :257) doesn't cover reserve + fee. The review is exact: CollateralReserveRow and FundingTotals (:3270-3274). This is a gap, not a decision: Session 11's screens put the row on the reviews only. Low: on mainnet today the reserve is 0, since no 5 ₳ pool holds 30 other boxes; it applies on preprod now and on mainnet once such a pool forms. At the edge, a box the form offers is refused at Review, and nothing is signed.

Evidence: sessions.ts:1956-1988, 4323-4328; seedelf-core/src/lovejoin/mod.rs:1600; lovejoin.ts:2893-2932, 3474-3483; handlers.ts:501-510; Lovejoin.tsx:253-263, 399-411, 2786-2808, 3270-3274; docs/plans/chunk-34-token-pools.md (Session 11 'Screens and words')

## 321-lj-screens#4

**low · owner-call · owner-call** — "Comes back once it's mixed, about" counts the 5 ₳ collateral, which now goes into the 5 ₳ pool and comes back later as a box

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2807`

**Detail.** `mixCosts.soon` = leaving − cost − later (409), and `leaving` includes COLLATERAL (407), so the Back soon row includes the 5 ₳ kept aside. Since session 10 (in this PR) and session 11, a mix's return with Settings' collateral switch on and a 5 ₳ pool at its floor puts that 5 ₳ into the 5 ₳ pool. There it is mixed once and comes back by itself after a box's delay, not 'once it's mixed' with the rest. Session 10's call 2 deliberately left the approvals' notes ('…comes back with the 5 ₳ kept aside') unchanged, to keep classic-only screens as they were. This figure follows the same decision, but it is a number on the form.

**Scenario.** Preprod today, or mainnet once a 5 ₳ pool holds the floor: the form says about 9.9 ₳ comes back once the box is mixed. Only about 4.9 ₳ comes back then; the other 5 ₳ comes back hours later as a 5 ₳ pool box, and is tied to the session until that box's mix goes. The user expects more ADA back sooner than arrives.

**Confirmed how.** Read the code (Lovejoin.tsx 399-411, 2798-2807; plan chunk-34 Session 10 'For the owner' 2 and Session 11). No test run.

**Suggested fix.** The owner's call. Either keep it, or, where the collateral is mixed, leave the 5 ₳ out of `soon` and say it comes back later as a box: one condition on the token-free classic path when no 5 ₳ pool is shown keeps classic-only users' screens byte-identical.

**Test idea.** With the collateral's mix applying, assert the Mix form's backSoon value excludes the 5 ₳ (and still includes it when no 5 ₳ pool is shown).

**Skeptic (owner-call, low).** mixCosts' soon works out to reserve + 5 ₳ − 2 fee estimates, about 6 ₳ for a classic box (not the 9.9 ₳ the finding says). It counts the 5 ₳ collateral as coming back once the box is mixed. Where the collateral's mix applies (switch on, a shown 5 ₳ pool at its floor, today preprod only), that 5 ₳ goes into a 5 ₳ box, is mixed once, and comes back by itself after a box's random wait. Only about 1 ₳ comes back with the return. Session 10's call 2 (plan line 978) deliberately kept the matching approval notes ("comes back with the 5 ₳ kept aside") unchanged, so classic-only screens would not change. It noted they are "no longer 'with' the rest where a 5 ₳ pool is shown". The form's figure follows the same choice. The owner's look at Session 10's calls is still listed as next (line 915). What a user sees and risks: the form promises about 6 ₳ back soon; about 1 ₳ arrives then, and the other 5 ₳ arrives hours later as a 5 ₳ pool box. Nothing is lost.

Evidence: Lovejoin.tsx:399-411 (soon = leaving − cost − later; leaving includes COLLATERAL at 407), 2807; swap.ts:25 (SESSION_FEE_ESTIMATE 0.25 ₳); docs/plans/chunk-34-token-pools.md:978 (Session 10, For the owner 2), 915 (owner's look pending), Session 11 (tail: the collateral mixed once, then back after its wait)

## 321-lj-screens#5

**low · confirmed · ux-words** — Bring every box back now's reason tells the user to "Pay from your public account", which that run never offers

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:3092`

**Detail.** In a pool whose boxes can't pay their own way back, `bringAllBackNow` always withdraws with `paid: "private"` (lovejoin.ts:5965). With no free ADA-only private UTxO, `withdrawOne` throws `lj.privatePayNone` (lovejoin.ts:6136): '…Pay from your public account, or make some ADA private first.' The run keeps that as `why`. BringAllBack shows it as 'The last box that didn't go: …' (BringAllBack.tsx:199), and after three runs as 'Stopped: … Press Try again to bring back the rest.' (222). Neither Settings' nor the pool's Bring every box back now has a public payer, and Try again fails the same way. The public payer exists only box by box, behind the pool page's stuck callout (PaidQuestion).

**Scenario.** A user whose private balance is all Lovejoin boxes, with no ADA-only UTxO, presses Bring every box back now with a token pool's boxes stuck. Settings says to pay from the public account, but no such option is there. Try again repeats the same failure. The way out (each pool's page → Bring one back → Pay from my public account) is never named.

**Confirmed how.** Read the code (lovejoin.ts 5963-5986, 6119-6136; BringAllBack.tsx 196-200, 220-224). No test run.

**Suggested fix.** For the bring-all-back run, give its own reason: the pool's page brings these boxes back one at a time paid by the public account, or make some ADA private, then Try again. Or let the run fall back to the public account only after its question has said what that ties.

**Test idea.** Worker test (lovejoin-bring-all-back.test.ts): a stuck token pool's box and a private balance with no ADA-only UTxO. Assert `bringing.why` doesn't contain 'Pay from your public account' (or names the pool page's Bring one back).

**Skeptic (confirmed, low).** In a stuck pool, bringAllBackNow always withdraws with paid: "private" (lovejoin.ts:5957, 5965). When no free private UTxO of ADA alone pays, withdrawOne throws lj.privatePayNone (6136): "…Pay from your public account, or make some ADA private first." The run keeps it as why when it sent nothing (5979, 5983). BringAllBack shows it as "The last box that didn't go: …" (BringAllBack.tsx:199), and after BRING_FAILED_RUNS (3) inside "Stopped: … Press Try again to bring back the rest." (:222, en.json:1935). Neither Settings nor the pool page's Bring every box back offers a public payer. That exists only in the stuck callout's Bring one back (PaidQuestion), which the words never name. Low, not stuck: the other half of the advice (make ADA private, then Try again) works. Once classic boxes come back, their UTxOs are tried first (6125-6127). So it takes a stuck token pool and no payable ADA-only private UTxO.

Evidence: lovejoin.ts:5955-5985, 6119-6136, 1364 (BRING_FAILED_RUNS 3); en.json:3092, 1933, 1935; BringAllBack.tsx:196-200, 220-224; docs/plans/chunk-34-token-pools.md:1173 (call 36: PaidQuestion offers the public payer on the pool page only)

## 321-lj-worker#1

**low · confirmed · ux-words** — Bring every box back now waits with no word of why; since #323, a session's collateral mix waiting on giveme.my can keep that wait up to a day

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5854`

**Detail.** `elsewhere()` (5854-5860) only clears `held`. The waits for Mix my boxes again (5861), a chain being sent (5862) and a withdraw being looked for (5863) record no reason. settleMaybeSent (5864) throws MaybeSentWait out of the run. So Settings shows only "Bringing every box back: N sent back so far." and "Keep Seedelf Wallet unlocked…". Bring one back now says each of these in words (lj.mixingAgain, lj.chainSending, lj.lastBoxMaybe).

Since #323, a session's chain whose collateral mix waits for giveme.my (busy or out of reach) stays 'being sent', retrying with backoff for up to TAIL_KEEP_MS (24 h; sessions.ts:4798-4805, lovejoin.ts:325). The emergency exit, and every due box (which waits on the same chainsSending at 5514), can sit silent that long.

**Scenario.** giveme.my is unreachable while a private swap's return waits on its collateral's mix. The user presses Bring every box back now. For hours Settings shows "Bringing every box back: 0 sent back so far." with no reason, and nothing comes back.

**Confirmed how.** read the code

**Suggested fix.** Have elsewhere() keep a short reason code (a chain being sent, mixing again, a withdraw being looked for, a payment that may still go through), shown in place of an older reason as `held` is. Also consider letting the bring skip a chain stalled only at its giveme.my tail.

**Test idea.** With a chain's progress present (chainsSending), a bring run must leave a waiting reason in lovejoin-held's `bringing`. Once the chain ends, the reason must go.

**Skeptic (confirmed, low).** Accurate on HEAD. elsewhere() only deletes `held`. The waits for Mix my boxes again, a chain being sent and a withdraw being looked for return with no reason kept. settleMaybeSent throws MaybeSentWait, which runs.ts swallows. Settings shows only the sent count and "Keep Seedelf Wallet unlocked…", or an older run's stale `why`, since elsewhere() doesn't clear it. Bring one back now says each of these in words. Since #323, witnessTail keeps a session's chain unended while giveme.my is busy or out of reach, with back-off, up to TAIL_KEEP_MS (24 h) from the deposit landing, so the silent wait can last that long. While giveme.my is down the bring couldn't send anyway, since its withdraws need giveme.my too. So the harm is only the missing words: low.

Evidence: lovejoin.ts:5854-5864; pending.ts:961-968 (MaybeSentWait thrown); runs.ts:68 (.catch(() => undefined)); BringAllBack.tsx:189-200 (only held or why shown); lovejoin.ts:5704-5712 (Bring one back now's lj.mixingAgain / lj.chainSending / lj.lastBoxMaybe); sessions.ts:4780-4806 (witnessTail returns false on CollateralError/KoiosError, TAIL_KEEP_MS check at 4786); lovejoin.ts:325 (TAIL_KEEP_MS = 24 h); sessions.ts:680 (TAIL_WITNESS_WAIT_MS 1 min to 30 min).

## 321-lj-worker#2

**low · confirmed · tests** — Bring every box back now's pay-from-the-private-balance branch for a stuck pool has no test

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5957`

**Detail.** The bring decides per box whether the private balance pays (5957-5965: `stuck ? { paid: "private" }`, from cantComeBack). No test runs bringAllBackNow against a token pool whose boxes can't pay their own way back. lovejoin-bring-all-back.test.ts has no stuck pool, and no bring test mentions cantComeBack, stuck or buildLovejoinWithdrawPrivate. The private-paid withdrawOne is tested only through withdrawNow (lovejoin-merged-review.test.ts' call-36 block).

**Scenario.** A later change passes `paid: "private"` for every box, or for none, and nothing fails:
- for every box: each of the user's boxes comes back beside one of their private UTxOs, tying them together on chain, with each fee paid from the private balance;
- for none: in a stuck pool the bring fails three runs on core's refusal and stops.

**Confirmed how.** read the code, and grepped the tests (none of the bring's tests covers a stuck pool)

**Suggested fix.** Add a bring test with a token pool at a price per byte its boxes can't pay, set up as the call-36 tests do. Assert that the stuck pool's box comes back paid by a private UTxO, and that a classic box in the same run pays its own way.

**Test idea.** As in the suggested fix, mutation-checked by forcing `stuck` to true and to false.

**Skeptic (confirmed, low).** No bring test has a stuck token pool. lovejoin-bring-all-back.test.ts, settings.test.ts and the e2e bring test never make cantComeBack truthy. Call 36's private-paid withdraw is tested only through withdrawNow (lovejoin-merged-review.test.ts' stuckWith block). So a mutation that never passes paid:"private" (stuck always false) would go uncaught. The finding overstates the other direction: forcing paid:"private" for every box would very likely fail the first bring test. Its expect(sent).toHaveLength(4) and its exact set of spent inputs would break, either through lj.privatePayNone with no private UTxO or through an extra private input. The gap is real but one-sided: low.

Evidence: lovejoin.ts:5957-5965 (stuck → paid "private"); lovejoin.ts:6119-6147 (private-paid branch); grep: no `stuck|cantComeBack` in any test that calls bringAllBack; lovejoin-merged-review.test.ts:1031-1131 (stuckWith via withdrawNow only); lovejoin-bring-all-back.test.ts:163-167 (first test's sent count and exact withdrawn set).

## 321-lj-worker#3

**low · owner-call · owner-call** — Done can be said while a box that was there at the ask is left behind: madeSince drops one someone else's mix moved after any later chain of the wallet's

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1818`

**Detail.** madeSince (1818-1825) leaves out a box no record accounts for if it last moved after any chain the wallet recorded since the ask, reading it as ripeAt does. This is deliberate: it may be that later chain's box. While the bring waits, for example for that later chain being sent, other people's mixes move the wallet's older boxes. Each moved box becomes madeSince, is left out of `ours` (5886), and keeps a due time. The run then ends with "Done: N back in your private balance", since doneOf returns `back`. Those boxes come back later, after their own waits.

**Scenario.** 1. The user presses Bring every box back now.
2. A swap's return then goes through Lovejoin, or the user sends a public mix.
3. During the 20–30 minutes it's being sent, other people's mixes move two of the user's older boxes.
4. The bring ends with 'Done: 6 back' while those two stay in Lovejoin for hours.

**Confirmed how.** read the code

**Suggested fix.** The owner's call: accept it, since such a box can't be told from the later mix's. Or have Done say how many still come back after their waits (Home's count) rather than Done alone.

**Test idea.** Bring asked, a later chain recorded, and an old box re-listed with a block_time after that chain: the end state should report that box as left.

**Skeptic (owner-call, low).** The behaviour is real and deliberate. madeSince leaves out a box no record accounts for when any chain recorded after the ask went in before that box last moved, because it can't be told from that chain's own box. Its doc comment explains this as the owner's item-5 call, "only what's there now", which favours keeping a later mix's waits for privacy. Such boxes keep their due times through the end branch, Home still shows them, and they come back after their own waits, so nothing is lost. "Done: N back" is literally true but doesn't say some stayed. The case is narrow: the bring must not have taken the old boxes before the later chain started, and strangers must move them during its send. A user would see Done while Home still lists a box or two in Lovejoin. Whether Done should also say how many come back later is a wording call for the owner.

Evidence: lovejoin.ts:1812-1825 (madeSince and its comment citing item 5's call); lovejoin.ts:5886 (ours excludes madeSince); lovejoin.ts:5921-5923 (their due times kept); BringAllBack.tsx:31-32 (doneOf returns back when > 0); docs/plans/chunk-34-token-pools.md:1086 ("The owner: one at a time …, and only what's there now") and :1008 (bring-takes-later-mixes → madeSince).

## 321-lj-worker#4

**low · confirmed · ux-words** — 'Waiting for the chain to confirm', with no Stop, can last up to 2 h when a sent withdraw never lands

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:179`

**Detail.** Once `left` is 0 and `back` > 0, the page hides Stop (BringAllBack.tsx:179 and 201). The worker keeps waiting while its pools list a box that a sent withdraw spent (lovejoin.ts:5903-5915). If that withdraw is dropped (expired, rolled back), its box stays spent-marked for SPENT_KEEP_MS (2 h, spent.ts:33) before it counts as owned again and is retaken. Meanwhile returning() keeps the alarm reading every pool each minute.

**Scenario.** A withdraw the bring sent is dropped. For two hours Settings says "8 boxes sent. Waiting for the chain to confirm." with no Stop button, and the box isn't brought back meanwhile.

**Confirmed how.** read the code

**Suggested fix.** Keep Stop available while confirming. Or, once a confirming box's withdraw is older than CHAIN_RESEND_MS and still unseen, forget its spent mark so the next run takes the box again.

**Test idea.** Bring sends a withdraw that never lands. After the resend window, the run must offer Stop or retake the box, rather than wait SPENT_KEEP_MS.

**Skeptic (confirmed, low).** Accurate on HEAD. Once left is 0 and back > 0, the view hides Stop, and on Settings' run for every pool the ask button too. The worker waits as long as a listed box of the wallet's is spent-marked. withdrawOne drops `withdrawing` as soon as Koios takes the submit, so nothing looks for a dropped withdraw. Its box stays spent-marked for SPENT_KEEP_MS (2 h) before it's owned and retaken. The "no Stop" state is the design from the owner's item 7, but the owner weighed a normal one-minute confirmation, not a withdraw that never lands. Two things narrow it. A submit Koios accepted that never lands, with its box left unspent, is rare. And a lock ends it sooner, since lock clears session storage, spent marks included, although the page asks the user to stay unlocked. Nothing is lost and it heals itself: low, misleading words.

Evidence: BringAllBack.tsx:179 (confirming = left 0 && back > 0), 201-207 (Stop hidden), 212 (asks false while going); lovejoin.ts:5903-5915 (confirming wait, unbounded, no fail count); lovejoin.ts:6242 (dropWithdrawing right after a taken submit); spent.ts:33 (SPENT_KEEP_MS = 2 h), spent.ts:127-130; wallet.ts:687 (lock clears session storage); docs/plans/chunk-34-token-pools.md:1088 (item 7: "with no Stop").

## 321-parts-rust#0

**low · confirmed · compat** — CLI sweep's default ADA for 21+ distinct tokens is now refused by the shared builder

At `seedelf-platform/seedelf-cli/src/commands/sweep.rs:160`

**Detail.** The CLI still works out the default sweep amount as one output holding every token: address_minimum_lovelace_with_assets over all of selected_tokens (sweep.rs:129-134), used when --lovelace is absent (sweep.rs:160). PR #321 changed the shared pay_address to split tokens 20 to an output. It now refuses less than minimum_address_payment, the sum of each 20-token chunk's minimum (build.rs:3306-3318, checked at 3344-3355). With 21 or more distinct tokens that sum is about 1 ADA higher for each extra chunk (each output pays the 160-byte overhead and its address again), so the CLI's own default is always under the builder's floor. The CLI's pre-check at sweep.rs:134 now checks against a smaller number than the builder enforces. The transfer path changed the same way: payment_outputs now requires minimum_seedelf_payment = minimum_deposit summed per chunk (build.rs:3239-3246, 3262-3264). So a CLI transfer of 21+ tokens at the old one-output minimum is refused too, with a clear message. The PR says payments go 20 tokens to an output, but not that the CLI's default sweep amount stops working.

**Scenario.** A CLI user holding 21 distinct tokens runs `seedelf-cli sweep --address addr1... --asset p.a1=1,...,p.a21=1` without --lovelace. Before 1.6.0 this built one output at the CLI's computed minimum. Now it fails with "A payment to that address with these tokens needs at least N ADA", and N is the CLI's default plus about 1 ADA. No money moves; the user has to rerun with a larger --lovelace.

**Confirmed how.** Read the code. Compared sweep.rs:129-160 with build.rs pay_address and minimum_address_payment at 3306-3355 on HEAD, and with the pre-PR versions in e6b5dae51 (one output, a single-output minimum). The CLI harness (tests/cli/sweep.rs) has no token sweep, so nothing covers it.

**Suggested fix.** In sweep.rs, work out the default and the pre-check from seedelf_core::build::minimum_address_payment(&chain.params, &addr, &selected_tokens), which matches the builder, instead of address_minimum_lovelace_with_assets over all the tokens at once.

**Test idea.** In seedelf-cli/tests/cli/sweep.rs, fund the mock wallet with one UTxO holding 21 distinct tokens and run sweep with all 21 --asset entries and no --lovelace. Assert it builds, with the 21 tokens across two outputs at the address. It fails on HEAD.

**Skeptic (confirmed, low).** This holds on HEAD. When --lovelace is absent, the CLI's sweep pays a default worked out as the minimum for one output holding every token: address_minimum_lovelace_with_assets over all of selected_tokens. Since PR #321, the shared builder refuses anything below minimum_address_payment, which adds up the minimum of each 20-token output. For 21 or more distinct tokens that total is always above the one-output figure. Each output's minimum is (160 + its CBOR length) x coins_per_utxo_size, so every extra output pays the 160-byte overhead, the address and the lovelace field again: about 1 ADA. The CLI's default therefore always falls below the builder's floor, and `seedelf-cli sweep --asset <21 tokens>` with no --lovelace is refused with "A payment to that address with these tokens needs at least N ADA". The same happens when --utxo is given, since sweep_from goes through address_payment and pay_address too. Before the PR (e6b5dae51), minimum_address_payment and pay_address both covered one output, which matched the CLI. The CLI hasn't changed between e6b5dae51 and HEAD. Commit 1cd50dba and plan line 1093 record that the web wallet's minimum changes above 20 tokens. Nothing records that the CLI's default amount stops working, so this isn't an owner-call. Transfer has no default (it requires --lovelaces), so only sweep's default breaks. No money moves, the message is clear, and rerunning with a larger --lovelace works, so low.

Evidence: seedelf-cli/src/commands/sweep.rs:129-136 (address_minimum_lovelace_with_assets over all selected_tokens), :160 (args.lovelace.unwrap_or(address_minimum_lovelace)) -> build::sweep -> sweep_many_apart -> address_outputs (build.rs:3455-3464) -> address_payment -> pay_address: build.rs:3343-3354 refuses lovelace < minimum_address_payment, which sums token_chunks (build.rs:3306-3318, chunks of MAXIMUM_TOKENS_PER_UTXO = 20, constants.rs:95). transaction.rs:18-27: min = (OVERHEAD_COST + cbor_len) * coins_per_utxo_size. Pre-PR e6b5dae51 build.rs:3049-3058 (minimum_address_payment was one output) and 3067-3091 (pay_address was one output). `git log e6b5dae51..499768f6 -- seedelf-cli/src/commands/sweep.rs` is empty. tests/cli/sweep.rs only sweeps with --all and one token.

## 321-parts-worker#0

**low · confirmed · state** — After a lock, Home calls a payment in parts "confirmed" (a funding "funded") though its waiting parts were wiped and never go

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PendingBanner.tsx:270`

**Detail.** How it happens:
- A part Koios didn't answer is sealed together with its `chain`. That covers the last part Send sends and every part the pump sends (pending.ts:585 writes `chain` ahead; parts.ts:447 and parts.ts:589 set it).
- A lock or a closed browser wipes session storage, which takes the parts' record and the waiting parts with it (parts.ts:8-13). restoreNow (pending.ts:334-352) then puts the sealed part back in the watch.
- Home's poll finds no record: `parts.of(first)` returns undefined (handlers.ts:221-224). The banner gets a chain-named watch with no `parts`, so `left` = 0 and there's no parts line (PendingBanner.tsx:252-257).
- Once that part lands, the banner shows CONFIRMED (PendingBanner.tsx:270-282): "Private payment confirmed", or "Private session funded" for a funding the runner later finds short.
- If the part is never seen, `unseenPart` takes it for the last part (`went = total - 1`, PendingBanner.tsx:253). With two parts lost, the banner says "1 of 3 didn't go".
- nameParts (pending.ts:976-991) writes `chain` onto the watch in session storage only, never onto the sealed copy. A part named at Send therefore loses its `chain` at a lock.

This undoes the 1.6.0 review's banner-confirmed-over-partial fix in the lock case, and makes flows.md's "never 'confirmed'" false there.

**Scenario.** 1. Send 400 tokens to a Seedelf. It goes as 3 parts; the 2nd and 3rd wait.
2. The 1st lands. The pump sends the 2nd and Koios doesn't answer.
3. Before it settles, the wallet auto-locks (or the user locks, or closes Chrome).
4. After unlocking, the 2nd lands and Home says "Private payment confirmed".

The 3rd part was wiped and never goes. The recipient is a third short and nothing tells the user. The same happens when the part Koios didn't answer is the first part, sent at Send itself.

**Confirmed how.** Throwaway Vitest tests/zz-review-321-parts-worker-lockbanner.test.ts (now deleted). Steps:
- walletA(20): 3 parts.
- Send; the first part lands.
- The pump's submit of the 2nd is never answered.
- wallet.lock() then unlock(); the 2nd lands.

The banner printed "Private payment confirmed …", and the 3rd part was never submitted. The "1 of 3 didn't go" undercount for a part never seen comes from reading the code.

**Suggested fix.** Seal the parts' progress with the part itself. When parts are still to go after it, put `parts: {sent, total}` on the Sending/Watched record (sendParts' last go-now part, step's sends, nameParts) and seal it; nameParts should reseal too. In the pending-tx handler, a restored chain-named watch whose sealed `parts.sent < total`, with no parts' record left, should come back stopped: `stopped: "refused"`, sent = its `parts.sent`. Home then says "… only partly sent" with the right count.

**Test idea.** In parts-send-review-fixes.test.ts, build a 3-part chain, leave the pump's 2nd submit unanswered, lock and unlock.
- When the 2nd lands, `banner(await homeHears(s))` should contain "only partly sent" and "1 of 3 didn't go", and not "confirmed".
- When the 2nd is never seen, it should contain "2 of 3 didn't go".

Both fail today.

**Skeptic (confirmed, low).** This holds on HEAD, and I reproduced it.
- A part Koios didn't answer is written ahead and sealed with its `chain`. That covers the last part Send sends (parts.ts:589) and every part the pump sends (parts.ts:447; pending.ts:585, 614).
- A lock clears session storage (wallet.ts:702), which takes the parts' record and the waiting parts with it. restoreNow then puts the sealed part back in the watch (pending.ts:334-352).
- Home's handler finds no parts' record (handlers.ts:221-224), so `left` is 0, and the banner says CONFIRMED once the part lands (PendingBanner.tsx:252-257, 270-282).
- The 'never seen' undercount follows from PendingBanner.tsx:253: with no record, went = total - 1.

I lowered it to low. It needs two things at once: Koios not answering a part, and a lock or a closed browser before that part settles. It's also a sub-case of 10b's call 1, where a lock cuts the rest and Home says nothing; here that silence becomes a false 'confirmed'. The branch review gave the general banner-confirmed-over-partial no medium tag (plan line 1005). It does make flows.md:370's "never 'confirmed'" false in this case.

For a funding, the session isn't stuck. stillWaiting treats a wiped record as none (sessions.ts:5455-5461), so the funding goes short, and the session's page then contradicts the banner's 'Private session funded'.

Evidence: Throwaway Vitest tests/zz-review-321-parts-worker-skeptic-lock.test.ts, now deleted (git status clean).

A: walletA(20), 3 parts.
- The pump's submit of the 2nd is never answered. Before the lock, the watch holds the 2nd {maybeSent: true, chain: {first, total: 3}} and parts.of is {sent: 2, total: 3}.
- wallet.lock() then unlock(): the waiting record is undefined.
- The 2nd lands. homeHears gives {confirmations: 1, chain, no parts}, and the banner reads "Private payment confirmed 40dedc86e3…704a8c on Cardanoscan …".
- Three more pumps return false, and the 3rd is never submitted.

B: walletA(12), 2 parts.
- Koios doesn't answer the first at Send. Send answers {maybeSent: true, chain, parts: {sent: 1, total: 2}}.
- Lock and unlock; the first lands. The banner reads "Private payment confirmed …".
- The 2nd is never submitted.

Code: parts.ts:447, 589; pending.ts:585, 614, 334-352; wallet.ts:702; handlers.ts:221-224; PendingBanner.tsx:252-282.

## 321-parts-worker#1

**low · confirmed · ux-words** — Send again on a first part that may have gone says the rest didn't go and to review what's left, while the pump still sends it

At `seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts:596`

**Detail.** How it happens:
- Once Send returns with parts waiting, holdWaiting moves the later parts off Send's keys (parts.ts:346-351). While maybe sent, the first part stays kept with `partHashes` and `sentCbor`.
- Send again reads every hash (parts.ts:581-582). splitParts finds the later parts missing and returns goNow = total (parts.ts:204-205).
- The loop then fails one of two ways:
  - Koios still doesn't answer the resent first part: `worker.parts.partlyMaybe` (parts.ts:599).
  - It tries part 2 under Send's key, which script-spend.ts:383-386 refuses as not ready: `worker.parts.partly` (parts.ts:596).
- letGo leaves the pump's record as it is (parts.ts:256), so the waiting part still goes once the first lands.

parts-send-review-fixes.test.ts:462 models exactly this press and swallows the error.

**Scenario.** 1. A page missed Send's answer (say the worker restarted) and still shows the review.
2. The user presses Send again. It says "1 of 2 transactions went. The rest didn't: That payment isn't ready to send. Review it again. Review what's left again." (or "… so the rest wait. Once it's settled, review what's left again.").
3. The user reviews and sends the rest.
4. Once the first part lands, the pump also sends the waiting part.

The recipient is paid that share twice. The trigger is narrow: Send pressed again after holdWaiting ran.

**Confirmed how.** Throwaway Vitest tests/zz-review-321-parts-worker-sendagain.test.ts (now deleted), built on the shape of the test at :462. It printed both messages above. Afterwards the pump submitted the second part once (count 1).

**Suggested fix.** In sendParts, handle the case where Send's own copies of the later parts are gone and a parts' record for hashes[0] exists. Resend only the first part, if it's kept as sent. Then answer with the record's progress (`parts: {sent, total}`), or say the rest are on their way, instead of trying them and saying they didn't go.

**Test idea.** Extend the test at :462. The second submit should resolve (or its message shouldn't contain "Review what's left again") and report parts {sent: 1, total: 2}.

**Skeptic (confirmed, low).** The mechanics hold on HEAD.
- holdWaiting moves the later parts off Send's keys (parts.ts:346-351) while the first stays kept as maybe sent.
- Send again reads every hash (parts.ts:581-582). splitParts finds the later parts missing and returns goNow = total (parts.ts:204-205).
- The loop then ends in partlyMaybe (parts.ts:599). If Koios answers the resend, it ends in NOT_READY and then partly (script-spend.ts:383-386, parts.ts:596).
- letGo leaves the pump's record as it is (parts.ts:256), so the part still goes, once (parts-send-review-fixes.test.ts:462-487). The words 'The rest didn't' and 'review what's left again' are false there.
- When Koios answers the resend, `take` also drops the watch's `chain`, because the resent first part carries none. Home can then flash 'Private payment confirmed' until the pump sends part 2.

The trigger is narrower than the finding says.
- Send answers a maybe-sent first part without an error, and the page moves on (Transfer.tsx:164). A second press on the same review needs that answer lost after holdWaiting ran, for example the worker dying then.
- A second page can't hold the same review: each build makes a new one-time key and rewrites the keys.

The double payment is mostly blocked.
- The waiting part's inputs stay reserved (parts.ts:215), and readContract leaves them out (script-spend.ts:237-242).
- Building the same form again is refused with 'Your private balance waits for a payment still being sent in parts.'
- Only an ADA share the user types again by hand, paid from other UTxOs, could go twice.

Evidence: parts.ts:204-205, 256, 346-351, 581-582, 595-599; script-spend.ts:383-386, 237-242; pending.ts:367-382 (take replaces the maybe-sent watch with the chain-less record); Transfer.tsx:164-168. The messages are from en.json:
- worker.parts.partly: "{{sent}} of {{total}} transactions went. The rest didn't: {{why}} Review what's left again."
- worker.parts.partlyMaybe: "… so the rest wait. Once it's settled, review what's left again."

## 321-parts-worker#2

**low · owner-call · owner-call** — A lock or auto-lock silently cuts a payment's waiting parts; the lock countdown warns only of Lovejoin chains

At `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:178`

**Detail.** What the code does:
- Waiting parts live in session storage alone (parts.ts:8-13). This is 10b's call 1, still open for the owner (chunk-34 plan, line 1060).
- The lock countdown asks `chains-sending` (handlers.ts:178-181). That reads Lovejoin's chains only (lovejoin.ts:4733-4736), so "locking now stops it partway" (LockCountdown.tsx:152) never shows for a payment's parts.
- Auto-lock can be 1 or 5 minutes (shared/preferences.ts:76), and the pump doesn't put it off.
- Each waiting part needs its parent in a block plus a look: at least 15 s while Home is open, a minute on the alarm. A chain of a few parts outlasts a short lock time.
- After the unlock nothing is said, because the record is gone. Activity lists only the parts that went.

**Scenario.** 1. Auto-lock is set to 5 minutes.
2. A Max over a move-in's 300 bundles goes as about 15 parts, most of them waiting. The user closes the popup.
3. The wallet locks about 5 minutes in, after roughly half the parts went.

The recipient has about half. The rest stays in the private balance, and on unlock Home says nothing. For a funding cut this way, the session ends "Not fully funded", and its fees and the return's are paid for nothing.

**Confirmed how.** Read the code.

**Suggested fix.** This is the owner's call (10b call 1). Either fix is cheap:
- Have `chains-sending` also answer true while a parts' record isn't stopped (parts.ts `waitingOn`), with words for a payment's parts.
- Keep a sealed note that parts were waiting, so Home can say after the unlock how many didn't go.

**Test idea.** Worker test: with a payment whose parts wait, handle({type: "chains-sending"}) returns true. LockCountdown screen test: the parts line shows.

**Skeptic (owner-call, low).** 10b's call 1 records exactly this trade (plan line 1060):
- what waits lives in session storage;
- a lock or a closed browser stops the rest, which never go, and what they'd have spent stays private;
- the review asks the user to keep the wallet unlocked;
- 'a sealed record would let Home say after an unlock that they didn't go'.

flows.md:369 says the same: 'A lock wipes what waits'. The code matches. `chains-sending` asks only about Lovejoin's chains (handlers.ts:178-181, lovejoin.ts:4733-4736), so the countdown's 'locking now stops it partway' line (LockCountdown.tsx:152) never shows for a payment's parts, and auto-lock doesn't wait for them.

The one thing the call didn't weigh is that countdown line. With the default 15-minute auto-lock (shared/preferences.ts:165), and a minute or two per part on the minute alarm with the popup closed (sw.ts:87), a long chained payment such as a token-heavy Max is likely to be cut. Nothing is said after the unlock. The recipient gets part of the payment, and the rest silently stays in the private balance.

A funding isn't stuck: stillWaiting treats the wiped record as none, so the funding goes short and offers Bring it back (sessions.ts:5455-5461).

Cheap fix: have `chains-sending` also answer true while a parts' record isn't stopped, with words for a payment's parts.

Evidence: docs/plans/chunk-34-token-pools.md:1060 (10b call 1); docs/flows.md:369; handlers.ts:178-181; lovejoin.ts:4733-4736; LockCountdown.tsx:80, 152; en.json lock.warn.chainSending = "A Lovejoin chain is being sent: locking now stops it partway."; shared/preferences.ts:76, 165; sw.ts:87; sessions.ts:5455-5461.

## 321-parts-worker#3

**low · confirmed · state** — A later part's inputs are checked for "spent since" and reservations only as it goes, after earlier parts went

At `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:401`

**Detail.** What the code does:
- send() runs refuseSpentSince (script-spend.ts:401) and refuseReserved (script-spend.ts:426) only for the one transaction it's sending.
- sendParts (parts.ts:588-600) and sendFunding (sessions.ts:5361-5374) reach a later part's checks only after the first part went. The pump's waiting parts reach theirs later still.
- A session return's chain built before the payment's Send checks only spentSet at its own Send (sessions.ts:4559-4562), not the parts' reservations. It can therefore merge a funding change that a waiting part reserved after the return was built.

**Scenario.** 1. Make public is reviewed in one window and a Send in parts in another (they use different keys). Both use a UTxO that Send's second part spends.
2. Make public goes first.
3. Send's first part goes; the second is refused as spent since.

The payment ends partly sent and the user has to work out the rest. Refusing the whole review at Send ("Refresh and review again") would have sent nothing. A Bring it back reviewed before the payment went gives the same result.

**Confirmed how.** Read the code.

**Suggested fix.** Before the first part goes, run refuseSpentSince and refuseReserved over every kept part (excepting the payment's own `parts.<first>`), and refuse the whole review as stale. In sendChain, also refuse inputs held in other chains' reservations (reservedSet, excepting its own).

**Test idea.** Build a Send in 2 independent parts and a Make public that spends part 2's UTxO. Send Make public, then the Send. Expect a stale refusal with nothing submitted; today part 1 is submitted and the user sees "1 of 2 transactions went".

**Skeptic (confirmed, low).** This holds on HEAD.
- send() runs refuseSpentSince and refuseReserved only on the one transaction it's sending (script-spend.ts:401, 426).
- sendParts and sendFunding reach a later part's checks only after the parts before it went (parts.ts:588-600, sessions.ts:5361-5374).
- A session return's sendChain checks spentSet only, not reservations (sessions.ts:4559-4562).

Two reviews in two windows can share a UTxO that a later part spends. Then the first part goes and the rest is refused, where 1.5.0's single transaction was refused whole with nothing sent.

The user is told in words: "1 of 2 transactions went. The rest didn't: Another of your transactions spent part of it since this review. … Review what's left again." Home then says 'only partly sent'. Nothing is lost.

I checked both orders with a session return: neither breaks the return's chain.
- If the waiting part goes first, its inputs are written ahead as spent, so the return is refused whole (sess.spentSince).
- If the return goes first, its reservation makes the waiting part refused (refuseReserved). The payment then stops partly sent, and Home says so.

flows.md:381 ('one of the review's inputs spent since … nothing is sent') is false for a later part. Low: it needs two concurrent reviews.

Evidence: script-spend.ts:401, 426, 568-579, 588-601; parts.ts:588-600; sessions.ts:5361-5374, 4559-4562; pending.ts:602 (writeAhead's rememberSpent); docs/flows.md:381.

## 321-parts-worker#5

**low · owner-call · ux-words** — The review's Transaction details opens only the first part

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:240`

**Detail.** What the code does:
- Send, Make public and the funding approvals pass `summary.txHash` to Transaction details. whole() keeps the first part's hash (script-spend.ts:490-491).
- tx-view's BUILT_KEYS (tx-view.ts:82-99) has no `partKey` or `waitingPartKey` keys.

So nothing on a review can open parts 2..N. Their outputs (each part's share, and the carry to the wallet's own register) aren't shown anywhere before Send signs them all.

**Scenario.** A review says "Transactions: 3". Transaction details shows one transaction paying a third of the amount. The user can't check the other two before signing them.

**Confirmed how.** Read the code.

**Suggested fix.** List the parts on the review (reviewParts already has each one's hash, fee and inputs) with a details button each. Let tx-view look in `partKey(key, i)` and `waitingPartKey`.

**Test idea.** Screen test: a review with parts renders a details button for each part. tx-detail for parts[1].txHash returns that part's CBOR.

**Skeptic (owner-call, low).** This is accurate on HEAD.
- Transfer.tsx:240 and Withdraw.tsx:225 pass summary.txHash, which is the first part's (script-spend.ts:490-491).
- tx-view's BUILT_KEYS (tx-view.ts:82-99) holds no partKey or waitingPartKey.

But the branch review's fix round recorded it as not fixed, 'a feature for later' (plan line 1028, parts-details-first-only).

No money on the review goes unreviewed: its rows add every part up (script-spend.ts:477-508), with a Transactions row. What can't be opened is the decoded bytes of parts 2..N.

One cheap gap goes beyond what was recorded. The button keeps the plain 'Transaction details' label. The owner's rule for a chain's review is that the button says which transaction it opens (flows.md:271: 'Transaction details' is a lie where there are several). A 'the first part's' label would make it true.

Evidence: Transfer.tsx:240; Withdraw.tsx:225; script-spend.ts:477-508; tx-view.ts:82-99; docs/plans/chunk-34-token-pools.md:1028 ('Not fixed: parts-details-first-only: a review in parts opens only part 1's details. A feature for later.'); docs/flows.md:271; Lovejoin.tsx:2543 (a chain's labelled button, by contrast).

## 321-parts-worker#6

**low · confirmed · ux-words** — Max's "stays for another payment" line gives the wrong reason when Max in parts left UTxOs whose part couldn't pay its fee

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:257`

**Detail.** What the code does:
- When a part can't pay its fee and no chain can either, max_in_parts sends what went (wasm/src/lib.rs:4323 and 4348). So `left` > 0 can now mean "no ADA to pay for these".
- The screens only choose between "won't fit in one output" and "a payment takes {{max}} at most" (Transfer.tsx:257-267, Withdraw.tsx:245-255).
- If Max ends as one part of 20 inputs, `summary.parts` is unset, so it says "a payment takes 20 at most". In 1.6.0 that's untrue: a payment takes 500.

**Scenario.** Max with a little ADA and many token bundles holding only their least. The review says "12 private UTxOs stay for another payment: each holds a token that won't fit in one output with the rest." The real reason is that nothing pays their fee.

**Confirmed how.** Read the code. The planner's behaviour comes from its own comments; not run.

**Suggested fix.** Have WebAssembly's parts result say why it left UTxOs (for example a `leftWhy`), and give the screens a third line for "can't pay their own fee".

**Test idea.** Max on one small ADA UTxO plus 40 bundles at their least. Expect left > 0 with the reason "fee", and the screen showing its words.

**Skeptic (confirmed, low).** This holds on HEAD.
- When a part can't pay its fee and no chain can either, max_in_parts sends what went (lib.rs:4322-4351). `left` is every UTxO no part spent (lib.rs:4352-4362).
- The screens have only two reasons: "each holds a token that won't fit in one output with the rest." and "a payment takes {{max}} at most, and some tokens won't fit in one output." (Transfer.tsx:257-267, Withdraw.tsx:245-255).
- With one part, `parts` is unset (transfer.ts:160-162). A first part of 20 inputs then reads 'a payment takes 20 at most', which is false in 1.6.0, where Max takes 500 (script-spend.ts:445-449).

The real reason, that nothing pays their fee, is never said. These are misleading words with no money at risk: another Max over those UTxOs is refused anyway. I didn't run it, since it's low.

Evidence: wasm/src/lib.rs:4276-4364 (max_in_parts: failed, then max_chained anchors, then `if !went && parts.is_empty()`; left = without(utxos, spent)); extension/src/ui/screens/Transfer.tsx:257-267; Withdraw.tsx:245-255; transfer.ts:160-162; script-spend.ts:445-449; en.json withdraw.leftTokens and withdraw.leftLimit.

## 322#0

**low · confirmed · privacy** — Details suggests "a report to Minswap" but never says the transaction ties whoever sends it to the swap's one-time account

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:3112`

**Detail.** The note `swaps.retry.cbor` (en.json:2365: "The transaction Minswap built, {{bytes}} bytes of CBOR, never signed: for a report to Minswap.") sits next to Copy (Swaps.tsx:3111-3117) and invites the user to send the transaction somewhere. The CBOR names the session's one-time account: its inputs are the funding's outputs, and its change, any order datum and Minswap's CIP-20 note carry the account's address. On chain, that funding spends registers from the private balance and leaves change there. The privacy policy says so itself (store/privacy-policy.md:27: "anyone can follow its funding back into your private balance"). Everywhere else the wallet hands off something that has this effect, it warns. The same timeline shows `explorer.privacy.transaction` (en.json:640, "Opening this tells Cardanoscan and your browser history that this transaction is yours", via ExplorerNote at Swaps.tsx:3130). The GitHub links say an issue you open is public (privacy-policy.md:63, privacy.md:132). Minswap itself learns only the reporter's contact identity, since it built the transaction and saw the IP address. A public support channel learns all of it. Nothing is sent by the wallet: this is a missing warning on an action the wallet suggests, in a rare case.

**Scenario.** On mainnet a route through Danogo fails on Minswap's side. The user opens Details, presses Copy and, as the note suggests, pastes the hex into Minswap's public Discord support channel under their usual handle. Anyone there can decode the one-time account, follow its funding on chain into the Seedelf contract, and learn which register UTxOs, spent and change, belong to that person. Nothing on screen said the transaction could be traced back to them.

**Confirmed how.** Read the code: Swaps.tsx:3108-3119, en/es/ja swaps.retry.cbor, against privacy-policy.md:27/63, privacy.md:131-132 and 185-186, en.json:640.

**Suggested fix.** Add a line under the note, under a `.privacy.` key so it joins the critical set and es/ja get checked by a person. For example: "It names this swap's one-time account: whoever sees it can tie that account, and the private balance that funded it, to you. A report in a public channel is public." Or drop "for a report to Minswap", so the wallet doesn't suggest it.

**Test idea.** In the e2e private-swap step after Details is opened, expect(retry).toContainText("whoever sees it can tie"). Or render the session page with a retry carrying `cbor` (renderToStaticMarkup, as swap-hidden-balances.test.ts does) and assert the privacy key's words appear next to the copy chip. Both fail today.

**Skeptic (confirmed, low).** This holds up. Minswap builds the transaction for the session's one-time account (buildTx(address, ...) sends `sender: address`). So the CBOR names that account: its inputs are the funding's outputs, and its change and order or Minswap note carry the account's address. The account's funding is a Seedelf spend on chain, which the policy itself says anyone can follow. The note's words 'never signed: for a report to Minswap' invite sharing it and suggest that's harmless, and nothing nearby says that whoever sees it next to your name can tie you to that funding's registers and change. When the wallet's own exports tie private items together, it adds a `.privacy.` note: the Activity CSV and Cardanoscan on a private transaction. It isn't an owner-call. flows.md:481 and architecture.md:646 record the 'for a report' design, but nothing shows the privacy side was weighed. One thing to temper: the reviewer's 'everywhere else it warns' goes too far. TxDetail's Copy CBOR on private reviews has no privacy note, but it doesn't suggest sending the transaction anywhere. The wallet sends nothing, and Minswap already holds the CBOR and the IP address. The harm needs a rare build failure plus the user posting it somewhere public. That's narrow, so low.

Evidence: Swaps.tsx:3108-3119 (note at 3112, CopyButton 3113); en.json:2365 swaps.retry.cbor (es.json:2498, ja.json:2232 the same); minswap.ts:352-358 (build-tx with sender = session address), sessions.ts:2838; store/privacy-policy.md:27 ('anyone can follow its funding back into your private balance'); privacy.md:186 (Minswap's CIP-20 note names the account); precedent en.json:69 activity.export.privacy.private and en.json:640 explorer.privacy.transaction; counter-precedent TxDetail.tsx:199 with hint en.json:2734 (no privacy line, no suggestion to share).

## 322#1

**low · confirmed · correctness** — The CBOR sits inside the retry line's aria-live region, so with Details open each new failure reads thousands of hex characters aloud

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:3095`

**Detail.** `<div className="timeline__now timeline__now--retry" data-testid="session-retry" aria-live="polite">` (Swaps.tsx:3095) wraps the `<details>` and its `<pre>` of `auto.retry.cbor` (3108-3119). While the page is open it advances every 20 s (Swaps.tsx:2003, 2092-2097). The runner rebuilds after 30 s, doubling to 5 min (sessions.ts:252, 3213-3216), and each failing build typically returns a different transaction (a fresh quote and validity interval), stored in place of the last (sessions.ts:3216). React updates the `<pre>`'s text node in place, and the uncontrolled `<details>` stays open, because the Timeline isn't remounted (Swaps.tsx:2436). A text change inside a polite live region is announced, so a screen reader reads the whole new hex: about 8,000 characters for a 4 KB transaction, up to 32,000 for 16 KB. While Details is closed its content isn't in the accessibility tree, so this happens only after it's opened, and opening it is how a screen-reader user reaches Copy.

**Scenario.** A screen-reader user opens Details, presses Copy and leaves it open. A few minutes later the retry fails again with a new transaction, and NVDA or VoiceOver starts reading "8 4 a a 0 0 …" for minutes, drowning out the page until they move away.

**Confirmed how.** Read the code: the live region at Swaps.tsx:3095 contains the details/pre at 3108-3119; the page's 20 s advance loop and the runner's replacement of retry.cbor.

**Suggested fix.** Keep the live region to the words. Put `aria-live="polite"` on the `<p>` with the reason and time (and the error line), or give the `<details>` `aria-live="off"`, or render the `<details>` after the live div.

**Test idea.** In the e2e private-swap step, after Details is opened, assert `await cbor.evaluate((el) => el.closest('[aria-live]')?.getAttribute('aria-live') ?? 'off')` is "off". It returns "polite" today.

**Skeptic (confirmed, low).** The code is as described. The retry line's container is a polite live region, and it holds the <details> with its <pre> of the hex. Timeline is rendered without a key, so a new view re-renders it in place, and the uncontrolled <details> stays open. The page advances every 20 s while the swap runs. Each failure replaces the whole retry, a new cbor included, and a rebuild asks Minswap afresh, so the transaction differs. Under ARIA's default aria-relevant ('additions text'), React swapping the <pre>'s text is announced, so the whole new hex gets read aloud. This happens only after Details is opened, since a closed <details> isn't rendered into the accessibility tree. The UI has only three aria-live regions and the docs set no rule, so this isn't a deliberate choice. It's a narrow accessibility problem with nothing about money or privacy, so low. The fix is simple: keep aria-live on the reason <p>, or put the <details> outside the live div. I didn't run a screen reader; the ARIA live-region rules settle it.

Evidence: Swaps.tsx:3095 (div.timeline__now--retry aria-live="polite") containing 3108-3119 (details/pre data-testid=session-retry-cbor); Swaps.tsx:2436 (<Timeline> with no key); Swaps.tsx:2003 ADVANCE_EVERY_MS = 20_000 and 2092-2097 setInterval; sessions.ts:3213-3216 (auto.retry replaced, cbor included); sessions.ts:252 retryAfterMs 30 s doubling to 5 min; aria-live uses in src/ui: Swaps.tsx:3095, 3124, BuildStage.tsx:35 only.

## 323-rust#1

**low · confirmed · correctness** — The 1.5 ₳ tail reserve covers the collateral's mix only on a chain; a direct return needs about 2.7 ₳ of ADA beside the collateral

At `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1600`

**Detail.** COLLATERAL_TAIL_RESERVE's doc (mod.rs:1593-1599) says it pays for three things: the deposit (~0.18 ₳), the mix under giveme.my's collateral (planned at 0.95 ₳) and the sweep after it, whose Seedelf output must hold its least. Measured, those come to 0.174 + 0.831 + (0.171 + 1.457) ≈ 2.63 ₳, well over 1.5 ₳. On a chain it works, because what DEPOSIT_RESERVE leaves after the chain pays the sweep's least: the measured margin is 0.32 ₳ for one box three wide, 0.33 ₳ four wide, and more when mixing again. A direct return is different. `direct_tail` (wasm lovejoin.rs:335-384) pays the deposit and the mix only from the session's ADA-only UTxOs besides the collateral, which is the reserve plus whatever is left. The worker adds the reserve to a swap's funding, a site's and a top-up's (sessions.ts:1752, 1837, 2047). Those sessions mostly come back directly, because their spare after the reserve doesn't pay for a 10 ₳ box. With nothing else left, the tail's mix change falls under the least, or its sweep under 1.457 ₳, and `.ok()` drops the tail without a word. The collateral then comes back with the rest, as privacy.md's "too little left to pay for it" fallback says, but the reserve was added to prevent exactly that.

**Scenario.** A 5 ₳ pool is shown and the user swaps ADA for a token through a private session. The funding review says "For its collateral's mix: 1.5 ₳, and what it doesn't use comes back". After the fill, the session holds the 5 ₳ collateral, the swap's ADA change (the 1.5 ₳ reserve plus, say, 0.5 ₳) and the token output. Its return comes back directly, and with under about 1.2 ₳ beyond the reserve no tail is built. The 5 ₳ collateral goes back into the private balance under the session's history, which is what the reserve was paid to avoid. No money is lost, since the 1.5 ₳ comes back.

**Confirmed how.** Read the code, then a throwaway wasm test zz_review_323_rust_direct (deleted). It called api::session_return with utxos [the reserve + extra of ADA alone, the 5 ₳ collateral], the verified 5 ₳ pool and three strangers' boxes. With extra = 0, 0.5, 1.0, 1.1 and 1.15 ₳ no tail was built. With 1.2 and 1.5 ₳ the tail was built (deposit and mix 1.004 ₳).

**Suggested fix.** Size the reserve for a return that comes back directly: deposit + giveme.my's mix + max(least change, sweep fee + Seedelf least). That is about 2.8 ₳ at today's parameters, ideally computed in WebAssembly from the parameters. The swap, site and top-up fundings would take that amount, and a mix session would keep 1.5 ₳, since its chain's DEPOSIT_RESERVE covers the sweep. Then correct the constant's doc. Or keep 1.5 ₳ and have the funding row say the collateral is mixed only when enough is left at the return.

**Test idea.** A wasm test: session_return with only the 5 ₳ collateral and the swap/site reserve of ADA alone (what's left when the rest is spent) builds a tail. It fails today with 1.5 ₳.

**Skeptic (confirmed, low).** The technical claim holds, and it's even a little worse than stated. mix_with drafts the tail's mix at a 1 ₳ fee and needs the change to stay ≥ least_change (~0.98 ₳). So a direct return's ADA-only payers beside the collateral must be ≥ ~2.16 ₳ before the mix can be drafted at all, and ≥ ~2.65 ₳ when nothing else is there to carry the sweep's 1.457 ₳ least. The 1.5 ₳ reserve alone never builds a direct return's tail. COLLATERAL_TAIL_RESERVE's doc, which says the reserve pays the deposit, the mix and the sweep's least, is false: on a chain it's DEPOSIT_RESERVE's leftover that pays the least. The reviewer's swap scenario is overstated, though. A swap's funding also carries SWAP_MARGIN (2 ₳), so after an order's ~0.2–0.4 ₳ fee there's about 1.6–1.8 ₳ beside the reserve. With its fill there to carry the sweep, a swap needs only ~0.7 ₳ beyond the reserve, so a typical swap's direct return does build the tail. The real misses are a site session or top-up whose site spent everything but the reserve, or a direct pool swap with no separate ADA-only change. What happens then is the documented fallback: the 5 ₳ comes back with the rest (privacy.md lists "too little left to pay for it"), and the 1.5 ₳ comes back too. No money is lost, and the funding row's words stay true. On mainnet the whole tail is dormant until a 5 ₳ pool holds 30 other people's boxes, since tailReserve returns 0. Correcting the doc is the safe fix. Resizing the reserve to ~2.7 ₳ for swap/site/top-up fundings goes against the owner's "adds about 1 ₳" call, so that part is for the owner to decide.

Evidence: HEAD mod.rs:1593-1600 (the doc's claim); mod.rs:896 and :991 (least_change; draft staged at a 1_000_000 fee, so the payer must have ≥ 1 ₳ + least); wasm lovejoin.rs:335-384 (direct_tail pays only from the ADA-only UTxOs beside the collateral); lib.rs:1415-1447 (session_return's .ok() falls back). Throwaway test (deleted) of api::session_return with the 5 ₳ pool and 3 strangers' boxes, utxos [1.5 ₳ + extra ADA alone, 5 ₳ collateral]. With nothing else: no tail for extra 0 to 1.15 ₳, a tail from 1.2 ₳ (tail fee ~1.004 ₳). With a 2 ₳ token UTxO beside it: no tail for extra up to 0.5 ₳, a tail from 0.7 ₳. Swap margin: sessions.ts:198 (SWAP_MARGIN 2 ₳) and :844 (quoteOf adds it to fund). Fallback documented: privacy.md:217. Row words: en.json:1008-1009. Dormant on mainnet: sessions.ts:4323-4327. Owner's sizing: chunk-34-token-pools.md, Session 11 "The owner's calls" ("adds about 1 ₳"; "back with the rest where the tail can't be built at review").

## 323-worker#0

**low · confirmed · money** — Where a 5 ₳ pool is shown, every funding takes 1.5 ₳ more than its form checks, and nothing falls back without it

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1752`

**Detail.** tailReserve adds COLLATERAL_TAIL_RESERVE (1.5 ₳) to the first payment of four fundings: a swap's (sessions.ts:1752, 1761), a site's (1837, 1843), a mix's (1961, 1968), and a top-up that pays a new collateral (2047-2048). None of the forms that decide what can be funded knows about it:
- the swap form's Max (ui/swap.ts:116-122 maxAdaIn keeps aside only the costs, the collateral and FEE_ROOM 1 ₳);
- its shortfall check (swap.ts:147-150 adaShort; Swaps.tsx:745-747);
- the Mix form's stepper (Lovejoin.tsx:253-263 boxesAffordable, 283 mixMost: COLLATERAL + FEE_ROOM).

The worker never drops the reserve either. outBuild falls back only for a token's boxes (sessions.ts:1779 `if (!lovejoin?.fund || mendable) throw e`), and the others have no fallback at all, so buildFunding refuses with sess.notEnoughPrivate.

Context from before this PR: FEE_ROOM (1 ₳) never covered the funding's fee plus its change's least (about 1.52 ₳, measured below). Max already failed whenever wholeUnits' rounding left less than about 0.5 ₳. With the reserve, a funding needs about 3 ₳ of slack, and Max leaves under 2 ₳.

This is dormant on mainnet until a 5 ₳ ADA pool holds 30 other people's boxes. It is live on preprod (floor 0) once a 5 ₳ pool is shown.

**Scenario.** Preprod, a 5 ₳ pool shown with two other people's boxes. A user swaps 10 ₳ to MIN (fund 16 ₳) holding 23 ₳ private, an amount 1.5.0 funds and 1.6.0 funds with no pool. The form shows no shortfall, but Review answers "Not enough ADA in your private balance for this, its fee and the change." Pressing Max on any balance builds an amount that Review refuses every time. The Mix form's stepper can likewise offer a count whose Review is refused.

**Confirmed how.** Throwaway Vitest tests/zz-review-323-worker-max.test.ts (deleted after). It used the recorded preprod quote (ask 10 ₳, fund 16 ₳, collateral 5 ₳) with the private balance set to fund + 5 ₳ + extra.
- No 5 ₳ pool: outBuild was refused at extra 1.0 and 1.5 ₳, and funded from 2.0 ₳ (fee 0.233 ₳).
- A launched 5 ₳ ADA pool with two strangers' boxes: refused at every extra up to 3.0 ₳, funded at 3.5 ₳, with collateralReserve 1500000 and payments[0] 17.5 ₳.
- maxAdaIn(fund + 5 ₳ + 1 ₳) returned the ask's 10 ₳.

**Suggested fix.** In outBuild, siteOutBuild, mixFunding and topUpBuild: when the funding built with the reserve throws NotEnoughPrivate, build it again with a reserve of 0 and no tailReserved/collateralReserve, as outBuild already does for a token's boxes. The tail is then paid from what's left, or the collateral comes back with the rest.

Also keep the reserve aside in the forms where a 5 ₳ pool is shown, and make FEE_ROOM cover the fee and the change's least.

**Test idea.** Worker test: preprod, a 5 ₳ pool with two strangers' boxes, private balance = quote.fund + 5 ₳ + 2 ₳. outBuild should resolve; today it rejects with sess.notEnoughPrivate. Also check that the amount maxAdaIn gives builds.

**Skeptic (confirmed, low).** The facts hold on HEAD. tailReserve adds 1.5 ₳ to the first payment of the swap, site, mix and new-collateral top-up fundings. quoteOf's quote.fund never includes it, so maxAdaIn, adaShort and the Mix stepper (COLLATERAL + FEE_ROOM) don't count it. outBuild falls back only for a token's boxes, and its reserve is computed outside fund(), so it stays in the retry too. siteOutBuild, mixFunding and topUpBuild have no fallback at all. I lowered it to low: nothing is lost, locked, misdirected or signed, the refusal (sess.notEnoughPrivate) is true, the way out is easy (a smaller amount, or Settings' collateral switch), and it's dormant on mainnet until a 5 ₳ ADA pool holds 30 boxes that aren't the user's. Where it is live, users would see this: Max on an ADA swap gives an amount Review always refuses, since Max leaves FEE_ROOM 1 ₳ plus under 1 ₳ of rounding, while the funding now needs its fee, its change's least and 1.5 ₳. A balance within about 1.5 ₳ of what 1.6.0 funds with no pool is refused. Mix my boxes again, whose count the worker picks, can only be mended by making more ADA private. Max's slack was already marginal before #323 (FEE_ROOM doesn't cover fee plus change least), but the reserve turns sometimes into every time. The suggested fallback (build again with reserve 0 on NotEnoughPrivate, as the token-box fallback does) fits Claude's recorded call 3 in Session 11 (a session without the reserve still gets its tail if the change pays).

Evidence: sessions.ts:1752,1761 (outBuild reserve), 1773-1782 (fallback only `if (!lovejoin?.fund || mendable) throw e`, reserve kept), 1837/1843, 1961/1968, 2045-2049, 4323-4328 (tailReserve), 843-863 (quoteOf: fund excludes it), 2711 (NotEnoughPrivate); ui/swap.ts:104 (FEE_ROOM 1 ₳), 116-122 (maxAdaIn), 147-150 (adaShort); Swaps.tsx:745-751; Lovejoin.tsx:253-263, 282-283; en.json:1783

## 323-worker#2

**low · confirmed · state** — A return held back for its collateral's mix gives a false reason and "try again in a minute" for up to a day, with no way to bring it back directly

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3524`

**Detail.** tailChain answers "wait" in four cases:
1. the 5 ₳ pool isn't in the read set (3524);
2. Koios doesn't answer whether the deposit is in (3530);
3. the deposit isn't in yet, within TAIL_UNLANDED_MS (3532);
4. WebAssembly says "pool has N boxes": too few free boxes to draw (3556).

buildBack throws lj.tail.waiting for all four (sessions.ts:4125): "Its 5 ₳ collateral's box isn't in Lovejoin's pool yet, and its mix goes before anything comes back. Try again in a minute." (en.json:915). In cases 1 and 4 the box is in the pool, and the wait lasts until tailOf's TAIL_KEEP_MS, a day from landed or ended (3497).

There's no way around it in the meantime:
- tailChain runs for every started return not built `direct` (sessions.ts:4122), whatever Settings' lovejoinReturns and lovejoinCollateral say.
- A site session's page builds through Lovejoin only (SiteSessions.tsx:304); the directly switch lives on the review, which the throw never opens.
- Bring everything back shows its directly switch only when a built return has boxes (ClaimAll.tsx:286).

So a by-hand session whose only return waits can't come back directly until the wait ends.

**Scenario.** Preprod, a thin 5 ₳ pool. A site session's chain stopped at its collateral's mix (giveme.my refused, or a box it drew was spent), and another chain of the wallet holds the pool's last free boxes. For up to 24 hours, Bring it back answers that the box "isn't in Lovejoin's pool yet... Try again in a minute", although the box is in the pool, and nothing on the page brings the session's ADA back directly. The likelier case, a lock right after the collateral's deposit was sent and a dropped deposit, holds it for an hour.

**Confirmed how.** Read the code: every "wait" return in tailChain, buildBack's throw, the site page's buildBack(true), and ClaimReview's switch condition.

**Suggested fix.** Give each case its own words (pool not readable, too few boxes to draw, deposit not in yet) and say how long it can last. Let a direct return through when the user asks: offer the directly path on the session page (or always show Bring everything back's switch) when a return was held for this reason. Consider treating Settings' switches being off as a direct ask in tailChain.

**Test idea.** Planner test: stoppedAtMix(), then reserve the 5 ₳ pool's free boxes under another owner. backBuild should reject with words that don't claim the box is missing from the pool, and backBuild(..., direct = true) should resolve.

**Skeptic (confirmed, low).** This holds. tailChain answers 'wait' in four cases: the 5 ₳ pool isn't in the read set, Koios doesn't answer, the deposit isn't in yet within the hour, or WebAssembly's PoolShort ('pool has N boxes'). buildBack turns all four into lj.tail.waiting: '…box isn't in Lovejoin's pool yet… Try again in a minute.' In the PoolShort case the box is listed (split.owned has it, and `landed` was just set before the build), so the words are false, and the wait runs until free boxes appear or TAIL_KEEP_MS after `landed`. tailChain runs for any started return not built direct, whatever Settings' lovejoinReturns or lovejoinCollateral say. A site's page builds through Lovejoin only: buildBack(true) sends no `direct`. Its directly switch lives on the review, which the throw never opens. Bring everything back shows its switch only when some built return has boxes, although buildBack(direct=true) would skip tailChain and sweep. Holding the rest back is documented (privacy.md; the owner's hour for an unlanded deposit and day for giveme.my), so the defect is the wrong reason plus no direct way out. Low: it bites in thin pools (preprod) or when discovery drops the pool. Mainnet's floor of 30 makes PoolShort on a rebuild unlikely, and the hold ends by itself within a day.

Evidence: lovejoin.ts:3523-3524, 3529-3532, 3537 (landed set before build), 3554-3556, 3492-3501 (TAIL_KEEP_MS); sessions.ts:4122-4125; en.json:915; SiteSessions.tsx:224-226, 304; ClaimAll.tsx:286; seedelf-core/src/lovejoin/mod.rs:2071, 2128-2134 (PoolShort)

## 323-worker#3

**low · owner-call · owner-call** — While giveme.my is busy or out of reach, a session's return sits at its collateral's mix for up to a day, and no screen says why

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4800`

**Detail.** witnessTail keeps waiting (backing off from 1 to 30 minutes) on any CollateralError except a non-busy refusal past GIVEME_BEHIND_MS, and on any KoiosError. It stops only at TAIL_KEEP_MS, a day after the deposit landed (4783-4806). The day is the owner's call (chunk-34 Session 11).

Throughout, the chain's progress stays pending:
- buildBack and sendChain throw sess.chainSending ("still being sent. Wait for it to finish.", 4055-4056, 4553-4554);
- disconnect throws sess.chainSendingDisconnect (2208-2209);
- Stop on a mix only pumps the chain (act, 3230);
- the session's line reads "Sending N of M transactions" (LovejoinReturn.tsx:119).

witnessAfter and witnessWait never reach a view (no rpc field), so nothing names giveme.my, the next try, or the day's limit.

**Scenario.** giveme.my answers 503 for six hours after a site session's collateral's deposit lands. All that time the page says "Sending 5 of 7 transactions", and Bring back and Disconnect say to wait for it to finish. Only a lock changes anything: it cuts the chain and uses up one of the two tries.

**Confirmed how.** Read the code: witnessTail's catch, pumpChain returning false, the refusal sites, chainText; there is no view field for the wait.

**Suggested fix.** Show the wait (for example, a chain-view field for the giveme.my wait with its next try) in words such as: "Waiting for giveme.my to back its collateral's mix; tried again at …; after a day the rest comes back without it." Consider letting the user end the wait from Bring back (tailOver and drop the pending chain).

**Test idea.** Planner test: setUp, backSubmit, confirmations 1, giveme.my returning 503. Assert the session's view names the giveme.my wait; today no field carries it.

**Skeptic (owner-call, low).** The code matches the finding. witnessTail backs off (1 to 30 minutes) on any CollateralError except a non-busy refusal past GIVEME_BEHIND_MS, and on any KoiosError, until TAIL_KEEP_MS. Meanwhile the pending chain makes buildBack and sendChain refuse with sess.chainSending and Disconnect with sess.chainSendingDisconnect, and Stop on a mix only pumps. SessionView.chain has no field for the wait, so the line reads 'Sending N of M'. The day's hold for a landed deposit waiting on giveme.my, and the doubling waits, are the owner's own calls ('The owner's calls on what the review left', 1 and 2), not Claude's. A lock doesn't help either: the rebuild waits on giveme.my again and keeps the day from the same `landed`. What the owner didn't weigh is only the words: nothing names giveme.my, the next try, or the day's limit. The money stays at the one-time account and comes back once the day is out (lj.tail.tooLong, then tailOver). It's worth a chain-view field and one line, but the behaviour is the owner's.

Evidence: sessions.ts:4780-4806 (witnessTail), 680 (TAIL_WITNESS_WAIT_MS), 4055-4056, 4553-4554, 2208-2209, 3230; shared/rpc.ts:1775 (chain view: total, sent, confirmed, cut, stopped); ui/components/LovejoinReturn.tsx:115-122 (chainText); docs/plans/chunk-34-token-pools.md:952-954

## 323-worker#4

**low · confirmed · correctness** — A Bootstrap whose one funding UTxO is exactly 5 ₳ of ADA is taken for its collateral, and comes back without going in

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4160`

**Detail.** buildBack picks `rows.find((u) => collateralFits(u) && u.tx_hash === funding) ?? rows.find(collateralFits)` (4159-4160) for every session, a Bootstrap's included, and passes it to lovejoin.chain (4175-4179).

Since 62162483, a Bootstrap's funding is one UTxO of boxes × box + DEPOSIT_RESERVE (1.5 ₳), with no collateral (mixFunding, 1961-1971). In an ADA pool whose box is 3.5 ₳ (one box) or 1.75 ₳ (two), that UTxO is exactly 5 ₳ of ADA alone, so collateralFits takes it.

WebAssembly then sets the collateral apart from the coins (wasm/src/lovejoin.rs:936-937, holdings), so the plan pays for no box. chain() returns undefined (lovejoin.ts:3021), the session's mix.skipped becomes sess.skip.warn.mixCannotPay (sessions.ts:4205), and everything comes back directly.

Before 62162483, the funding's separate 5 ₳ collateral made this pick harmless.

**Scenario.** Someone launches a 3.5 ₳ ADA pool, and a user bootstraps it with one box from the private balance. The funding lands 5 ₳ at the one-time account. The return builds no deposit and says the mix can't pay for its boxes anymore. About 0.5 ₳ of fees is gone and no box went into the pool.

**Confirmed how.** Read the code: the collateral pick, chain()/countAt, and WebAssembly's holdings_of setting the collateral apart from the coins.

**Suggested fix.** For a depositOnly session, take a collateral only when a box's worth remains without it. Or mark a Bootstrap funded without one at mixOutSubmit (for example `mix.noCollateral`) and never pass one, so its funding UTxO stays a coin.

**Test idea.** Planner test like "funds a Bootstrap with no collateral", with an ADA pool of 3.5 ₳ boxes and a one-box Bootstrap whose account holds its one 5 ₳ funding UTxO. backBuild's chain should be ["deposit", "back"], not a direct return with mixCannotPay.

**Skeptic (confirmed, low).** This holds, though in a narrower shape than stated. Since 62162483 a private Bootstrap's funding is one UTxO of 1.5 ₳ + n × box (funding_for_in at depth 0, no mixes) with no collateral. buildBack still takes `rows.find(collateralFits && funding) ?? rows.find(collateralFits)` for every session, a Bootstrap included, and hands it to chain(). chain() accepts a defined collateral at depth 0. WebAssembly's holdings_of then sets that UTxO apart from the coins, so plan_at's spare is 0, countAt gives 0, and chain() returns undefined. buildBack writes mix.skipped = mixCannotPay ('its ADA doesn't pay for a box and its mixes anymore'), and the direct return sweeps the 5 ₳ back. Before the commit, the separate 5 ₳ collateral made two interchangeable 5 ₳ UTxOs, so this was harmless. The narrower shape: an ADA pool's least box value is 3.45 ₳ (chunk-34 S0d), so 1.75 ₳ boxes can't be launched. That leaves a 3.5 ₳ ADA pool (allowed, below the 4 ₳ suggestion) with a one-box private Bootstrap. The user pays the funding's and the return's fees (about 0.45 ₳), no box goes in, and the reason shown is false.

Evidence: sessions.ts:1961-1971 (bootstrap: one payment, reserve 0, no collateral), 4156-4160 (collateral pick), 4164, 4175-4197, 4205-4209; lovejoin.ts:2964 (depth 0 with a collateral proceeds), 3015-3021; wasm/src/lovejoin.rs:936-939 (collateral not a coin), 1102-1127 (plan spare), 1945-1951 (funding_for_in); seedelf-core/src/lovejoin/mod.rs:1591, 1632-1634; docs/plans/chunk-34-token-pools.md:668 (ADA pool least 3.45 ₳)

## 323-worker#5

**low · confirmed · privacy** — A collateral box that has landed but isn't listed yet is taken for moved, and the return sweeps what pays for its mix

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3531`

**Detail.** In tailChain, when split.owned lacks the box, a deposit known on chain (tail.landed, or onChain through the feed or tx_status) leads to tailOver (3526-3534), as if someone else's mix had moved the box. A pool listing that lags the feed or tx_status gives the same answer; Koios backends lag, and the wallet allows for that elsewhere (squareUp's RECORD_KEEP_MS, the found-box rules).

So a return built soon after a cut chain's deposit lands can mark the tail over and sweep the deposit's change. The box then waits not mixed yet, tied to the session, though nothing moved it.

**Scenario.** Preprod (Koios only). A lock cuts a chain right after its collateral's deposit was sent. On a run after unlock, tx_status shows the deposit but the 5 ₳ mix_box listing doesn't show the box yet. The tail is marked over, the rest is swept, and the box waits for Mix my boxes again.

**Confirmed how.** Read the code (tailChain's not-listed branch).

**Suggested fix.** Before tailOver on a landed but unlisted box, ask whether the box's outref is spent (utxo_info is_spent), or wait a few minutes past `landed` before concluding it moved; answer "wait" until then.

**Test idea.** Planner test: cut after the collateral's deposit, deposit known on chain, box absent from the 5 ₳ listing. backBuild should reject with lj.tail.waiting; today it builds a plain return and marks the tail over.

**Skeptic (confirmed, low).** This holds. In tailChain, a box missing from split.owned whose deposit is known in (`tail.landed` set, or onChain true) goes straight to tailOver, with no grace and no spent check. A pool listing behind the feed or tx_status therefore reads as someone else's mix having moved the box. The plain return then sweeps the deposit's change that pays for the mix, and the box waits 'not mixed yet', tied to the session. privacy.md promises that only after the rebuild fails or the day is out, not after a lagging read. It's plausible on preprod (Koios only; tx_status and credential_utxos are served by balanced backends, which the wallet allows for elsewhere, e.g. ownGone's M4 note), for example a return built right after a StalePool stop, or an unlock soon after a lock cut the chain. The other reasons a box would be missing don't apply here: it's the wallet's own re-randomized register, it's never a Bootstrap's, and its mix wasn't sent. Low: a narrow timing window, the money comes back, and Mix my boxes again still takes the box first.

Evidence: lovejoin.ts:3525-3535 (unlisted + landed → tailOver), 3583-3593 (tailLanded), 6040-6060 (split/real); sessions.ts:4784 (landed set at the witness); sessions.ts:921-941 (Koios backends disagree, M4); docs/privacy.md:217

## 323-worker#6

**low · confirmed · ux-words** — Funding reviews still say the 5 ₳ comes straight back

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:346`

**Detail.** Three places say the 5 ₳ comes straight back:
- dappUi.back.privacy.noteLovejoin (en.json:346), shown by FundingWayBack on a site's funding review (DappApprovals.tsx:464-466): "The rest and the 5 ₳ come back at once."
- sites.topUp.collateral (en.json:2097, SiteSessions.tsx:611-615): "It comes back with the next return."
- The Mix form's "Comes back once it's mixed, about" (lovejoin.mix.backSoon, en.json:1015; Lovejoin.tsx:2807): its figure (mixCosts `soon`, Lovejoin.tsx:396-410) includes the 5 ₳, and its "Total leaving your private balance" (407) leaves out the 1.5 ₳ reserve that the review will add.

Where collateralReserve is set (a 5 ₳ pool shown, Settings' switch on), the 5 ₳ becomes a box, is mixed once, and comes back by itself hours later, less its way back. The site and top-up reviews show CollateralReserveRow right above these words. All three strings predate #321 and #323.

**Scenario.** A site session funded on preprod with a 5 ₳ pool shown. Its review says "For its collateral's mix: 1.5 ₳" and then "The rest and the 5 ₳ come back at once". At the return the 5 ₳ goes into the pool and comes back hours later as a mixed box.

**Confirmed how.** Read the code and the strings against buildBack's tail.

**Suggested fix.** Choose the words by review.collateralReserve (pass it to FundingWayBack), for example: "the 5 ₳ is mixed once in Lovejoin and comes back by itself later". On the Mix form, where a 5 ₳ pool is shown, add the reserve to the total leaving and take the 5 ₳ out of the comes-back-once-it's-mixed figure.

**Test idea.** Render FundingWayBack and the top-up review with collateralReserve set; assert they no longer say the 5 ₳ comes back at once or with the next return.

**Skeptic (confirmed, low).** This holds, and the strings predate #321/#323 as stated. FundingWayBack always shows dappUi.back.privacy.noteLovejoin ('The rest and the 5 ₳ come back at once'), a critical key, on the same review as the new CollateralReserveRow. The top-up's note says the new 5 ₳ 'comes back with the next return'. The Mix form's 'Total leaving your private balance' is mixCosts' leaving (the funding, plus 5 ₳, plus one fee estimate), which leaves out the 1.5 ₳ the review then adds. Its 'Comes back once it's mixed' figure counts the 5 ₳, which now comes back hours later as a mixed box, less its way back. Session 10's call 2 (Claude's, still awaiting the owner's look) deliberately left the 'comes back' / 'with the rest' approval notes unreworded, to spare classic-only users' screens. That covers the top-up line. It doesn't cover 'at once' in a privacy note next to the new reserve row, or the Mix form's totals. Low: dormant on mainnet, the error claims less privacy than the user gets, and the exact signed totals on the reviews are right.

Evidence: en.json:346, 2097, 1015; DappApprovals.tsx:464-466, 734; SiteSessions.tsx:599, 611-615; Lovejoin.tsx:399-411 (leaving/soon), 2798-2807; docs/plans/chunk-34-token-pools.md:978 (Session 10, call 2)

## 323-worker#7

**low · owner-call · owner-call** — A session funded without the reserve pays its collateral's mix from what was coming back

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4107`

**Detail.** intoPool is computed for any return through Lovejoin with a 5 ₳ at the account (4107-4115), and collateralReserve is passed only where the record has it (4195). So a 1.5.0 session, or one funded while no 5 ₳ pool was shown, never loses a box to the reserve, as promised. But WebAssembly still builds the tail on the chain's change whenever that pays (with_return, wasm/src/lovejoin.rs:1753-1770).

The owner chose this (Session 11, call 3). What it means for a 1.5.0 swap that runs itself, approved with "Kept aside for contracts: 5 ₳, comes back":
- its return spends about 1.1 ₳ of the leftover on the collateral's deposit and the mix giveme.my backs;
- the 5 ₳ comes back hours later as a box, less about 0.3 ₳;
- the return is a sweep into new UTxOs instead of 1.5.0's merge.

None of this is ever reviewed.

**Scenario.** A user upgrades mid-swap. After the fill, the automatic return mixes the collateral, costing about 1.1 ₳ more than the approval's figures, and the 5 ₳ arrives hours later in a new UTxO.

**Confirmed how.** Read the code: buildBack's intoPool and collateralReserve, and WebAssembly's with_return.

**Suggested fix.** Owner's call: keep it and say so in the release notes or Settings, or build the tail for a session without the reserve only on a return the user reviews.

**Test idea.** If the call changes: a planner test where an automatic swap without collateralReserve has no tail in its return chain.

**Skeptic (owner-call, low).** The code matches the finding. intoPool doesn't depend on the reserve; only the plan's `collateralReserve` flag follows the record. with_return builds the tail on the chain's change whenever CollateralTail::build succeeds, then sweeps rather than merges. This is recorded as Session 11's call 3 ('without, the tail is paid from what the chain leaves, if that's enough') and Session 10's call 1 (the collateral switch is read when the return is built, not at approval). Both are Claude's calls awaiting the owner's look, so it's the owner's to decide, not a bug to fix unasked. In user terms: the automatic return of a 1.5.0 session, or of one funded with no 5 ₳ pool shown, spends about 1.1 ₳ more than its approval showed, and its 5 ₳ comes back hours later as a mixed box, less about 0.3 ₳, in a new UTxO. It can't happen on mainnet at release (no 5 ₳ pool at the floor), so 1.5.0 sessions in flight at the upgrade won't meet it; on preprod they can.

Evidence: sessions.ts:4107-4115 (intoPool), 4193-4196 (collateralReserve only from the record); wasm/src/lovejoin.rs:1752-1772 (tail on the chain's change), 1777-1797 (sweep after a tail); docs/plans/chunk-34-token-pools.md:932, 977

## 323-worker#8

**low · confirmed · tests** — The tail's give-up paths, which release the session's money, have no test

At `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-planner.test.ts:1147`

**Detail.** The tail block covers giveme.my's behind-the-chain wait and one rebuild, a lock's cut, the unlanded hour, and the busy back-off. Untested:
- lj.tail.tooLong after TAIL_KEEP_MS (sessions.ts:4786), and the plain return after it (tailOf, lovejoin.ts:3497);
- the second build stopping, then tailOver and a plain return (TAIL_TRIES, 3497);
- the "pool has N boxes" and pool-not-shown waits (3556, 3524);
- a tail mix that was sent, so chainSent drew its due time and share (4463-4477), and then dropped, which tailOf then never rebuilds (3496).

**Scenario.** A regression in any of these leaves a session's ADA held past the day, or swept while its mix could still go, and no test notices.

**Confirmed how.** Read the tests (grep for tooLong, TAIL_KEEP, tries 2, over, and the pool-has-boxes wait in tests/).

**Suggested fix.** Add planner tests for each path, reusing stoppedAtMix() and the clock.

**Test idea.** stoppedAtMix(); rebuild and stop again (giveme.my refusing past 3 min): the next backBuild is a plain return and both tails are over. Separately, advance the clock 24 h + 1 ms while giveme.my is busy: the chain stops with lj.tail.tooLong and the next backBuild sweeps.

**Skeptic (confirmed, low).** This holds. The tail block in lovejoin-planner.test.ts covers the chain, giveme.my's wait for the chain and one rebuild, a rebuild that never starts, Ogmios behind, a lock's cut, the unlanded hour, the busy back-off, the direct return, no 5 ₳ in the account, the Bootstrap, the floor, the switch off, and the reserve. Grep over tests/ finds no test of these paths: lj.tail.tooLong after TAIL_KEEP_MS; a second stop leading to tailOver and then a plain return (TAIL_TRIES); the PoolShort and pool-not-in-set waits; or a tail mix that was sent (scheduled, its due time and +1 share drawn by chainSent) and then lost. In that last path tailOf never rebuilds it, and the drawn due time and share stay with no leaf, so it's an untested state path too. These are the paths that release or hold a session's money.

Evidence: tests/lovejoin-planner.test.ts:1147-1581 (no tooLong, TAIL_TRIES exhaustion, 'pool has' or scheduled-then-lost case); lovejoin.ts:3496-3500, 3524, 3556, 4463-4477; sessions.ts:4786

## docs-small#1

**low · confirmed · docs** — Plan §2 still says L's registration is checked at each read: nothing checks it after discovery, and on mainnet the wallet takes the server's word

At `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md:292`

**Detail.** #308's §2, kept by #315, lists "L's credential is registered (one `account_info` for all pools)" among the checks made "at each read" (lines 291-294). #315's §9 adds "Every pool shown is genuine and finished … unfinished pools … never reach the page" (line 440), and §10 says the server "can't make one look real". Decision 30 (lines 126-128) made "finished" final at discovery ("never checked again"), but §2 was never struck. Its call-34 note ("only the first check gates: a box below the minimum") also names the wrong bullet. At HEAD no pool read checks L: lovejoin.ts never calls accountInfo. On the Koios path, the look checks the launch's certificates or firstRegistrations (lovejoin-pools.ts:519-527). The data layer's list (refresh, lovejoin-pools.ts:432-446) is re-verified only for the seed's derivation, both scripts at the holder (`scriptsInline`) and a listed value (`verified`/`listedValue`, :443-453). So on mainnet "finished" and "earliest" are the server's word: its own copy of the rule (seedelf-data/api/src/lovejoin/standard.rs:174-182, sound as written). keep() only adds (lovejoin-pools.ts:371-381), so a pool listed once stays on the device. A box can't leave a pool whose L isn't registered: every withdraw carries L's zero withdrawal (seedelf-core/src/lovejoin/mod.rs:1395).

**Scenario.** Suppose the data layer ever listed a genuine pool whose launch didn't register L: a db-sync gap, or a later edit to its copy of the rule where the shared vectors don't reach (decision 32's stated risk). Every mainnet wallet that refreshed would keep the pool and offer it. A user's mix or Bootstrap deposit runs no script and lands. Then the node refuses the first mix and every Bring one back (a withdrawal from an unregistered credential), and the boxes wait until someone registers L. That costs 2 ₳ and anyone can do it, but the wallet doesn't offer it. Anyone reading §2 believes an independent check prevents this.

**Confirmed how.** Read the code: lovejoin-pools.ts refresh/verified/listedValue/keep and the Koios look; a grep showed no accountInfo in lovejoin.ts; seedelf-data's settle; core's withdraw_with.

**Suggested fix.** Strike §2's registration bullet and point it to decision 30. Correct the call-34 note so it names the min-UTxO bullet. In architecture.md's *Which pools are shown*, say that on mainnet "finished" and "earliest" are the server's word. If wanted, re-check L once per pool when the data layer first hands it over: one batched account_info for every listed pool's L, the same request for every wallet.

**Test idea.** A discovery test where the fake index's lovejoin/pools lists a genuine pool and account_info says its L isn't registered. With the check, the pool is never handed over; today it is.

**Skeptic (confirmed, low).** This is a stale design doc. §2 still lists 'L's credential is registered (one account_info for all pools)' among the checks made 'at each read'. On HEAD nothing checks L after discovery. usableNow and cantComeBack pass a constant `registered: true`, with the comment 'A standard pool's credential is registered by its launch (34c)'. Decision 30 says a pool's standing is 'never checked again'. Decision 11 says mix_logic refuses deregistration, so once L is registered it stays registered, and re-checking at each read would add nothing. The call-34 note says 'only the first check gates: a box below the minimum', but the first bullet is the registration, so it names the wrong bullet. On Koios the registration is checked once, at the look: the launch's certificates or firstRegistrations. The data layer's list is re-run only through lovejoinVerifyPool, scriptsInline and listedValue. So on mainnet 'finished' is the server's verdict, under its own copy of the rule (settle, which is sound). That is the trade decision 32 accepted. §10's 'can't make one look real' is accurate for genuineness. The failure scenario needs a data layer bug. A box in such a pool would wait for someone to register L: anyone can, with cert 0, and every withdraw carries L's zero withdrawal. Only the wording is wrong, so low. The optional one-time L check on the data-layer path is for the owner to decide.

Evidence: chunk-34-token-pools.md:291-294 (the bullet from #308's bf4ff54c9, the call-34 note from 5550d156b), :126-128 (decision 30), :61 (decision 11: L registered; mix_logic refuses deregistration), :473 (§10). lovejoin.ts:3431 and :2474 (`registered: true`), :3411-3421 (usableNow's comment). lovejoin-pools.ts:401-447 (refresh), :449-460 (verified/listedValue), :519-527 (the Koios look's certificates/firstRegistrations), :371-381 (keep only adds). seedelf-data/api/src/lovejoin/standard.rs:172-182 (settle). seedelf-core/src/lovejoin/mod.rs:1395 (WithdrawZero on every withdraw).

## docs-small#2

**low · confirmed · docs** — keys-and-accounts.md wasn't updated for 1.6.0: it says only a mint, a public mix and a site put up the account's collateral

At `seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md:129`

**Detail.** #308's §9, kept by #315, names keys-and-accounts among the docs token pools update, but `git log 63f87b8..HEAD -- docs/keys-and-accounts.md` is empty. Line 129 still says the public account's collateral is "put up only by what the account signs that runs a script: the account-paid mint, a Lovejoin mix from the public account (chunk 16), and a connected site's transaction". 1.6.0 also puts it up for a pool started from the public account (seedelf-core/src/lovejoin/launch.rs:354-447, launch_from_account: "its own collateral", refused if too small) and for Bring one back paid by the public account (withdraw_paid, seedelf-core/src/lovejoin/mod.rs:1125-1132). architecture.md and the privacy policy say so; this doc doesn't.

**Scenario.** Someone checking when the public account's 5 ₳ is at stake reads a list of three. It leaves out a pool's start from the public account and the escape hatch paid by it. Doc-only: the screens and the policy are right.

**Confirmed how.** Read the code and the git log.

**Suggested fix.** Add both to the list at keys-and-accounts.md:129: starting a pool from the public account, and Bring one back paid by it. Optionally note that giveme.my lends its collateral to a session collateral's mix (the tail), as it does for Seedelf spends.

**Test idea.** None (docs).

**Skeptic (confirmed, low).** keys-and-accounts.md:129 still says the public account's collateral is put up only by three things: the account-paid mint, a public Lovejoin mix and a connected site. The file is unchanged since 1.5.0. 1.6.0 adds two more uses, both wired in the worker. A pool started from the public account (fromPublic) sends readAccount's collateral to buildLovejoinLaunchFromAccount, and core refuses one too small. Bring one back paid by the public account (`paid === true`) puts up the account's own collateral, with lj.needCollateral if there is none and no giveme.my. The plan's own §9 docs list names keys-and-accounts as a doc to update, and architecture.md:732 does mention withdraw_paid's account collateral. Docs only: no screen or amount is wrong.

Evidence: keys-and-accounts.md:129. `git log 63f87b8..HEAD -- seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md` is empty. lovejoin-launch.ts:315-330 (fromPublic: readAccount → collateral → buildLovejoinLaunchFromAccount). seedelf-core/src/lovejoin/launch.rs:434-447 ('The public account's collateral is too small to put up for this launch'), :562-571 (launch_from_account). lovejoin.ts:6107-6113 (paid === true: readAccount collateral, lj.needCollateral). seedelf-core/src/lovejoin/mod.rs:1125-1146 (withdraw_paid: 'which puts up its own collateral too'). chunk-34-token-pools.md:464.

## gap-1#0

**low · confirmed · state** — A private session's collateral mix waiting on giveme.my blocks switching public accounts for up to a day, and the refusal blames "this account"

At `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:350`

**Detail.** account-use (handlers.ts:345-351) refuses when any network's atStake entry has chainSending. atStake (handlers.ts:588-605) gets that from lovejoin.chainsSending (lovejoin.ts:4733-4736), which is true for any chain record not ended. A private session's chain (ChainRecord.session) counts the same as a public mix's (ChainRecord.account). Since #323, a session's return chain ends with its collateral's mix. That mix goes out only with giveme.my's signature, and only once everything before it is on chain. pumpChain returns false while witnessTail says not yet (lovejoin.ts:489). witnessTail (sessions.ts:4780-4810) keeps waiting while giveme.my is busy (5xx or 429) or out of reach, and on Koios errors, backing off from 1 to 30 minutes (sessions.ts:680), until TAIL_KEEP_MS, 24 h (lovejoin.ts:325). The record stays live the whole time, because cuts() still finds its progress. The refusal says "A payment or mix from this account is still on its way. Wait for it to settle, then switch accounts." (en.json:2924). That is false here: the public account isn't in any of a session's transactions (sessions.ts:1-5), and the session's keys don't depend on the account index (wallet.ts:670, 674: SeedelfKey.fromEntropy(entropy, 0), OneTimeAccounts.fromEntropy). Switching wouldn't touch the chain. The same chainsSending feeds the lock countdown (handlers.ts:178-181, LockCountdown.tsx:80 and 152). "A Lovejoin chain is being sent: locking now stops it partway" shows at every auto-lock approach for as long as the wait lasts. That line is true, but a cut tail is built again (tailOf and tailChain, lovejoin.ts:3492-3560), so locking costs one of TAIL_TRIES = 2 builds. That lock is also the only way out of the refusal. The same check holds Bring one back now and Bring every box back now (lovejoin.ts:5707, 5862); this overlaps x-scenarios-lj. The refusal was already wrong in 1.5.0 during minute-long session chains; #323 stretched it to hours. On mainnet it stays dormant until a 5 ₳ ADA pool holds its floor of 30 other people's boxes (collateralPool). On preprod it is live today (pool 18c4df77…, floor 0).

**Scenario.** Preprod today, or mainnet once someone starts a 5 ₳ ADA pool past its floor. A user with two public accounts brings a site's session back through Lovejoin. The chain's mixes land, then giveme.my answers 503 for three hours. Choosing Public account 2 in Home's account picker is refused with "A payment or mix from this account is still on its way. Wait for it to settle, then switch accounts." Nothing of that account is on its way, and nothing settles while giveme.my is down, so waiting can take up to a day. The only way out is to lock and unlock, which cuts the chain, and nothing tells the user that. For a swap's or a mix's session, the runner builds the collateral's mix again after the unlock wait, so the refusal comes back. A second lock is then needed, and it gives the collateral's mix up, leaving its box not mixed yet. Meanwhile the countdown warns them against locking every 15 minutes.

**Confirmed how.** Read the code, and ran a throwaway test, zz-review-gap-1-switch, now deleted. It used lovejoin-planner's 5 ₳ pool setUp: a site session's return, giveme.my answering 503, and the user active every 10 minutes for 3 hours. Results: chains-sending stayed true; reset-check listed chainSending; account-use was refused with SWITCH_AT_STAKE's words; giveme.my was asked 10 times; the chain record was session 0's, with no account. After wallet.lock() and unlock(), chains-sending was false, tailOf still held the tail (tries 1), and the switch went through (active = 1).

**Suggested fix.** Make account-use block only on the public account's own chains, for example chainsSending(network, { publicOnly: true }), meaning chains.some(c => !c.ended && c.session === undefined). Alternatively, have atStake report which kind of chain is live. Keep Remove wallet's list as it is. Optionally, when a session's collateral mix is waiting for giveme.my, have the countdown say so and that the mix is built again after unlock, instead of the generic chain line.

**Test idea.** In lovejoin-planner's tail block: a site session's return with giveme.my busy and account 1 known. handle({type: "account-use", index: 1}) should resolve while chains-sending stays true. A public mix chain mid-send (publicBuild, then publicSubmit) should still throw SWITCH_AT_STAKE().

**Skeptic (confirmed, low).** The mechanism holds on HEAD, but I'd lower it to low. account-use refuses whenever chainsSending is true. chainsSending counts any chain record that hasn't ended, and a private session's return chain counts the same as a public mix's. While giveme.my is busy (5xx or 429) or out of reach, or Koios errors, witnessTail returns false and pumpChain returns false. The chain's progress stays in session storage, so cuts() never ends it. It stays live until the witness comes, until TAIL_KEEP_MS (24 h after its deposit landed) stops it, or until a lock cuts it. A switch wouldn't touch that chain. The Seedelf key and the one-time accounts are derived independently of the account index. accounts.use only rewrites LOCAL_ACCOUNT and wipes the balance caches. The session's transactions are signed with the one-time keys and recorded under the session's own index. So the words "A payment or mix from this account" are false here. flows.md says the switch is refused only "while something of the account's is on its way", so this is not an owner's choice. The owner chose the day-long giveme.my wait (Session 11) but never weighed it against switching accounts. Why low and not medium: (1) the same filter refused the same way during session chains in 1.5.0 (63f87b8 handlers.ts:325). (2) With giveme.my healthy, the collateral's mix adds only a minute or two (one ask, maybe one 1-minute back-off while giveme.my is behind). Hours need giveme.my or Koios down for hours. (3) On mainnet it's dormant until someone launches a 5 ₳ ADA pool and it holds the floor of 30 other people's boxes: the bundled mainnet pool list is empty and we launch none. (4) No money or privacy is at risk, and waiting is bounded. The countdown line is true, and it only shows when the user is idle near the lock. A user who locks twice does give up the collateral's mix, since TAIL_TRIES is 2, and the box is left not mixed yet. That is recoverable with Mix my boxes again or Bring one back. Fix as suggested: block only on chains with session === undefined, and keep Remove wallet's list as it is.

Evidence: handlers.ts:350 (filter includes a.chainSending); lovejoin.ts:4733-4736 (chains.some(c => !c.ended), no session/account distinction); lovejoin.ts:4705-4730 (cuts ends a chain only when its progress is gone or stopped); lovejoin.ts:486-489 (pumpChain returns false when witness is false); sessions.ts:4780-4810 (witnessTail: CollateralError or KoiosError → witnessAfter back-off from TAIL_WITNESS_WAIT_MS [60_000, 30*60_000] at sessions.ts:680; stops only past TAIL_KEEP_MS or on a non-busy refusal after GIVEME_BEHIND_MS); lovejoin.ts:325-326 (TAIL_KEEP_MS 24 h, TAIL_TRIES 2); sessions.ts:4145-4149 (a rebuild gets tries: tail.tries + 1); lovejoin.ts:3497 (tries >= TAIL_TRIES → tailOver); wallet.ts:668-674 (SeedelfKey.fromEntropy(entropy, 0), OneTimeAccounts.fromEntropy, account only for CardanoAccount); accounts.ts:190-211, 105-112 (use = LOCAL_ACCOUNT plus WIPED_ON_SWITCH balance caches); en.json:2924; docs/flows.md:154 ("refused while something of the account's is on its way"); 63f87b8:handlers.ts:325 and lovejoin.ts:2653-2656 (identical in 1.5.0); lovejoin.ts:3474-3483 plus src/lovejoin-pools.json mainnet pools [] (dormant on mainnet); chunk-34-token-pools.md Session 11 owner's calls 1-2 (day kept for a giveme.my wait, nothing on switching).

## gap-2#0

**low · confirmed · docs** — Public docs on RestTo and account_send still say "in one output"; HEAD splits tokens 20 to an output

At `seedelf-platform/seedelf-core/src/build.rs:1503`

**Detail.** RestTo::Seedelf (build.rs:1503) says "into the contract, in one output". RestTo::Address (build.rs:1506) says "in one output". account_send (build.rs:754) says the account pays `to` "in one output". Since #321 this is false past 20 token kinds. ScriptSpend::stage pays the rest through deposit_outputs or pay_address, which chunk at MAXIMUM_TOKENS_PER_UTXO (build.rs:2143-2154). Payee::Address::outputs goes through pay_address (build.rs:652-655). ScriptSpend::settle already counts the extra rest outputs (build.rs:2034-2039), and the Payee docs (build.rs:620, 625) were updated, so only these three comments are stale. Both items are pub in the published seedelf-core crate.

**Scenario.** Nothing a user sees today: the counts and the money are right. Someone building on pay_rest trusts the doc and assumes one rest output, for example a CLI Max mode or a caller that picks the rest output by index or counts outputs. With 21 or more token kinds there are two or more rest outputs, so a count or index taken from the docs is wrong.

**Confirmed how.** Read the code at HEAD. A throwaway seedelf-core test (zz_review_gap2_shapes, since deleted) confirmed that payments and rest go out 20 tokens to an output, and that FinalSpend.change_outputs leaves the extra outputs out.

**Suggested fix.** Reword the three comments to "its tokens MAXIMUM_TOKENS_PER_UTXO to an output", as the Payee docs now say.

**Test idea.** A core test: pay_rest(RestTo::Address) and pay_rest(RestTo::Seedelf) with 25 token kinds each build 2 rest outputs, and FinalSpend.change_outputs equals the decoded outputs minus the 2 rest outputs minus the fixed outputs.

**Skeptic (confirmed, low).** The finding holds. Three public doc comments in seedelf-core still say "in one output", but HEAD's code splits a payment into outputs of at most 20 token kinds each. The comments were true in 1.5.0. PR #321 (commit 1cd50dbaf) made payments split 20 tokens to an output and updated the doc on Payee::Address, but missed these three. How each item reaches the split: (1) RestTo::Seedelf goes through ScriptSpend::stage to deposit_outputs, which splits via token_chunks at MAXIMUM_TOKENS_PER_UTXO = 20. (2) RestTo::Address goes through stage to pay_address, which splits the same way. (3) account_send goes through account_send_many and account_payment to Payee::Address::outputs, then pay_address, which also splits. Nothing caps a send at 20 token kinds: fitting (utxos.rs:392) only guards against a token total overflowing u64. I found no money or user-visible effect, so severity stays low (stale public docs). The CLI never calls RestTo, pay_rest or account_send. The wasm crate reads counts, not positions: FinalSpend.change_outputs (settle subtracts token_chunks(rest.tokens).len()), AccountPayment.outputs (counts every chunk) and rest_lovelace. build::carried finds the carried output by its value, not its index, and carry() sends no tokens, so it makes exactly one output. Its doc (build.rs:1697), "one output of ADA alone", is therefore still correct. The risk is only to an outside user of the published crate (seedelf-core's build module is pub, and the crate isn't publish = false) who trusts the doc to count or index rest outputs. Small correction to the finding: only Payee::Address's doc (625) was updated in #321; Payee::Seedelf's (620) predates 1.5.0, because deposits always split. The suggested rewording fixes it. Separately, an internal comment in the wasm crate (lib.rs:3915, publish = false) still implies payments don't split. That is outside this finding.

Evidence: HEAD 499768f6, seedelf-platform/seedelf-core/src/build.rs:
- Stale comments: line 754 (account_send: "in one output"), line 1503 (RestTo::Seedelf: "in one output") and line 1506 (RestTo::Address: "in one output").
- The split: token_chunks at 349-355 splits at MAXIMUM_TOKENS_PER_UTXO (constants.rs:95, = 20). deposit_outputs (357-384) and pay_address (3335-3376, token_chunks at 3359) both use it. stage (2143-2154) sends the rest through deposit_outputs or pay_address. Payee::outputs (642-659) calls pay_address at 652-655.
- The counts stay right: settle's rest_outputs (2034-2039) subtracts every rest chunk.
- 1.5.0 (git show 63f87b8, build.rs:1913-1916): stage used the single-output deposit_output, and pay_address returned one Output, so the docs were true then.
- git blame: the comments come from 640a82992 and 8de4dc64d, both in 1.5.0. The split came from 1cd50dbaf, merged in #321 (68150b39).
- Grepping seedelf-cli/src for RestTo, pay_rest and account_send finds nothing.
- wasm/src/lib.rs:3238 and 4716 read built.change_outputs; core's carried() (build.rs:2258-2277) matches by lovelace and an empty token list.
- seedelf-core/src/lib.rs:3 is `pub mod build`, and seedelf-core/Cargo.toml has no publish = false.

## gap-3#0

**low · confirmed · docs** — flows.md's private-swap Back paragraph still describes #321's unmixed collateral box and its old setting name

At `seedelf-platform/seedelf-web-wallet/docs/flows.md:477`

**Detail.** flows.md:477 names the setting '*Put a session's 5 ₳ collateral into Lovejoin as it's brought back*'. It says the collateral 'becomes a box there instead, made by the return and mixed by nobody for it, which comes back by itself once someone else's mix moves it', and gives the floor as the only condition. That was #321's design (4d5bf583). #323 (24c5c62a) replaced it:
- The setting is now 'Mix a session's 5 ₳ collateral in Lovejoin as it's brought back' (en.json settings.lovejoin.collateral).
- The return now sends two transactions before itself. First a deposit of the collateral into a box, then one mix of that box with two other people's boxes, under giveme.my's collateral (core lovejoin/mod.rs:2023 collateral_tail and :803 mix_giveme; wasm lovejoin.rs:202).
- The pool must also hold two free boxes (lovejoin.ts:3481, TAIL_DRAWS).
#323 updated flows.md:521-522, privacy.md:217 and architecture.md:632, but not :477: git diff -U0 28e91f90 499768f6 touches flows.md lines 521-522 only. So the same doc now contradicts itself. The preference's doc comment carries the old wording too, at src/shared/preferences.ts:139-145 ('With `lovejoinReturns` ... nobody mixes the box for the session').

**Scenario.** The owner, a reviewer or a future agent opens the private-swap section, which is where 'what happens to my 5 ₳' is answered first. They read that the collateral's box is never mixed for the user and that giveme.my plays no part. Copy or a design written from it would leave out that giveme.my backs, and so sees, the collateral's mix from this device, and would name a setting that no longer exists. Section 521 and privacy.md say the opposite.

**Confirmed how.** Read the code. Compared flows.md:477 with :521, privacy.md:217 and architecture.md:632. git diff -U0 28e91f90 499768f6 shows #323 changed only flows.md 521-522. Also read sessions.ts:4100-4115 (intoPool), lovejoin.ts:3474-3483 (collateralPool), and the en.json keys settings.lovejoin.collateral and lovejoin.collateralBox.*.

**Suggested fix.** In flows.md:477, replace the 5 ₳ sentence with a pointer to section 521's account:
- the setting's current name;
- the deposit, then one mix under giveme.my's collateral that waits for the deposit to land;
- the floor plus two free boxes;
- the return after it is a sweep into new registers.
Also correct the doc comment in src/shared/preferences.ts:139-145.

**Test idea.** A docs check beside tests/words.test.ts that pulls each Settings label flows.md quotes in *…* after 'Settings' and asserts it exists in en.json. '*Put a session's 5 ₳ collateral into Lovejoin as it's brought back*' fails it today.

**Skeptic (confirmed, low).** Still on HEAD. Line 477 of flows.md names a setting that no longer exists. It also describes #321's design: a box made by the return and "mixed by nobody for it". #323 replaced that design with a deposit, then one mix under giveme.my's collateral, then a sweep, but it rewrote only flows.md:521-522, so the same doc now contradicts itself. The preference's doc comment carries the same old wording. Only internal docs are affected: privacy.md:217, the privacy policy and the screens describe the current behaviour correctly, so low.

Evidence: flows.md:477 names '*Put a session's 5 ₳ collateral into Lovejoin as it's brought back*' and says the box is 'made by the return and mixed by nobody for it'. en.json:1963 has 'settings.lovejoin.collateral': 'Mix a session's 5 ₳ collateral in Lovejoin as it's brought back'. flows.md:521 describes the deposit and the one mix under giveme.my's collateral. `git diff -U0 28e91f90 499768f6 -- docs/flows.md` shows a single hunk, '@@ -521,2 +521,2 @@'. src/shared/preferences.ts:140-143 says 'nobody mixes the box for the session'.

## gap-3#1

**low · confirmed · docs** — flows.md's session flows still bring the 5 ₳ back with the rest, though a shown 5 ₳ pool now takes it through the collateral's mix

At `seedelf-platform/seedelf-web-wallet/docs/flows.md:513`

**Detail.** When three things hold, a session's return through Lovejoin first deposits the 5 ₳ into a box and mixes it once under giveme.my's collateral, then sweeps the rest into new registers, never merged (architecture.md:632; sessions.ts:4107-4115). The three: lovejoinCollateral is on (the default), a 5 ₳ ADA pool is shown, and that pool holds the floor plus two free boxes. Mix sessions are included, because throughLovejoin is true for every mix (sessions.ts:4337-4338). The funding also pays COLLATERAL_TAIL_RESERVE, 1.5 ₳ (sessions.ts:1959-1961 for a mix, :1751-1752 a swap, :1836-1837 a site, :2044-2047 a top-up).

The per-flow lines weren't updated:
- flows.md:513: 'what the mixes and the fees don't use back with the 5 ₳ into the private UTxO the funding left'. When the tail applies, both halves are false.
- flows.md:512: 'what comes back once it's mixed (the 5 ₳ and what the fees don't use)', and its funding rows have no *For its collateral's mix*.
- flows.md:449: 'brings everything at it back..., the collateral too, signed by the account's key, with no giveme.my'.
- flows.md:471: 'paying the session's account twice: the swap with its costs and 2 ₳ of room, and 5 ₳'. The first payment carries the reserve too.
- flows.md:489: lists the site funding's rows without the reserve row.
- architecture.md:735: a chain's cost, 4k + 2 submits, counts neither the tail's two submits nor its Ogmios evaluate and giveme.my request.
- Root README.md:255: says a one-time account bringing money back uses its own collateral. The collateral's mix uses giveme.my's.
- architecture.md:632 and flows.md:521: say a funding that pays a collateral adds the reserve. The by-hand Put in 5 ₳ (collateralTopUp) adds none (Session 11, call 4), yet its return can still mix it.

flows.md:427 is fine: the connect choice says only that the 5 ₳ 'comes back', and Session 10's call 2 kept that.

**Scenario.** This applies on preprod today, and on mainnet once a 5 ₳ pool holds 30 other people's boxes. A user mixes one box from the private balance. flows.md:513 promises the 5 ₳ and the unused room back, merged into the funding's change, once the mixes end. Instead, the wallet sends the 5 ₳ through a giveme.my-backed mix into the 5 ₳ pool and sweeps the rest into a new private UTxO; the 5 ₳ comes back hours later as a box. A support answer or a review built from these lines tells the user their 5 ₳ is missing, or that giveme.my wasn't involved.

**Confirmed how.** Read the code paths cited above and architecture.md:632. git diff 63f87b8..499768f6 shows lines 449, 471, 489 and 512-513's 5 ₳ wording untouched by #321 and #323.

**Suggested fix.** In each flow, add the condition from section 521: where a 5 ₳ pool is shown, the funding adds *For its collateral's mix* (1.5 ₳), and the return sends the collateral's deposit and mix first, then sweeps the rest into new private UTxOs. Drop 'with no giveme.my' from :449. Add the tail's submits, evaluate and giveme.my request to architecture.md:735. Note the by-hand 5 ₳'s exception. Add the giveme.my exception to README.md:255.

**Test idea.** Docs only. lovejoin-planner.test.ts's tail block already pins the behaviour (deposit, giveme.my mix, sweep, the funding's reserve), so the fix is checked by reading the docs against it.

**Skeptic (confirmed, low).** The tail applies when lovejoinCollateral is on (the default) and a 5 ₳ ADA pool is shown holding the floor plus two free boxes. It covers every mix session, since throughLovejoin is always true for one. The return then deposits and mixes the collateral under giveme.my's collateral and sweeps the rest into new registers, never merged. Each funding also pays COLLATERAL_TAIL_RESERVE in its first payment. Several per-flow lines still describe the old way: flows.md:449 ('with no giveme.my'), :471 (the first payment), :489 (no reserve row, though DappApprovals shows one) and :513 ('back with the 5 ₳ into the private UTxO the funding left'). So do architecture.md:735 (4k+2, with no tail submits, evaluate or giveme.my request) and README.md:255 (session returns use their own collateral). Line 521 states the exception, so this is incompleteness in internal and public docs, not a contradiction everywhere. One sub-claim is weaker: flows.md:512 describes the Mix form, which really does show no reserve; that is finding 2's screen problem, not a doc mismatch. The behaviour is dormant on mainnet until a 5 ₳ pool holds 30 boxes that aren't the wallet's, so low.

Evidence: wasm/src/lovejoin.rs:1777-1786: with a tail, merge is &[], so the return is external_sweep (:1808). sessions.ts:4107-4115 decides intoPool, and :4337-4338 makes throughLovejoin true for a mix. The reserve is in the first payment at sessions.ts:1761 (swap), :1843 (site), :1968 (mix) and :2048 (top-up). DappApprovals.tsx:734 renders CollateralReserveRow. core lovejoin/mod.rs:803 is mix_giveme and :2023 collateral_tail. lovejoin.ts:3474-3482 needs the floor and TAIL_DRAWS. Stale lines: flows.md:449, :471, :489, :513; architecture.md:735; README.md:255.

## gap-3#2

**low · confirmed · ux-words** — Reviews that show *For its collateral's mix* still say the 5 ₳ comes back at once, or with the next return

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:465`

**Detail.** This is a screen problem, found while checking flows.md:489 (the doc matches the screen).

The site funding review shows CollateralReserveRow (:734) whenever the worker paid the reserve. That needs lovejoinReturns on (sessions.ts:1837, :4323-4327). The same setting makes lovejoinBack true (:510). So FundingWayBack's note (:465, dappUi.back.privacy.noteLovejoin) appears right beside the reserve row: 'The rest and the 5 ₳ come back at once.' When the tail applies, the 5 ₳ instead goes into a 5 ₳ box, is mixed once under giveme.my's collateral, and comes back by itself hours later.

The same class of wording:
- A site's top-up with the reserve row (SiteSessions.tsx:599) says 'It comes back with the next return.' (:611-613, sites.topUp.collateral).
- The by-hand 5 ₳ notes say 'It comes back with everything else' (Swaps.tsx:2679, :3218, :3226). But buildBack mixes any 5 ₳ of ADA alone when the chain's leftover pays for it (sessions.ts:4107-4115), so these can be false.

The cost figures leave the collateral's mix out too:
- FundingWayBack's *Both ways* counts two fees (:445).
- The swap approval's *Costs in all* and what comes back (ui/swap.ts:78-93) count the reserve and the 5 ₳ as coming back.
- The Mix form's *Total leaving, about* has no reserve, and its *Comes back once it's mixed, about* includes the 5 ₳ (Lovejoin.tsx:399-410, :2797-2807).

Session 10's call 2 (chunk-34-token-pools.md:978) deliberately kept 'comes back' in privateNote, againNote and heldAndCollateral, and that call still waits for the owner's look. The strings above weren't among the ones it named, and 'at once' and 'with the next return' are plainly false, not just loose.

**Scenario.** This applies on preprod now, and on mainnet once a 5 ₳ pool holds 30 other people's boxes; until then it's dormant on mainnet, which is why this is low. A user connects a site on a private session with default Settings. The funding review shows 'For its collateral's mix: 1.5 ₳' and, under it, 'The rest and the 5 ₳ come back at once'. After Bring it back, the 5 ₳ isn't in the private balance yet: it's a box waiting out its delay. The review they approved said nothing of the delay, and nothing of giveme.my backing that mix (only the return's own review shows CollateralTailNote).

**Confirmed how.** Read the code: DappApprovals.tsx:444-467, :510, :726-748; SiteSessions.tsx:595-613; Swaps.tsx:2640-2685; ui/swap.ts:78-93; Lovejoin.tsx:399-411 and :2785-2807; sessions.ts:4313-4327.

**Suggested fix.** Where collateralReserve is set, use variants of noteLovejoin and sites.topUp.collateral that say the 5 ₳ is mixed once in the 5 ₳ pool and comes back later by itself. Do the same for the by-hand notes when a 5 ₳ pool is shown. Count the tail's fees, which come out of the reserve, in *Both ways* and *Costs in all*. In the Mix form, put the reserve into Total leaving and leave the 5 ₳ out of Comes back once it's mixed when the tail would apply. Or put these strings to the owner along with call 2.

**Test idea.** Render ConnectRequest's funding review with a summary carrying collateralReserve '1500000' and lovejoinReturns on, and assert the text lacks 'the 5 ₳ come back at once'. It fails today.

**Skeptic (confirmed, low).** The site funding review shows the reserve row only when sessions come back through Lovejoin, which is the same condition that selects noteLovejoin (lovejoinOn equals LovejoinService.available). So 'The rest and the 5 ₳ come back at once' appears right beside 'For its collateral's mix'. A site top-up likewise says 'It comes back with the next return.' beside the reserve row. Both are false whenever the tail runs. The estimates also miss the tail: the swap's costs and comes-back figures, FundingWayBack's 'Both ways' (two fees) and the Mix form's totals leave out its roughly 1.1 ₳ of fees and the box's roughly 0.3 ₳ way back. Session 10's call 2 kept only privateNote, againNote and heldAndCollateral, and it still waits for the owner. 'At once' and 'with the next return' were not named in it. The by-hand 'with everything else' notes are the class call 2 described, so they are best put to the owner with it. No signature covers something unreviewed: the reviews' real totals include the reserve, and a site's Bring it back review shows CollateralTailRow and CollateralTailNote before anything is sent. Low because it is dormant on mainnet; it would rise to medium once a mainnet 5 ₳ pool holds the floor.

Evidence: en.json:346 'The rest and the 5 ₳ come back at once.' is rendered at DappApprovals.tsx:465, with CollateralReserveRow at :734. lovejoinBack is set at :510, and the reserve's condition is in sessions.ts:1837 and :4325. en.json:2097 'It comes back with the next return.' is at SiteSessions.tsx:611-613, beside :599. ui/swap.ts:84-91 has later = 3, and back counts the reserve and the 5 ₳. DappApprovals.tsx:446 counts two fees. Lovejoin.tsx:403-409 and :2798-2807 cover the Mix form. Call 2 is at chunk-34-token-pools.md:978 and is still pending at :915. The by-hand notes are en.json:2289, :2292, :2296 and :2298.

## gap-3#3

**low · confirmed · docs** — flows.md says the web wallet's Max takes the 20 largest UTxOs; since 1.6.0 it spends every UTxO in parts

At `seedelf-platform/seedelf-web-wallet/docs/flows.md:420`

**Detail.** flows.md:420 (Remove a Seedelf, Details) says 'the web wallet's Max takes the 20 largest'. Since items 8-10b, private Send's and Make public's Max go through buildTransferParts and buildWithdrawParts (transfer.ts:116, withdraw.ts:105). Their max_in_parts (wasm/src/lib.rs:4288-4305) spends every UTxO, those adding the most first, in up to 25 transactions (MAX_PARTS, lib.rs:3582) of up to 20 UTxOs each (MAX_WITHDRAW_UTXOS, :3249). A part with no ADA chains on the one before. flows.md:368 and :401 say this correctly.

architecture.md:162-163 still describe Max on private Send as buildTransfer building transfer_most on max_inputs and answering `left`. The worker no longer calls buildTransfer at all; the only singular build left is buildWithdraw at sessions.ts:2707, for one-transaction fundings.

**Scenario.** Someone comparing the CLI with the wallet, or answering 'why did Max send three transactions', is told Max stops at 20 UTxOs. A future agent editing Max looks for buildTransfer's Max path in the worker and finds none.

**Confirmed how.** Read the code: transfer.ts:116, withdraw.ts:105, sessions.ts:2704-2707, wasm/src/lib.rs:3103-3110, :3249, :3582, :4288-4305, against flows.md:368, :401 and :420.

**Suggested fix.** flows.md:420: '…and the web wallet's Max takes every UTxO, those adding the most first, 20 a transaction and 25 transactions at most (above)'. architecture.md:162-163: name buildTransferParts, buildWithdrawParts and max_in_parts, with max_inputs choosing each part's inputs.

**Test idea.** Docs only.

**Skeptic (confirmed, low).** flows.md:420 still says 'the web wallet's Max takes the 20 largest', a line carried over unchanged from 1.5.0 (:414 there). It contradicts the same doc's :368 and :401 and the code: private Send's and Make public's Max go through buildTransferParts and buildWithdrawParts into max_in_parts, which spends every UTxO in up to 25 parts of 20. The architecture.md half is only a nit. The per-part builder is still Rust build_transfer, transfer_most on max_inputs, and architecture.md:167-169 right below describes the parts and Max over every UTxO.

Evidence: flows.md:420 against :368 and :401. transfer.ts:116 calls buildTransferParts and withdraw.ts:105 buildWithdrawParts; nothing in src calls buildTransfer. wasm/src/lib.rs:4444-4456 sends Max to max_in_parts, :4302 loops while parts < MAX_PARTS, :3582 sets MAX_PARTS = 25, :3249 sets MAX_WITHDRAW_UTXOS = 20, and :4438 calls build_transfer per part. architecture.md:163 against :167.

## gap-3#5

**low · confirmed · docs** — flows.md says Settings asks Koios for nothing but three things; Bring every box back now reads every pool and asks giveme.my at once

At `seedelf-platform/seedelf-web-wallet/docs/flows.md:102`

**Detail.** flows.md:102 ends 'Settings asks Koios nothing, except to set a collateral by payment…, to look for or check a public account…, and to disconnect a site on a private session'. 1.6.0 edited this very sentence to add the collateral's tx_status poll. But Settings → Lovejoin → Bring every box back now sends lovejoin-bring-all-back, and its handler runs withdrawDue at once (handlers.ts:552-555). That reads every pool (the data layer or Koios), then gets giveme.my's witness and makes a submit for each box. The paragraph's Lovejoin list also leaves out 1.6.0's Four boxes a mix, the collateral's mix switch, and Bring every box back now, which are documented separately at :520, :521 and :527.

**Scenario.** A privacy reviewer listing which screens talk to servers trusts this sentence. They miss that one press in Settings sends every box's withdraw through giveme.my and Koios from this IP address, back to back.

**Confirmed how.** Read handlers.ts:552-555 and LovejoinService.bringAllBack in lovejoin.ts.

**Suggested fix.** Add to the exceptions: 'and Bring every box back now, which reads every pool and sends each box's withdraw (giveme.my, Koios) at once'. Add the three new Lovejoin items to the list.

**Test idea.** Docs only.

**Skeptic (confirmed, low).** 1.6.0 edited flows.md:102's 'Settings asks Koios nothing, except…' to add the collateral's tx_status poll, but left out Settings → Lovejoin's Bring every box back now. Pressing it starts a run at once: it reads every pool and sends each box's withdraw through giveme.my and Koios (or the data layer on mainnet), one after another. flows.md:527 and privacy.md:226 document this correctly, so only the summary sentence is false. The suggested fix should name 'the data layer or Koios', not Koios alone.

Evidence: flows.md:102, against 1.5.0's sentence, which had no tx_status. handlers.ts:552-555 runs bringAllBack, then `void ctx.lovejoin.withdrawDue(...)` at once. lovejoin.ts:5850-5880: bringAllBackNow reads every pool through this.ours (:5873). Settings.tsx:914 renders <BringAllBack> on the Lovejoin page. Documented at flows.md:527 and privacy.md:226.

## gap-3#6

**low · confirmed · state** — Neither Remove wallet nor the lock countdown mentions a payment whose parts still wait, though a lock or removal stops them as it stops a Lovejoin chain

At `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:588`

**Detail.** Parts waiting for the one before live only in session storage (seedelf.waiting.<network> and seedelf.waitingPart.<hash>; parts.ts:8-13). A lock and Remove wallet both clear session storage (architecture.md:50), so the rest never go. The review tells the user 'Keep Seedelf Wallet unlocked until they go' (review.partsWait). But:
- The lock countdown's warning checks only Lovejoin chains (handlers.ts:178-180 chains-sending; LockCountdown.tsx:80; lock.warn.chainSending).
- Remove wallet's list (atStake, handlers.ts:588-605: a maybe-sent payment, sessions, chainsSending, publicMaybe) has no entry for waiting parts. Yet it names 'a Lovejoin chain still being sent, which removing the wallet stops partway' (flows.md:104, architecture.md:441).
- Once Koios takes the first part, it's no longer maybe sent, so nothing at all is listed.
- After an unlock or a restore, nothing says the payment went only partly: the record behind Home's 'only partly sent' banner is gone.
flows.md:369 documents the lock case; nothing documents removal.

**Scenario.** A Max from a private balance holding many token bundles goes as 1 part at Send plus 9 that wait, each roughly 20-60 s, with giveme.my after its parent lands. The user walks away, and the 15-minute auto-lock fires mid-chain while its countdown says nothing about it. Or they press Remove wallet, which lists nothing. Say 4 of 10 parts went. After unlocking, Home shows no banner; the recipient got part of the payment while the user believes all of it went. No money is lost: the rest stays in the private balance.

**Confirmed how.** Read the code: handlers.ts:178-180 and :588-605, LockCountdown.tsx:75-85, the parts.ts header, pending.ts:1003-1006.

**Suggested fix.** Have chains-sending, or a sibling request, also report waiting parts, so the countdown warns 'A payment is still being sent in parts: locking now stops the rest'. Add waiting parts to atStake so Remove wallet lists them. Document both in flows.md:104 and :369, and architecture.md:441 and :450.

**Test idea.** With payment-parts-chain.test.ts's setup, leave one part waiting. Then call the atStake handler and assert it lists something, and call chains-sending and assert true. Both fail today.

**Skeptic (confirmed, low).** The lock countdown asks only chains-sending, which looks at Lovejoin chains alone, so it never warns that parts still wait. Remove wallet's list (atStake) covers a maybe-sent payment, sessions, chains and a public mix that may have gone through, and never waiting parts. Once Koios took the first part, a plain Send or Make public lists nothing at all. Waiting parts live in session storage, which a lock and Remove wallet clear, so the rest silently never go. That is likely with a 1- or 5-minute auto-lock, or a long Max chain of up to 24 waiting parts. No money is lost: the rest stays in the private balance, and the review asks the user to stay unlocked. The silence after an unlock was weighed in Session 8's call 1, Claude's call still waiting for the owner. The countdown and Remove wallet gaps were not weighed anywhere.

Evidence: handlers.ts:178-180 (chains-sending) calls lovejoin.chainsSending, which at lovejoin.ts:4733-4736 checks only chains. LockCountdown.tsx:80 and :152 show the warning. handlers.ts:588-605 builds atStake, and pending.ts:237-239 counts only a maybeSent payment. parts.ts:8-14: session storage, wiped by a lock. preferences.ts:76 offers 1, 5, 15, 30 and 60 minutes. en.json:1672-1673 holds the review's partsWait lines. chunk-34-token-pools.md:1060 is Session 8's call 1, pending at :915.

## x-compat#1

**low · confirmed · docs** — The deploy runbook's rollback note describes a .prev that's gone and never mentions the token-pool routes

At `seedelf-data/deploy/README.md:142`

**Detail.** Deploy history (gh run list --workflow data-layer-deploy.yml; each run's build job ran, so each was a deploy): 2026-10-13 from 63f87b8 (1.5.0), 2026-10-15 from 304f1d1 (#311), 2026-10-23 from 68150b3 (#321). Nothing in seedelf-data/ or tokens/list.json has changed since, so the running API is current and .prev is #311's build. That build has account_update_history and pool_history but lacks lovejoin/pools, lovejoin/tokens and lovejoin/tokens/since/{cursor} (#317). The note still says '.prev is the build deployed at #302's merge' and 'once chunk 37's API is deployed, .prev lacks pool_history'; neither is true now. Its general rule ('a route the old build lacks answers 404 … holds the wallet's whole public part on Koios for 5 minutes') is wrong for the token routes: private-index.ts:341 turns their 404, 503 or unreadable answer into TokensDown, which leaves every part up. feed.ts fromFeed then falls back to tx_status, and lovejoin-pools.ts:423 to Koios's holder scan. development.md:261 repeats the same rule. The runbook also never says to check lovejoin/pools and lovejoin/tokens by hand after a deploy, which the plan's 34g step 5 asks for and /health doesn't cover.

**Scenario.** After 1.6.0 ships, the owner rolls back during an incident. The runbook predicts the wrong harm (public part held, pool pages on Koios) and misses the real one: every 1.6.0 wallet loses the data layer's pool list and token-box feed. It reads each shown token pool from Koios at every pool read and scans the holder on each Lovejoin page open, the hub loses its crowd counts, and a token-pool chain's steps are watched through tx_status. Nothing stalls and 1.5.x wallets lose nothing, but the owner can't tell any of that from the runbook.

**Confirmed how.** Read the code (private-index.ts get/tokensSince, feed.ts fromFeed, lovejoin-pools.ts refresh/look, lovejoin.ts poolRows) and the deploy workflow's run history through gh.

**Suggested fix.** Replace the two stale sentences: 'Since 1.6.0's API deploy (2026-10-23, 68150b3), .prev is #311's build (304f1d1). It has every public route 1.6.0 asks, but not lovejoin/pools, lovejoin/tokens or lovejoin/tokens/since. Rolled back to it, a 1.6.0 wallet reads the token pools from Koios (the holder, each launch's tx_info, the pools' boxes), its hub shows no crowd counts, and a token pool's chain is watched through tx_status; no part is held on Koios. 1.5.x wallets lose nothing.' Add a post-deploy step: curl lovejoin/pools and lovejoin/tokens for 200. Narrow development.md:261 to the public routes. Revisit if 1.6.0's release deploys again (then .prev is #321's build, which has every route).

**Test idea.** Docs only. Add a release-checklist line that curls both token routes after every deploy.

**Skeptic (confirmed, low).** Confirmed. The runbook's rollback note is out of date and predicts the wrong harm for today's rollback target, .prev. gh's run list shows three deploys, each with build=success: 63f87b8 on 2026-10-13, 304f1d1 (#311) on 2026-10-15 and 68150b3 (#321) on 2026-10-23. Since then nothing the API builds from has changed (seedelf-data/, or the embedded tokens/list.json), so .prev is #311's build. Its public routes are identical to HEAD's (public/ is unchanged), and HEAD's private.rs only merges in the new lovejoin routes. So a rollback today takes away lovejoin/pools, lovejoin/tokens and lovejoin/tokens/since, and nothing else. The wallet handles their 404 without holding any part: private-index.ts:341 turns it into TokensDown, an IndexDown that leaves the part up. Then refresh drops the crowd counts (lovejoin-pools.ts:420-425), look() falls back to Koios's holder scan (388-394), and fromFeed returns undefined, so the chain's steps go to tx_status (feed.ts:283-286, 250-255). README.md:142 still names #302's and chunk 37's .prev and says a missing route holds the whole public part. development.md:261 repeats that rule unqualified. Neither mentions the token routes, and the runbook has no post-deploy check of them, which the plan asks for (line 1201: '/health says nothing of them'). This is an operator doc, nothing reaches a user, and 1.5.x wallets lose nothing on such a rollback, so low. Note: if 1.6.0's release deploys again (for example a decimals refresh), .prev becomes #321's build, which has every route.

Evidence: seedelf-data/deploy/README.md:142; seedelf-platform/seedelf-web-wallet/docs/development.md:261; seedelf-data/api/src/lovejoin/routes.rs:40-44 (new in 6e7e2d49, after 304f1d1); diff of /api/v1 routes between 304f1d1 and HEAD is empty, and `git diff --stat 304f1d1 HEAD -- seedelf-data/api/src/public/` is empty; private-index.ts:318-341; lovejoin-pools.ts:388-425; feed.ts:264-288; data-layer.ts:233-241 (the public-part hold is real for /api/v1 routes); plans/chunk-34-token-pools.md:1201.

## x-compat#2

**low · confirmed · tests** — The 1.5.0 gate never runs with a token pool shown, the state every preprod wallet starts in

At `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-1-5-0.test.ts:117`

**Detail.** wire() builds LovejoinService with no pools/known, so plans(), afterUpdate() and the restore run with the classic pool alone. In production, sw.ts wires discovery: every preprod wallet gets the bundled head start's two pools (MIN 4.5 ₳ and the 5 ₳ ADA pool 18c4df77…), and every mainnet wallet gets whatever pool is shown later. Chunk 34's backward-compatibility items 3–5 promise the classic pool is unchanged where token pools exist, but the gate checks it only where none do. With lovejoinCollateral on by default (shared/preferences.ts:171), the gate also never meets a 1.5.0 session's return with the collateral tail. There is a second gap: record mode writes recorded: "1.5.0 (63f87b8)" (line 648) whatever tree runs it, so RECORD_1_5_0=1 at HEAD would silently replace 1.5.0's record with HEAD's behaviour. The fixture has been committed once (fa36ec99) and never re-recorded.

**Scenario.** Say a later change counted a token pool's empty share against the classic due times, or drew a due time per shown pool. A 1.5.0 user's classic boxes would then come back at other times on every preprod wallet, and on mainnet as soon as one pool is shown, and the gate would still pass because its LovejoinService has no pools.

**Confirmed how.** Throwaway zz-review-x-compat-pools.test.ts (deleted): the gate's afterUpdate, with pools/known returning the bundled preprod pools. The result was identical to 1.5.0's record except for the token pools listed in status().pools and the credential_utxos request naming their mix boxes. With 6 strangers' boxes in the 5 ₳ pool, the 1.5.0 session's return took the tail (deposit, a mix backed by giveme.my, the return) and the leaf came back by itself about 2.6 h later. Every classic withdraw spent the same box; one went 60 s earlier because the leaf's draw shifted the seeded generator. A refreshed list showed the session's chain 3 of 3 confirmed.

**Suggested fix.** Add a case to the gate wired the way sw.ts wires discovery (the bundled preprod pools), comparing the trace without `calls`, and status/held without `pools`. Optionally add one with a populated 5 ₳ pool that asserts the classic sends match. Make record mode refuse unless package.json's version is 1.5.0.

**Test idea.** The wired case: make withdrawDue draw an extra due time per shown token pool and the wired case fails, while today's unwired gate still passes.

**Skeptic (confirmed, low).** Confirmed as a coverage gap. The gate's LovejoinService gets no pools, known or copies: wire() leaves them out, and testBalances' deps have none. So plans(), afterUpdate() and the restore run with the classic pool alone, and collateralPool finds no 5 ₳ pool, so the collateral tail is never met. Production differs. sw.ts wires serviceDeps(discovery), and discovery's kept() merges the bundled head start, so every preprod wallet carries MIN 4.5 ₳ (dfa1f845…) and the 5 ₳ ADA pool (18c4df77…). Some coexistence with token pools is tested elsewhere: lovejoin-pools.test.ts checks Home's classic figures with a token pool beside (:228), one box a run across pools (:279), and due times kept through a read that didn't cover a pool (:293). None of that is compared with 1.5.0's recorded behaviour, which is the gate's purpose, so a seeded-draw or due-time change that only shows with pools present would slip past. The reviewer's own wired probe found no regression today, so this is a risky path untested: low. The record-mode label is hardcoded at line 648, and the fixture was committed once (fa36ec99). If the label is guarded, it should be by package.json's version: the header says the file is copied into a 63f87b8 worktree to record.

Evidence: tests/lovejoin-1-5-0.test.ts:107-142 (wire, no pools/known), 525-636 (afterUpdate), 648 (recorded: "1.5.0 (63f87b8)"); tests/fakes.ts:706-734 (deps without pools; its LovejoinService has none); src/background/sw.ts:236-246 (serviceDeps(discovery)); src/background/lovejoin-pools.ts:345-350 (head start merged), 539-556; src/lovejoin-pools.json preprod pools dfa1f845… (4.5 ₳ MIN) and 18c4df77… (5 ₳ ADA), mainnet []; git log of the fixture: fa36ec99 only.

## x-compat#3

**low · owner-call · owner-call** — A swap approved under 1.5.0 comes back with a collateral mix its approval never showed

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4107`

**Detail.** buildBack reads lovejoinCollateral when the return is built, not when the swap was approved (sessions.ts:4107-4115). The setting is on by default, and a 1.5.0 preferences record has no such key. This is the owner's recorded call (chunk-34 plan, line 977: 'Read at build, not approval'). A 1.5.0 swap still running at the update has auto.direct false and auto.lovejoin {depth, delay}, and nothing about the collateral. Its automatic return (act → bringBack, sessions.ts:3402, no review) adds the tail wherever a 5 ₳ ADA pool is shown with two free strangers' boxes. That is preprod's bundled pool today, and mainnet as soon as anyone starts one; the wallet's own Start a pool can. The same applies to a 1.6.0 swap approved while no 5 ₳ pool was shown. The plan's own Next (34g, 'Start here') still lists the tail's first live run with giveme.my's witness as not done.

**Scenario.** A user approved a swap in 1.5.0, to come back through Lovejoin, before the update. Its return takes about 1 ₳ more in fees out of what the approval said comes back at once. Its 5 ₳ collateral comes back hours later as a box, less a withdraw fee, instead of at once, and giveme.my sees that mix. In the throwaway harness, the 1.5.0 record's session 0 return (by hand, so reviewed) went from 22.18 ₳ back at once with a 0.17 ₳ fee to 16.18 ₳ with a 1.17 ₳ fee, plus the 5 ₳ box later. A swap's automatic return shows none of this before it's sent.

**Confirmed how.** Read the code, then ran the throwaway harness above with a populated 5 ₳ pool and compared against 1.5.0's recorded return.

**Suggested fix.** The owner's call. Either keep it, as decided. Or, for an automatic return, take the tail only when the approval recorded it: for example a flag on auto.lovejoin, set when the approval showed CollateralReserveRow. Then a swap approved before 1.6.0, or before a 5 ₳ pool was shown, comes back as approved.

**Test idea.** A 1.5.0-shaped swap record (auto.lovejoin {depth, delay}, no flag) run to its fill with a populated 5 ₳ pool: its automatic return has no collateralTail.

**Skeptic (owner-call, low).** The docs record this as a call: Session 10's 'For the owner (calls made, yours to overturn)', item 1, 'Read at build, not approval'. A swap's approval fixes auto.direct, and the collateral switch is read when the return is built. HEAD's code does exactly that, and a 1.5.0 preferences record falls back to the default, which is on. The reviewer's scenario holds on preprod, but the exposure is narrower than stated. On mainnet the tail needs a shown 5 ₳ ADA pool holding the network's floor of 30 boxes that aren't the wallet's, plus two free (collateralPool → floorShort). There is none at release, the head start lists no mainnet pool, and the plan says we launch none. So 'mainnet as soon as anyone starts one' is wrong: on mainnet it takes, for example, a 1.5.0 order left unfilled for weeks and then stopped, after such a pool has filled. Preprod's floor is 0, so it applies there today, with test ADA. Nothing is lost: about 1 ₳ more in fees, and the 5 ₳ comes back hours later as a box, less a withdraw fee. giveme.my seeing that mix is documented in privacy.md. One thing the call may not have weighed: HEAD's swap review still says 'Changing Lovejoin in Settings won't change this swap.' 1.5.0's approval said the same. But the collateral switch is on Settings → Lovejoin and is read at the return's build, so that sentence is now partly false. Put it to the owner with the call. The plan's Next line still lists the owner's look at Session 10's calls as pending, and so is the tail's first live run with giveme.my's witness.

Evidence: plans/chunk-34-token-pools.md:976-977 (call 1), 915 (Next: the tail live on preprod with giveme.my's first witness; 'the owner's look at … Session 10's and Session 11's'), 995 (the floor, 30 on mainnet); sessions.ts:4101-4115 (intoPool reads collateralIntoPool at build), 4312-4315, 4337-4341 (throughLovejoin: auto.direct); lovejoin.ts:3474-3483 (collateralPool: floorShort and TAIL_DRAWS), 2858-2862; networks.ts:56 (preprod poolFloor 0), 71 (mainnet 30); shared/preferences.ts:171 and background/preferences.ts:124-125 (a missing key defaults to true); Swaps.tsx:1629 and en.json:2213 'Changing Lovejoin in Settings won't change this swap.' (the same string in 63f87b8's en.json); Settings.tsx:836-855 (the collateral switch on the Lovejoin settings page); 1.5.0's 'swaps.plan.backAdaOut': '…the rest at once'.

## x-i18n-es#0

**low · confirmed · i18n** — lovejoin.pools.starting

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:1349`

**Detail.** English "Being started: {{have}} of {{floor}} boxes" became "En marcha: {{have}} de {{floor}} cajas". In this file's own Spanish, "en marcha" means running or started: dapps.running (L559) is "{{count}} en marcha" and pending.confirmed.lovejoin_launch (L1557, "Your Lovejoin pool is started") is "Tu pool de Lovejoin está en marcha". The flag appears only while the pool holds fewer boxes that aren't yours than the floor (lovejoin-pools.ts:173-176 bootstrapProgress, shown at Lovejoin.tsx:1783), which is exactly when the wallet won't mix in it. So the Spanish says the opposite of the state it marks.

**Scenario.** A Spanish user opens Lovejoin's pool list. A token pool with 2 of the 8 boxes it needs shows the flag "En marcha: 2 de 8 cajas" ("Running: 2 of 8 boxes"). They take the pool for a working one and choose it to mix, but the wallet refuses because the pool is below its floor. Its own page then says "Ayuda a poner en marcha este pool" ("Help start this pool"), which contradicts the flag. No money is at risk; the user is just misled about whether the pool works yet.

**Confirmed how.** Read the code: Lovejoin.tsx:1781-1790, lovejoin-pools.ts:173-176, and the other uses of "en marcha" in es.json (L559, L1557).

**Suggested fix.** Use the Bootstrap vocabulary, which says the pool isn't running yet, e.g. "Arrancando: {{have}} de {{floor}} cajas" or "Poniéndose en marcha: {{have}} de {{floor}} cajas". Consider adding to glossary.md the 1.6.0 terms it lacks (Bootstrap → arranque, start a pool → iniciar / poner en marcha, being started), so started and being-started stay apart.

**Test idea.** In tests/i18n.test.ts: expect(es["lovejoin.pools.starting"]).not.toMatch(/^En marcha/i). It fails today.

**Skeptic (confirmed, low).** The flag appears only while the pool holds fewer boxes that aren't the user's than its floor. In that state the pool's page says it can't be mixed in yet. Everywhere else in es.json, "en marcha" means running or started: dapps.running says "{{count}} en marcha", pending.confirmed.lovejoin_launch says "Tu pool de Lovejoin está en marcha", and activity.title.lovejoinLaunch says "Pool de Lovejoin puesto en marcha". The same pool's page is titled "Ayuda a poner en marcha este pool" ("help start this pool"). The English ("Being started") and the Japanese (立ち上げ中) both say "not yet"; the Spanish drops that. The value is an unchecked machine draft. It stays low rather than medium: the next screen sets the user straight before Review, since the floor-short sentence and the Bootstrap title lead that page, and nothing is signed on the strength of the flag.

Evidence: es.json:1349; src/ui/lovejoin-pools.ts:173-176 (shown only when others < floor); Lovejoin.tsx:1781-1783 (the flag); Lovejoin.tsx:2572-2576 ("The pool can't be mixed in yet", short = others < floor); es.json:559, 1557, 118 (en marcha = running or started); es.json:1400 (lovejoin.bootstrap.title "Ayuda a poner en marcha este pool"); ja.json:1163 立ち上げ中; docs/i18n/es-provenance.json: machine

## x-i18n-es#1

**low · confirmed · i18n** — settings.lovejoin.collateralOn

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:2092`

**Detail.** English: "... if that pool exists and holds enough of theirs. A session funded while it does pays a little more for that mix ...". Spanish: "... si ese pool existe y tiene suficientes cajas suyas. Una sesión financiada mientras lo tenga paga un poco más por esa mezcla ...". "mientras lo tenga" ("while it has it") points at nothing: no masculine noun in the sentence matches "lo", and the pool-exists part is lost. The real rule is in sessions.ts:4323-4328 (tailReserve): the extra is charged only when the return goes through Lovejoin, the setting is on, and a 5 ₳ pool would take the box now. The sentence after it, "Si no, el colateral vuelve con el resto.", now reads as if it follows the funding sentence rather than the pool condition. The English has the same order, introduced in PR #323.

**Scenario.** A Spanish user turns on "Al traer de vuelta una sesión, mezclar su colateral de 5 ₳ en Lovejoin" in Settings (shown at Settings.tsx:841). They read that a session funded "mientras lo tenga" pays a little more, but can't tell when that applies. They can also read "Si no" as "if the session wasn't funded that way", rather than "if the 5 ₳ pool isn't there or is too small". The cost rule shown in Settings is unclear in Spanish.

**Confirmed how.** Read the code: sessions.ts:4317-4328 (tailReserve, collateralPool) and Settings.tsx:838-842. Traced the value's history: 4d5bf583, then 23bcf241, then 24c5c62a (PR #323) added the sentence.

**Suggested fix.** Name the condition and keep "If not" next to it. For example: "Al traer de vuelta una sesión, su colateral de 5 ₳ pasa a ser una caja del pool de cajas de 5 ₳ de Lovejoin y se mezcla una vez con dos cajas de otras personas, si ese pool existe y tiene suficientes cajas suyas; si no, el colateral vuelve con el resto. Una sesión financiada mientras ese pool exista y tenga suficientes cajas paga un poco más por esa mezcla, y lo que la mezcla no use vuelve. La caja mezclada vuelve por sí sola." Reorder the English and Japanese the same way.

**Test idea.** In tests/i18n.test.ts: expect(es["settings.lovejoin.collateralOn"]).not.toContain("mientras lo tenga"). Also check that the "Si no," sentence comes right after the clause with "si ese pool existe".

**Skeptic (confirmed, low).** In "mientras lo tenga", the pronoun "lo" points at nothing. It can't stand for "suficientes cajas" (that would need "las"). The only masculine nouns nearby give wrong readings: "colateral" gives "a session funded while it has its collateral", and "pool" gives "while it has the pool". So the condition for the extra cost is lost. That condition is in tailReserve: the reserve is charged only when the return goes through Lovejoin, the setting is on, and a 5 ₳ pool would take the box now. The "If not" placement comes from the English: commit 24c5c62a (PR #323) put the funding sentence between the pool condition and "If not", and the Japanese has the same order (そうでなければ after the funding sentence). That misreading is also false on the code's terms. At return the collateral goes in whenever the pool qualifies at that moment, whether or not the funding paid the reserve; collateralReserve is only passed along. So "if the session wasn't funded that way, the collateral comes back with the rest" is untrue. The suggested reorder should be applied to all three locales, not only the Spanish.

Evidence: es.json:2092; en.json:1964; ja.json:1836; git show 24c5c62a (the funding sentence added before "If not" in en, and "mientras lo tenga" in es); sessions.ts:4318-4328 (tailReserve); sessions.ts:4107-4115 (intoPool decided at return with no collateralReserve condition); sessions.ts:4195 (collateralReserve only passed along); Settings.tsx:840-842 (note shown while the setting is on)

## x-i18n-ja#0

**low · confirmed · ux-words** — worker.parts.partlyMaybe / worker.parts.fundingPartlyMaybe: "Koios didn't answer" names the wrong server on mainnet (en, es and ja)

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:3036`

**Detail.** parts.ts:599 throws worker.parts.partlyMaybe when the last part's send comes back maybe-sent; sessions.ts:5379 does the same for worker.parts.fundingPartlyMaybe. That send goes through pending.ts:462-472, `deps.koios(network).submitTx`. On mainnet that client is chainClient's DataLayerKoios (data-layer.ts:430-438, wired at sw.ts:181), and its submitTx (data-layer.ts:393-420) tries Seedelf Wallet's own server first. When that server times out it throws KoiosBusyError with koios.dataNoAnswer, "The server didn't answer", flagged maybe-sent. So on mainnet the server that went silent is usually the wallet's own; Koios is only correct on preprod, with Koios-only on, or while the submit part is down. Every 1.5.0 string for this state says "the server": koios.dataNoAnswer, worker.pending.maybeSentWait, lj.boxMaybeSent, swaps.retry.koiosSilent (ja サーバーが応答しませんでした). The two new keys say Koios in all three languages: ja.json:2873 and 2875 (「Koios が応答しなかったため」), es.json:3199 and 3201 ("Koios no respondió"), en.json:3036 and 3038.

**Scenario.** On mainnet with the data layer up, a user sends a Max that goes as 3 transactions, and the wallet's own server times out on part 2. The screen says Koios didn't answer, but the transaction went to Seedelf Wallet's server, as the privacy policy says mainnet sends do. A user who doesn't use Koios is told a third party had their transaction.

**Confirmed how.** Read the code: parts.ts:596-599, sessions.ts:5373-5379, pending.ts:462-472, data-layer.ts:126-141, 393-438, sw.ts:176-181, and compared the 1.5.0 strings for the same state in all three locales.

**Suggested fix.** en: "…but the server didn't answer for the last one…" in both keys. ja: 「…最後の 1 件にサーバーが応答しなかったため…」 (and 「最後に送った 1 件にサーバーが…」). es: "…pero el servidor no respondió…". This follows koios.dataNoAnswer.

**Test idea.** A Vitest that runs sendParts with a DataLayerKoios whose data-layer submit times out on part 2, then asserts the thrown message doesn't name Koios. Or a words guard: no worker.parts.* value names Koios.

**Skeptic (confirmed, low).** This holds on HEAD. On mainnet the parts' send goes through DataLayerKoios, and a timeout at the data layer throws koios.dataNoAnswer ("The server didn't answer"), maybe sent. So in the usual mainnet case the server that went silent is Seedelf Wallet's own, yet these two new keys say Koios in en, es and ja. The owner decided in 1.4.0 that screens say "the server" wherever either one may answer, and since then every other maybe-sent string does (koios.dataNoAnswer, koios.timeout, worker.pending.maybeSentWait, pending.maybeSent.*, lj.boxMaybeSent, swaps.retry.koiosSilent). It stays low, not medium: the privacy policy already allows Koios for anything our server can't answer, and resends while the submit part is down do go to Koios. So the user sees a wrong name, not a broken promise. When fixing, also change tests/sessions-review-fixes.test.ts:703, which pins the old English on preprod.

Evidence: parts.ts:599 and sessions.ts:5379 throw the keys. pending.ts:462/470/472 sends via deps.koios(network).submitTx. data-layer.ts:393-405: data.submitTx fails, submitFallback (136) returns "maybe" on a timeout, and it throws KoiosBusyError(t("koios.dataNoAnswer")); also 418. sw.ts:181 const koios = chainClient(dataDeps). The owner's call: docs/privacy.md:119 and docs/flows.md:23 ("Since 1.4.0 the screens say 'the server'"). en.json:3036/3038, es.json:3199/3201 and ja.json:2873/2875 are the only send-state values naming Koios (en.json grep). The 1.5.0 en (63f87b8) has none.

## x-i18n-ja#1

**low · confirmed · i18n** — worker.parts.partlyMaybe

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json:2873`

**Detail.** English "Once it's settled, review what's left again" covers either outcome: the maybe-sent part lands, or pending.ts lets it go as unseen or expired. The Japanese 「それが確定したら」 means "once it's confirmed" only. The Spanish keeps both outcomes ("Cuando se resuelva"), and the 1.5.0 Japanese for the same state (worker.pending.maybeSentWait, ja.json:2810) says 「確定したか、確定できなくなったかはホームに表示されます。その後に…」. The value also drops トランザクション (「{{total}} 件のうち {{sent}} 件」), where worker.parts.partly (ja.json:2872) says 「{{total}} 件のトランザクションのうち」.

**Scenario.** Part 2 of a Make public in parts gets no answer and in fact never went; Home later says it can't land. A Japanese user was told to wait until it's 確定 (confirmed), so they keep waiting for a confirmation that won't come instead of reviewing the rest again.

**Confirmed how.** Read the code (parts.ts:596-600: the rest never go, and the user reviews again) and compared ja with es and with the 1.5.0 ja for the same state.

**Suggested fix.** 「{{total}} 件のトランザクションのうち {{sent}} 件を送りましたが、最後の 1 件にサーバーが応答しなかったため、残りは待機しています。それが確定するか、確定できなくなったら（ホームに表示されます）、残りをもう一度確認してください。」

**Test idea.** No automatic test fits. Give it the blind back-translation the critical keys get, or add 'settled → 確定したか、確定できなくなったか' to the glossary.

**Skeptic (confirmed, low).** In this app's Japanese, 確定 means "lands": pending.maybeSentTitle uses まだ確定していません for "not confirmed yet", and swaps.now.funding says 資金提供を確定する. So 「それが確定したら」 means "once it lands" and drops English's other outcome, that it can't land. The 1.5.0 value for the same state spells out both (「確定したか、確定できなくなったか」). It stays low and goes no higher: when the part never went, Home's pending.dropped.unseen says it most likely wasn't sent and to check Activity before sending again, so the user isn't stuck. The missing トランザクション is only a nit: here 件 does count transactions, so the 34e ambiguity (件 meaning boxes) doesn't apply. The key is a non-critical machine draft. It is the same value as finding 0's ja fix, so both can be fixed in one edit.

Evidence: ja.json:2873 「…それが確定したら、残りをもう一度確認してください。」; ja.json:2810 (1.5.0) 「確定したか、確定できなくなったかはホームに表示されます」; es.json:3199 "Cuando se resuelva". parts.ts:229-235 letGo: the held parts "are freed, and never go". ja pending.dropped.unseen: 「…おそらく送信されていません。…もう一度送る前にアクティビティを確認してください」. docs/i18n/ja-provenance.json: worker.parts.partlyMaybe = machine, not critical.

## x-i18n-ja#2

**low · confirmed · i18n** — lovejoin.ways.fundedInto

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json:1261`

**Detail.** This shows on a swap's review (LovejoinReturn.tsx:241, TokenWays with funded=true): the token's Lovejoin boxes are paid for at Send, out of the private session's funding. The Japanese says 「（費用は今回の入金に含む）」. Everywhere else in ja.json, 入金 means paying into the public account from outside (collateral.fundFirst, home.start.fund.title, home.busy.fundFirst*, worker.mint.accountEmpty). The glossary (docs/i18n/glossary.md, the funding row) keeps 資金提供 for a private session's funding, and every swap screen says 資金提供 (swaps.stage.funding, swaps.now.funding, swaps.pause.warn.short).

**Scenario.** On a swap whose received token goes through its own pool, the review reads 「Lovejoin 経由：ボックス 2 件（費用は今回の入金に含む）」, "the cost is included in this deposit". No deposit into the public account is happening, so the user can't tell the boxes are paid from the swap's private funding.

**Confirmed how.** Read the code (LovejoinReturn.tsx:208-245) and grepped every 入金 in ja.json.

**Suggested fix.** 「Lovejoin 経由：{{boxes}}（費用は今回の資金提供に含む）」

**Test idea.** A glossary guard in i18n.test.ts: no ja value contains 入金 (追加入金 aside) except keys about funding the public account.

**Skeptic (confirmed, low).** TokenWays shows fundedInto only on a swap's review (funded=true, from Swaps.tsx). There the boxes are paid from the private session's funding at Send. The glossary reserves 入金 for paying into the public account from outside, uses 資金提供 for a private session's funding, and keeps 追加入金 for a site's top-up. Every other bare 入金 in ja.json is a public-account deposit, and every swap screen says 資金提供. The rough meaning (the cost is covered by what goes in now) survives, so this isn't higher than low. But on a money line, the glossary's word for another flow misleads about where the money comes from. The key is a non-critical machine draft, so the one-word fix (資金提供) needs no back-translation round.

Evidence: ja.json:1261 「Lovejoin 経由：{{boxes}}（費用は今回の入金に含む）」; LovejoinReturn.tsx:241 (funded ? lovejoin.ways.fundedInto); funded passed only at Swaps.tsx:1372 and 1559 (not SiteSessions.tsx:283 or Swaps.tsx:2239). glossary.md funding row: '資金提供 | 入金 is paying into the public account from outside'. Other 入金: ja.json:189, 726, 727, 730, 785, 2802. Swaps: ja.json:2171, 2192, 2284 (資金提供).

## x-privacy#0

**low · confirmed · privacy** — A stuck pool's Bring one back can tie two public accounts with neither named

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6126`

**Detail.** In a pool whose boxes can't pay their own way back, Bring one back of a held Bootstrap box (heldRequest) or a not-mixed box (anywayRequest) is paid by whichever payer the question's buttons name (Lovejoin.tsx PayerButtons 755-771, PayerNotes 773-779). withdrawOne with paid "private" takes the first pure box-back UTxO, else the smallest UTxO of ADA alone of any history. lovejoin.ts:6126 sorts by origin==='lovejoin', then by value, with no account check. With paid true it uses the active account (6110, payer = keys.account). The box itself can belong to another account: a public Bootstrap's held box or a public mix's not-mixed box counts as that account's (privacy.md:210; depositAccountOf at 6176). The wallet records the tie only after Send (6176-6181: ties = [payer, deposited]). Before Send, the question says only "Your public account paid for that Bootstrap" (lovejoin.bootstrap.privacy.account; fromAccount at Lovejoin.tsx:2590/3083 is built from every account's fromPublic) and "anyone can tie that UTxO, and where it came from, to the box" or "anyone can tie your public account to the box". It never names the account, though rpc.ts:2165-2170 `otherAccounts` carries it. privacy.md:92/:97 promise that every screen that could link accounts says so, and C01 refuses this same tie for Mix again from my public account. The listing says the wallet warns before a step ties your accounts together (store/README.md:65).

**Scenario.** A user with two public accounts Bootstraps a token pool from account 1. Later the fees rise and the pool's boxes can't pay their own way back. On account 2 they press Bring one back on a held box and keep the default, Pay from my private balance. No pure box-back UTxO pays, so the wallet takes the smallest UTxO of ADA alone: money made private from account 2. The one withdraw spends account 1's unmixed Bootstrap box together with account 2's money, so anyone can tie the two accounts. Pay from my public account makes the same tie, with account 2 paying for account 1's box. Neither question named account 2 or said the accounts would be tied.

**Confirmed how.** Read the code: lovejoin.ts withdrawNowNow 5697-5790 and withdrawOne 6080-6181; Lovejoin.tsx HeldQuestion 1008-1055, AnywayQuestion, PayerNotes 773-779 and the call site 3079-3086; rpc.ts otherAccounts.

**Suggested fix.** Where the box is another account's (otherAccounts in the page, depositAccountOf in the worker), name that account in the question. Either refuse the public payer from a different account, as C01 does for Mix again, or say that it ties the two. For the private payer, skip UTxOs whose history names a different public account than the box's, or name that account before Send.

**Test idea.** A Vitest on withdrawNow in a stuck pool: a held Bootstrap box whose chain record names account 1, active account 2, and a smallest private UTxO classed public:2. Expect that UTxO to be skipped, or the question to carry account 2, and expect paid:true from account 2 to be refused. Today it sends, with ties [1,2].

**Skeptic (confirmed, low).** This survives on HEAD. In a token pool whose boxes can't pay their own way back, Bring one back on another public account's box can tie two of the user's accounts, and neither question names them.

Case 1: the public payer, paid:true. It is always the active account (lovejoin.ts:6115, payer = keys.account), with no check against depositAccountOf (1843-1852). So on account 2, paying for account 1's held public-Bootstrap box, or for its public mix box cut at its deposit, spends account 2's UTxO beside account 1's box. That ties the two accounts.

Case 2: the private payer, paid:'private'. It takes a pure box-back UTxO first, otherwise the smallest (6125-6127), with no look at history. A UTxO made private from account 2 can pay for account 1's box. This happens even when account 1 is the active account.

What the page says, and why it misleads:
- HeldQuestion gets only a boolean, fromAccount. It is built from every account's fromPublic ('theirs': Lovejoin.tsx:2556 and 2590, call at 3083), and it shows en.json:1175: 'Your public account paid for that Bootstrap…'.
- A user on account 2 reads that as the account on screen. Then 'Pay from my public account… ties your public account to the box' (en.json:1313) seems to add no new tie.
- The worker already gives the page the account index (status otherAccounts, lovejoin.ts:5151-5154). But the page drops held boxes from OtherAccounts (Lovejoin.tsx:1136), so nothing on it names account 1.
- The anyway question has the same gap ('your public account', anywayWarning at 702-718).

This falls short of the docs' standard, 'every screen that could make one says what it would reveal' (privacy.md:92). Co-spending reviews name the accounts (privacy.md:94), as other screens do ('Ties Account 2 to Account 1, which paid for this Seedelf', tests/minted-by.test.ts:250). The listing makes the same promise (store/README.md:65).

The fix should name the accounts in the question. It should not refuse the payer: the owner's rule is 'honesty, not enforcement' and no paternalistic guards.

I rate it low because it needs several public accounts, a public deposit's box still at its deposit, and a stuck token pool. Mainnet has no token pools yet.

Evidence: lovejoin.ts:6107-6127 (payer = active account; sorting by origin==='lovejoin' and then by value), :6176-6181 (ties recorded at the withdraw), :1843-1852 depositAccountOf, :5151-5154 otherAccounts with the account index; Lovejoin.tsx:2556/2590/3083 (fromAccount boolean from every account's boxes), :1007-1055 HeldQuestion, :773-781 PayerNotes, :1136 (held boxes left out of OtherAccounts), :702-718 anywayWarning; en.json:1175, 1312-1313; privacy.md:92, :94, :97, :210; store/README.md:65

## x-privacy#1

**low · confirmed · ux-words** — The swap approval and the Lovejoin tile's private mix reviews don't say giveme.my sees the collateral's mix

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1332`

**Detail.** When a 5 ₳ pool is shown and Settings' defaults hold, three fundings reserve 1.5 ₳ for the session's collateral mix (sessions.ts:1752, 1961): a swap's, a mix from the Lovejoin tile's private side, and Mix my boxes again. Their reviews show only CollateralReserveRow (Swaps.tsx:1332, Lovejoin.tsx:3277, 3340). The session's return then runs by itself ("Start swap approves every step", "Then it runs by itself"), and its collateral mix goes to giveme.my from the device (lovejoin.ts tailWitness, 3563-3580). The note that giveme.my backs and sees that mix, and that a mix that can't go leaves the box tied to the session (lovejoin.collateralBox.privacy.note via CollateralTailNote, LovejoinReturn.tsx:470-476), appears only on returns reviewed by hand (Swaps.tsx:2255, SiteSessions.tsx:293, ClaimAll.tsx:412). These approvals' GivemeNote speaks of "this payment" only (Swaps.tsx:1375, Lovejoin.tsx:3310). privacy.md:121 says every review that asks giveme.my says so where it's read.

**Scenario.** On preprod, whose bundled pool list shows a 5 ₳ pool, a user approves an ADA-to-token swap with default settings. The approval shows "For its collateral's mix: 1.5 ₳" and that giveme.my sees the funding. When the order fills, the wallet sends the return chain by itself. That chain includes the collateral's mix, which goes to giveme.my from whatever IP address the device has then and ties that address to the session's one-time account. Nothing the user approved said giveme.my would see that mix.

**Confirmed how.** Read the code: the approval and review components, and CollateralTailNote's call sites.

**Suggested fix.** Where summary.collateralReserve is set, show the collateralBox privacy note (or a short form of it) beside CollateralReserveRow on the swap approval and on the tile's private mix and Mix my boxes again reviews.

**Test idea.** A screens test that renders SwapApproval and the Lovejoin private review with collateralReserve set and expects the collateralBox privacy note's text. It fails today.

**Skeptic (confirmed, low).** This survives as a gap in what the approvals say. Three fundings show only CollateralReserveRow, 'For its collateral's mix: 1.5 ₳…': the swap approval (Swaps.tsx:1332), the tile's private mix (Lovejoin.tsx:3277) and Mix my boxes again (Lovejoin.tsx:3340). Their returns then run by themselves, and the collateral's mix is witnessed by giveme.my (tailWitness, lovejoin.ts:3570-3580).

The note that says giveme.my backs and sees that mix, and that a mix that can't go leaves the box tied to the session, is CollateralTailNote (LovejoinReturn.tsx:470-478). It shows only on returns reviewed by hand (Swaps.tsx:2255, SiteSessions.tsx:293, ClaimAll.tsx:412). The design therefore discloses the mix before it goes on those reviews, but not on the approvals of flows that run by themselves. The GivemeNote on those approvals speaks only of 'this payment'.

Why only low:
- Nothing on the approvals is false.
- Approvals never listed giveme.my's later witnesses: the automatic box withdraws since 1.0 aren't on the swap approval either. LOVEJOIN_SEEN appears in Settings (Settings.tsx:810) and on the Lovejoin page (Lovejoin.tsx:3193).
- The policy's row 28 and its 18 October entry disclose the collateral mix.
- Today it only happens on preprod, whose bundled list has the 5 ₳ pool 18c4df77. On mainnet nothing happens until a 5 ₳ ADA pool holds 30 other boxes.

The owner hasn't ruled on this. Session 10's call 2 was about the 'comes back with' wording, not giveme.my. The fix can reuse the existing critical key lovejoin.collateralBox.privacy.note where collateralReserve is set, so nothing new needs translating. Keep it short: the owner has pushed back on paragraphs.

Evidence: Swaps.tsx:1332, 1375; Lovejoin.tsx:3277, 3310, 3340; LovejoinReturn.tsx:470-487; Swaps.tsx:2255; SiteSessions.tsx:293; ClaimAll.tsx:412; lovejoin.ts:3570-3580; sessions.ts:1752, 1961; src/lovejoin-pools.json preprod pool 18c4df77 at boxLovelace 5000000; en.json:1010, 1680, 2376

## x-privacy#2

**low · confirmed · docs** — giveme.my's lists of what it sees leave out the session collateral's mix

At `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:49`

**Detail.** giveme.my now witnesses a Lovejoin mix, not only Seedelf spends: the session collateral's mix (lovejoin.ts:3563-3580; core mix_giveme at lovejoin/mod.rs:803-811, giveme.my's collateral and required signer at 1007-1015). That mix spends the session's fee UTxO, returns change to the one-time account and is signed by the session's key (wasm/src/lovejoin.rs:221-229). It is sent once the deposit is on chain and after the Cardano server measures it. The policy's "Your Lovejoin boxes" row (28) and its 18 October entry (93) say so. These places leave it out:
- the services section's giveme.my bullet (49), written as the full list: private payments, session fundings, boxes brought back, pool starts;
- privacy.md's Network bullet (121) and rule 7 (50);
- the store's giveme.my justification and the merged host box (store/README.md:263, 269), which say "adds shared collateral to Seedelf script transactions".
Two neighbouring store rows are also out of date. The Koios row (261) says it "evaluates scripts (for two reviews…)" but misses the collateral mix's evaluation, which happens after Send. The alarms row (257) doesn't list a payment's later parts, which the alarm now sends (parts.ts).

**Scenario.** A reader checking what giveme.my, the developer's own service, learns reads the policy's services section and privacy.md's Network section. Both suggest it never sees a session's return. With 1.6.0's defaults, every private session that comes back through Lovejoin while a 5 ₳ pool is shown sends giveme.my its collateral mix, naming the one-time account, from the IP address of the return.

**Confirmed how.** Read the code and the docs.

**Suggested fix.** Add "and each private session's 5 ₳ collateral mix in Lovejoin, from its one-time account" to privacy-policy.md:49 and privacy.md:121 and :50. In store/README.md, name the collateral's Lovejoin mix beside Seedelf script transactions (263, 269), add its evaluation to the Koios row (261), and add the rest of a payment sent in parts to the alarms row (257).

**Test idea.** A docs check, like the word checks in tests/privacy-notes.test.ts, that the policy's giveme.my bullet and privacy.md's Network bullet name the collateral mix. It fails today.

**Skeptic (confirmed, low).** This survives as summary lists that are out of date. Not a hidden practice. The collateral's mix is witnessed by giveme.my (lovejoin.ts:3578) and measured first by the Cardano server's evaluate (3572).

These places leave it out:
- The policy's giveme.my services bullet (privacy-policy.md:49) lists private payments, session fundings, boxes brought back and pool starts, under 'each Seedelf transaction it adds collateral to'.
- privacy.md:121 (the Network list).
- privacy.md:50 (rule 7).
- store/README.md:263 and :269 say 'Seedelf script transactions'. That wording was already loose for Lovejoin box withdraws.
- The Koios row (store/README.md:261) names only 'two reviews' for evaluations.
- The alarms row (store/README.md:257) doesn't list a payment's later parts, which the sessions alarm now sends (parts.ts header, pumpParts). That one isn't about privacy.

It is disclosed elsewhere in the same documents: policy row 28, the policy's 18 October entry (line 93), and privacy.md:217. That keeps it low: a reader of the services section alone is told less than the policy's own data table says.

Evidence: store/privacy-policy.md:49 (the list leaves it out) against :28 and :93 (both disclose it); privacy.md:50, :121 against :217; store/README.md:257, 261, 263, 269; lovejoin.ts:3570-3580; parts.ts:1-14

## x-privacy#3

**low · owner-call · privacy** — Private session fundings read every Lovejoin pool afresh to price the collateral's reserve

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4323`

**Detail.** tailReserve (4323-4327) calls lovejoin.collateralPool. Once discovery has kept a shown 5 ₳ ADA pool, that calls split (lovejoin.ts:3474-3483, then 6015-6031), which makes a non-quiet readSet (the data layer's pool list) and a full, uncached pool listing. On mainnet that listing is our server's lovejoin/pool + since and lovejoin/tokens + since; otherwise it is Koios's credential_utxos of every pool. With Lovejoin returns on (the default), it runs at every session funding build: a swap's (1752), a site's private session in the connect window (1837), a mix's (1961) and a site session's top-up (2047). In 1.5.0, siteOutBuild and topUpBuild read no pool (63f87b8 sessions.ts:1423-1439). A swap approval's switch and Change also call session-out-build again (Swaps.tsx:787-806, 910-911), so each one re-reads every pool. That contradicts privacy.md:205 (those rebuilds use "the reads its first build made") and room()'s five-minute cache, kept so that "reviews in a row ask Koios once" (lovejoin.ts:2761-2788). Neither privacy.md's account of when the pools are read (198, 217, 233) nor the policy (28, 93, a read "to draw those two boxes") mentions a funding's review. Preprod's bundled head start already holds a 5 ₳ pool (src/lovejoin-pools.json). On mainnet this starts once someone launches one.

**Scenario.** On preprod with default settings, a user connects a site to a new private session. Building the connect window's review reads every Lovejoin pool from Koios from their IP, which 1.5.0 never did for a site. Toggling Bring it back through Lovejoin three times on a swap's approval reads them three more times. Nothing of the user's is named, but the server sees Lovejoin reads at each site connection, where the docs say no read happens.

**Confirmed how.** Read the code: tailReserve and its four callers in sessions.ts; collateralPool, split, poolRows and rooms in lovejoin.ts; the 1.5.0 siteOutBuild and topUpBuild through git show.

**Suggested fix.** Have collateralPool reuse the review's pool read: the POOL_ROOM_MS cache of rooms()/splitAll, or a split cached the same way. Then say in privacy.md (Lovejoin, What Koios learns) and in the policy that a private session's funding review reads the pools where a 5 ₳ pool is shown.

**Test idea.** A Vitest with a fake Koios that counts credential_utxos, and a 5 ₳ pool in the head start. Build siteOutBuild twice within five minutes, and outBuild with through toggled. Expect one pool read in all; today there is one per build.

**Skeptic (owner-call, low).** The code does what the finding says, but the owner chose it on purpose for 1.6.0.

What happens: tailReserve (sessions.ts:4323-4327) calls collateralPool (lovejoin.ts:3474-3483). Once a 5 ₳ ADA pool is shown, that runs split (6015-6031): a readSet that asks discovery, plus an uncached listing of every pool. It runs:
- at the swap's, the site's and the mix's funding builds (sessions.ts:1752, 1837, 1961);
- at a top-up only where it pays a new collateral (2045-2047);
- again each time the swap approval's switch is turned on, or Change is used (Swaps.tsx:787-806, 910-911).
1.5.0's siteOutBuild read no pool.

Why it's the owner's call: the collateral mix's review left exactly this for the owner (commit f89a1d01: 'collateralPool lists the pools on every build and funding review, every network'). The owner decided on 2026-10-23 (plan:955): 'No 5 ₳ pool is read for a return whose account holds no 5 ₳ to mix. The rest (the five-minute room cache for funding reviews, one listing through the whole build) after release.' So no code change before release.

What's left is in the docs, and fixing them doesn't conflict with that call:
- privacy.md:198 says the swap approval's read is 'kept for five minutes'.
- privacy.md:205, written 2026-10-18 before the tail existed, says Change and the switch rebuild 'with the reads its first build made'.
- Both now overstate the caching wherever a 5 ₳ pool is shown.

The read is the same for everyone and names nothing of the user's. The policy's 'Lovejoin's pools when you use Lovejoin' (line 41) broadly covers it. Note that toggling the switch off never reads, so the finding's 'three more reads' overstates it.

Evidence: sessions.ts:1752, 1837, 1961, 2045-2047, 4323-4327; lovejoin.ts:3474-3483, 2254-2266 (readSet), 6015-6031 (split), 2548-2553 (listing, uncached), 2771-2788 (rooms, cached); Swaps.tsx:787-806, 910-911; 63f87b8 sessions.ts:1423-1439 (no read); chunk-34-token-pools.md:955 (the owner's call); f89a1d01 ('collateralPool lists the pools on every build and funding review'); privacy.md:198, :205

## x-privacy#4

**low · owner-call · owner-call** — The policy is dated 18 October, but its 1.6.0 entry includes changes from 19 to 23 October

At `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:3`

**Detail.** "Effective 18 October 2026" (3) and the "18 October 2026" Changes entry (93) now also describe the owner's calls 34-36, made on 19 October (5550d156), and the session collateral's mix, decided on 22-23 October (3a7b546e, 1d55700b). The page promises to update its date, and list the change, before a version ships (91). Session 5 asked the owner whether to re-date it (docs/plans/chunk-34-token-pools.md:1188); no answer is recorded.

**Scenario.** When 1.6.0 reaches the store, a user reading the policy sees changes listed as of 18 October that weren't decided until 23 October. The date doesn't tell them which wallet version first did them.

**Confirmed how.** Read the docs and the policy's git log.

**Suggested fix.** Re-date the effective date and the entry to 1.6.0's release day, or give the collateral mix its own dated entry, as the owner answers.

**Test idea.** A release-checklist check that the policy's effective date is no earlier than the newest commit touching it.

**Skeptic (owner-call, low).** This is an open question to the owner, asked twice and never answered.
- plan:1188: 'The privacy policy's date: its 18 October entry (not shipped) now carries calls 35 and 36, made on the 19th. Keep "Effective 18 October 2026", or re-date it?'
- plan:981: 'The privacy policy's date (again): its 18 October entry now carries this too.'

The policy's git log shows its 18 October entry edited on 19 October (5550d156), 22 October (3a7b546e) and 23 October (1d55700b), with no change of date. Its own line 91 promises to update the date and list the change before the version ships.

It does no harm to money or privacy. But it needs the owner's answer before the 1.6.0 upload: the store links the policy on main, so whatever main says at upload is what users and the reviewers read.

Evidence: store/privacy-policy.md:3, :91, :93; git log for privacy-policy.md (5550d156 2026-10-19, 3a7b546e 2026-10-22, 1d55700b 2026-10-23); docs/plans/chunk-34-token-pools.md:981, :1188; store/README.md:9, :17

## x-release#2

**low · confirmed · docs** — The release procedure skips what 1.6.0 adds: no check of the token routes after the deploy, no 1.6.0 flow in the preprod checklist, and a live-run step that can't pass

At `seedelf-platform/seedelf-web-wallet/docs/development.md:261`

**Detail.** Step 7 (line 261) runs `status` and `curl …/health` only. The deploy script itself checks /health and CORS alone (seedelf-data/deploy/edge/seedelf-data-deploy:30-51), and /health reports only db-sync, Kupo and the node (seedelf-data/api/src/lib.rs:71-95). So nothing reads lovejoin/pools or lovejoin/tokens, whose failure the wallet quietly routes to Koios (private-index.ts:341), or pool_history and account_update_history, where a 404 or 400 holds the whole public part on Koios for 5 minutes (data-layer.ts:117). The 34g handoff asks for that check by hand (chunk-34:1201). Part 2's note (line 215) says to deploy before the upload, while step 7 says before the package. The preprod checklist (110-157) names no 1.6.0 flow: item 6's Lovejoin line (141) is 1.5.0's, with no token pool mix, Start a pool, Bootstrap, Bring every box back now, return through a token's pool, Send or Make public in parts, collateral mix, four boxes a mix, Delegation history or Return on stake. The payments-in-parts shapes harness (wasm/tests/payment_parts_shapes_test.rs:955, #[ignore], the file's only test, 'run in release' per chunk-34:1074) is in neither CI nor the checklist. Part 1's live runs (lines 190-191, and item 1 at 114) cannot pass after a plain `npm run build`. e2e/live/lib.mjs:18-43 restores the preprod test wallet without picking a network, and that build opens on mainnet (chunk-34:994). e2e/live/flows.mjs:24 fills 'Personal tag (optional)', but the form's label is 'Tag (optional, anyone can read it)' (en.json:1399), so `all` stops at its first step. The live harness problem predates 1.6.0; it is still part of this release's procedure.

**Scenario.** The owner follows the procedure to the letter. The deploy passes its checks while a token route answers 503. Checklist item 9 counts the resulting api.koios.rest traffic as 'a part the data layer couldn't answer'. The manual checklist never touches token pools, the release's headline feature. The live run either fails at mint or restores the test phrase on mainnet.

**Confirmed how.** Read development.md, the deploy script, /health, private-index.ts, data-layer.ts and the e2e/live files; grep found no 1.6.0 feature named anywhere in development.md; git log -S showed the mint label changed in d423b79a, before 1.5.0.

**Suggested fix.** In step 7, after `status`: curl lovejoin/pools and lovejoin/tokens for 200 and JSON, and make one pool_history and one account_update_history request. Make Part 2 say 'before the package', as step 7 does. Add 1.6.0's flows to checklist item 6. Add `cargo test --release -p seedelf-wasm --test payment_parts_shapes_test -- --ignored` to item 1. Live runs on a `VITE_ENABLE_MAINNET=false npm run build` (or have openWallet pick preprod), and fix flows.mjs's mint label and payer radio.

**Test idea.** A Vitest check, like store-images-copy.test.ts, that every label e2e/live/flows.mjs fills or clicks still exists in en.json. It fails today on 'Personal tag (optional)'.

**Skeptic (confirmed, low).** Every point checks out on HEAD. Step 7 checks only `status` and /health. The deploy script checks only /health and CORS, and /health says nothing of the Lovejoin routes. The checklist (items 1-9) has not changed since 1.5.0 and names no 1.6.0 flow. The shapes harness is the file's one test, it is #[ignore], and neither CI nor the procedure runs it. The live harness cannot pass. It restores the test phrase without touching the welcome screen's network picker, and a plain `npm run build` defaults to mainnet. Its mint flow looks for the label 'Personal tag (optional)', which was renamed in d423b79a before 1.5.0. It clicks a button where the payer is now a radio. ALL's 'mint live-2 Seedelf' also fails flows.mjs:21's lowercase-only check. The plan noted the harness problem in Session 10 and left flows.mjs as it was. Nothing records that as the owner's choice. The Part 2 note's 'before the upload' against step 7's 'before the package' dates from 1.5.0. It is a doc gap, not a defect in the wallet.

Evidence: development.md:261 (step 7: `status` and `curl …/health`), :215 ('deploy it before the upload'), :110-157 (unchanged since 1.5.0: `git diff 63f87b8 499768f6 -- docs/development.md` touches only lines 161-262), :141 (Lovejoin line), :114 and :190-191 (live runs). seedelf-data/deploy/edge/seedelf-data-deploy:30-51 (health() and cors() only). seedelf-data/api/src/lib.rs:71-95 (/health: db_sync, kupo, node, egress). wasm/tests/payment_parts_shapes_test.rs:954-955 (`#[test] #[ignore = "slow…"]`), and web-wallet.yml has no --ignored run. e2e/live/lib.mjs:18-43 (no network pick). networks.ts:132 defaultNetwork → mainnet first. Onboarding.tsx:74 NetworkPicker. flows.mjs:21,24,25. run.mjs:28 ALL. en.json:1399 'Tag (optional, anyone can read it)'. CreateSeedelf.tsx:228 RadioCards, RadioCards.tsx:50 role="radio". data-layer.ts:117-124 (readFallback: any failure takes the part down).

## x-release#3

**low · confirmed · docs** — The policy's and privacy.md's lists of what giveme.my sees leave out the collateral mix

At `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:49`

**Detail.** giveme.my's own bullet reads like a complete list of the transactions it witnesses: 'each private payment, each private session's funding, each Lovejoin box you bring back …, and each Lovejoin pool you start'. Since Session 11, giveme.my also lends its collateral to a session's 5 ₳ collateral mix and sees it (sessions.ts witnessTail at 4780). The same policy says so in its table row (line 28) and in its 18 October entry (line 93), but not here. privacy.md:121's 'giveme.my sees every private transaction' list leaves it out the same way. The listing's giveme.my host row (store/README.md:263) still says 'Seedelf script transactions', which hasn't covered the Lovejoin mixes and withdraws it now signs.

**Scenario.** Someone reads the policy's section on giveme.my to learn what that service sees, and isn't told that it sees, from their IP address, the mix that moves their session's collateral box. They would learn it only from the Lovejoin row or the change log.

**Confirmed how.** Read privacy-policy.md lines 28, 49 and 93, privacy.md lines 121 and 217, and store/README.md line 263.

**Suggested fix.** Add 'and the one mix of each private session's 5 ₳ collateral' to privacy-policy.md:49 and privacy.md:121. In the giveme.my host row, say 'Seedelf and Lovejoin script transactions'.

**Test idea.** None needed: it's documentation. A reviewer checklist line could pair each giveme.my call site (collateral.ts callers) with the policy's list.

**Skeptic (confirmed, low).** The giveme.my bullet reads as a complete list of the transactions giveme.my witnesses, and it leaves out the session collateral's mix, which giveme.my now funds. privacy.md's summary of what giveme.my sees leaves it out too. The same policy does disclose the mix in its 'Your Lovejoin boxes' row and in the 18 October entry, and privacy.md:217 explains it in full. So this is an omission inside each document, not a false statement, and low is right. The listing's host row still says 'Seedelf script transactions'. That is a permission justification for the store's reviewers, not a user-facing disclosure.

Evidence: store/privacy-policy.md:49 ('each private payment, each private session's funding, each Lovejoin box you bring back …, and each Lovejoin pool you start from your private balance'). privacy-policy.md:28 and :93 ('giveme.my lends that one mix its collateral, so it sees that mix'). privacy.md:121 ('every Seedelf spend …, a session's funding and each box brought back from Lovejoin'). privacy.md:217 ('giveme.my lends its own'). store/README.md:263 ('adds shared collateral to Seedelf script transactions'). sessions.ts:4780 witnessTail → lovejoin.ts:3570-3580 tailWitness → collateral.witness.

## x-release#4

**low · owner-call · owner-call** — The policy says 'Effective 18 October 2026' but describes behaviour built up to 24 October, and goes live on main before 1.6.0 reaches users

At `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:3`

**Detail.** The 18 October entry (line 93) now covers calls 35 and 36 (19 October), the collateral box (22 October) and its mix (23 October). The header's 'updated for …' list (line 3) stops at Lovejoin's token pools. The plan leaves 'Keep "Effective 18 October 2026", or re-date it?' open (chunk-34:1188, repeated at 981). The policy URL and Settings' link both point at main, so it changes when this branch merges, while the store still serves 1.5.0 during review.

**Scenario.** A 1.5.0 user opens Settings' privacy link after the merge. They read that their wallet has, since 18 October, put a session's tokens through token pools by default and mixed its collateral through giveme.my. Their build does neither, and no release did on that date.

**Confirmed how.** Read the policy and the plan's open question.

**Suggested fix.** Re-date the policy to the day 1.6.0 is merged or submitted, add the collateral mix to the header's list, and open the entry with 'From Seedelf Wallet 1.6.0:'. This is the owner's call.

**Test idea.** A test could check that the policy's 'Effective' date equals its newest Changes entry, and is no earlier than the latest commit touching that entry's subject.

**Skeptic (owner-call, low).** The plan leaves the date to the owner, twice, and no answer is recorded. Settings links to the policy on main, so the merge publishes it before 1.6.0 reaches users. Earlier releases did the same, and the policy promises its updates 'before the new version ships'. The 18 October entry now covers changes made 19-24 October. The header's 'updated for …' list also stops at token pools and doesn't name the collateral mix, a small fix whichever date the owner picks. A user sees a misleading date, and nothing more.

Evidence: privacy-policy.md:3 ('Effective 18 October 2026 (updated for … and Lovejoin's token pools…)'), :91 ('we'll update this page and its date … before the new version ships'), :93 (the 18 October entry, which includes the collateral mix). chunk-34-token-pools.md:1188 ('Keep "Effective 18 October 2026", or re-date it?') and :981 ('The privacy policy's date (again)'). Settings.tsx:83 (the policy URL on blob/main).

## x-release#5

**low · confirmed · docs** — The README feature lists still describe 1.5.0's Lovejoin, and the extension README lacks npm run lovejoin-pools

At `seedelf-platform/seedelf-web-wallet/README.md:47`

**Detail.** README.md:47's 'Also in v1: Lovejoin' says only that the spare ADA goes through '10 ₳ boxes on chain'. It says nothing of token pools, a session's tokens going through their pool by default, Start a pool (about 23 ₳ never returned), Bootstrap, the collateral mix, Bring every box back now or four boxes a mix, and nothing of Send and Make public in parts. extension/README.md:40's Lovejoin row says 'Mix puts ADA in, in 10 ₳ boxes'. Its scripts table (74-87) omits `npm run lovejoin-pools`, though development.md:3 says that README lists every script. Its source tree omits lovejoin-pools.ts, lovejoin-launch.ts, parts.ts, LovejoinLaunch, Delegations, BringAllBack and src/lovejoin-pools.json.

**Scenario.** Someone reading the repo to see what 1.6.0 does isn't told that a session's tokens now go through Lovejoin by default, or that starting a pool costs ADA that never comes back.

**Confirmed how.** Read both READMEs; git diff 63f87b8 shows README.md gained one docs row and extension/README.md only chunk 36/37 rows.

**Suggested fix.** Rewrite README.md:47 and extension/README.md:40 for token pools, Bootstrap, Start a pool, the collateral mix and Bring every box back now. Add payments in parts. Add `npm run lovejoin-pools` and the new files.

**Test idea.** Extend an existing docs test so that every package.json script appears in extension/README.md's table. It fails today on lovejoin-pools.

**Skeptic (confirmed, low).** The Lovejoin rows in both READMEs describe only 1.5.0's 10 ₳ boxes. development.md:3 says the extension README lists every script, but its table leaves out `npm run lovejoin-pools`. That is the only true omission: build:wasm and build:ext are named in the build row. The source-tree listing is otherwise complete for src/background, missing only 1.6.0's three new files there, and it leaves out the new screens and the pools' JSON too. These are stale docs.

Evidence: seedelf-web-wallet/README.md:47 ('10 ₳ boxes on chain'). extension/README.md:40 ('Mix puts ADA in, in 10 ₳ boxes'). package.json:21 "lovejoin-pools". A script-by-script grep of extension/README.md finds lovejoin-pools as the only missing script. Of the 52 src/background/*.ts files, the README layout lacks only lovejoin-launch.ts, lovejoin-pools.ts and parts.ts (added 2026-10-17 and 10-21). LovejoinLaunch.tsx, Delegations.tsx, BringAllBack.tsx, src/ui/lovejoin-pools.ts and src/lovejoin-pools.json are not mentioned.

## x-release#6

**low · confirmed · docs** — deploy/README.md's rollback note describes a .prev two deploys out of date

At `seedelf-data/deploy/README.md:142`

**Detail.** The note describes .prev after 1.5.0's deploy (#302's build) and says 'Once web wallet chunk 37's API is deployed, .prev lacks pool_history'. Since then the API was deployed from 304f1d16 (2026-10-15) and from 68150b39 (2026-10-23, run 39982806550). So .prev is now 304f1d16's build. It has pool_history and account_update_history, but lacks lovejoin/pools, lovejoin/tokens and tokens/since/{cursor}, and the discovery cursor fix.

**Scenario.** An operator weighing a rollback during the 1.6.0 launch reads that it costs pool_history. In fact it would send every 1.6.0 wallet's token-pool reads to Koios, including its questions about what made its boxes (private-index.ts TokensDown), and drop the cursor fix.

**Confirmed how.** gh run list --workflow data-layer-deploy.yml (both runs' deploy steps succeeded), and read the README.

**Suggested fix.** Replace the paragraph's history with what .prev is now, and note to update it after each deploy.

**Test idea.** None: an operations doc.

**Skeptic (confirmed, low).** There have been three deploys since 1.5.0 and no rollback: 63f87b8 on 10-13, 304f1d16 on 10-15 and 68150b39 on 10-23. Each one's build job ran, and that job runs only for a deploy. So .prev is now 304f1d16's build. That build has pool_history and account_update_history, but no api/src/lovejoin/ at all, so it lacks lovejoin/pools, lovejoin/tokens and tokens/since. It also lacks the discovery cursor's fix. The README still describes .prev as it was after 1.5.0, so an operator would misjudge what a rollback costs. Rolled back, 1.6.0 wallets would get TokensDown and read token pools from Koios. Mainnet has no token pools yet, so the cost today is small.

Evidence: seedelf-data/deploy/README.md:142 ('After 1.5.0's deploy, .prev is the build deployed at #302's merge … Once web wallet chunk 37's API is deployed, .prev lacks pool_history'). gh api runs: 38419150936 at 63f87b82, 38765078629 at 304f1d16, 39982806550 at 68150b39, each with build and vps 'deploy' succeeding (data-layer-deploy.yml: `build: if inputs.action == 'deploy'`). `git show 304f1d16:seedelf-data/api/src/public/mod.rs` has account_update_history (:63) and pool_history (:71). `git ls-tree 304f1d16 seedelf-data/api/src/lovejoin` is empty, while HEAD's lovejoin/routes.rs:40-42 has pools, tokens and tokens/since. private-index.ts:341 (a 404 → TokensDown).

## x-release#7

**low · owner-call · owner-call** — The store's WebAssembly wraps u64 overflow silently, where every test build panics

At `seedelf-platform/Cargo.toml:37`

**Detail.** [profile.wasm-release] inherits release, so overflow-checks is off in the shipped module, while cargo test, CI and the WebAssembly tests run with it on. 1.6.0 adds a lot of lovelace arithmetic: parts' carries, the tail reserve, merged returns. Session 10's review hit exactly this split (chunk-34:986). A merged return of a session holding only its collateral panicked in tests, but in wasm-release its review would say about 18.4 trillion ₳ comes back. That case is fixed, and I found no live instance at HEAD; this is about the class of bug.

**Scenario.** Some untested state reaches an unchecked subtraction. The user sees a review with an absurd amount, which the ledger later refuses, instead of an error the worker already handles (isTrap).

**Confirmed how.** Read Cargo.toml and wasm/build.sh:61 (it builds --profile wasm-release), and the plan's Session 10 review.

**Suggested fix.** Set overflow-checks = true in [profile.wasm-release]. It costs a little size and changes the zip's hash. This is the owner's call.

**Test idea.** A wasm node test that feeds a known-underflowing request (Session 10's merged return before its fix) and expects a thrown error, not a result.

**Skeptic (owner-call, low).** The facts are right. [profile.wasm-release] inherits release, which turns overflow checks off. Tests and CI run with them on, and Session 10 hit exactly this split. But nobody has found a case on HEAD. This is hardening, not a defect, and no doc records the owner weighing it: the profile's comment talks only about size. Turning it on changes the shipped module and the zip's hash. It could also turn a harmless wrap on a path no test covers into a trap, just before release. That trade-off is for the owner. For a user the risk is a review showing an absurd amount, which the ledger would then refuse, rather than an error message. No money is at risk.

Evidence: seedelf-platform/Cargo.toml:37-42 ([profile.wasm-release] inherits = "release", with no overflow-checks key, and no [profile.release] override anywhere in the file). wasm/build.sh:61 (`--profile wasm-release`). chunk-34-token-pools.md:986 ('a panic in a test build, and in wasm-release, which doesn't check overflow, a review saying about 18.4 trillion ₳ comes back'), fixed in WebAssembly's CollateralBox::back_from.

## x-scenarios-lj#1

**low · confirmed · state** — While a collateral's mix waits on giveme.my or Koios (up to a day), no box in any pool comes back, and Bring one back and Bring every box back now are held

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5514`

**Detail.** witnessTail (sessions.ts:4780-4808) returns false and backs off from 1 to 30 minutes (TAIL_WITNESS_WAIT_MS, sessions.ts:680) when giveme.my is busy (5xx/429), unreachable or not JSON, or when Koios's evaluate fails or is behind. It keeps doing so until TAIL_KEEP_MS (24 h, lovejoin.ts:325) after the tail's deposit landed (sessions.ts:4786). Meanwhile pumpChain keeps the chain unfinished, so its ChainRecord stays !ended and chainsSending (lovejoin.ts:4733) is true. Three paths gate on that: withdrawDueNow returns [] for every pool (lovejoin.ts:5514), withdrawNowNow refuses with lj.chainSending (5707), and bringAllBackNow returns elsewhere() (5862). Before the tail, a chain being sent lasted minutes. The tail touches only its own 5 ₳ box, two drawn boxes (reserved) and the session's change, yet it now holds every pool's withdraws for as long as it waits. The docs (privacy.md:217, flows.md:521, architecture.md:632) describe the day's wait but not this.

**Scenario.** A session's tail deposit lands, and giveme.my starts answering 503 or 429 (or Koios's Ogmios evaluate errors) for the next hours while the user keeps the wallet unlocked. Throughout, boxes due in the classic and token pools don't come back. Bring one back says "A chain of yours is being sent through Lovejoin. Bring a box back once it's all sent." That includes the public-account-paid way, which needs neither giveme.my nor Koios's evaluate. Settings' Bring every box back now shows as going and sends nothing, with no reason given. Where only Koios's evaluate is failing, ordinary withdraws (measured locally, backed by giveme.my) would otherwise have gone. It clears at the next lock (which cuts the chain) or at the 24 h mark. No money is at risk.

**Confirmed how.** Read the code: the witnessTail backoff and its bound, pumpChain returning false without ending the chain, and the three chainsSending gates.

**Suggested fix.** Don't count a chain as sending for withdraws once all its main transactions are on chain and only its tail's mix and the return are left: the tail spends its own reserved box and change. At least let Bring one back and Bring every box back now go then, or have Bring every box back now say what it's waiting for (a held reason, as for a kept review).

**Test idea.** Set up a chain whose deposit and mixes are on chain and whose tail mix waits on a giveme.my answering 503, plus a box in the classic pool past its due time. withdrawDue should send that box; on HEAD it returns [].

**Skeptic (confirmed, low).** The mechanics are as the reviewer described, but the bounds are tighter. While the tail's mix waits on a busy or unreachable giveme.my, or on a failing or behind Koios evaluate, pumpChain returns false and the chain record stays open. chainsSending then holds three things for every pool: due withdraws, Bring one back (all ways, the public-account-paid one too), and Bring every box back now. Bring every box back now gives no reason (elsewhere() records none), while a kept review does get one. Limits the reviewer understated: auto-lock (default 15 minutes without UI activity, 60 at most) wipes the chain's progress and cuts() ends the record; the tail is rebuilt at most TAIL_TRIES (2) times; TAIL_KEEP_MS caps it at a day; and it only happens where a 5 ₳ ADA pool at the floor is shown. That is preprod today; mainnet has none at release. No money is at risk, and the boxes come back later. Parts of this are documented: flows.md:527 says Bring every box back now 'waits for a chain being sent', Session 11's call 2 says 'withdraws keep their own rule', and the owner chose the day's wait for giveme.my. Nothing records weighing them together: the emergency button held silently for as long as giveme.my is busy. So it's a narrow edge case, low.

Evidence: HEAD: sessions.ts:4780-4808 (witnessTail: on CollateralError or KoiosError it backs off and returns false; it throws only past TAIL_KEEP_MS, or on a non-busy refusal after GIVEME_BEHIND_MS, parts.ts:44). TAIL_WITNESS_WAIT_MS is at sessions.ts:680; TAIL_KEEP_MS and TAIL_TRIES are at lovejoin.ts:325-326. pumpChain, lovejoin.ts:486-489: return false, with no chainEnded. chainsSending, lovejoin.ts:4733-4736: any record that hasn't ended. The gates: lovejoin.ts:5514 (withdrawDueNow returns []), 5707 (withdrawNowNow throws lj.chainSending, before the paid branch), and 5862 (bringAllBackNow returns elsewhere(), which at 5852-5858 records no reason). Collateral.ts:82 treats 5xx and 429 as busy. Auto-lock: wallet.ts:49 and shared/preferences.ts:76,165 (1 to 60 minutes, default 15); the LockCountdown only warns. Docs: flows.md:527; chunk-34 plan Session 11 'Calls made here' item 2, and the owner's calls item 1 ('The day stays for a deposit that landed and waits on giveme.my').

## x-scenarios-sessions#1

**low · confirmed · ux-words** — Max's note on UTxOs left behind gives a false reason now that Max goes in parts

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:262`

**Detail.** max_in_parts (wasm/src/lib.rs:4288-4364) leaves UTxOs for two reasons that 1.5.0's one-transaction Max never had. (1) A later part can't pay its fee even as a chain: Max then sends the parts that built and sets `left` to the rest, since it is refused only when nothing builds. (2) The 25-part cap is reached with parts smaller than 20 inputs (for example parts limited by size, or bundles of tokens). The screens still choose between two messages by `summary.inputs < MAX_UTXOS * (summary.parts ? MAX_PARTS : 1)` (Transfer.tsx:262-264; Withdraw.tsx:250-252 the same). One is withdraw.leftLimit, "a payment takes {{max}} at most, and some tokens won't fit in one output". The other is withdraw.leftTokens, "each holds a token that won't fit in one output with the rest". For a Max that stopped after one part, `parts` is absent and inputs is 20, so it shows "a payment takes 20 at most", which is false since Max now sends up to 25 × 20. Capped smaller parts show the token message, also false.

**Scenario.** A private balance holds one 2 ₳ UTxO of ADA and 40 move-in bundles at exactly their least. Max builds part 1 (the 2 ₳ plus 19 bundles). The rest can't pay their fees, even chained, so the review shows "21 private UTxOs stay for another payment: a payment takes 20 at most, and some tokens won't fit in one output." The real reason is that there isn't enough ADA to pay for spending them. The user may try again expecting another 20 to go, or think something is wrong with the tokens.

**Confirmed how.** Read the code: the max_in_parts paths (the `failed` branch and `!went && parts.is_empty()`) and the screens' condition, which only knows the old one-transaction causes.

**Suggested fix.** Have WebAssembly report why Max left each UTxO (cap, fee, tokens), as LeftOutUtxo reasons do, and show that reason. Or at least add a reason for "too little ADA to pay for spending them" and base the cap message on the number of parts.

**Test idea.** Screen test of Transfer's Max review where WebAssembly returns one part with left 21 because the rest can't pay their fees (2 ₳ plus 40 bundles at their least). Assert the note doesn't say "a payment takes 20 at most".

**Skeptic (confirmed, low).** The screens still choose Max's reason for what stays from 1.5.0's one-transaction causes. max_in_parts now leaves UTxOs for a reason those causes never covered. When a later part can't pay its fee, even chained, Max sends the parts that built and puts every unspent UTxO in `left` on the last part. It is refused only when nothing built. With one part built, the worker gives no `parts` (transfer.ts and withdraw.ts add `parts` only when there are more than one), and inputs is 20. The screen then says "a payment takes 20 at most, and some tokens won't fit in one output". That is false in 1.6.0, where a payment goes as up to 25 parts. With several parts and fewer than 500 inputs, it says each UTxO "holds a token that won't fit in one output with the rest", also false. Neither names the real cause: too little ADA to pay for spending the rest. flows.md lists what Max's review names as left (past 500, a token that wouldn't fit, a reference script, a return being sent); too little ADA isn't among them. No test pins these notes. The trigger is plausible for Send to a Seedelf: bundles of tokens at exactly their least need outputs as large as their inputs, so they free no ADA for fees. The reviewer's 2 ₳ plus 40 bundles fits, if the bundles carry enough token kinds each. No money is at stake, only a misleading reason.

Evidence: seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:262-264 and Withdraw.tsx:250-252 (`summary.inputs < MAX_UTXOS * (summary.parts ? MAX_PARTS : 1)`); en.json:2908-2912 (withdraw.leftLimit, leftTokens, left); wasm/src/lib.rs:4330-4350 (failed -> max_chained, else `if !went && parts.is_empty()` refuses only with nothing built), :4355-4362 (left = every unspent UTxO, on the last part); extension/src/background/transfer.ts:157 (`parts.length > 1 ? {...summary, parts} : summary`); docs/flows.md:368 (the list of what Max's review names).

## x-scenarios-sessions#2

**low · confirmed · ux-words** — Two of Send's "partly sent" errors misstate what happens to the remaining parts

At `seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts:596`

**Detail.** (a) Suppose a payment whose first part went maybe-sent while later parts wait, and Send is pressed on it again from a second window. sendParts finds the first part kept with sentCbor, so `hashes` is every part. splitParts finds parts ≥ goNow moved to waitingPartKey and returns `all`. Part 0 is sent again; part 1's partKey is gone, so send() throws StaleReviewError (worker.spend.notReady.payment). Line 596 turns that into worker.parts.partly: "1 of 2 transactions went. The rest didn't: That payment isn't ready to send. Review it again. Review what's left again." unsplit/letGo then leaves the first Send's waiting record and reservation as they were (parts.ts:256), so the pump still sends the rest once part 0 lands, and Home says "1 more to go". The test parts-send-review-fixes.test.ts:462 pins this storage behaviour but swallows the message. (b) worker.parts.partlyMaybe (line 599) says "…Koios didn't answer for the last one, so the rest wait", but letGo frees the held parts and nothing ever sends them.

**Scenario.** (a) The user has the review open in the popup and the side panel. Send in the popup gets no answer from Koios (maybe sent), and the user presses Send in the side panel. They read that the rest didn't go and that they should review what's left again. They pay the remainder again from other UTxOs, while the wallet still sends the original remaining parts: the recipient is paid the remainder twice. (b) Told "the rest wait", a user may wait for parts that will never go.

**Confirmed how.** Read the code: sendParts' catch (parts.ts:592-604), splitParts' early return when parts aren't all kept (205), letGo's `!own && waitingOn[first]` early return (256), and the test at parts-send-review-fixes.test.ts:462, which shows the second part still goes after this error.

**Suggested fix.** (a) In sendParts, when the payment already has a waiting record (or the first part is sent again with sentCbor), return the watch's pending with `parts` instead of throwing worker.parts.partly, or throw a message saying the rest will go once the first lands. (b) Reword partlyMaybe to say the rest won't go.

**Test idea.** Extend the test at parts-send-review-fixes.test.ts:462 to assert that the second Send's error or result never says the rest didn't go while parts.of(first) still has them to go.

**Skeptic (confirmed, low).** Both messages are as the reviewer says, but the trigger in their failure scenario can't happen. A review isn't shared between the popup and the side panel. Each builds its own, with a fresh random seed for the one-time key (keys-and-accounts.md). A second build replaces the kept parts under the same key, so the other window's Send is refused as stale at part 0 (i === 0 rethrows). (a) is real only when Send is pressed again on the same review after part 0 went maybe-sent and the later parts were held by holdWaiting. The screen navigates away on any answer, so that takes a first Send whose answer the screen never got (NO_ANSWER keeps the review and re-enables Send). In that case splitParts finds partKey(key,1) gone and returns `all`. Part 0 goes again, and part 1 throws StaleReviewError, which becomes worker.parts.partly ("The rest didn't … Review what's left again"). Meanwhile letGo's `!own && waitingOn[first]` early return keeps the waiting record, and the pump still sends part 1, which parts-send-review-fixes.test.ts:462 shows. That path is very narrow. (b) is the realistic one. Whenever Koios doesn't answer a part before the last of those that go at Send, partlyMaybe says "so the rest wait". Yet unsplit/letGo frees the held parts and writes stopped "refused", and nothing sends the rest unless the user presses Send again. In the wallet's own words "wait" means it goes later (review.partsWait: "1 waits for the one before to land"), and Home's banner then says "N of M didn't go". The next sentence ("review what's left again") softens it, and no money is at stake unless (a)'s rare path leads to the remainder being paid again. Low.

Evidence: seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts:205 (parts not all kept -> `all`), :256 (`if (!own && (await waitingOn(deps, network))[first]) return;`), :596 (worker.parts.partly), :599 (partlyMaybe when `i < goNow - 1`), :230-262 (letGo frees and stops the rest); src/background/script-spend.ts:539 (partKey(key,0) === key), pending.ts:604 (sentCbor kept); src/ui/screens/Transfer.tsx:159-169 (onSent on any answer; an error keeps Send enabled); src/ui/background.ts:65-71 (NO_ANSWER); en.json:3035-3036, 1511-1512, 1672-1673; tests/parts-send-review-fixes.test.ts:462-484 (the second Send's error swallowed, part 1 still sent).

## x-scenarios-sessions#3

**low · owner-call · owner-call** — A session's whole return waits on giveme.my for its collateral's mix, up to a day, with no direct way out

At `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4780`

**Detail.** With the collateral tail, the tail's deposit spends the chain's change and the collateral, or for a direct return every ADA-only UTxO (wasm lovejoin.rs:1753-1799, 335-383). The return then sweeps the mix's change, so it can't go before the mix, and the mix needs giveme.my's witness. While giveme.my is busy or out of reach (or Koios' evaluate fails), witnessTail backs off from 1 to 30 minutes (sessions.ts:4799-4806) for up to TAIL_KEEP_MS, 24 h (lovejoin.ts:325). Meanwhile buildBack refuses any return, direct included, with sess.chainSending (sessions.ts:4055-4057). Stop isn't offered after a fill, and the session page shows only the chain's sent/total (chainView), not that it is waiting on giveme.my. 1.5.0 returns never needed giveme.my: a sweep or a merge under the session's own collateral. This is the owner's design (Session 11), and dormant on mainnet until a 5 ₳ pool holds 30 boxes that aren't the wallet's.

**Scenario.** On preprod (or on mainnet once a 5 ₳ pool exists), giveme.my has an outage during a swap's return through Lovejoin. All of the session's ADA and tokens stay at the one-time account for as long as giveme.my is down (up to a day), plus up to 30 minutes after it recovers. The page shows a chain stuck at N−1 of N+1 with no reason given, and Bring it back directly is refused.

**Confirmed how.** Read the code: pumpChain's giveme gate (lovejoin.ts, `unwitnessed`/`io.witness`), witnessTail's backoff and the 24 h stop, buildBack's pendingChain refusal, and with_return/direct_tail's inputs.

**Suggested fix.** Owner's call. Options: say on the session page that the return waits for giveme.my to back the collateral's mix; or, after a shorter wait (an hour, say), stop the chain at the mix so the rest comes back by a plain sweep and the boxed collateral waits not mixed yet, as it does after TAIL_KEEP_MS.

**Test idea.** lovejoin-planner tail test: giveme.my unreachable for 2 hours after the tail's deposit lands. Assert that the session's view says what it waits on, and, if the owner chooses a shorter cut-off, that the rest comes back by then.

**Skeptic (owner-call, low).** The code works as described. The giveme gate in pumpChain holds the collateral's mix, and with it the return that sweeps the mix's change, until giveme.my signs. witnessTail backs off from 1 to 30 minutes for up to TAIL_KEEP_MS (24 h) after the deposit landed, and buildBack refuses any return while the chain is pending. The owner chose this on purpose. The calls of 2026-10-23 say "The day stays for a deposit that landed and waits on giveme.my" and set giveme.my's backoff. privacy.md also says the rest is held back meanwhile, up to a day after the deposit landed. It is dormant on mainnet until a 5 ₳ pool holds 30 boxes that aren't the wallet's. Settings' switch, on by default, turns it off for later returns. The one thing left that no decision covers is wording. While it waits, the session page shows only the chain's count (chainView has no witness state). The return review's collateral note says giveme.my backs the mix but not that the return can wait up to a day on it. What a user would see: during a giveme.my outage on preprod, or once a mainnet 5 ₳ pool opens, all of a session's ADA and tokens sit at its one-time account for up to a day plus 30 minutes. The page shows a chain stuck short of its total with no reason, and Bring it back says the return is still being sent. Nothing is lost.

Evidence: seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:465-490 (unwitnessed gate, io.witness), :325 (TAIL_KEEP_MS = 24 h); src/background/sessions.ts:680 (TAIL_WITNESS_WAIT_MS [1 min, 30 min]), :4780-4807 (witnessTail: tooLong past a day, backoff otherwise), :4055-4057 (sess.chainSending), chainView (total/sent/confirmed/cut/stopped only); docs/plans/chunk-34-token-pools.md:953-954 (the owner's calls 2026-10-23: "The day stays for a deposit that landed and waits on giveme.my"; the backoff); docs/privacy.md:217 ("the rest held back meanwhile … a day after the deposit landed"); en.json:1010 (lovejoin.collateralBox.privacy.note, no word of the wait).

## 314-core#2

**nit · confirmed · correctness** — `with_staking` admits script-credential certificates that need a script witness the spend never adds

At `seedelf-platform/seedelf-core/src/staking.rs:497`

**Detail.** `is_scripts` (staking.rs:497-506) treats these certificates for a script credential as needing no key: Shelley's deregistration (cert 1), its delegation, and Conway's `Reg`/`UnReg`. That is true for keys, so `stake_signs()` is false and `ScriptSpend::with_staking` accepts them (build.rs:1769-1775). But only cert 0 (StakeRegistration) needs no witness at all. Every other one needs the script itself to run with a certificate redeemer, which `ScriptSpend` never adds. Cert 1's refund is also missing from `refund()` (staking.rs:409-417). Today only the launch's cert 0 reaches this code (launch.rs:230-239), and account staking can't name a script credential, because `StakeKey::new` refuses one.

**Scenario.** A later caller passes `Reg(ScriptHash(L), 2 ₳)` (Lovejoin's own cert 7) or a script delegation to `with_staking`. The spend is built and measured locally, then the node refuses it for the missing script witness. No money moves; the error just comes late, as a node refusal instead of a refusal in words.

**Confirmed how.** Read the code.

**Suggested fix.** Let `with_staking` take only `StakeRegistration(ScriptHash(_))`, the one certificate it's documented and used for, or narrow `is_scripts` to that certificate.

**Test idea.** `ScriptSpend::with_staking` given `Reg(ScriptHash, 2_000_000)` or `StakeDelegation(ScriptHash, pool)` returns an error.

**Skeptic (confirmed, nit).** The guard is looser than its intent, but nothing reaches it today. `is_scripts` counts script-credential certs 0, 1 and 2, plus Conway's Reg (7) and UnReg (8), as signed by no key, so `stake_signs()` is false and `with_staking` admits them. Under Conway's witness rules, only the legacy registration (cert 0, ConwayRegCert with no deposit) needs no witness. Certs 1, 2, 7 and 8 for a script credential each need the script to run under a certifying redeemer, which ScriptSpend never stages, and local evaluation does no phase-1 check. So such a spend would be measured fine and then refused by the node. `refund()` also leaves out cert 1's implicit refund. Today `with_staking` has one caller, the launch, and it passes only `StakeRegistration(ScriptHash(mix_logic))` or nothing, which is cert 0 by design (the plan's S0c, settled on preprod). The wallet's own unregistration uses UnReg with an explicit deposit, so it never builds cert 1. This is a latent API hazard in a crate shared with the CLI, not a live bug: nit.

Evidence: seedelf-core/src/staking.rs:350-356 (stake_signs), 409-417 (refund: UnReg/UnRegDRepCert only), 497-506 (is_scripts), 259 (account unregistration uses Certificate::UnReg); seedelf-core/src/build.rs:1766-1775 (with_staking); its only caller seedelf-core/src/lovejoin/launch.rs:308 with staking from 230-239 (cert 0 only); grep finds no other with_staking caller in core, wasm or cli; docs/plans/chunk-34-token-pools.md:1209 (cert 0 registers mix_logic with no script witness).

## 316#4

**nit · confirmed · docs** — rpc.ts: LovejoinChainTx's doc comment is stranded above LovejoinMixView's, and `cleared`'s comment shares a line with `chain`

At `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts:2326`

**Detail.** PR #316 inserted LovejoinMixView between `/** One transaction of a chain through Lovejoin… */` and LovejoinChainTx (2326-2352). LovejoinChainTx now has no doc comment and LovejoinMixView has two. Line 2348 also has `width?: 4 };  /** Cleared from Your mixes … */` on a single line.

**Scenario.** Someone reading the RPC types takes LovejoinMixView for a chain transaction's row, and finds LovejoinChainTx undocumented.

**Confirmed how.** Read the code.

**Suggested fix.** Move the stranded comment down to LovejoinChainTx, and put `cleared`'s comment on its own line.

**Test idea.** None: these are comments.

**Skeptic (confirmed, nit).** As described. PR #316 inserted LovejoinMixView under LovejoinChainTx's one-line doc comment. LovejoinMixView now carries two doc comments, and LovejoinChainTx at 2352 has none. A later commit put `cleared`'s comment on the same line as `chain`. Comments only.

Evidence: HEAD src/shared/rpc.ts:2326 (`/** One transaction of a chain through Lovejoin ... */`, blame d5bb3c210), 2327-2332 (LovejoinMixView's doc and interface, blame b2e589b65 = PR #316), 2348 (`... width?: 4 };  /** Cleared from Your mixes ... */`, blame be2325288), 2352 (`export interface LovejoinChainTx {` with no doc).

## 317-data#2

**nit · confirmed · performance** — `lovejoin/pools` queries db-sync on every request, before it looks in its cache

At `seedelf-data/api/src/lovejoin/routes.rs:209`

**Detail.** `pools` calls `stable()` (a `block_before` on the private pool, routes.rs:209-212) before it checks `state.kept(&key)` (:214), so every request costs a db-sync query. `tokens` and `tokens/since` run their `stable()` inside `cached_in`, once per tip, and the classic routes do the same inside `from_sources`.

**Scenario.** A client calling `/lovejoin/pools` in a loop at the edge's sustained 10 a second per address makes 10 uncached db-sync queries a second on the private index's two connections. Every other private route costs home one read per block. `since/{made-up cursor}` already allows the same load, so this adds no new exposure.

**Confirmed how.** Read the code: routes.rs:201-216 against routes.rs:124-142 and private.rs:174-206.

**Suggested fix.** Keep the stable cursor per db-sync tip: a small `Mutex<Option<(String, Cursor, Block)>>` keyed by the tip hash, or work out the key inside a `cached_in` for the tip.

**Test idea.** Behind a seam that counts `block_before` calls, two `pools` requests at the same tip should make one call.

**Skeptic (confirmed, nit).** The finding is accurate. pools runs stable(), a block_before on the private pool, before it looks at kept(&key). So every request costs one indexed query on home's two private connections. tokens, tokens/since and the classic routes run stable() inside cached_in's make, once per tip. The impact is negligible. The wallet asks at most once every REFRESH_MS (5 min) per worker. A looping client gets no new leverage, because since/{made-up cursor} already costs home two uncached queries per request at the same 1 edge unit. One side effect ties it to finding 0: the cache key needs that query. So when the private connections are congested, the route can't reach the list it already holds for the cursor, nor LATEST, and answers 503. Caching the stable cursor per db-sync tip would remove both the query and that effect. It is a performance cleanup only.

Evidence: seedelf-data/api/src/lovejoin/routes.rs:209-216 (stable() before state.kept(&key)); chain.rs:218-221 (block_before takes a private connection); contrast routes.rs:136-141 and private.rs:184, :226-227 (stable() inside cached_in, once per tip); private.rs:252-262 (since/{made-up cursor}: a new key, two queries); edge.rs:49-62 (private routes weigh 1); extension/src/background/lovejoin-pools.ts:74 (REFRESH_MS 5 min), :406-407 (throttle).

## 318-worker#3

**nit · confirmed · performance** — A pool's start and a token-pool mix from the private balance read epoch_params twice in one review

At `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:242`

**Detail.** build() reads koios.epochParams() for the box's least and most (lovejoin-launch.ts:242). fromPrivate's readContract(this.deps, network) at :293 reads it again, though readContract takes `known`. fromPublic's readAccount reads it again too (account.ts:178). The tile's private mix into a token pool does the same: fits → takesNewBoxes reads it, then mixFunding's buildFunding → readContract reads it again. Each is one extra generic request per review, and the two reads can straddle an epoch change, so the least is checked under one epoch's parameters and built under another's.

**Scenario.** Every Review of a pool's start from the private balance sends two identical epoch_params requests, to the data layer or Koios. No user-visible harm beyond the request count.

**Confirmed how.** Read the code: lovejoin-launch.ts:242 and :293, script-spend.ts:232-236 (readContract's `known`), account.ts:176-180, lovejoin.ts fits/takesNewBoxes.

**Suggested fix.** Pass `params` into readContract(this.deps, network, params) in fromPrivate. Let readAccount take known parameters, or hand fromPublic the ones already read.

**Test idea.** Count the fake Koios's epoch_params calls during launch.build from the private balance: expect 1 (2 on HEAD).

**Skeptic (confirmed, nit).** Accurate, and harmless. build() reads epoch_params at lovejoin-launch.ts:242. fromPrivate then calls readContract(this.deps, network) without the `known` argument it accepts (:293; script-spend.ts:234 reads it again when that's missing). fromPublic's readAccount always reads it again (account.ts:178). Koios.epochParams is not cached (koios.ts:1118-1122), so a private-balance launch review makes one extra identical request. The tile's token-pool mix does the same through takesNewBoxes with no params (lovejoin.ts:3454-3459, called from fits). The worry about straddling an epoch boundary needs the two reads, seconds apart, to fall either side of it, and WebAssembly enforces its own minimums under the parameters it builds with. Nothing a user sees: a nit.

Evidence: lovejoin-launch.ts:242, :293, :320-323; script-spend.ts:220-236; account.ts:176-180; koios.ts:1118-1122; lovejoin.ts:3454-3459.

## 319-rust#2

**nit · confirmed · docs** — Stale comments: the WebAssembly module still says 10 ₳ boxes three wide, and the width doc names the old core path

At `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:9`

**Detail.** The module doc at wasm lovejoin.rs:9-12 still describes the deposit as "as many 10 ₳ boxes" and the mixes as "three wide". Since 34d and 34e a chain can go into token pools, across pools, and four wide. Separately, lovejoin-mix-width.md:135 lists `seedelf-core/src/lovejoin.rs`, which is now `seedelf-core/src/lovejoin/mod.rs`.

**Scenario.** A developer reading the module header is told every chain is 10 ₳ boxes three wide, which no longer holds. No user sees it.

**Confirmed how.** Read the code and the doc.

**Suggested fix.** Reword the module doc for pools and width ("the pool's boxes ... `width` wide, three or four"), and fix the path in lovejoin-mix-width.md.

**Test idea.** None; documentation only.

**Skeptic (confirmed, nit).** Both stale texts are on HEAD and are for developers only. The WebAssembly module's doc at lines 9-12 still describes every chain as 'as many 10 ₳ boxes as its ADA-only UTxOs pay for' and 'three wide'. git blame dates those lines to 2026-09-25, and #319 didn't touch them. Since 34d and 34e, a chain can go into a token pool, across pools with token UTxOs in its deposit, and four wide. A later paragraph (2026-10-17) mentions token pools, but not width or chains across pools. lovejoin-mix-width.md:135 lists `seedelf-core/src/lovejoin.rs`. That file existed at 1.5.0 (63f87b8), but it has been `seedelf-core/src/lovejoin/mod.rs` since chunk 34, already at #319's base (9cb97a32b). The section says it's 'Kept as the list of what a fifth width, or a change of default, would touch', so the path is meant to be followed. No user sees either text.

Evidence: seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:9-12 (blame 47b0e34cc, 2026-09-25); seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md:133-135; `git ls-tree 63f87b8` shows seedelf-core/src/lovejoin.rs, `git ls-tree 9cb97a32b` and HEAD show seedelf-core/src/lovejoin/{mod,value,pool,templates,launch,box_value}.rs.

## 320-screens#5

**nit · refuted · ux-words** — The hub's aside says 'A mixer for ADA and tokens' when the only other pools are ADA pools

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1484`

**Detail.** `tokenPools = pools.some((p) => p.id !== undefined)` (1484) counts any non-classic pool, ADA pools at other values included. It picks lovejoin.asideTokens (1491) and hides lovejoin.start.warn.cost (1580-1584).

**Scenario.** Someone launches a 5 ₳ ADA pool on mainnet (the collateral pool the 1.6.0 tail looks for), and there is no token pool yet. Every hub then says "A mixer for ADA and tokens".

**Confirmed how.** Read the code: Lovejoin.tsx:1484-1491.

**Suggested fix.** Use `pools.some((p) => !!p.box.token)` for the aside.

**Test idea.** Render the hub's aside with the classic pool and one 25 ₳ ADA pool; expect lovejoin.aside.

**Skeptic (refuted, nit).** The code does what the recorded call says. In the code's own terms, every non-classic pool is a 'token pool': LovejoinStatus.pools is 'Every token pool the wallet reads, beside the classic pool'. So `p.id !== undefined` is exactly 'once a token pool is read' (Claude's call in the 34f plan, listed for the owner in PR #320). The aside isn't false either: in 1.6.0 Lovejoin does mix tokens, and anyone can start a token pool. The suggested fix would make it false. With a 5 ₳ ADA pool listed and no token pool, `p.box.token` would bring back lovejoin.aside, 'A mixer for ADA, in 10 ₳ boxes', beside a 5 ₳ pool. Hiding lovejoin.start.warn.cost there does no harm, because the launch form shows lovejoin.launch.warn.cost before Review and the review lists each locked amount.

Evidence: Lovejoin.tsx:1484, 1491, 1580-1584; shared/rpc.ts:2178-2183; en.json:965 ('A mixer for ADA, in 10 ₳ boxes'), 1238; chunk-34-token-pools.md:899; LovejoinLaunch.tsx:357-359, 207-216.

## 321-lj-rust-data#1

**nit · confirmed · docs** — `external_sweep_with` outlived the collateral box it was written for: an unused public builder with a stale doc and an unchecked `extra`

At `seedelf-platform/seedelf-core/src/build.rs:564`

**Detail.** Session 10 (#321) added it so CollateralBox's return could pay the 5 ₳ box first. #323 removed CollateralBox, and both returns now call plain `build::external_sweep` (wasm/src/lib.rs:1500, wasm/src/lovejoin.rs:477 and :1808). Its only caller is external_sweep itself, with `&[]` (build.rs:557). It stays `pub` in seedelf-core, the crate the CLI shares (and a published one). Its doc still says it's for 'a web wallet session's return putting its collateral into a Lovejoin box'. Its non-empty `extra` path has no test. 'Outputs of ADA alone' isn't enforced: `paid` subtracts only lovelace (build.rs:576-585), while deposit_outputs pays back every input token. With `&[]` it builds exactly 1.5.0's external_sweep (checked_lovelace(total, &[fee, 0])), so the CLI's transactions are unchanged.

**Scenario.** Nothing a user sees today. A later caller who takes the doc at its word and passes an `extra` holding a token gets a transaction that pays the token twice. The node refuses it as unbalanced (ValueNotConserved) only after the review.

**Confirmed how.** Read the code, and grepped the workspace for external_sweep_with: the only call is build.rs:557, with &[].

**Suggested fix.** Fold it back into `external_sweep` and drop `extra`. Or make it pub(crate), say in its doc that nothing uses it, and refuse an `extra` that holds assets, in words.

**Test idea.** If it's kept: a core test that external_sweep_with refuses an extra output carrying a token before anything is built. If it's removed, no test is needed.

**Skeptic (confirmed, nit).** `external_sweep_with` has one caller on HEAD: `external_sweep`, passing `&[]` (build.rs:557). Commit 24c5c62a in #323 replaced CollateralBox with CollateralTail and turned both `external_sweep_with(..., &extra)` calls into plain `build::external_sweep` (wasm lib.rs:1500, lovejoin.rs:477 and :1808). Its doc (build.rs:560-563) still names 'a web wallet session's return putting its collateral into a Lovejoin box', which no longer exists. 'Outputs of ADA alone' isn't enforced: `paid` sums lovelace only (build.rs:576-579), while `deposit_outputs` pays back every input token. An `extra` holding a token would pay it twice, and the node would refuse the transaction as unbalanced. No caller does this. The CLI is unaffected: with `&[]`, checked_lovelace(total, &[fee, 0]) gives the same as checked_lovelace(total, &[fee]) (transaction.rs:89-97), and no extra outputs are staged. I compared it line by line with 1.5.0's external_sweep (63f87b8:build.rs:418-448). That leaves dead public API in a published crate, with a stale doc and an untested parameter. Fold it back into external_sweep or make it pub(crate).

Evidence: seedelf-platform/seedelf-core/src/build.rs:550-597; seedelf-platform/seedelf-core/src/transaction.rs:89-97; git grep external_sweep_with finds only build.rs:557 and :564, plus the session-10 history line in docs/plans/chunk-34-token-pools.md:967; git show 24c5c62a: both '-build::external_sweep_with(..., &extra)' become '+build::external_sweep(...)'; git show 63f87b8:seedelf-platform/seedelf-core/src/build.rs:418-448

## 321-lj-screens#6

**nit · confirmed · ux-words** — Settings says "Nothing of yours was left in Lovejoin" after watching a single pool's run end with nothing sent

At `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:227`

**Detail.** Settings covers every run, a pool's too (`covers` with no `pool`). `doneOf` scopes its check to `last.pool` (line 34), so it returns 0 when only that one pool is empty. The text then picks `settings.lovejoin.bringNone` from the page's own scope (`pool ? … : …`), not the run's.

**Scenario.** A pool's page started its own Bring back, and its one box was already being withdrawn, so the run sends none. The user watches it end in Settings, which says "Nothing of yours was left in Lovejoin." Other pools still hold their boxes.

**Confirmed how.** Read the code (BringAllBack.tsx 31-36, 57, 225-228). No test run.

**Suggested fix.** Choose the words by the run's scope (`last.pool`): `lovejoin.bring.none` or a Settings wording naming one pool when it was a pool's run.

**Test idea.** BringAllBack in Settings: reads go {back:0,pool:'classic'} then no bringing, with another pool's boxes in `held.pools`. Assert the done text doesn't say 'in Lovejoin'.

**Skeptic (confirmed, nit).** Settings watches every run, a pool's too (covers with no pool, BringAllBack.tsx:57). doneOf scopes its empty check to last.pool (:34). settings.test.ts:397 pins doneOf({back:0,pool:"classic"}, …) = 0 while pool a1 still holds a box. The wording is chosen by the page's scope, not the run's (:227). So a pool's run that ends with nothing sent, watched in Settings, reads "Nothing of yours was left in Lovejoin." while other pools still hold boxes. That is false but very narrow: such a run lasts about one run, and the user must open Settings during it.

Evidence: BringAllBack.tsx:31-36, 57, 66-68, 225-228; tests/settings.test.ts:396-399; en.json:1938, 1945

## 321-parts-rust#1

**nit · confirmed · docs** — Stale builder docs: 'in one output' after tokens went 20 to an output, and external_sweep_with describes a removed collateral box

At `seedelf-platform/seedelf-core/src/build.rs:1503`

**Detail.** RestTo::Seedelf (build.rs:1503) and RestTo::Address (build.rs:1506) still say the rest is paid 'in one output'. stage() now pays it through deposit_outputs or pay_address, 20 tokens to an output (build.rs:2143-2154), and settle counts rest_outputs as token_chunks(...).len() (2034-2039). account_send's doc says 'in one output' (build.rs:754), but Payee::Address now goes through pay_address chunks (652-655). external_sweep_with (build.rs:560-602) is documented as 'a web wallet session's return putting its collateral into a Lovejoin box'. PR #323 replaced that box with the collateral mix and planned_return calls external_sweep again (wasm lib.rs:1500), so on HEAD this public function is used only by external_sweep with no extra outputs.

**Scenario.** A later caller reads RestTo or account_send, expects one output per payee, and counts or indexes outputs on that basis. With more than 20 tokens they get several. external_sweep_with stays in the public API for a feature that no longer exists.

**Confirmed how.** Read the code on HEAD: grep shows external_sweep_with's only caller is external_sweep (build.rs:557).

**Suggested fix.** Change the RestTo and account_send docs to say tokens go MAXIMUM_TOKENS_PER_UTXO to an output. Either remove external_sweep_with and fold it back into external_sweep, or re-document it as generic.

**Test idea.** Docs only; no test.

**Skeptic (confirmed, nit).** Each stale comment is on HEAD. RestTo's two variants still say the rest goes 'in one output'. stage() now pays it through deposit_outputs or pay_address, both split 20 tokens to an output, and settle counts rest_outputs as token_chunks(...).len(). Before the PR, stage paid one output (deposit_output / pay_address). account_send's doc still says 'in one output', although Payee::Address's own doc was updated and its outputs() goes through pay_address's chunks. external_sweep_with is documented as the session return that puts the collateral into a Lovejoin box. That was PR #321's Session 10 CollateralBox, which PR #323 replaced with CollateralTail ('merged_return's extra outputs went with the box'). Its only caller is external_sweep, which passes &[]. The WebAssembly and the CLI call external_sweep only. No current caller is misled: build::carried finds the carried output by matching it, not by index, and settle's output count is chunk-aware. It's rustdoc only (seedelf-core is published, so it reaches docs.rs at the next CLI release), so nit.

Evidence: build.rs:1502-1507 (RestTo docs 'in one output'); build.rs:2141-2153 (stage: deposit_outputs / pay_address chunks); build.rs:2034-2039 (rest_outputs = token_chunks(..).len()); build.rs:753-756 (account_send 'in one output') vs 625 (Payee::Address 'Tokens go MAXIMUM_TOKENS_PER_UTXO to an output') and 652-655; build.rs:557 (only call of external_sweep_with, with &[]), 560-563 (its doc); callers of external_sweep: wasm lib.rs:1500, lovejoin.rs:477 and 1808, seedelf-cli external/sweep.rs:40; chunk-34-token-pools.md:925 (Session 11 replaced the box) vs 967-968 (Session 10's external_sweep_with); e6b5dae51 build.rs:1982-1985 (rest was one output before the PR); build.rs:2258-2277 (carried matches by address, coin and no assets).

## 321-parts-rust#2

**nit · confirmed · correctness** — Max in parts over no UTxOs returns Ok with zero parts, where one transaction's Max refuses

At `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4302`

**Detail.** build_transfer_parts (lib.rs:4446-4456) and build_withdraw_parts (4564-4584) send Max straight to max_in_parts without checking request.utxos. With none, the loop `while !rest.is_empty()` (4302) never runs, failed stays None, and the function returns Ok(vec![]). The one-transaction path refuses the same request with "There's nothing in the Seedelf balance to send" (transfer_plan, lib.rs:3058-3060) or "...to withdraw" (withdrawal_of, 3378-3380). Today the worker checks for no UTxOs before calling (transfer.ts and withdraw.ts both throw nothingToSpend first), so this can't be reached now. But `whole([])` in script-spend.ts:477-480 would throw a TypeError on `last.payments` if any caller ever reached it.

**Scenario.** A future caller of buildTransferParts or buildWithdrawParts that doesn't check for an empty balance first gets {parts: []} back. The review then crashes with a TypeError instead of telling the user the private balance is empty.

**Confirmed how.** Read the code: traced max_in_parts with an empty utxos slice, and the TypeScript guards in background/transfer.ts and background/withdraw.ts.

**Suggested fix.** At the top of max_in_parts (or both callers), bail with the one-transaction words when utxos is empty, or return Err(e) whenever parts comes out empty.

**Test idea.** Call api::build_transfer_parts and api::build_withdraw_parts with Max (lovelace None) and no UTxOs. Assert both return Err containing "nothing in the Seedelf balance". Both return Ok(empty) on HEAD.

**Skeptic (confirmed, nit).** Accurate, and unreachable today. With an empty utxos slice, max_in_parts never enters its loop, `failed` stays None, and it returns Ok(vec![]). With any UTxOs it returns at least one part or an Err: a first fit_part failure with no parts falls to `!went && parts.is_empty() => Err(e)`, and max_chained returns a non-empty chain or bails. The one-transaction paths refuse an empty balance in words. Every caller guards first, though. transfer.ts and withdraw.ts throw nothingToSpend before calling, and their shortfall retries ('most') reuse the same non-empty utxos. sessions.ts buildFunding guards too, and it always sends `funding`, which skips max_in_parts. So `whole([])`, which would throw a TypeError at `last.payments`, is never reached. It's a defensive inconsistency in an API no caller can trip, so nit.

Evidence: wasm/src/lib.rs:4288-4360 (max_in_parts; loop at 4302; Err only when failed and parts empty, 4344-4346); 4444-4456 (build_transfer_parts sends Max straight to max_in_parts); 4560-4584 (build_withdraw_parts: Max only when !funding); 3058-3060 and 3378-3380 (the one-transaction refusals); extension src/background/transfer.ts:102 and withdraw.ts:98 (utxos.length === 0 -> nothingToSpend before measuring); sessions.ts:2690 (guard), 2701 (request carries funding); script-spend.ts:477-493 (whole: parts.at(-1)! then last.payments[0]).

## 321-parts-worker#4

**nit · refuted · performance** — Once its parent shows, a waiting part is retried at every pump, up to every 5 s, against giveme.my

At `seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts:455`

**Detail.** What the code does:
- The look for a parent is spaced by LOOK_EVERY_MS (parts.ts:424-426). Once `seen`, every pump goes straight to send (parts.ts:436-447).
- Home's poll pumps on every `pending-tx` (handlers.ts:218). That's every 5 s while the watch is on the feed (Home.tsx:128 and 498-500), every 15 s otherwise.
- A giveme.my that's behind or busy (a 429 counts as busy) is asked again on each pump for GIVEME_BEHIND_MS (3 min; parts.ts:44 and 455). That's about 36 requests per part, after which the rest stop as refused.

**Scenario.** giveme.my is rate-limiting during a burst. A wallet with Home open asks again every 5 s, which keeps it over the limit. After 3 minutes the payment stops partly sent, and the owner's service has taken the hammering.

**Confirmed how.** Read the code.

**Suggested fix.** Space sends after `seen` the way looks are spaced: an in-memory `tried` map keyed by part hash, using LOOK_EVERY_MS, and back off on giveme.my's busy answers.

**Test idea.** With the parent shown and giveme.my answering 429, pump 10 times 5 s apart. Expect at most 2 collateral requests.

**Skeptic (refuted, nit).** Once a part is `seen`, the parent's look is skipped (parts.ts:423), so each pump does ask giveme.my again. But the stated cadence is wrong.
- Home polls every 5 s only while its answer carries `onFeed` (Home.tsx:128, 500). settleNow adds that only for a watched transaction it hasn't seen yet (pending.ts:892).
- By the time a waiting part is `seen`, the watch has seen the parent too. Its own look runs on every poll, while the step's look is throttled to LOOK_EVERY_MS (parts.ts:424-426), so the watch usually sees it first.
- Home's answer is then the seen record (pending.ts:754-770) or parts.shown() (parts.ts:550-559). Neither has onFeed, so Home polls at WATCH_EVERY_MS, 15 s (Home.tsx:126, 495-500).

With the minute alarm, that's about 5 asks a minute: roughly 15 per part over GIVEME_BEHIND_MS, not about 36. The proposed spacing at LOOK_EVERY_MS (15 s) is the cadence it already has, so the fix changes nothing.

Retrying a busy giveme.my at each pump for 3 minutes is the documented rule (flows.md:369), as it is for Lovejoin's tail.

Evidence: parts.ts:53, 423-436, 454-455, 550-559; pending.ts:754-770, 892; Home.tsx:124-128, 495-500, 1417-1418; sw.ts:87; docs/flows.md:369 ('giveme.my or Koios turning it away within 3 minutes of its parent showing is tried again').

## 322#2

**nit · refuted · correctness** — The hex is cut only when it ends the message: anything after it puts the whole transaction back on the retry line, wrapped into a tall wall

At `seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:117`

**Detail.** `RAW_TX = /\s*\|\s*RawTx:\s*([0-9a-f]+)\.?\s*$/i` is anchored at the end of the message. A JSON message is never capped (`why: said === undefined ? words.slice(0, 300) : words`, minswap.ts:414). If Minswap ever puts anything after the hex (a closing quote, a trace, a second `| …` field), the match fails and the whole hex stays in `why`. It is still classified build-failed (BUILD_FAILED matches the words), so `error` differs from the plain words and is shown in full in `.timeline__error` (Swaps.tsx:3106). That rule wraps but has no height cap (styles.css:3053-3057), so a sidebar about 360 px wide shows roughly 150 lines of hex. The horizontal overflow this PR fixed can't come back, but the line can become a wall again. Minswap's one observed format (2026-10-23) matches, so this is about robustness only.

**Scenario.** Minswap changes its 500 to `Error evaluating tx: … | RawTx: 84aa… | Trace: …`. The retry line again carries the whole few-KB transaction, now as a block a couple of thousand pixels tall under the timeline, and the transaction is missing from Details.

**Confirmed how.** Read the code: minswap.ts:117 and 403-415, Swaps.tsx:3106, styles.css:3053-3057.

**Suggested fix.** Match `\|\s*RawTx:\s*([0-9a-f]+)` without the `$` anchor and cut from there to the end. Also cap `why` for JSON answers (for example the same 300 characters, or 500), so no message from Minswap can fill the line.

**Test idea.** In minswap-refusals.test.ts, a 500 `{ message: `${WHY} | RawTx: ${CBOR} | Trace: x` }` should give `e.message` without the hex and `e.cbor === CBOR`. It fails today.

**Skeptic (refuted, nit).** The failure needs Minswap to change its answer. The one format it's known to send, `<words> | RawTx: <hex>` at the end of the JSON message, is handled, and so are the tested variants: JSON, and plain text with a trailing period and whitespace. The doc comment says the anchor is deliberate ('How such a refusal ends'). Even if the format changed, the effect is only how the page looks. `.timeline__error` wraps, through this PR's overflow-wrap, so nothing runs off the screen, and nothing about money, signing or privacy changes. The uncapped JSON `why` predates this PR: the old code took parsed.message whole, at line 374 of 68150b394. Dropping the `$` anchor and cutting from the match would be a harmless hardening if wanted. It isn't a defect in what ships.

Evidence: minswap.ts:117 RAW_TX, 389-392, 403-414 (refusalOf: JSON why uncapped at 414); pre-PR 68150b394 minswap.ts:374 `message = String(parsed.message ?? parsed.error ?? message)` (also uncapped); tests/minswap-refusals.test.ts:28 (JSON) and :35 (plain text with trailing '.'); e2e/support.ts:525 (the observed format); styles.css:3043-3046 and 3053-3057 (overflow-wrap: anywhere on the retry <p>s).

## 322#3

**nit · refuted · i18n** — es: "de su lado" reads as "taking its side", not "on Minswap's servers"

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:2505`

**Detail.** "El intercambio que construyó Minswap falló cuando Minswap lo ejecutó, de su lado. No se firmó nada." In Spanish "de su lado" is the idiom for siding with someone. For where it happened, "en sus servidores" or "por su parte" says it. The string is recorded as `machine` (docs/i18n/es-provenance.json:2217) and isn't in the critical set, so no person checks it before release. The Japanese for both keys and the Spanish `swaps.retry.cbor` read correctly and match the glossary and nearby wording (intercambio, construyó Minswap, 作成, スワップ).

**Scenario.** A Spanish reader stumbles on "lo ejecutó, de su lado", wondering whose side is meant. The point, that it failed on Minswap's servers and not in the wallet, gets blurred.

**Confirmed how.** Read es.json:2505 against en.json:2371 and the neighbouring es strings.

**Suggested fix.** "El intercambio que construyó Minswap falló cuando Minswap lo ejecutó en sus servidores. No se firmó nada."

**Test idea.** Add the Spanish wording of minswap-build-failed to worker-words.test.ts's retry-line case, as the Japanese one is.

**Skeptic (refuted, nit).** 'de su lado' as an adverbial after the verb, set off by a comma, reads as 'on its end/side'. That's the usual support-desk sense ('el error es de su lado', 'revisa de tu lado'). The sense of taking someone's side needs a verb: 'estar/ponerse de su lado'. The Spanish mirrors the English 'on its side' (en.json:2371), and 'No se firmó nada' right after it carries the point the user needs. 'en sus servidores' or 'del lado de Minswap' would read a little more naturally, and would clear the mild doubt over whether 'su' means Minswap's or the swap's, but that's polish. The key is recorded as machine and left out of the critical set on purpose, as the PR says.

Evidence: es.json:2505 swaps.retry.minswapBuildFailed vs en.json:2371; docs/i18n/es-provenance.json:2217 ('machine'); no other es string uses 'de su lado'/'del lado' (grep of es.json); the PR #322 body says neither new key is in the accuracy-critical set.

## 323-rust#2

**nit · confirmed · docs** — Stale docs on the replaced collateral box and on the return spending the collateral

At `seedelf-platform/seedelf-core/src/build.rs:560`

**Detail.** `external_sweep_with`'s doc (build.rs:560-563) says it's for "a web wallet session's return putting its collateral into a Lovejoin box". Since #323 nothing calls it with extras: its only caller is `external_sweep`, with &[], so the `extra` parameter is dead in shared core. The wasm module doc (lovejoin.rs:13-15) still says the return takes "the collateral (spent here, last)" and merges, which is no longer true after a tail or for a Bootstrap. `ChainResult.returned`'s doc (lovejoin.rs:1380-1382) still counts the collateral in what comes back.

**Scenario.** A maintainer reads core's doc, keeps `external_sweep_with`'s `extra` for a use that is gone, or relies on `returned` including the 5 ₳ after a tail. Nothing a user sees.

**Confirmed how.** Read the code; grep finds no caller passing extras.

**Suggested fix.** Drop `external_sweep_with`'s `extra`, or reword its doc. Update the module doc's step 3 and `returned`'s doc to cover the tail and the Bootstrap with no collateral.

**Test idea.** None needed (docs).

**Skeptic (confirmed, nit).** All three docs are stale since #323 replaced CollateralBox with CollateralTail and the Bootstrap went without a collateral. external_sweep_with's only caller passes no extras, so its `extra` parameter and its doc ("a web wallet session's return putting its collateral into a Lovejoin box") describe a use that no longer exists. The CLI is unaffected: external_sweep is byte-identical with &[]. The wasm module doc's step 3 still says the return spends the collateral and merges, which is false after a tail and for a no-collateral Bootstrap. ChainResult.returned's doc still counts the collateral, though collateral_tail's own doc at lovejoin.rs:1405 corrects it. bootstrap_most's doc ("beside a collateral the deposit never spends", mod.rs:1756-1758) is stale in the same way and belongs with index 0's fix. A user sees none of this.

Evidence: HEAD build.rs:556-563 (doc), :557 (the only call, with &[]); a workspace grep (target excluded) finds no other caller. Wasm lovejoin.rs:13-15 (module doc step 3), :1380-1382 (returned's doc), :1405 ("`returned` leaves its 5 ₳ out"). git log -S external_sweep_with: added in 4d5bf583 (#321); its use was removed by 24c5c62a (#323).

## docs-small#3

**nit · confirmed · docs** — Plan §5: a private launch's change takes its inputs' merged history, not "a history class of its own"

At `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md:352`

**Detail.** #308's §5 lists "the change, into a fresh register under a history class of its own". The worker gives it changeHistory(classes, built.inputs) (lovejoin-launch.ts:309), the merged class of what it spent, as every Seedelf spend does (script-spend.ts:171-173). Nothing later in the plan says this changed. It's privacy-neutral: the change is an output of the launch, so on chain it's tied to the launch and its inputs anyway, and a class of its own would hide nothing. The review shows the histories spent (LovejoinLaunch.tsx:225) and says the UTxOs spent are tied to the start (lovejoin.launch.privacy.private).

**Scenario.** Nothing a user sees. A reader of the plan expects coin selection to keep a launch's change apart from the classes it spent.

**Confirmed how.** Read the code.

**Suggested fix.** Reword §5's last bullet: "the change, into a fresh register, under the merged class of what it spent".

**Test idea.** None (docs).

**Skeptic (confirmed, nit).** §5's last bullet (from #308) says a private launch's change goes 'under a history class of its own'. The worker records it under changeHistory(classes, inputs), the merged class of what it spent, as every Seedelf spend does. That holds for both builds. No later decision in the plan changes this. The merged class is the honest choice: on chain the change is an output of the launch, so it is tied to the inputs. The review shows the histories spent, and its privacy text says the UTxOs spent are tied to the start. Plan wording only.

Evidence: chunk-34-token-pools.md:352 (bf4ff54c9). lovejoin-launch.ts:309 (origins: { built: changeHistory(classes, built.inputs), bare: changeHistory(classes, bare.inputs) }), :394-407 (sendable carries origin). script-spend.ts:171-173 (changeHistory = merged). LovejoinLaunch.tsx:221-225 (privacy callout, HistoriesNote). en.json:1352 (lovejoin.launch.privacy.private).

## gap-3#4

**nit · confirmed · docs** — seedelf-platform/CLAUDE.md tells agents Max takes at most 20 UTxOs and settle refuses only over 16 KiB; 1.6.0's output limit, typed errors and carry are missing

At `seedelf-platform/CLAUDE.md:61`

**Detail.** - CLAUDE.md:61 says '`build::max_inputs` picks Max's inputs (...at most 20)'. That's true per transaction only. The web wallet's Max now spans up to 25 transactions (500 UTxOs) through WebAssembly's max_in_parts.
- CLAUDE.md:97 says '`settle` refuses a transaction over 16 KiB'. Since 1.6.0, the shared settle also refuses any output whose value is over MAX_VALUE_SIZE, 5,000 bytes (build.rs:135-138 and :249-271, TooLarge::Output; absent at 63f87b8). ScriptSpend::settle (:1980, :2027) and external_sweep (:584) go through it. So a CLI sweep or transfer that gathers many tokens into one output now fails at build with 'One output would hold N bytes of tokens…' instead of at submit.
- Not listed in CLAUDE.md:
  - the typed TooMany and TooLarge errors, with is_too_many and is_too_large (build.rs:144-185, :507-524), which the web wallet uses to split a payment into parts;
  - ScriptSpend::carry (:1701) and build::carried (:2258), beside with_account, measure_locally and pay_rest;
  - core Lovejoin mixes can now go under giveme.my's collateral (lovejoin/mod.rs:803 mix_giveme, used by collateral_tail at :2023), beside its withdraws.
- architecture.md:125 also mentions only the 16 KiB refusal.

**Scenario.** An agent asked to change Max caps a payment at 20 UTxOs. Another, asked about a CLI error 'One output would hold 5,100 bytes of tokens', searches the 16 KiB logic and may 'fix' settle's new refusal as a CLI regression. One adding giveme.my handling assumes ScriptSpend and withdraws are its only paths.

**Confirmed how.** Read build.rs at HEAD, and git show 63f87b8 of the same file: no MAX_VALUE_SIZE, TooMany, TooLarge or carry before 1.6.0. Also read wasm/src/lib.rs's max_in_parts and core lovejoin/mod.rs.

**Suggested fix.** CLAUDE.md:61: say max_inputs takes at most 20 per transaction; the web wallet's Max goes in parts over every UTxO (max_in_parts, 25 parts), and a part with no ADA chains on the one before's carry(). CLAUDE.md:97 and architecture.md:125: add the 5,000-byte output limit, and say both size refusals are typed (TooLarge, with TooMany for computation) so callers can split. Mention mix_giveme under Script spends or Things that bite.

**Test idea.** Docs only.

**Skeptic (confirmed, nit).** Both cited CLAUDE.md lines are still true. max_inputs takes at most 20, those holding the tokens first, and settle does refuse anything over 16 KiB. They are incomplete, not wrong. New since 63f87b8 and missing from CLAUDE.md: settle's refusal of an output over 5,000 bytes, the typed TooLarge and TooMany errors, ScriptSpend::carry with build::carried, and mix_giveme. All are documented in flows.md:368 and :375 and architecture.md:167-169. For the CLI, the new check only refuses at build what the node would refuse at submit: value_size is the serialized Value size the ledger checks. So no valid CLI transaction changes. Worth a line in the guidance, but no agent breaks anything by it.

Evidence: seedelf-platform/CLAUDE.md:61 and :97. build.rs:135-138 sets MAX_VALUE_SIZE and :258-267 refuses with TooLarge::Output. TooLarge is at :140-185 and TooMany at :503-524. carry is at :1697-1701, carried at :2254-2258, max_inputs at :2877-2884 and value_size at :202-215. `git show 63f87b8:…/build.rs` has none of MAX_VALUE_SIZE, TooLarge or TooMany. core lovejoin/mod.rs:803 is mix_giveme.

## gap-3#7

**nit · confirmed · docs** — flows.md:521 says the collateral switch goes off with the returns switch; it's only greyed out, and a mix still mixes its collateral

At `seedelf-platform/seedelf-web-wallet/docs/flows.md:521`

**Detail.** Settings.tsx:848 and :852 show the collateral switch with aria-checked={prefs.lovejoinCollateral}, disabled while lovejoinReturns is off. So it stays on, greyed, and its note still says the collateral becomes a box. The worker's collateralIntoPool reads only lovejoinCollateral (sessions.ts:4313-4314), and throughLovejoin is true for every mix session (:4337-4338). So a mix from the Lovejoin tile, or a swap whose approval kept Lovejoin, still mixes its collateral with returns off. tests/settings.test.ts:230 asserts only `disabled`, although the test's name says 'off with the returns''.

**Scenario.** A user turns returns off, reads that the collateral's mix is off with it, then mixes from the private balance. That session's 5 ₳ still goes through the giveme.my-backed collateral mix. Money is unaffected, and the result is more private, but the doc says otherwise.

**Confirmed how.** Read Settings.tsx:836-855, sessions.ts:4313-4341, tests/settings.test.ts:210-231.

**Suggested fix.** Say it's greyed while returns are off, which changes nothing for a mix from the Lovejoin tile, whose collateral is still mixed. Or, if the owner meant 'off', have the worker treat the collateral setting as off while returns are off.

**Test idea.** A lovejoin-planner case with lovejoinReturns false, lovejoinCollateral true, a mix session and a shown 5 ₳ pool, asserting whichever behaviour the owner picks.

**Skeptic (confirmed, nit).** With returns off, the collateral switch keeps its stored value (on by default) and is only greyed out. The worker reads lovejoinCollateral alone, throughLovejoin is always true for a mix, and mixFunding pays the reserve with through=true, so a mix from the Lovejoin tile still mixes its collateral. That matches the owner's answer, 'every return through Lovejoin', and Settings' own note when returns are off ('A mix from the Lovejoin tile still mixes'). Only flows.md:521's word 'off' misleads. Money is unaffected and the result is more private.

Evidence: Settings.tsx:848 sets aria-checked={prefs.lovejoinCollateral}, and :852 sets disabled={!loaded || !on}. sessions.ts:4313-4314 (collateralIntoPool), :4337-4338 (throughLovejoin is true for a mix) and :1961 (tailReserve(network, true)). en.json settings.lovejoin.privacy.returnsOff. chunk-34-token-pools.md:964 holds the owner's answers. settings.test.ts:230 asserts only disabled="".

## x-i18n-es#2

**nit · confirmed · i18n** — lovejoin.pools.flag.held

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:1351`

**Detail.** "{{n}} retenidas por un arranque" gets a bare number: Lovejoin.tsx:1785 passes n: p.bootstrap.length with no count, so i18next can't choose a singular. With one box the row reads "1 retenidas por un arranque". English "{{n}} held by a Bootstrap" works for any number, but Spanish needs agreement. The same mismatch appears with one box in three more places. lovejoin.mixes.againOf (L1364) gives "{{what}}, mezcladas otra vez" with what = "1 caja de 10 ₳" (Lovejoin.tsx:2014-2015). lovejoin.ways.fundedInto (L1463) gives "A través de Lovejoin: {{boxes}}, financiadas ahora" with boxes = "1 caja de …" (LovejoinReturn.tsx:241-243). The tag lovejoin.tag.held (L1370) is "Retenidas" on a one-box Bootstrap.

**Scenario.** A Spanish user has Bootstrapped one box into a pool. The pool row shows "1 retenidas por un arranque", and a Mix again of a single box is listed as "1 caja de 10 ₳, mezcladas otra vez". The grammar is wrong; the meaning gets through.

**Confirmed how.** Read the code: Lovejoin.tsx:1785, Lovejoin.tsx:2006-2015, LovejoinReturn.tsx:241-243.

**Suggested fix.** Avoid the participle's agreement, e.g. "{{n}} en un arranque", "{{what}}: nueva mezcla", "A través de Lovejoin: {{boxes}}, con la financiación de ahora". Or pass count and add _one/_other forms to these keys in all three locales.

**Test idea.** Add a lint to tests/i18n.test.ts. For es keys with no plural forms whose value has {{n}}, {{boxes}} or {{what}} followed within three words by a word ending in -adas or -idas, fail. It catches these four keys today.

**Skeptic (confirmed, nit).** No count is passed and none of these keys has plural forms, so one box renders Spanish plural agreement. A count of one is reachable: checkBoxes allows 1 and the Bootstrap input has min=1. In againOf, "what" comes from boxesOf with amount.boxes_one ("1 caja de 10 ₳"), and fundedInto gets lovejoin.boxesOf_one. The result is "1 retenidas por un arranque", "1 caja de 10 ₳, mezcladas otra vez" and "A través de Lovejoin: 1 caja de …, financiadas ahora". The tag "Retenidas" is the only plural among the singular or neutral tags (Completada, En curso, Volviendo). One more case belongs with these. The English "held until you bring them back" is itself plural for one box, and the Spanish lovejoin.mixes.held ("retenidas hasta que las traigas de vuelta") copies it on the same row. The grammar is wrong but the meaning gets through.

Evidence: Lovejoin.tsx:1785 (n: p.bootstrap!.length, no count); Lovejoin.tsx:2004-2015 (boxesIn and againOf); Lovejoin.tsx:2041-2043 (tag.held); LovejoinReturn.tsx:241-243; lovejoin.ts:2103 and Lovejoin.tsx:2874 (one box allowed); es.json:1351, 1364, 1367, 1370, 1463 (no _one or _other variants)

## x-i18n-es#3

**nit · confirmed · i18n** — lovejoin.launch.needBox

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:1440`

**Detail.** "Enter how much ADA each box holds." became "Escribe cuánto ADA tiene cada caja.", and lovejoin.launch.needQuantity (L1439) became "Escribe cuánto del token tiene cada caja.". The glossary (docs/i18n/glossary.md, "Enter (a value) | Ingresa | Lace's") settles "Enter" as "Ingresa". All 17 other "Enter …" values in es.json use it (review.why.amount, token.amount.*, swaps.rules.*). "Escribe" is otherwise used only for "Type" and "Write" (dapp.passwordToSend, reset.confirmLabel, create.phrase.note).

**Scenario.** A Spanish user on Start a pool leaves the box amount empty and is told "Escribe cuánto ADA tiene cada caja.", while every other form in the wallet says "Ingresa …". It's one wallet speaking two ways, the drift the glossary exists to prevent.

**Confirmed how.** Read the code: compared every es value whose English starts with "Enter" or "Type" against glossary.md.

**Suggested fix.** "Ingresa cuánto ADA tiene cada caja." and "Ingresa cuánto del token tiene cada caja."

**Test idea.** In tests/i18n.test.ts: for every key whose English starts with "Enter ", expect the es value to start with "Ingresa". It fails today on these two keys only.

**Skeptic (confirmed, nit).** The glossary settles "Enter (a value)" as "Ingresa". 18 English values start with "Enter". 16 of their Spanish values start with "Ingresa", and the 2 that don't are exactly needQuantity and needBox (the finding said 17 others; the substance holds). Besides these two, "Escribe" is used only for English "Type" and "Write". Both strings are Review's reason it can't be pressed yet on Start a pool.

Evidence: docs/i18n/glossary.md:80 ("Enter (a value) | Ingresa | Lace's"); es.json:1439-1440; LovejoinLaunch.tsx:130-132; a scripted compare of en and es: 18 "Enter" keys, 16 "Ingresa"

## x-i18n-es#4

**nit · confirmed · i18n** — worker.parts.partlyMaybe

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:3199`

**Detail.** "... but Koios didn't answer for the last one, so the rest wait" became "pero Koios no respondió por la última". "Responder por" means "to answer for" in the sense of being accountable for something, a calque of the English. The sibling key worker.parts.fundingPartlyMaybe (L3201) says it correctly: "Koios no respondió a la última enviada".

**Scenario.** After a payment in parts where Koios gave no answer for the last transaction sent, a Spanish user reads "Koios no respondió por la última" ("Koios wasn't accountable for the last one"). It reads oddly, and the funding version of the same message words it differently.

**Confirmed how.** Read the code: compared L3199 with L3201.

**Suggested fix.** "Se enviaron {{sent}} de {{total}} transacciones, pero Koios no respondió a la última enviada, así que el resto espera. Cuando se resuelva, revisa de nuevo lo que falta."

**Test idea.** In tests/i18n.test.ts: expect(es["worker.parts.partlyMaybe"]).toContain("no respondió a la última").

**Skeptic (confirmed, nit).** "Responder por" means to vouch for or be accountable for. It copies the English "answer for", whose sense here is "gave no answer about". The sibling key words the same event correctly: "no respondió a la última enviada". The path is reachable when a payment in parts has an unsure last send. The meaning can be recovered, so this is a nit.

Evidence: es.json:3199 vs es.json:3201; parts.ts:599 raises worker.parts.partlyMaybe; sessions.ts:5379 raises fundingPartlyMaybe

## x-i18n-es#5

**nit · confirmed · i18n** — lovejoin.bootstrap.atMost

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json:1229`

**Detail.** "At most {{most}} fit in one." became "Como máximo caben {{most}} en una.". The feminine "una" has no noun. The note it ends (Lovejoin.tsx:2883-2894) has just named "tu cuenta pública" and "cajas", so a reader must guess that "una" means "una transacción", meaning one Bootstrap.

**Scenario.** On a pool's Bootstrap form, paying from the public account, a Spanish user reads "... Se quedan en el pool hasta que las traigas de vuelta. Como máximo caben 40 en una." It's unclear what holds at most 40: an account, a box, or a transaction.

**Confirmed how.** Read the code: Lovejoin.tsx:2883-2894.

**Suggested fix.** "Como máximo caben {{most}} en un solo arranque." (or "en una sola transacción").

**Test idea.** In tests/i18n.test.ts: expect(es["lovejoin.bootstrap.atMost"]).not.toMatch(/en una\.$/).

**Skeptic (confirmed, nit).** The note joins costPublicOf ("N cajas, X de tu cuenta pública. Se quedan en el pool hasta que las traigas de vuelta.") with atMost. The only feminine singular nouns in view are "caja" (from "1 caja") and "cuenta pública". So "Como máximo caben 40 en una" reads as "40 fit in one box" or "in one account". The English "fit in one" is vague too, but the gendered "una" makes it worse. Its sibling atMostPrivate ("entran como máximo {{most}} a la vez") and lj.boxRange.bootstrap ("Un arranque mete de 1 a {{most}} cajas a la vez") are clear, so "a la vez" is the matching fix. No harm can follow, because the input's max already enforces the limit.

Evidence: es.json:1229; Lovejoin.tsx:2883-2894 (the note built with joinSentences); Lovejoin.tsx:2875 (max={bootstrapMost}); es.json lovejoin.bootstrap.costPublicOf_* and lovejoin.bootstrap.atMostPrivate

## x-i18n-ja#3

**nit · confirmed · i18n** — worker.parts.tooMany

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json:2876`

**Detail.** 「受取人を 1 人ずつにしてください」 is the only 受取人 in ja.json. The glossary has recipient → 宛先, and a recipient is an address or a Seedelf, not a person (1 人).

**Scenario.** A Japanese user sending to several Seedelfs reads "one person at a time" and a word for recipient that appears nowhere else in the app.

**Confirmed how.** Read the code; grepped ja.json for 受取人.

**Suggested fix.** 「一度に送れる UTxO の数を超えています。金額を減らすか、宛先を 1 件ずつにしてください。」

**Test idea.** None needed; a glossary check for 受取人 would catch it.

**Skeptic (confirmed, nit).** It's real but only wording. 受取人 appears nowhere else in ja.json, and 1 人 counts people, while the glossary gives 宛先 for a recipient. The sibling recipient-limit message already says 宛先 … 件. The meaning is clear (send to fewer recipients at a time), so nit.

Evidence: ja.json:2876 「…受取人を 1 人ずつにしてください。」 is the only match for 受取人 in ja.json. glossary.md: 'recipient; To (a row label) | 宛先'. ja.json:1917 shared.recipients.tooMany 「1 回の支払いの宛先は最大 {{max}} 件です。」. Thrown from short.ts:33.

## x-i18n-ja#4

**nit · confirmed · i18n** — lj.launch.otherPool

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json:2915`

**Detail.** The error calls the pool's credential 資格情報. The start's review note, lovejoin.launch.warn.atMost (ja.json:1250, critical), calls the same credential クレデンシャル.

**Scenario.** A user reads クレデンシャル on Start a pool's review and then 資格情報 in the error about that same registration, and may not connect the two.

**Confirmed how.** Read both values; grepped every 'credential' key.

**Suggested fix.** Change the non-critical one so no new back-translation round is needed: 「このプールのクレデンシャルは、開始より前に何者かが登録していました。…」

**Test idea.** None; record the term in the glossary.

**Skeptic (confirmed, nit).** Both strings are in Start a pool, and they use two words for the same credential. The direction of the fix needs a note, though. 資格情報 is the word 1.5.0 already used (tx.certField.credential, .cold and .hot), so the outlier is the critical lovejoin.launch.warn.atMost (クレデンシャル), not lj.launch.otherPool. Changing the non-critical one to クレデンシャル, as suggested, makes the pair match within the flow without a new back-translation round, but it leaves the transaction details' 資格情報. Both are standard Japanese for "credential", and lj.launch.otherPool only shows in a rare race (someone registered the credential first), so the impact on users is negligible.

Evidence: ja.json:1250 lovejoin.launch.warn.atMost 「…プールのクレデンシャル…」 (critical, verified), shown at LovejoinLaunch.tsx:219. ja.json:2915 lj.launch.otherPool 「このプールの資格情報は…」 (machine), thrown at lovejoin-launch.ts:377. 1.5.0 (63f87b8) ja.json: tx.certField.cold/credential/hot = コールド資格情報/資格情報/ホット資格情報.

## x-i18n-ja#5

**nit · confirmed · i18n** — lovejoin.pools.starting

At `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json:1163`

**Detail.** English "Being started: {{have}} of {{floor}} boxes" becomes 「立ち上げ中：{{floor}} 件中 {{have}} 件」, with no noun. The 34e round recorded that 件 without a noun reads as transactions and fixed it elsewhere. The sibling lovejoin.bootstrap.progress (ja.json:1203) names the boxes.

**Scenario.** In the pools list a row says 「立ち上げ中：20 件中 3 件」, and the user can't tell whether it counts boxes or transactions.

**Confirmed how.** Read the code (Lovejoin.tsx:1781-1783) and the 34e note in verified-critical-ja.json.

**Suggested fix.** 「立ち上げ中：ボックス {{floor}} 件中 {{have}} 件」

**Test idea.** None.

**Skeptic (confirmed, nit).** The flag drops the noun the glossary requires (ボックス N 件), as 34e fixed elsewhere. In the same row, the crowd text shows both 「あなたのものではないボックス N 件」 and 「デポジット M 件」, so a bare 「20 件中 3 件」 could be read as boxes or as deposits. have is p.others, the same number as the crowd's box count right beside it, so a careful reader can work it out. Nit.

Evidence: ja.json:1163 「立ち上げ中：{{floor}} 件中 {{have}} 件」 vs en.json:1256 '{{have}} of {{floor}} boxes'; Lovejoin.tsx:1783 (flag), 1802-1803 (crowdText in the same row); lovejoin-pools.ts:163-176 (crowdText; bootstrapProgress have = p.others); ja.json:1154-1155; glossary.md 'N boxes | ボックス N 件'; ja.json:1203 lovejoin.bootstrap.progress names the boxes.

## x-i18n-ja#6

**nit · confirmed · docs** — glossary.md records none of 1.6.0's new words

At `seedelf-platform/seedelf-web-wallet/docs/i18n/glossary.md:87`

**Detail.** glossary.md is unchanged since 1.5.0. 1.6.0's choices appear only in the prose of verified-critical-ja.json: Bootstrap → ブートストラップ, classic pool → クラシックプール, token pool → トークンプール, Start a pool → プールを開始, floor → 下限, box value → 中身が同じ, held by a Bootstrap → 保持, four boxes a mix → ミックスごとにボックス 4 件, change → おつり, a pool's credential. The file calls itself 'the words that must be the same everywhere'.

**Scenario.** The next translator of a 1.6.x key picks a different word, as already happened with 資格情報 vs クレデンシャル and 入金 vs 資金提供 above.

**Confirmed how.** git diff 63f87b8 499768f6 -- docs/i18n/glossary.md is empty; read the verified note.

**Suggested fix.** Add a 1.6.0 rows block to the Japanese (and Spanish) tables with the words above.

**Test idea.** None.

**Skeptic (confirmed, nit).** glossary.md hasn't changed since chunk 23, while the other five i18n files changed for 1.6.0. Still, the file doesn't claim to list every word, so nothing in it is false; it is just incomplete. A spot check found the main 1.6.0 terms consistent without it: Bootstrap is ブートストラップ in every ja value of the 24 en keys (es: arranque/arrancar throughout), and classic pool and token pool are consistent. Of the two slips the finding cites, 入金 vs 資金提供 happened even though the glossary already has that row. Recording the 1.6.0 words is a cheap docs nit.

Evidence: git diff --stat 63f87b8 499768f6 -- docs/i18n/: critical-keys.json, es/ja-provenance.json and verified-critical-es/ja.json changed, glossary.md not; git log on glossary.md ends at 596ec271 (chunk 23). Python spot check over en/ja/es.json: no ja value of a Bootstrap key lacks ブートストラップ (the misses were only _one keys ja doesn't have); classic pool 3/3 and token pool 2/2 consistent.

## x-release#8

**nit · confirmed · tests** — data-layer.yml doesn't run when networks.ts or seedelf-core's constants.rs change, though seedelf-data's tests read both

At `.github/workflows/data-layer.yml:7`

**Detail.** 1.6.0 added three shared fixtures to the path filter, but seedelf-data/api/src/constants.rs:39-41 also include_str!s seedelf-core/src/constants.rs and extension/src/networks.ts, to hold the contract hash, the policy and Lovejoin's mainnet mixBox. This gap predates 1.6.0.

**Scenario.** A PR that changes networks.ts's mainnet mixBox, for example after a Lovejoin redeploy, passes CI. The data layer goes on watching the old mix box until some later seedelf-data PR runs that test.

**Confirmed how.** Read the workflow and constants.rs, and checked git show 63f87b8.

**Suggested fix.** Add both files to the paths list.

**Test idea.** None: CI configuration.

**Skeptic (confirmed, nit).** Correct, and it predates 1.6.0. seedelf-data's constants tests read seedelf-core/src/constants.rs and extension/src/networks.ts through include_str!, but neither file is in data-layer.yml's path filter. web-wallet.yml covers seedelf-platform/**, but it never runs seedelf-data's tests. So a change to networks.ts's mainnet mixBox would not run the check that holds it to the data layer.

Evidence: .github/workflows/data-layer.yml:6-14 (paths: seedelf-data/**, the workflow, list.json, lovejoin-pool-vectors.json, lovejoin-shown.json). seedelf-data/api/src/constants.rs:39-41 (include_str! of seedelf-core/src/constants.rs and extension/src/networks.ts), and the_mix_box_matches_the_wallets_mainnet just below. web-wallet.yml has no seedelf-data step (grep finds none).

