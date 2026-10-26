# Review of the fixes: the data layer (seedelf-data)

Lens: every change since `499768f6` in `seedelf-data/` and `.github/workflows/data-layer.yml`.
- Phase A's 317-data#0, #1, #2 and 321-lj-rust-data#0 (`d5fa7ede`, repaired in `9978654a`). No fixer report exists for them, so I ran their mutation checks myself.
- deep-datum's `datum.rs` and `standard.rs`, and docs-2's runbook note and CI paths (`fc8561c7`).
- Round 2 (`e43eef7f`) touched nothing here.
- The deployed build, `68150b39`, has the same `seedelf-data/` as `499768f6`. So `git diff 68150b39 HEAD -- seedelf-data/api/src` is exactly this round's work: `lovejoin/{datum,db,discovery,routes,standard}.rs` and `state.rs`. `public/` and `private.rs` didn't change.

## Findings

### 1. low: a failed or slow stable-cursor read answers 503, though the cursor's own list and LATEST are kept

`seedelf-data/api/src/lovejoin/routes.rs:242`. Concerns 317-data#0 and 317-data#2 (phase A).

**Scenario.**
- A block arrives while both private connections are busy: say, the `pools` task working out a new cursor's list, and a `tokens/since` or classic `since` read.
- The first `lovejoin/pools` requests at the new tip must read the stable cursor. 317-data#2 keeps the cursor only once a read succeeds.
- The read waits out the pool's 2 s `WAIT` and fails with `Unavailable`, or it runs past the request's 5 s deadline.
- The `?` on line 244 then returns 503 before the route looks at anything it keeps.
- Yet the cursor moves only every 200 slots. So at about 9 of 10 tips, the list for that very cursor is kept (`lovejoin/pools/{cursor}`, an hour), and LATEST is kept too.
- The wallet takes the 503 as `TokensDown` (private-index.ts:341). Discovery drops the hub's crowd counts and doesn't mark the list answered (lovejoin-pools.ts:426). `look()` then scans Koios's holder when the Lovejoin page opens, and the data layer isn't asked again for 5 minutes.

**Why it's the fix's gap.**
- The fix's own comment says: "Meanwhile the last list, and as much when the list fails: kept for an hour, it's a better answer than a 503 that sends the wallet to Koios". It applies that to the list's task, not to the read that comes first.
- 317-data#2's skeptic named this exact side effect ("the route can't reach the list it already holds for the cursor, nor LATEST, and answers 503") and expected caching to remove it. Caching removes it only after the first successful read at each tip.

**Evidence.**
- Code: routes.rs:242-244 (`timeout_at(deadline, state.stable_cursor(..))…?`), state.rs:307-328, chain.rs `block_before` (the private pool's `get()`, `WAIT` 2 s, which becomes `ApiError::Unavailable`).
- Two throwaway unit tests in a copy of seedelf-data (since deleted), both failing on HEAD:
  - `zz_review_a_failed_cursor_read_answers_503_with_its_list_kept`. Tip `aa` works out cursor C's list. At tip `bb` the same cursor's read fails. Output: `answered Err(Unavailable(no connection within 2 s)) with the cursor's list and LATEST kept`.
  - `zz_review_a_slow_cursor_read_answers_503_with_latest_kept`, on a paused clock with a 6 s read. Output: `answered Err(Unavailable(timed out)) with LATEST kept`.

**Suggested fix.**
- On the cursor read's error or timeout, answer `state.kept(LATEST)` when there is one, with the same throttled warn as a failed list. Otherwise return the error.
- Keep the two tests above.
- This refuses nothing, and before the first list it still answers 503.

### 2. low: GATHERED's slot bound, the clause that keeps a read on from skipping new pools, has no test

`seedelf-data/api/src/lovejoin/db.rs:95`. Concerns 321-lj-rust-data#0 (phase A).

**Scenario.**
- Suppose `where b.slot_no <= $2` is lost from `GATHERED`, for example in a refactor that shares the CTE with `found_sql`.
- Its max then covers holder outputs above the read's block, up to db-sync's tip.
- Every read on then starts above candidates launched in the last 200 to 400 slots. A new pool is listed only at the first hourly read from the start after it's that old. So every mainnet wallet sees new pools up to an hour late, with no error.
- Nothing would catch it:
  - the offline suite tests `found_sql`'s text, and discovery only through a model (`read_among`);
  - the live `every_candidate_at_the_holder_is_checked` compares candidates, and the mainnet holder has none until a pool launches.

**Evidence.**
- Mutation in a copy, `where b.slot_no <= $2` changed to `… or true`: all 123 offline tests pass (103 lib, 5 edge, 12 grammar, 3 scripted Kupo).
- The same mutation run through the real `db::found` against a throwaway Postgres 16 with db-sync's schema and domains. Gathered jumps to the candidate at slot 500 when reading at 250: `assertion left == right failed: Gathered { id: 6, tx: 5 }, left: 6, right: 3`. The reads on would never gather the candidates at slots 300 and 500.

**Suggested fix.**
- Add a text test beside `a_read_on_gathers_only_the_outputs_above_its_ids`: GATHERED's outer `where` holds `b.slot_no <= $2`, and its CTE's bounds are `found_sql`'s (`o.id > $3 and o.tx_id > $4`).
- Or build both queries from one CTE string, so the two can't drift.

### 3. nit: the rollback note doesn't say what rolling back to 68150b39's build costs

`seedelf-data/deploy/README.md:143`. Concerns docs-2 (310#0, 311#1, x-compat#1, x-release#6).

**Scenario.**
- After 1.6.0's deploy, `.prev` is 68150b39's build. It has every route and request shape 1.6.0 calls. So the note's costs, sorted by 404 and 400, don't apply, and read that way a rollback looks free.
- It isn't free. It brings back 317-data#0's two 5 s waits. A slow cursor read plus a list still being worked out answer at about 10 s, which is when the wallet aborts. The abort holds the wallet's whole private part on Koios for 5 minutes (private-index.ts:336-338 `failed()`), not just `TokensDown`.
- It also brings back the old shown-pool rule. That rule lists a pool whose launch put its scripts under a datum past 128 levels. The fixed wallet refuses such a pool (`scriptsInline` ≥ 1). If it's the earliest of its values, the genuine later pool isn't listed while the old build runs.
- docs-2's report knew this ("Rolled back, the server could list a pool the fixed wallet's own check refuses"), but the note keeps it under "every fix since goes with them".

**Suggested fix.** One line that stays true across deploys: "A token route that answers after the wallet's 10 s holds the private part like any private route; a `.prev` older than 1.6.0's review answers `lovejoin/pools` that slowly when db-sync is slow, and lists pools the wallet then refuses."

## Checks

### CI's data-layer steps, in seedelf-data
- `cargo fmt --all -- --check`: clean.
- `cargo clippy --locked --all-targets -- -D warnings`: clean.
- `cargo test --locked`: 123 passed, 30 ignored (live).
- The deploy script is unchanged since `499768f6`. shellcheck isn't installed here.

### Phase A's tests fail without their fixes
Each mutation was made in a copy:
- the task waiting its own 5 s: `a_pool_list_answers_by_one_deadline` fails;
- a failed task returning its error: `a_list_that_fails_answers_the_last_one` fails;
- `stable()` called directly: `the_stable_cursor_is_read_once_a_tip` fails;
- `lovejoin/tokens` out of `ALWAYS_KEPT`: `the_snapshots_are_kept_past_the_budget` fails;
- either `Gathered` fold reverted: `a_read_on_goes_on_from_the_highest_output_gathered` fails.

Only finding 2's clause is unpinned.

### 321-lj-rust-data#0's SQL, run for real
I ran `db::found` itself (both pipelined queries, the type mapping, `query_one` over an aggregate) against a throwaway Postgres 16 cluster with db-sync's tables and domain types (`word63type` and the rest). It was on loopback port 55432, separate from this machine's running cluster, and is deleted.
- **Normal order:** a read on misses nothing and gathers nothing twice. Gathered stops at a payment to the holder that holds no `lovejoin` token, and stays put when nothing is new.
- **A fork above the read's block:** the rows come back with higher ids and are read on.
- **A rollback below the read's block:** the same reference is gathered again under new ids. The old candidate-id bound did the same, and `READ_AGAIN` forgets it within the hour.
- **An earlier transaction's output inserted after a later block's:** a read on skips it, where the old bound would have found it.
  - db-sync never writes in that order: `insertBlockGroupedData` runs once per block, at its end, in transaction order, and nothing in db-sync calls `setval`.
  - Home runs `tx_out` in "consumed" mode (`deploy/home/db-sync-insert-options.json`).
- **The plan:** the tx bound does what the finding wanted. The holder's `(address_id, tx_id)` index takes `tx_id > $4` as an index condition, as a generic prepared plan too. The old plan filtered all 300,000 outputs of a spammed holder. Time: 44 ms down to 4.6 ms.

### deep-datum: do the layers agree?
- **The two walks.** I copied `datum.rs`'s walk and core's `cbor::within_depth` (minicbor 0.25.1, as pallas-codec 0.35.1 links it with `std`) verbatim into a scratch crate. I ran 3,000,000 inputs (random bytes, random trees, mutated trees, nests of 126 to 130 levels) at 10 depth limits: 30,000,000 checks, 11 million accepted, 0 mismatches. Planted divergences were caught: an off-by-one depth, and a dropped UTF-8 check.
- **The bytes.** The wallet judges the same bytes the server does. `utxoOf` passes the row's `datum` hex as `inline_datum.bytes`, and `unreadable_datum` applies the same predicate.
- **The rows.** Both judge only the launch transaction's rows at the holder: the server's `launches()`, and the Koios look's `byTx`. Both take the first readable row by output index: `script()` by `o.id`, `held()` by (tx, index). pool-exists's new same-transaction check passes on every list the server makes.

### Once shown, always shown
The server can't hide a pool any field wallet has shown:
- The new rule hides only pools whose every launch row carrying a script sits under a datum past 128 levels. The fixed wallet refuses exactly those, on both its paths.
- Mainnet has no token pool, and 1.5.0 never reads the token routes. So no field wallet has shown one.
- Preprod reads Koios with the same rule, and its pools' script rows carry no datum (deep-datum's scan).
- A device keeps every pool it was handed for good (STATE-2).

### x-release#8
Every file outside seedelf-data that the build or tests read (`include_str!`) is now in the workflow's paths, all six. There's no build script and no path dependency.

### The runbook's claims
All checked:
- #311's build `304f1d16` lacks `lovejoin/routes.rs`, and `68150b39` serves all three token routes;
- `status` prints both sha256s;
- deploy prints `DEPLOYED <sha256> (<old> kept as .prev)`;
- a failed deploy leaves `.prev` as it was;
- a 404 or 400 on a token route is `TokensDown` and keeps the part up.

### A deploy, then a rollback to 68150b39's build, for wallets in the field
- **1.5.0 wallets:** no route or shape changed (the diff is in token routes, the cache and the shown-pool rule). Like every deploy, the restart's few seconds of 502s from Caddy hold whatever parts a wallet read then for 5 minutes.
- **1.6.0 wallets:** none are in the field at the deploy, which comes before the upload. A later rollback sends no 404 or 400, because the wallet's request builders didn't change this round. It does bring back the four phase-A bugs and the old shown-pool rule (finding 3).
- **Both ways:** a restart empties the process. `lovejoin/pools` then answers 503 "behind" until its first list, the discovery's verdicts are worked out again under that build's rule, and every cache refills.

## Questions

1. **How long does mainnet's cold `lovejoin/pools` take after a restart?** That is a read from the start, every candidate checked, and the classic pool's whole history for its crowd. A fresh process has no LATEST and gives that work only the first request's 5 s. If it takes longer, the release procedure's curl block, run right after `status`, prints `503`. An operator might take that as a failed deploy and roll back, losing the fixes. If so, the block needs a line: "a 503 behind in the first minute is the first list being worked out: ask again".
2. **Should the runbook record the read-on premise?** The id and tx bounds assume db-sync writes every output in chain order and never reuses an id. That holds in "consumed" mode. db-sync's `tx_out` "bootstrap" mode inserts the UTxO set late, and a resync in that mode would let reads on skip old candidates until the hourly read. If so, it belongs beside "After a db-sync resync".
3. **317-data#1 protects the snapshot, not `tokens/since/{C}` for its own cursor.** Every wallet reads that right after (`tokensNow`). Past the budget it's still worked out per request, as the classic pool's `lovejoin/since/{C}` has been since 1.5.0. Its skeptic called the fix parity. Is parity enough for 1.6.0?

## Leftovers

None of L1 to L6 is in the data layer.
- Under L6, `seedelf-data/README.md` lags: "each read gathers only the outputs above the highest id read so far", and "Standard means" without the datum's depth (deep-datum's docs-to-update 3).
- The wallet doesn't serve that README.
