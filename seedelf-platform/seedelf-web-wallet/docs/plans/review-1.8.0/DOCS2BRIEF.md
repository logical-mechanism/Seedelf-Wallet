# 1.8.0's release review, round two: the docs touch-up

You're the docs writer of round two. Round one's writer drafted the docs in the merged worktree (their report: [docs.md](docs.md)). Round two found what those drafts and a few older lines say wrong, and four fixers changed some code since. Your job is to make every doc true of the merged code as it is now. Read [DOCSBRIEF.md](DOCSBRIEF.md) first: its rules, its *Don't* list and its report form bind you.

## The tree

- **Edit in the merged worktree, and only there:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/merged`, branch `review-1.8.0/merged`. Round one's drafts are uncommitted there; leave them uncommitted. Run no git command that changes state. The lead commits.
- **Its head** has round two's four fix lanes merged on `4b4628e9`: their reports are in [fix2/](fix2/), and what each changed in a request a flow makes is in their *requestsChanged*. Check every sentence you write against the code there.
- **The traces** in [round2/verify.md](round2/verify.md) give the exact words for most items below. Where an item quotes one, use it unless the merged code says otherwise.

## The items

1. **The privacy policy** (`docs/store/privacy-policy.md`), *Lovejoin's pools* (`:46`) and the 6 November entry (`:93`):
   - the look's moments, as r2-critic#3's trace words them: "as a private session's return is built, by you or by the wallet as a swap that runs itself comes back, at a swap's review or its Stop, at a session's funding or top-up review, at a mix's review, and when you put 5 ₳ in for Lovejoin";
   - its frequency, both halves (our server's list and Koios's holder), hedged as the list's already is: "at most every five minutes while the browser keeps the wallet running" (r2-critic#2);
   - "It names nothing of yours, though it comes at the moment of one of these." in place of "it comes when you do one of these";
   - the pool read: "…and, on mainnet, by a return built with no 5 ₳ at its account and by **Put in 5 ₳ for Lovejoin**";
   - whatever round two's fixers changed in a request (fix2/sessions.md and fix2/retire.md say): r2-worker#1 makes each review list the pools once; r2-critic#0 moves Stop's pool read from two hours on to the next run. Neither is a new kind of request; say nothing that claims the old counts.
2. **privacy.md:**
   - `:202`, the look's throttle: "at most every 5 minutes a network while the worker runs (counted from the last look's start …; the throttle is in its memory, as the list's, so a worker the browser started again looks at its first ask)" (r2-critic#2's trace);
   - the public look's "at most every two minutes" (`:124`), the same gap and older (the trace's N3): the same hedge;
   - the token-pool line, if it says a token pool launched later is found without the page (r2-critic#1).
3. **architecture.md:**
   - `:740`: "So a 5 ₳ pool launched after a device's head start is found and used without the page, on both networks", and its throttles "while the worker runs"; `:748` too;
   - `:647` and `:658`: Put in 5 ₳'s press asks as a return's build does, reads the pool's room on mainnet and refuses under the floor; only the session list's view reads the device alone (r2-critic#3's trace);
   - `:349`, `:351`: the public look's two minutes, hedged (N3);
   - round two's code, in the new block where it belongs: Stop's dialog counts the 5 ₳ pool's room as the return's chain does, leaving the collateral's mix its two draws at each width, while a swap's Review stays a forecast (r2-worker#0); each review lists the pools once (`collateralRoom` on the shared `rooms()` read; the `draws` callers keep their fresh split; `rooms()` hands a trap on) (r2-worker#1); after the first unlock's retired run stops partway, the pools are read at the next run, the read re-armed while one of its withdraws is held as spent, and a released 1.7 Bootstrap owes that read too (r2-critic#0); the hub's `takes` is "takes new boxes" (`!unusable`), its aside's three cases, and a pool's page's line while the retired pools' run goes (r2-screens#3, #4, #5). Read fix2/*.md for what landed; write only what did.
4. **development.md `:331`:** the head start is never a gate, but a pool launched after it is found live without the page only for the 5 ₳ pool, as the code has it: on mainnet by the data layer's list; where the data layer doesn't answer (preprod, Koios-only, the data layer down), by Koios's holder as the page opens, and wherever a return, a review or a funding asks while no 5 ₳ pool is kept. A token pool launched later is found by the list on mainnet, and on those Koios paths as Lovejoin's page opens, at a pool's start, or at Settings' Bring every box back (r2-critic#1's trace). Its throttle "while the worker runs".
5. **The archived plan** (`docs/archive/plans/chunk-44-lovejoin-v2.md` `:67`): "the 5 ₳ pool", not any pool, found later without the page. Keep the owner's words as they are.
6. **flows.md:** the hub's aside and none-line as round two left them; a pool's page while the retired pools' run goes; `dappUi.back.privacy.noteLovejoinMixed`'s new English if flows.md quotes it; Stop's dialog's count if it's described; `:128`'s public look (N3).
7. **backlog.md:**
   - delete the lines round two closed (check fix2/*.md): the first unlock's e2e, BringAllBack's `retired` wiring, `priced`'s cap on D3's leg at width 4;
   - add, one line each:
     - *a v2 token pool launched later, on Koios paths,* is found as Lovejoin's page opens, at a pool's start or at Settings' press, never at a Review or a return; widening the look is for after 1.8.0 (the owner, 2026-11-06; r2-critic#1; it would add a holder read at most Koios-only returns and reviews holding a listed token);
     - *Put in 5 ₳ under the floor* is offered by the session list and refused at the press, which says why: kept, so the list stays quiet (the owner, 2026-11-06; r2-critic#5);
     - *the swap's Plan* says "directly" with no 5 ₳ pool known, while its return may find one: kept, as 1.6.0's DX-3 left the same step (the owner, 2026-11-06; r2-worker#4);
     - *D3 at width 4 ignores the collateral's tail:* at 4 free (depth 1) or 16 (depth 2) four goes and the 5 ₳ comes back unmixed where three would mix both; D3's rule stays as it is for now (the owner, 2026-11-06; r2-worker#0's trace);
     - *Home keeps "A mix stopped partway: open Lovejoin to see what to do."* for a 1.7 chain cut in a retired pool while its box comes back by itself (r2-critic#0's trace, an aside; old);
     - *a mix's review and Mix again* list the pools twice (their fresh split for P1's draws, and tailReserve's), since 1.7.2 (r2-worker#1's trace);
   - keep P2's `tailChain` sibling.

## Your report

Add a **Round two** section to [docs.md](docs.md): for each item, what changed (file:line at the merged head) and what you checked it against (file:line); anything in a fix2 report or a trace you found false; anything left, and why. Return the same as your structured output.
