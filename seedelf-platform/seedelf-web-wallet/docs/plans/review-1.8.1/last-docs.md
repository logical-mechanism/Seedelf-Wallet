# 1.8.1's last look at its round-two fix-ups: docs

Reviewer `last-docs`. **Lens:** every doc hunk of the round-two fix-ups and of the lead's edits after them (`git diff a619169f` on the main tree), against the code as merged and against each other. Read-only in the main tree; no repro file was put there.

**In short:** no high, medium or low. Three nits:

- **last-docs#1:** the lead's "or later" edit for the retired pools' run is half done. Eight lines still say it's 1.8.0's first unlock: architecture.md:708, privacy.md:222's twin; :750, the cost line the lead edited; :426 and :674; flows.md :501, :523 and :529; and README.md:59.
- **last-docs#2:** the race lines (backlog.md:55–59) and the new 'Koios behind' line (:60) say what the code does, not what the user sees. guard#10's line (:23) says both.
- **last-docs#3:** privacy.md's new probe line says a refusal tells a site whether the device has read Lovejoin's pools since that pool started. For the head start's pools it tells nothing. On mainnet those are both of today's pools.

Everything else held. That includes every link and anchor (287, 0 broken), GitHub's state of the upstream PRs, and the verification docs against the proofs. See *Checked, and held*.

| id | severity | where | what |
|---|---|---|---|
| last-docs#1 | nit | `WW/docs/architecture.md:708` (and `:426`, `:674`, `:750`; `flows.md:501`, `:523`, `:529`; `WW/README.md:59`) | The retired pools' run is still "1.8.0's first unlock" in eight lines, where its heading and privacy.md's twins now say "1.8.0 or later" |
| last-docs#2 | nit | `WW/docs/backlog.md:55–59`, `:60` | The race lines and the 'Koios behind' line say what the code does, not what the user sees |
| last-docs#3 | nit | `WW/docs/privacy.md:172` | "The site learns whether this device has read Lovejoin's pools since that pool started" doesn't hold for the head start's pools, which every device knows |

## Findings

### last-docs#1 · nit · the retired pools' run is still 1.8.0's in eight lines

**Where:** `WW/docs/architecture.md:708`, `:426`, `:674`, `:750`; `WW/docs/flows.md:501`, `:523`, `:529`; `WW/README.md:59`.

**What's wrong.**

- **What was swept:**
  - the lead made the run's heading "The first run on 1.8.0 or later" (architecture.md:743, both phrases);
  - privacy.md's two lines now say "the first unlock on 1.8.0 or later" (`:222`, `:231`);
  - the docs lane did development.md:145 (r2-docs#8).
- **What wasn't:**
  - **architecture.md:708:** "but for the retired pools' run, which 1.8.0's first unlock asks (`retireOnce`, below)". It's the design-doc twin of privacy.md:222, which now says "or later". The docs lane's report listed it as left, beside :743.
  - **architecture.md:750:** "The first run on 1.8.0 costs a withdraw for each of the wallet's boxes in the retired pools". This is the cost line the lead edited for "Koios is behind", so one edited line still names the run by its old heading.
  - **architecture.md:426:** "the first run on 1.8.0 dropped 1.7's counts …" and "when the first run on 1.8.0 retired them".
  - **architecture.md:674:** "the first run on 1.8.0 lets each Bootstrap there go".
  - **flows.md:501, :523, :529:** "the first unlock on 1.8.0 brings …", "… lets a Bootstrap there go", "… runs it by itself".
  - **README.md:59:** "the first unlock on 1.8.0 brings every box of yours in them back, one right after another". This one is user-facing.
  - releases.md:40 is 1.8.0's own record, and right as it is.

**Evidence.**

- `retireOnce` (`EXT/src/background/lovejoin.ts:4292`) is gated by the schedule alone, with no version check:

  ```ts
  if ((await this.read(network)).retired !== undefined) return;
  ```

- So a 1.7.2 profile updated straight to 1.8.1 runs it at 1.8.1's first unlock. That's r2-docs#8's premise, which the lead's edits accept.

**The failure.** The same nit as r2-docs#8, now inside one doc and across docs. architecture.md says "1.8.0 or later" at :743 and "1.8.0's first unlock" at :708. privacy.md and the design doc's unlock rule now disagree. A tester reading flows.md or the README on 1.8.1 reads the run as 1.8.0's.

**Fix** (docs only, no test):

- Put "1.8.0 or later" in each line, as :743 has it. :708 would read "which the first unlock on 1.8.0 or later asks".
- The code's comments say the same, and that's the worker's to take or leave: lovejoin.ts:1043, :1061, :4286–4287, :6781 and :7258 ("the first run on 1.8.0", "1.8.0's first unlock").

### last-docs#2 · nit · the race lines and the 'Koios behind' line don't say what the user sees

**Where:** `WW/docs/backlog.md:55–59` (❓) and `:60` (⬜).

**The test**, from the brief: each line says what the user sees and what's the owner's.

- **guard#10's line (:23) does both.** It names the warn callout, the words in it and which of them is critical. It's ❓, with the two ways open.
- **The race (:55).** What's the owner's holds: "Only an order fixes it …, the owner's to pick". What the user sees is only "refused" and "nothing is lost". In fact the user sees:
  - **worker#2, readers#2, and readers#3's second half:** a public mix's chain or a session's chain in that pool stops after its deposit, its boxes not mixed yet (the line at :54).
    - The words are `lj.warn.rewardsMoved`'s: "The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost."
    - They show at Send, on the chain's stop, and on Bring one back now (withdrawOne builds again once, then says them).
    - In worker#2 the pool didn't change: the wallet's own collateral tail holds the balance.
    - In readers#2 this goes for every build in that pool, for up to two hours.
  - **readers#3's first half:** Bring everything back's failed list shows `lj.rewardsMovedReview`, "Lovejoin's pool changed since you reviewed this. Review it again.", beside every session but the first. That's guard#10's line.
  - **worker#3:** for two hours, Bring one back now says `lj.lastBoxMaybe`, "The last box may still be on its way back. Try again in a few minutes.", and no box comes back by itself meanwhile.
  - **"Nothing is lost" is about money:** a chain stopped after its deposit leaves its boxes unmixed, tied to that deposit, until Mix my boxes again.
- **The 'Koios behind' line (:60).** What's the owner's holds: ⬜ is a candidate (the legend, `:7`), and the lead's "Rework them together" is in it. It says what the code does ("stops its chain", "a build again avoids nothing"). The user sees:
  - **at the collateral's mix:** the session's chain stops there with "Lovejoin's pool changed while the wallet read it." (`lj.stalePool`). That mix is built once more with fresh boxes (`TAIL_TRIES`), and after that the 5 ₳ box waits unmixed;
  - **at a build:** where the build drew a box Ogmios doesn't know yet, it says after two tries `lj.poolDrifted`: "Lovejoin's pool changed while the wallet read it: a box it drew isn't there anymore. Try again in a minute." That's said even though the box is there and only Ogmios is behind.

**Evidence.**

- **Where each word comes from:**
  - `EXT/src/background/sessions.ts:5309` and `:5321`: a chain's stop, and the rethrow in `REWARDS_MOVED()`;
  - `lovejoin.ts:5424` and `:5446`: pumpPublicNow;
  - `lovejoin.ts:7708–7710`: withdrawOne, built again once, then `KoiosError(REWARDS_MOVED())`;
  - `lovejoin.ts:586`: `StalePool`, whose message is `lj.stalePool`. tailWitness throws it (`:4544`). witnessTail rethrows it, since it's neither a CollateralError nor a KoiosError (`sessions.ts:5419`), and the chain stops;
  - `lovejoin.ts:4607`: unstale's `lj.poolDrifted`.
- **The words:** `EXT/src/i18n/translations/en.json:900`, `:913`, `:914`, `:933`, `:950`.
- **The consequences:** readers.md's readers#2 ("A chain stops after its deposit, its boxes not mixed yet. A way back waits. It clears itself after two hours."), and worker.md's worker#2 and worker#3.

**The failure.** The owner picks the race's order from a line that names the mechanism. The cost the user sees is in the review reports only: chains stopped after their deposits, boxes left unmixed, two hours of refusals or of held way backs.

**Fix:** one clause each, in the backlog's one-line style.

- **:55:** "…so nothing is lost: the flow refused says `lj.warn.rewardsMoved`, a chain stopping after its deposit, its boxes not mixed yet (above), and Send's refusal is `lj.rewardsMovedReview`, in Bring everything back's list (:23)."
- **:60:** "…the user sees the chain stop at the mix (`lj.stalePool`) and the mix built once more, or `lj.poolDrifted`'s 'Try again in a minute'."

### last-docs#3 · nit · privacy.md:172 overstates what a site learns for the head start's pools

**Where:** `WW/docs/privacy.md:172`, the new line in *Connecting a site*.

**What's wrong.** The line says a transaction that pays into a pool's reward account "is refused unasked where the device knows that pool, and opens the window where it doesn't, so the site learns whether this device has read Lovejoin's pools since that pool started". But every device knows the head start's pools without reading anything: discovery's record always merges them in.

**Evidence.**

- **`kept()`** (`EXT/src/background/lovejoin-pools.ts:379–383`) merges the head start in every time. `head` is the bundled `lovejoin-pools.json` unless one is given:

  ```ts
  for (const p of [...head.pools, ...(stored?.pools ?? [])]) pools.set(refOf(p.ref.reference), p);
  ```

- **`everyKept`** (`:363`) maps that merged list.
- **Mainnet's head start in 1.8.1** (`EXT/src/lovejoin-pools.json`) is two pools: `dc6abe3b…` (retired) and `fcb3f5ec…` (v2's 5 ₳). So every 1.8.1 device refuses a site's payment into either one's `mix_logic` account unasked, whatever it has read.
- **`tests/dapp-lovejoin-rewards.test.ts`'s first case** expects the bundled head start's pools in the set on both networks.

**The failure.**

- The line reads as if any pool's refusal told the site about this device's reads. On mainnet today, none does: the probe tells something only about a pool launched after the build.
- The owner's call on the policy's *sites you connect* row (r2-docs#4's other half) rests on this line.

**Fix.**

- **The words:** "…so, for a pool newer than the list the wallet ships with, the site learns whether this device has read Lovejoin's pools since that pool started…".
- architecture.md:568's "which pools this device has found" is right as it is: the head start is what every device has, and what the device found is what varies.

## Checked, and held

**architecture.md:377** (the docs lane's edit beyond its list) against `koios.ts:1248–1256`:

- A withdrawal refused (`WITHDRAWAL_REFUSED`: the three names) whose answer has no `KeyHashObj` is a `RewardsChangedError` in `koios.rejected`'s words. Otherwise it's in stakingRefusal's words, of the same type.
- tests/koios.test.ts holds both, at protocol versions 10 and 11.
- **One edge the doc doesn't state.** The check reads the whole answer, so a script's refusal beside a second failure that names a key's address gets staking's words (the worker lane's note). The doc's "names a key's account" describes the single-failure case. Lovejoin rewords by type anyway, so it isn't worth a line.

**architecture.md:568** (the dApp refusal and its set):

- **The refusal:** `readTx` refuses at `dapp.ts:2099–2104`, before `ask` (`:2150–2174`), for a session and for the public account. Both inspect paths are `cip30::inspect_tx` (`wasm/src/lib.rs:6091`, `:6486`).
- **`paid_scripts`** names three things (`cip30.rs:1403`, `:1574`, `:1589`): a stake pool registration's reward account, a proposal's deposit return, and a treasury withdrawal's payee.
- **The set:** `mixLogicHashes` (`lovejoin.ts:4621–4628`) is readSet's quiet set plus `everyKept`. That's the classic pool, every kept pool and every copy, and it makes no request.
- **"No longer depends on where the boxes are"** holds, except where discovery's record can't be read. Then the set is readSet's, as the code's comment and the test "are the pools the wallet reads still" say.
- **The link** `privacy.md#known-links` resolves: *Connecting a site* is in *Known links*.

**architecture.md:635** (the pointer):

- `unknownInputs` is `2a8060d3`'s but for its doc comment (`git diff 2a8060d3`).
- tailWitness's `ours` fires only on a named input (`:4543`), and a real answer names none: 3110 plus a 3004's reason, per v-pv11-impact.md's table.
- `backlog.md#lovejoin` resolves.

**architecture.md:702:** "its balance counted as 0 while …" is `balanceAfter` (`lovejoin-rewards.ts:86`).

**The lead's edits:**

- **architecture.md:743:** the heading and its clause.
- **The cost line (:750):** a stale answer to the collateral's mix is a `StalePool`, which witnessTail rethrows, so the chain stops. A busy or unreachable giveme.my still waits, as the line says.
- **privacy.md:222 and :231.**

**privacy.md:172:**

- It's placed in *Connecting a site*, and its citation is right.
- "A hint that it uses Lovejoin" holds: the unlock reads a pool only where something is open in Lovejoin (`lovejoin.ts:6801`).
- The other pool reads are Lovejoin's and private returns', which go through Lovejoin by default.

**flows.md:432:** the third refusal before the window, as the code has it. The section is the public account's, and private CIP-30's *Use* lists no refusals.

**backlog.md:23** (guard#10):

- The rethrow is at `sessions.ts:5321`, and the warn callout at `ClaimAll.tsx:160–167`.
- `lj.warn.rewardsMoved` is critical (`critical-keys.json:157`).
- RUNTIME (`tests/i18n-worker-reasons.test.ts:70`) names no Lovejoin key.

**backlog.md:60** (the revert):

- **The claims** match v-pv11-impact.md (3117 is never sent on an evaluation; the input is named only in a 3004's reason), r2-worker#1, r2-worker#2 and r2-tests#1.
- **"Only preprod, or mainnet with Koios as a fallback":** the data layer only passes Ogmios's answer on (`seedelf-data/api/src/submit.rs`), and db-sync never runs ahead of its own node.
- **⬜ is right** by the legend.

**development.md:145:** "1.8.x" and "1.8.0 or later" (`retireOnce` has no version gate).

**The archived records:**

- chunk 43's :192 now reads as privacy.md:237 does.
- chunk 45's :14 dates no release.

**chunk 41's plan** (`:19`, `:21`, `:85`), on GitHub, read only:

- PlutusCoreBlaster #71 is MERGED, 2026-11-05T11:22:34Z, merge commit `6b4260a980af…`;
- #73 is OPEN;
- Lean-blaster #455 is OPEN and CONFLICTING;
- no PlutusCoreBlaster issue matches "ByteArray".

**seedelf-platform/CLAUDE.md:86:**

- `lovejoin_proven_bytes_test.rs` holds the three template files to `unapplied_hashes_in(Set::V2)`, and skips its fourth hash, fee_contract's (`templates.rs:213–219`).
- It holds reference_holder to `REFERENCE_HOLDER_HASH`.
- It derives `fcb3f5ec…`'s policy, `mix_logic` and `mix_box`.

**CLAIMS.md:23–24:**

- `lakefile.lean` pins Blaster `25c0ee0` (#454's fix) and PlutusCoreBlaster `68c5399`.
- `Slice/lakefile.lean` pins `96261cc`, which is `68c5399` plus `SliceByteString`.
- The README's *Running it* has the forks.
- "Three changes upstream doesn't have yet" matches the README and chunk 41's `:273`.
- *What a ✅ is worth* exists (README:97).

**The AnyTx README:**

- The complete results above are the ones named: mix_box, mix_logic, one_shot_mint and reference_holder.
- Every fee_contract module it names exists: `FeePurpose`, `PurposesKernel`'s `fee_*_errors`, `FeeMix`, `FeeSpend` and `FeeRecovery`, `Template/FeeContract.lean`, and `Audit/Template/Fee*.lean`.
- `Audit/Template/FeeIff.lean` is a scenario's iff, so "no such result" holds.
- The *Fee shard* row exists, and the CLAIMS.md link resolves.
- No section outside the two now superseded claims open work against CLAIMS.md.

**check.sh:**

- The usage is a comment, and nothing prints the header.
- `:27` gives the whole run 16G and 30m when any Every module is named.

**Links:** every relative link and anchor in the 11 changed Markdown files resolves (287, 0 broken). My checker caught a planted bad anchor and a missing file.

**The name style and dates:** I scanned the added lines. There's no lowercase "seedelf" in prose and no "Seedelf wallet". The only dates are the upstream PRs' and the owner's.

**No test reads a changed doc:** the extension's tests read `docs/i18n/` alone, and the Rust tests' mentions are comments.

## Notes for the lead

- **r2-screens#2 (guard#4's blind round) has no disposition** in R2FIXBRIEF.md: it's in no lane and no call.
  - Nothing under `docs/i18n/` has changed since `7a8c9eeb`.
  - `lj.warn.rewardsMoved` is still in both verified-critical lists (`:480`), and neither reviewer note names it or 1.8.1.
  - If that round is yours (r2-last's note), it's still owed.
- **chunk 43's record, `:45` ("staking's words still"):** r2-screens#1 makes a script account's refusal the network's words. Lovejoin rewords it by type, so no user sees either. It records what chunk 43 built, so I've left it (the worker lane's note 1).
- **Still the owner's, untouched:** r2-docs#1's dates, and the policy's *sites you connect* row (r2-docs#4's other half). last-docs#3 bears on the second.

## What I ran

- **The diffs:** `git diff a619169f` and `git diff` (the lead's unstaged edits) for every changed doc, word by word, with a script of mine; `git diff 2a8060d3` for `lovejoin.ts`.
- **A link and anchor checker** over the 11 changed Markdown files: 287 links, 0 broken. A planted bad anchor and a missing file were caught.
- **Scans of the added lines:** the name style, dates, and markup.
- **`gh`, read only:** PlutusCoreBlaster #71 and #73, Lean-blaster #455, and PlutusCoreBlaster's issues for "ByteArray".
- **Not run:** no build, no tests (the lead is running the suites), no repro in the tree, no lake, lean or check.sh, nothing in seedelf-data.
- **Scratch:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad/review/last-docs/` holds the diffs, the tools and the added lines.
