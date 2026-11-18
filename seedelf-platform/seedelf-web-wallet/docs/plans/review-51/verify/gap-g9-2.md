# gap-g9#2: verification

From lane gap-G9, graded low by its finder.

## Trace: confirmed, low

The finding holds, and a run shows it. All of Lovejoin's way-back gates read only the profile's own chrome.storage. With one phrase unlocked in two Chrome profiles, each profile finds the other's boxes, gives them due times of its own and brings them back on its own schedule. None of its gates sees the other profile's withdraws, sends or chains.

In the test, profile B finds profile A's three boxes and draws a due time for each. A withdraws one box, and B's next alarm run takes the next box 40 s later. privacy.md:442-443 promises the opposite: never within 5 minutes of the wallet's own send, and one box at a time, 5 to 60 minutes apart. Nothing guards this:
- The quiet rule's input is per profile: wallet.ts:349-357 reads `seedelf.sends` and spent.ts's SESSION_SPENT, both in chrome.storage.session.
- B makes no draw of its own at a box that leaves the pool: it just trims to its earliest due times (lovejoin.ts:6831).
- The holds (lines 6793, 6796, 6798) are B's own records.

The other parts of the scenario follow from the same per-profile inputs. I checked them in the code; they aren't run:
- (b) After a refusal, neverWent gives the due time back and forgetWithdraw drops the spent marks, so the next run takes another box at once.
- (c) mixingAgain and the reservations are B's alone.
- (d) backOrder's leaves come from B's chains only.
- (e) Each profile keeps its own due list, so a box comes back at the earlier of two schedules. Settings are per profile too, so a longer wait chosen in A can be cut short by B's default 1 to 6 hours.
- (f) madeSince (line 2226) reads B's chains only.

It isn't known. The docs do say that another browser brings back boxes "as any box does" (privacy.md:456, :463, :450; lovejoin.ts:33-37; independent review M14). Nowhere says that the timing rules hold within one profile only, or that two profiles unlocked together undo them. The backlog, the archived reviews and their Not fixed lists, SECURITY.md and the owner's rules have nothing on it. lanes/critic.md:119 flagged it as untraced.

Severity is low:
- Who: the user, in an uncommon but documented setup. privacy.md:349-350 offers the phrase in a second profile, and a site session's return goes through Lovejoin by default.
- What it costs: privacy only. Two of the phrase's boxes come back into Seedelf within a minute from one IP, or a withdraw follows the other profile's send, or the oldest leaf goes first, or a chosen longer wait is shortened. This adds to the documented weak spot that a box can be picked out a few hours after its mixes (privacy.md:400). No money is lost, misdirected or locked.
- The way out: keep only one profile unlocked at a time.

**Evidence:**

Trace on TREE at 140886c9. The lines match tag web-wallet/1.9.1 (6793 and 6901 are the same there).

1. Profile B finds A's boxes.
   - lovejoin.ts:6373-6379 status(): ours, then sortOut (5968), then found (6129-6153).
   - B has no chain records, so every owned box is unknown. moreThanDue (2042-2062) is true: 3 free boxes against 0 due times.
   - lookUp asks tx_info; a mix made them, so they're free.
   - scheduleFound (5467-5482) calls draw (5485-5490), each due time counted from B's now.
   - withdrawDueNow does the same at B's unlock and due reads (6814, 6827).

2. B's gates read only B's storage.
   - 6793 `if (await this.deps.mixingAgain?.(network)) return [];`: B's sessions book.
   - 6796 chainsMixing: B's `chains`.
   - 6798 settleWithdrawing: B's `withdrawing`.
   - 6831 `setDue(... .slice(0, inPool(back, p).length))`: keeps B's earliest due times when a box has gone.
   - 6849-6853 one box a run, and 6926-6934 the others' WITHDRAW_SPREAD_MS: B's due times.
   - 6901-6904 `const { sent, forgotten } = await this.deps.wallet.sends(); ... quiet(now, sent, forgotten)`. wallet.ts:349-357 reads lastSpentAt(SESSION_SPENT, spent.ts:29) and SESSION_SENDS (wallet.ts:80), both chrome.storage.session, so per Chrome profile.
   - 2108-2113 backOrder ranks by `leaves` from ownLeaves (2297), B's chains only.
   - 2226-2234 madeSince reads B's chains only.
   - 7698-7704: on a refusal, neverWent puts the due time back, and forgetWithdraw drops the spent marks, so the quiet rule doesn't count the refused try.

3. Run.
   - Command, from extension/: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g9-2.test.ts`
   - Two testBalances profiles: one phrase, separate storage, one clock. One chain: a landed withdraw is marked spent at both fakes. Real WebAssembly, v2's 5 ₳ pool.
   - Every check before the last passes:
     - B's Lovejoin page finds A's three boxes and draws its own due times [bDue, bDue, bDue].
     - A's alarm withdraws b1…#0.
     - B's alarm, 40 s later, withdraws another of the phrase's boxes, not b1.
   - The last check fails: "AssertionError: profile B's withdraw went 40 s after profile A's: expected 40000 to be greater than or equal to 300000".

4. Pass once fixed.
   - In a copy outside TREE (~/.cache/seedelf-review-51/verify-gap-g9_2, node_modules symlinked), I added a sketch fix to withdrawDueNow. When no chain is being sent and this profile has no `withdrawing`, a pool whose due times outnumber its free boxes sets `elsewhere`. After the update, `noteSend(session, now)` runs.
   - With the fix: "Test Files 1 passed (1)". I removed the copy afterwards.
   - TREE has no tracked-file changes.

**Known:** None.

Searched:
- backlog.md, for: another device, other device, two devices, second device, another browser, two browsers, two profiles, another profile, this browser, this device, per device, per profile, quiet, one a run, one at a time, back to back, burst, spread.
- Every archived plan and review under docs/archive/plans/, for the same words.
- privacy-review §3.1, §3.6, §5.4 and §5.10, and independent-review M10, M11, M14, L8 and L29.
- The chunk-51 plan, SECURITY.md, and the other review-51 lanes and verify files.

Closest, and none covers it:
- privacy.md:456 and :463, lovejoin.ts:33-37, architecture.md:703 and M14 say a box another browser finds comes back there "as any box does". So per-device schedules are by design, but the docs say nothing of how they combine when both profiles are unlocked.
- chunk-44:54 and privacy.md:450 (a second device updating) are about the retired pools' run only.
- chunk-34:595 ("Left, low, two devices only") is about a Bootstrap's entry.
- lanes/critic.md:119 raised the per-device timing rules as untraced.

**Fix notes:**

Needs the owner, as the finder says: either a timing default changes, or privacy.md's promise and its separate-profile advice do.

The minimum is the docs:
- privacy.md:440-446 (Timing) and architecture.md's Withdraws should say the rules hold within one browser profile.
- With the phrase unlocked in two profiles, each brings back the other's boxes on its own schedule: its own Settings' delay, oldest first, blind to the other's sends, withdraws and chains. The way out is to keep only one of them unlocked.
- privacy.md:349-350's advice should carry the same line.

The code fix treats the phrase's own on-chain activity that this profile didn't send as a send:
- The signal: a box of the wallet's gone from the pool with no withdraw of this profile's. Only the key withdraws, and someone else's mix leaves a box in its place.
- Better than the count: the spender and its block time, from the data layer's pool feed (spent.by), and contract rows spent by a transaction not in this profile's spent marks (the private index's since answer, which contract-scan.ts:300 reads and then drops).
- Push the next withdraw a fresh quiet or spread from then.
- My sketch is enough to flip the test: in withdrawDueNow's trim at 6831, with no chain being sent and no `withdrawing`, set a flag when a pool's due times outnumber its free boxes, then call `noteSend(session, now)`. A real fix needs a cleaner signal, because a due time with no box also follows this profile's own Bring one back now (the comment at 6815-6816).

The rest of the class, which the count alone can't fix:
- §3.6's choice, backOrder/ownLeaves (2108, 2297): the other profile's leaves are unknown here.
- The holds while the other profile sends a chain (6793-6796), which reservations don't share.
- Bring every box back's madeSince (2226) and tailBoxes.
- Each profile's own Settings delay (e).

This test goes with the code fix. Under the doc fix alone, remove it.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g9-2.test.ts`

Result: On TREE (fails, because of the bug):

 RUN  v5.0.3 /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension
 ❯ tests/r51-gap-g9-2.test.ts (1 test | 1 failed) 4517ms
   ❯ r51 gap-g9#2: the phrase unlocked in two Chrome profiles (1)
     × keeps a box's way back 5 minutes from the phrase's withdraw that the other profile sent a minute before 4515ms
 FAIL  tests/r51-gap-g9-2.test.ts > r51 gap-g9#2: the phrase unlocked in two Chrome profiles > keeps a box's way back 5 minutes from the phrase's withdraw that the other profile sent a minute before
AssertionError: profile B's withdraw went 40 s after profile A's: expected 40000 to be greater than or equal to 300000
 ❯ tests/r51-gap-g9-2.test.ts:134:84
 Test Files  1 failed (1)
      Tests  1 failed (1)
   Duration  6.99s

Every check before it passed: B's page found A's three boxes and drew its own due times; A withdrew b1…#0; B withdrew another of the phrase's boxes, not b1.

In a copy outside TREE with the sketch fix in withdrawDueNow (a box gone with no own withdraw counts as a send, through noteSend): Test Files 1 passed (1), Duration 6.77s. I removed the copy afterwards.

```
// Chunk 51, gap-g9#2 (the trace verifier's test). Lovejoin's way-back rules read only this browser profile's own
// storage: the quiet after the wallet's own send (wallet.ts `sends`: `seedelf.sends` and spent.ts's SESSION_SPENT, both
// chrome.storage.session), one box a run and the spread after it (lovejoin.ts withdrawDueNow, over this profile's
// sealed `lovejoin.<network>` due times), and the holds while a withdraw may be on its way (`withdrawing`) or a chain is
// sent (`chains`, sessions.ts's `mixingAgain`). privacy.md:349-350 offers the phrase in a second Chrome profile, and
// :456 says a box a mix made comes back there "as any box does": the second profile finds the first's boxes
// (moreThanDue, found, scheduleFound) and brings them back on its own schedule. privacy.md *Timing* promises the way
// back keeps "from lining up with anything else the wallet does" (:440), never goes "within 5 minutes of the wallet's
// own send" (:442), and goes "one at a time: the others each wait a fresh 5 to 60 minutes" (:443); lovejoin.ts:6797
// says "two a minute apart say they're one owner's".
//
// The behaviour those promises ask for, asserted here: once a box of the phrase's has left the pool by a withdraw this
// profile didn't send (the other profile's, 40 s before, landed), this profile's next withdraw keeps
// QUIET_AFTER_SEND_MS from it. Only the phrase's key can withdraw its box, and someone else's mix leaves the phrase a
// box in its place, so a box of the wallet's gone from the pool with no withdraw of this profile's is the phrase's own
// withdraw sent elsewhere. Fails today: profile B's alarm run 40 s after profile A's withdraw takes the next box.
//
// This is the finder's code fix. Under its doc fix alone (privacy.md saying the rules hold per profile), this test goes.
//
// Two profiles: two wallets of one phrase over storage of their own (testBalances), one chain between them (a
// withdraw that lands is spent at both fakes of Koios), and one clock. The real WebAssembly builds each withdraw in
// v2's 5 ₳ pool; giveme.my's witness is stood in for, as lovejoin-restore.test.ts's `witnessed` does.
import { afterEach, describe, expect, it, vi } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { LovejoinService, QUIET_AFTER_SEND_MS } from "../src/background/lovejoin";
import { AGREES, HOUR, PASSWORD, account } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, testBalances } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

/** Three withdraws' worth of real WebAssembly, and a few hours of runs. */
const SLOW = { timeout: 120_000 };
const PHRASE = account(12).phrase;
/** The phrase's three boxes in v2's 5 ₳ pool, made five hours ago by someone else's mixes. */
const BOXES = ["b1", "b2", "b3"].map((h) => h.repeat(32));
const ref = (tx: string) => `${tx}#0`;

afterEach(() => void vi.restoreAllMocks());

/** One Chrome profile with the phrase restored and unlocked: its own storage, its own fake Koios and giveme.my. */
async function profile() {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.addedToAccounts.push(...ADA_ROWS);
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const wasm = loadTestWasm();
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL],
    // Every draw at its range's middle: Settings' 1 to 6 hours gives 3.5, a spread 32.5 minutes.
    random: () => 0.5,
  });
  return { t, lovejoin };
}

/** Pool `ADA`'s due times, as profile `t`'s sealed schedule keeps them. */
const adaDue = async (t: Awaited<ReturnType<typeof profile>>["t"]) =>
  (await t.store.get<{ pools?: Record<string, { due: number[] }> }>("lovejoin.preprod"))?.pools?.[ADA]?.due ?? [];

describe("r51 gap-g9#2: the phrase unlocked in two Chrome profiles", SLOW, () => {
  it("keeps a box's way back 5 minutes from the phrase's withdraw that the other profile sent a minute before", async () => {
    const a = await profile();
    const b = await profile();
    // What's stamped by the device's clock: both profiles' clocks are kept as one.
    vi.spyOn(Date, "now").mockImplementation(() => a.t.clock.now);
    const both = async (ms: number) => {
      await busyFor(a.t, ms);
      await busyFor(b.t, ms);
      expect(b.t.clock.now).toBe(a.t.clock.now);
    };
    // One chain: the same three boxes of the phrase's in the pool, read by both profiles, a mix having made each.
    const rows = await Promise.all(BOXES.map(async (tx) => adaBox(tx, await ownDatum(a.t.wallet), a.t.clock.now)));
    for (const p of [a, b]) {
      p.t.koios.addedToAccounts.push(...rows);
      madeByAdaMix(p.t.koios, ...BOXES);
    }
    const start = a.t.clock.now;
    // Profile B opens its Lovejoin page ten minutes in, and draws a due time for each box it finds: 3.5 hours on.
    const found = start + 10 * 60_000;
    const bDue = found + 3.5 * HOUR;
    // Profile A's own due times for its boxes, as its chain drew them: its first comes 40 s before B's.
    const aDue = bDue - 40_000;
    await a.t.store.set("lovejoin.preprod", { due: [], pools: { [ADA]: { due: [aDue, aDue + 2 * HOUR, aDue + 4 * HOUR] } }, chains: [] });

    // Each profile's unlock: its run sends nothing (privacy review §3.1).
    expect(await a.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(await b.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    // Profile B's page finds the three boxes no record of its own accounts for, asks what made them (a mix), and gives
    // each a due time of B's own: B will bring A's boxes back by itself.
    await both(found - a.t.clock.now);
    await b.lovejoin.status("preprod");
    expect(await adaDue(b.t)).toEqual([bDue, bDue, bDue]);
    // The alarm's next runs: nothing is due yet on either.
    await both(60_000);
    expect(await a.lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(await b.lovejoin.withdrawDue("preprod")).toEqual([]);

    // Profile A's first box comes due: its alarm brings it back, every rule of A's met.
    await both(aDue - a.t.clock.now);
    expect(await a.lovejoin.withdrawDue("preprod")).toHaveLength(1);
    const aAt = a.t.clock.now;
    expect(txInputs(a.t.koios.submitted.at(-1)!)).toContain(ref(BOXES[0]!));
    // It lands: the box is gone from the pool, for both profiles' reads.
    for (const p of [a, b]) p.t.koios.spent.add(ref(BOXES[0]!));

    // Profile B's alarm, each minute from 40 s later, while both stay unlocked.
    await both(40_000);
    let bAt: number | undefined;
    for (let run = 0; run < 120 && bAt === undefined; run++) {
      if ((await b.lovejoin.withdrawDue("preprod")).length) bAt = b.t.clock.now;
      else await both(60_000);
    }
    if (bAt !== undefined) {
      // B's withdraw spends another of the phrase's boxes, never the one A's took.
      const spent = txInputs(b.t.koios.submitted.at(-1)!);
      expect(spent.some((o) => o === ref(BOXES[1]!) || o === ref(BOXES[2]!))).toBe(true);
      expect(spent).not.toContain(ref(BOXES[0]!));
    }
    // Two of the phrase's boxes come back into Seedelf from one IP address: never within the quiet after the wallet's
    // own send, nor in a burst, whichever profile sent the first.
    const apart = bAt === undefined ? Infinity : bAt - aAt;
    expect(apart, `profile B's withdraw went ${apart / 1000} s after profile A's`).toBeGreaterThanOrEqual(QUIET_AFTER_SEND_MS);
  });
});
```
