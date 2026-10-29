# v-x-priv-4-trace: x-priv#4, traced on HEAD (`6bca8bec`)

**Verdict: confirmed. Severity: low (docs).** Confidence: high.

I couldn't refute it. #336 changed what the data layer's path does, and none of the four places the finding cites changed with it. A scratch test turned architecture.md:732's claims into behaviour: all three fail on HEAD, and all three pass with #336's one call reverted in a copy. The fix text needs two corrections (below).

It's the same defect as **pr336#5** (pr336.md F6, already confirmed by `v-pr336-5-trace`) and x-docs.md's heading 4. Merge them into one fix.

## What holds on HEAD

- **#336 left architecture.md alone.** `git diff 473b7f1a^1 473b7f1a --stat` lists privacy.md, privacy-policy.md, `lovejoin-pools.ts` and two tests. Every other code PR in the range updated architecture.md in its own PR: #330, #333, #335 and #337. So this was missed, not held back for the release-prep commit.
- **The behaviour changed.** `lovejoin-pools.ts:454` is `await this.keep(network, await this.confirmed(network, found));`. Before #336 it was `await this.keep(network, found);`.
  - `confirmed()` (:565-584) takes the listed pools the device doesn't hold (`fresh`, :568).
  - For those, it calls `launched()` (:522) on `koiosAlone()`. That asks `tx_info` for the launch's inputs and certificates (`koios.ts:926`), and asks `account_update_history` (`:954`) for each L its launch didn't register (:550).
  - It keeps a fresh pool only if Koios confirms it (:583).
- **architecture.md:732 is stale.** Unchanged since `677715db` (1.6.0, round 3c), it says "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's". It gives Koios's checks to "Koios's look" alone.
- **architecture.md:287** says only "`lovejoin/pools` is the shown pools' list (`lovejoin-pools.ts`)". No architecture.md line mentions a Koios request made while the data layer answers, or what it costs (rule 8). The cost tables (:292ff) and *What each costs* (:737) have no discovery row.
- **The file header is stale.** `lovejoin-pools.ts:33-36` is unchanged since `fc8561c7`: "Verified offline, a pool may still not be on chain (a seed no launch spent verifies as well), so the ledger is the judge of that".
- **So is the comment in `refresh`.** `:436-437`: "That the pool is on chain at all, the ledger checks". The loop it sits in ends at :454's `confirmed()`.
- **The code contradicts its own header.** `confirmed()`'s docstring (:556-564) gives the new rule: a server that lied, or a deep rollback, "could otherwise list one that isn't there, or one that never paid to be finished".

## The scratch test

`extension/tests/zz-review-v-x-priv-4-trace-1.test.ts` used `lovejoin-discovery`'s fixtures, the real WebAssembly, a fake index and a fake Koios. I ran it alone, then deleted it.

**On HEAD: 3 failed, 5 passed.** Part A, architecture.md's claims as behaviour, all failed:
- **A1:** with the data layer answering, a new listed pool asks Koios nothing. Received `["tx_info"]`.
- **A2:** a listed pool whose launch Koios doesn't know is kept, since being on chain "is the ledger's to judge". Received `[]`.
- **A3:** a listed pool whose L was registered after its launch is kept, since being finished is "the server's word". Received `[]`.

Part B, the proposed fix's details, all passed:
- **B1:** the kept pool carries the list's `launch` (block BLOCK−5, index 9), not Koios's (BLOCK, 3). Where it sits stays the server's word.
- **B2:** the `tx_info` query is `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`, with no outputs (`koios.ts:942`). A list naming the scripts at made-up outputs of the launch (`#5`, `#6`) is still kept.
- **B3:** a pool Koios answers about but doesn't confirm (L registered after its launch) is asked about again at every list. Three lists, 5 minutes apart, sent 3 `tx_info` and 3 `account_update_history`, and kept nothing.
- **B4:** `TXS_PER_REQUEST` is 20 and `CREDENTIALS_PER_REQUEST` is 75.
- **B5:** a pool already held (the head start's) asks Koios nothing.

**Mutation check.** I reverted :454 to `await this.keep(network, found);` in a copy under the scratchpad, then deleted the copy.
- A1–A3 passed, so the doc matched the code until #336.
- B2, B3 and B5 failed, since nothing asked Koios.
- B1 and B4 passed both ways.

## Fix advice (corrections to the finding's fix)

1. **Narrow the ledger sentence at :732; don't drop it.**
   - Koios confirms three things: the launch is on chain, it spent the pool's seed (`launch_check`'s `find_seed`, `wasm/src/lovejoin.rs:705`), and L was registered by the launch or an earlier block.
   - It doesn't confirm the launch's outputs. `tx_info` is asked without them, and `confirmed` keeps the list's own rows and `launch` (B1, B2).
   - So the reference row, the script rows and where the launch sits stay the server's word. The ledger still judges the reference UTxO at each deposit (`deposit_across`), and a rollback after the confirm.
2. **"until Koios answers" should read "until Koios confirms it".**
   - A pool Koios answers about but doesn't confirm is asked about at every list: every 5 minutes while the worker runs, and at a restarted worker's first pool read. That goes on for as long as the data layer lists it (B3).
   - The same goes for a pool whose launch Koios doesn't know yet, and for a Koios that's down.
3. **The cost:**
   - One `tx_info` per 20 launches new to the device.
   - One `account_update_history` per 75 Ls their launch didn't register.
   - The client's retries come on top (two on a 5xx).
   - Pools the device already holds cost nothing (B5).
   - :732 already names the holder look's requests, so the confirm's fit there. *What each costs* (:737, as pr336 F6 suggests) also works. :287 needs only a clause saying a new listed pool is confirmed with Koios.
4. **Two more stale spots the finding didn't list:**
   - `refresh`'s docstring, `lovejoin-pools.ts:399-403`: "every pool it shows, verified here again, kept".
   - The test comment at `tests/lovejoin-discovery.test.ts:302-304`: "That the pool is on chain at all, the ledger checks (each deposit reads its reference UTxO), so this catches only a server that contradicts itself."
5. **The header (:33-36) and :436-437:** say that a pool new to the device is confirmed with Koios before it's kept (`confirmed`), and that the ledger still judges its outputs.

**Not traced here:** B2 shows the script rows' output indexes are the list's word. That predates #336, and it belongs to pr336#0 (F1's gap). I haven't checked whether a wrong index could strand a Bootstrap's boxes.

Scratch files: the test and the copy are both deleted. No tracked file was touched.
