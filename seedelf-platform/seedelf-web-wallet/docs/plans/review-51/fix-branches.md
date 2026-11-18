# Chunk 51 · The two high fixes, each on its own branch from `main`

Each goes to `main` on its own PR once the owner says to push (SECURITY.md voids a report already fixed on `main`; a public PR also shows the bug before a store release ships the fix, so the timing is the owner's).

| Branch | Worktree | Commit | Fixes |
|---|---|---|---|
| `web-wallet/lovejoin-box-datum-spelling` | `../Seedelf-Wallet-fix-boxdatum` | `e2b31e6f` | r3a#1 (high): a Lovejoin box whose datum a stranger's mix wrote in constructor 0's general form, `102([0, [a, b]])`, is still the wallet's: listed, mixed and brought back |
| `cli/stranger-rows` | `../Seedelf-Wallet-fix-clirows` | `027fc81b`, and `204ef8fb` (the review's medium) | r4#1 (high) and r4#2 (medium): a stranger's UTxOs no longer stop the CLI's sweeps or its balances |

## Checks

- **The box datum's:** its two tests fail on `main` and pass on the branch (a box in the general form is read, with its pair and fields definite or indefinite; such a box mixes and comes back through the local evaluation of mix_box and mix_logic); the workspace's 792 tests (12 ignored), clippy and fmt; the WebAssembly rebuilt from it; Vitest 3,306 on both builds.
- **The CLI's:** 15 new tests through the CLI's offline harness, each failing without its fix and passing on the branch; the workspace's 806 (12 ignored); clippy and fmt.

## The independent review (2026-11-18)

One reviewer read both diffs and the code around them, and reverted each fix in a copy to see its tests fail.
- **The box datum's: sound.** Only `(102, Some(0))` is newly read; every builder hashes outputs and input references, never an input's datum bytes, so a re-spelled box mixes and comes back. A low: the data layer's `is_mix_datum` (`seedelf-data/api/src/lovejoin/datum.rs`) keeps the tag-121-only rule for its crowd count, which the owner decides with a deploy. A nit: Pallas 0.35 doesn't check a tag-102 pair's length, so `102([0, [a, b], 7])` reads as a box; the ledger can't hold those bytes.
- **The CLI's: one medium,** fixed in a follow-up commit: a failed build's retry dropped every token row short of its own output's minimum at once, so a stranger's pile could hold back the user's own NFT, with a reason that named it. Otherwise sound: every retry terminates, no command pays more or less than before, and no selection takes junk that `main` wouldn't.

## For the owner, from the CLI's fixer

1. **Dusting:** where the rest's ADA can carry a stranger's token pile, both sweeps still carry it, into outputs of the user's; the web wallet's `plan_return` leaves such a UTxO behind instead.
2. **The 20-UTxO window** of `transfer`, `sweep -l` and `util mint` is picked before any filter, so a stranger's UTxOs that selection then refuses take slots.
3. **Reference scripts in `sweep --all`:** it sweeps them, bounded by the ledger's 204,800 bytes; matching `transfer` would never spend them.
4. **`sweep --all`'s order** stays the README's "the first 20 the CLI finds".
