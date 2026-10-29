# v-pr336-0-impact: confirmed() keeps the server's reference datum and launch place

**Verdict: confirmed. Severity: low** (as filed), at the top of low.

- **The code defect is exactly as filed,** and I reproduced it on HEAD.
- **The finding understates the harm, in its own example.** Boxes deposited at a forged value above the real one aren't stuck: anyone's mix can take each box's excess. Only a forged value *below* the real one leaves boxes as filed (never mixed, back by hand).
- **It still rates low** because only a compromised data layer can do it, and that server can already redirect any Seedelf payment.
- **The fix is right.** Keep `launched()`'s own pools (Koios's row, seed and place) rather than comparing rows. I checked that in a copy.

## What HEAD does (`6bca8bec`)

- **Koios checks the launch, not the row.** `confirmed()` runs `launched()` on the server's reference row (`lovejoin-pools.ts:576`, `row: p.ref.reference`). It keeps the server's entries (`:582-583`, `found.filter(...)`), not `launched()`'s. `launches()` asks `tx_info` for `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates` (`koios.ts:942`): no outputs.
- **Nothing offline pins the datum's values.** The scripts are fixed by the seed alone: `mix_logic(P, "lovejoin")`, `mix_box(L)` (`templates.rs:124-126`).
  - `ReferenceDatum::decode` (`pool.rs:174-184`) takes any `box_lovelace > 0`, any `0 < max_fee < box_lovelace`, and any token and quantity.
  - `pool_of` builds the protocol from them: `denom: datum.box_value.lovelace` (`pool.rs:467`) and `token: datum.box_value.token` (`:474`).
- **Every later read and build uses the kept row.** `verifiedPool` (`lovejoin.ts:2730-2752`) reads `boxLovelace` and `token` from it.
- **A deposit runs no script.** It is key-signed. It adds the pool's reference UTxO only as a reference input (`mod.rs:693`, `:759`) and pays `protocol.box_value()` at `mix_box` (`:765`). The ledger checks that the reference exists, never what its datum says.

## Repro

`tests/zz-review-v-pr336-0-impact-1.test.ts`, run alone on HEAD, then deleted. The data layer lists the fixture pool (`lovejoin-token-pool-preprod.json`) with its datum or launch changed, and Koios answers the real launch (seed spent, L registered):

| What the data layer lists | What Koios is asked | What's kept |
|---|---|---|
| the real datum | `tx_info` | 2 ₳ |
| box ADA `1a001e8480` → `1a05f5e100` (100 ₳ for 2 ₳) | `tx_info` | `boxLovelace "100000000"`; `lovejoinVerifyPool` on the kept ref: `boxLovelace "100000000"`, `scriptsInline 0` |
| token quantity `1b002386f26fc10000` → `1b00470de4df820000` (2e16 for 1e16) | `tx_info` | quantity `"20000000000000000"` |
| launch at block 1, place 0 (`tx_info`: BLOCK, 3) | `tx_info` | `launch {block: 1, index: 0}` |

## The consequence is worse than filed

**Lovejoin never checks a mix input's value.** At 8131b1d:

- `mix_logic`'s `walk_outputs` checks `output.value == box_value` only for the N box outputs (`mix_logic.ak:276`).
- `collect_well_formed_mix_inputs` (`:319`) filters inputs by address and datum shape alone.
- `mix_box` only needs the withdrawal (`mix_box.ak:62`).
- Anyone can make a mix's Sigma-OR proofs: that is how others' boxes are drawn.
- Lovejoin's own `docs/generalize-lovejoin.md:120` says so: *"Mix inputs are not value-checked, by design. … A box deposited with more than the box value … can still be mixed by anyone, and the excess goes to whoever builds that Mix. … Under-funded boxes are never mixed …, and every box stays withdrawable by its owner."*
- Core says the same (`mod.rs:391-396`): *"a box holding more than the box value could be mixed by anyone, who'd take the excess."*

**So in the finding's 3 ₳-for-2 ₳ case**, anyone, the server's operator first, can mix the user's boxes and keep 1 ₳ of each. The forged value can be any u64, so the excess has no ceiling but the user's deposit. A forged token, or a larger quantity, loses the extra tokens the same way. The finding's "no mix can ever take those boxes … only by hand" holds only for a forged value below the real one.

**Afterwards the boxes drop out of view.** Once mixed down, the user's boxes sit at the true value. `PoolBox::from_row` (`mod.rs:397-401`) filters rows by the believed value, so the wallet no longer sees them. They stay hidden until Remove wallet deletes the pool record, because nothing corrects a kept row:

- `confirmed()` never asks about a known pool again;
- the holder look skips known outpoints;
- `kept()` lets the stored row override the head start's (`lovejoin-pools.ts:352`).

**The likely flow is Bootstrap:** 64 boxes in a token pool, 96 in an ADA pool. The forged value hides every real box, so the pool reads as empty, and Bootstrap is what an empty pool offers. A mix or a return also needs the floor (30 boxes that aren't the wallet's, at the believed value), so the server would have to forge box rows too.

**Every mainnet token pool comes through this path.** The mainnet head start is `height 14110720`, with 0 pools (`src/lovejoin-pools.json`).

## Is it reachable?

- **Only through a lying data layer.** A site, a user or a stranger can't do it.
- **An honest server or a rollback can't produce it.** The outpoint pins its transaction. The data layer reads the datum from db-sync's `datum` table, and the launch place from `t.block_index` (`seedelf-data/api/src/lovejoin/db.rs:62-78`), the same value as Koios's `tx_block_index`.
- **The same server can already steal more directly.** A Seedelf recipient's register comes from the index's `names()` rows (`contract-scan.ts:333-336`, `locatorOf` `:400-402`). A transfer never reads the recipient's UTxO on chain: its only reference input is the wallet's script. And `transfer.ts:9-10` says *"Koios is never asked about the recipient's token"*, on purpose. So this is one more theft vector of a kind a compromised server already has, not a new kind.
- **But #336 claims more than it does.** Its whole aim was a check "no single operator answers". Several texts claim parity with the holder look that doesn't hold for the datum or the launch place:
  - its PR text: "exactly as the Koios path's holder look does", "so devices can't disagree";
  - `confirmed()`'s comment, "as the holder's look would" (`lovejoin-pools.ts:558`);
  - `privacy.md:200`, "as its own look would".
- **One older comment overclaims too.** The file header (`:31-36`) still says the ledger is the judge of a listed pool, through the deposit's reference read. The ledger only checks that the reference exists.

## Severity: low

- **It matches 1.6.0's `docs-small#1`,** the server's word on L's registration, rated low and confirmed. This one has a harsher consequence but needs a strictly malicious server.
- **If the owner wants #336's property to be real,** this is the gap left, and the fix is cheap.

## The fix

**Take Koios's row, and keep `launched()`'s pools rather than comparing and dropping.** A comparison would trip on harmless differences: index rows carry `block_height 0`, `stake_address null` and an epoch computed on the device. I tested it in a copy outside the tree (`scratchpad/review/v-pr336-0-impact/`, since deleted):

```ts
const chain = new Map((await koios.utxoInfo(fresh.map((p) => refOf(p.ref.reference)))).map((r) => [refOf(r), r]));
({ standard } = await this.launched(network, koios, fresh.flatMap((p) => {
  const row = chain.get(refOf(p.ref.reference));
  return row ? [{ row, scripts: p.ref.scripts ?? [] }] : [];
})));
// … catch unchanged …
return [...found.filter((p) => known.has(refOf(p.ref.reference))), ...standard];
```

**What it does, in the copy:**
- The forged box ADA is kept as 2 ₳, and the forged quantity as 1e16.
- The misplaced launch is kept at Koios's BLOCK, place 3.
- Koios is asked `["utxo_info", "tx_info"]`.

**What it costs:**
- One `utxo_info` a batch of new pools, up to 60 refs a request (`REFS_PER_REQUEST`). It goes through `koiosAlone()`, so never to the data layer.
- Nothing changes with an honest server, and the holder path is untouched.

**Tests it touches, found in the copy:**
- 9 of `lovejoin-discovery.test.ts`'s tests fail until its `koiosOf` fake answers `utxo_info`, which is one line.
- After that, only the two call lists at `:290` and `:357` change, to `["utxo_info", "tx_info"]`.
- `lovejoin-merged-review.test.ts:502` ("answers grew when a look hands over a pool …") needs a `utxo_info` row in its fake. Without one it gets `{ grew: false }`.

**New tests to add:**
- a forged datum is kept at Koios's values;
- a misplaced launch is kept at Koios's place;
- a reference Koios doesn't know yet waits for the next list.

**Docs:** it's a new request, so name the pool's reference UTxO in:
- the unreleased 28 October 2026 entry and the pools paragraph of `docs/store/privacy-policy.md`;
- `privacy.md:200`.

It's the same request for every wallet, and only for pools new to the device. Correct `:558` and the header at `:31-36` too.

**Optional, in the same request: read the scripts' outpoints too.** `utxoOf(s, HOLDER, network)` (`lovejoin-pools.ts:446`) stamps the holder's address on whatever outpoint the server names. A lying server can point a script at a launch output that isn't at the holder, and every transaction into that pool then fails. That's denial of service only.

**An alternative with no new request:** add `outputs` to `launches()`'s `tx_info`. It needs `_assets` and `_scripts`, and a mapper from `tx_info`'s output shape to a row, and it grows the holder path's reads too. `utxoInfo` is simpler, and it's already used by `pending.ts`, `dapp.ts`, `sessions.ts` and `lovejoin.ts`.

**Within the owner's rules:**
- No new refusal of anything a user does: the fix only changes where a discovered pool's data comes from, which was #336's own decision.
- No UI text.
- Private by default is unchanged.
- The privacy notes gain one clause.
