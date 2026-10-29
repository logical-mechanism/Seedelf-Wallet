# v-x-priv-5-trace: x-priv#5, privacy.md and flows.md trail #337's way out and #333's priced reserve

**Verdict: confirmed. Severity: low** (docs), as the finding says. Confidence: high.

I tried to refute it on HEAD (`6bca8bec`) and couldn't. All three parts hold. Two are narrower than the finding's words, and two duplicate earlier findings:

- **privacy.md:217 (#337) is the new part.** It's an omission, not a false statement.
- **privacy.md:198 is right at today's parameters.** It only gives a priced figure as if it were fixed.
- **flows.md:523's "68" is plainly false on HEAD.** That part duplicates pr333#2 (confirmed in `v-pr333-2-trace.md`) and x-docs#2, which also covers privacy.md:198.

## 1. privacy.md:217 has no word of *Bring the rest back now* (#337)

**What the doc says.** The ways the collateral's mix stops waiting are:
- one rebuild ("past that");
- an hour for a deposit not on chain;
- "a day after the deposit landed".

Nothing in privacy.md mentions the user's way out. I searched for "rest back now", "Bring the rest back", "without waiting", "until you mix" and `TAIL_OFFER`, and none of them appears. In this range, only #336 (`f40ed2fc`) touched privacy.md, and nothing touched the privacy policy. #337 updated flows.md:522 and architecture.md:633 only.

**What the code does.** The way out is real, offered an hour after the deposit landed:
- `lovejoin.ts:335`: `TAIL_OFFER_MS = 60 * 60_000`.
- `lovejoin.ts:4132`: `return { id: c.id, offerAt: c.tail.landed + TAIL_OFFER_MS };`. `Tail.landed` is "when its deposit was first known on chain" (`:1276`).

**The outcome is the same as at the day's end:**
- **The skip.** `sessions.ts:5526-5537` `skipCollateralMix` calls `tailOver` and pumps a chain that's still being sent. `witnessTail` then throws `lj.tail.skipped` (`:5144`) before giveme.my is asked. Then it calls `advance(…, true)`.
- **The return after it.** `tailOf` filters `!r.tail.over` (`lovejoin.ts:4011`), so `tailChain` returns `undefined`. `buildBack`'s Lovejoin branch needs `!started` (`sessions.ts:4421`), so the rest comes back directly.
- **The day's end takes the same path.** `witnessTail` throws `lj.tail.tooLong` (`:5148`), or `tailOf` marks the tail over once `tailBuildable` lapses (`lovejoin.ts:4013-4015`).

**The screen.** `CollateralHeldWayOut` (`LovejoinReturn.tsx:536-557`) shows the critical line `lj.tail.privacy.wayOut` and a button labelled "Bring the rest back now".

**Narrower than worded.** "Ends the wait only at the day's end" is loose, since privacy.md also lists the rebuild and the unlanded hour. The substance holds: the design doc doesn't record a control that lets the user give up privacy to save time. privacy.md records every other such control: the switches on :197, *Bring one back anyway* on :210, and *Bring every box back now* on :226.

**privacy.md:226's "a day at most" is still true as an upper bound.** After a skip, `tailBoxes` (`:1351`) no longer keeps the box back for its mix, so *Bring every box back now* takes it.

## 2. privacy.md:198, "1.5 ₳ for its way back" (#333)

- **The code.** The reserve is `bootstrap_back_reserve(params)` (`seedelf-core/src/lovejoin/mod.rs:1744-1751`), never less than 1.5 ₳.
  - The funding adds it at `sessions.ts:2096`.
  - The review row shows it at `Lovejoin.tsx:3797-3798` (`summary.bootstrapReserve`).
- **The figures.** 1.5 ₳ at the fixture's 4,310 lovelace a byte, and 1.8 ₳ at 6,465.
- **Why it rises.** Only the byte price changed in my run, so the 1.8 ₳ comes from the sweep's Seedelf output's least, not from the fees.
- **Today.** The doc's figure is right at today's parameters and wrong only at a dearer byte. This is the weakest part, close to a nit on its own.

## 3. flows.md:523 (#333)

- **The cap.** "(68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)" is false on HEAD: the cap is 96 there, on preprod and on mainnet.
- **The reserve.** "1.5 ₳ for returning the rest" and "*For returning the rest* (1.5 ₳, …)" hold today only. At 6,465 the row shows 1.8 ₳.
- **#333's edit.** It touched only "3 ₳ of reserves at today's prices" in this bullet.

## Repro

**The scratch test.** `extension/tests/zz-review-v-x-priv-5-trace-1.test.ts` used the real WebAssembly (`loadTestWasm`) and the `epochParams` fixture. I ran it alone and then deleted it. Its result: **4 failed, 1 passed**.

- **The control passed.** It checked that:
  - each quoted string is at privacy.md:198, privacy.md:217 and flows.md:523;
  - `TAIL_OFFER_MS` is one hour;
  - `t("lj.tail.wayOut")` is "Bring the rest back now";
  - `lj.tail.privacy.wayOut` is in `critical-keys.json`;
  - today's reserve is `1500000` and today's cap is 96.

  It logged: `HEAD at 6,465: {"reserve":"1800000","mostPreprod":96,"mostMainnet":96,"mostMainnetToday":96}`.
- **Four assertions that fail if the finding is real all failed:**
  - privacy.md contains "Bring the rest back now": it doesn't.
  - The reserve at 6,465 is `1500000`: received `1800000`.
  - The cap at 6,465 on preprod is 68: received 96.
  - The cap at 6,465 on mainnet is 68: received 96.

**The existing tests.** I also ran two tests already on HEAD: `npx vitest run tests/lovejoin-planner.test.ts -t "an hour after its deposit went in|once giveme.my kept it waiting a day"`. Both passed, 2 passed and 77 skipped. They end in the same state:
- the tail is over;
- the chain is stopped;
- giveme.my is asked once only;
- `backBuild`'s `collateralTail` is `undefined`, so the rest comes back directly.

## Fix advice

- **privacy.md:217.** After "…or a day after the deposit landed", add: "or sooner, by the user's choice: from an hour after the deposit landed, while the mix still waits (for giveme.my, or to be built again), the session's page (a swap's, a site's, or the mix's card on the Lovejoin page) offers *Bring the rest back now*, whose line says the 5 ₳ box stays unmixed, tied to the session (1.7.0)".
  - Don't say "while giveme.my keeps it waiting" alone. The offer also shows while the rebuild waits on the 5 ₳ pool (`tailBuildable`; see x-priv#4).
- **privacy.md:198.** "at least 1.5 ₳ for its way back, priced from the network's parameters (1.8 ₳ at 6,465 lovelace a byte)".
  - Say **parameters**, not the finding's "fees". At 6,465 the rise comes from the least an output must hold.
- **flows.md:523.**
  - Replace the parenthetical with "one deposit's most at a dearer byte too (96, or 64 in a token pool)".
  - Write the way back as "a reserve priced from the network's parameters, at least 1.5 ₳ (1.8 ₳ at 6,465)", in both places.
  - At 6,465, "64 in a token pool" holds only for a pool whose box meets the ledger's least, which LJTEST's 2 ₳ box doesn't (v-pr333-4-trace).
- **Merge with pr333#2 and x-docs#2.** One docs fix covers all three.
