// Bring every box back now's part of the page, 1.6.0's release review (round 2, lane S1, sc-lj-2). A read sent while
// Stop's request went never brings the stopped run back to say Done (321-lj-screens#0). Settings words a pool's run
// that sent nothing as that pool's, never as every pool's (321-lj-screens#6). What the run waits for is said, and Stop
// is offered once a withdraw it waits for is late (321-lj-worker#1 and #4, the page's half). Where nothing private pays
// a stuck pool's box, the run's reason names the ways it has, never a public payer it doesn't offer (321-lj-screens#5):
// with the real WebAssembly, the classic pool's recorded preprod boxes, and PR #163's preprod token pool.
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { t as tr } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinHeld } from "../src/shared/rpc";
import { BringAllBackView, bringFollower } from "../src/ui/components/BringAllBack";
import { PreferencesContext } from "../src/ui/preferences";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

type Bringing = LovejoinHeld["bringing"];

/** What lovejoin-held answers: nothing of the wallet's anywhere but `pools`, and the run as `bringing` has it. */
const held = (bringing?: Bringing, pools?: LovejoinHeld["pools"]): LovejoinHeld => ({
  boxes: 0,
  lovelace: "0",
  next: null,
  notMixed: 0,
  stopped: 0,
  ...(pools ? { pools } : {}),
  ...(bringing ? { bringing } : {}),
});

/** A page following the runs (`pool`, a pool's page's), and what it showed: whether each end it said was a Stop too (L2). */
function page(pool?: string) {
  const shown = {
    bringing: [] as Bringing[],
    done: [] as Array<number | undefined>,
    pools: [] as Array<string | undefined>,
    stopped: [] as Array<boolean | undefined>,
    overs: 0,
  };
  const follower = bringFollower(pool, {
    bringing: (b) => shown.bringing.push(b),
    done: (count, of, stopped) => {
      shown.done.push(count);
      shown.pools.push(of);
      shown.stopped.push(stopped);
    },
    over: () => (shown.overs += 1),
  });
  return { follower, shown };
}

/** The part of the page as a person reads it: Settings' (`pool` false) or a pool's page's. */
const view = (props: Partial<Parameters<typeof BringAllBackView>[0]>) =>
  renderToStaticMarkup(
    createElement(
      PreferencesContext.Provider,
      { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
      createElement(BringAllBackView, { bringing: undefined, busy: false, onAsk: () => undefined, onStop: () => undefined, ...props }),
    ),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("Bring every box back now's Stop, a read answering after it (1.6.0's release review, 321-lj-screens#0)", () => {
  it("never says Done for the run the user stopped, though a read sent while Stop went answers with it still going", async () => {
    const { follower, shown } = page();
    // A read finds the run going: 3 sent, 5 left.
    follower.read()(held({ back: 3, left: 5 }));
    // Stop is pressed just as the 2 s read goes: that read, sent while Stop's request goes, reads the record before
    // Stop's write, and its answer comes after Stop's.
    let answer!: () => void;
    const pressed = follower.press(true, () => new Promise<void>((done) => (answer = done)));
    const during = follower.read();
    answer();
    await pressed;
    during(held({ back: 3, left: 5 }));
    // The reads after find no run: Stop deleted it.
    follower.read()(held());
    follower.read()(held());
    expect(shown.done.filter((d) => d !== undefined)).toEqual([]);
    expect(shown.overs).toBe(0);
    // Nothing shows it going again, Stop with it.
    expect(shown.bringing.at(-1)).toBeUndefined();
    expect(shown.bringing.slice(1).some((b) => b !== undefined)).toBe(false);
  });

  it("drops a read sent before the press, however late it answers, and keeps every read sent once it's answered", async () => {
    const { follower, shown } = page();
    const before = follower.read();
    let answer!: () => void;
    const pressed = follower.press(false, () => new Promise<void>((done) => (answer = done)));
    const during = follower.read();
    answer();
    await pressed;
    // As the ask left it: going, nothing sent yet.
    expect(shown.bringing.at(-1)).toEqual({ back: 0 });
    before(held());
    during(held());
    expect(shown.bringing.at(-1)).toEqual({ back: 0 });
    // Sent once it's answered: the worker's record as it is now.
    follower.read()(held({ back: 1, left: 2 }));
    expect(shown.bringing.at(-1)).toEqual({ back: 1, left: 2 });
    // And over, once a read sent after finds it gone: every box it found went.
    follower.read()(held());
    expect(shown.done.at(-1)).toBe(1);
    expect(shown.overs).toBe(1);
  });

  it("drops the reads sent while a press's request failed too, and shows nothing new for it", async () => {
    const { follower, shown } = page();
    follower.read()(held({ back: 2, left: 1 }));
    let refuse!: (e: Error) => void;
    const pressed = follower.press(true, () => new Promise<void>((_, no) => (refuse = no)));
    // Sent while Stop's request goes, which then fails: dropped, as every read sent before the request answered is.
    const during = follower.read();
    refuse(new Error("The wallet is locked."));
    await expect(pressed).rejects.toThrow("The wallet is locked.");
    during(held());
    expect(shown.overs).toBe(0);
    expect(shown.bringing.at(-1)).toEqual({ back: 2, left: 1 });
    // The next read speaks for now: the worker never stopped it, so a run gone is one that ended.
    follower.read()(held());
    expect(shown.done.at(-1)).toBe(2);
    expect(shown.overs).toBe(1);
  });
});

describe("Settings watching one pool's run end with nothing sent (1.6.0's release review, 321-lj-screens#6)", () => {
  it("says nothing was left in that pool, never in Lovejoin, where other pools still hold the wallet's boxes", () => {
    // Settings follows every run, a pool's page's too.
    const { follower, shown } = page();
    follower.read()(held({ back: 0, pool: "classic" }));
    // Its one box was being withdrawn already: the run sends none and ends, while another pool still holds a box.
    follower.read()(held(undefined, [{ id: "a1", boxes: 1, lovelace: "2000000", next: null, notMixed: 0 }]));
    expect(shown.done.at(-1)).toBe(0);
    expect(shown.pools.at(-1)).toBe("classic");
    const said = view({ done: 0, donePool: true });
    expect(said).toContain("Nothing of yours was left in that pool.");
    expect(said).not.toContain("in Lovejoin");
    // Every pool's run, in Settings, and a pool's page, as they were.
    expect(view({ done: 0 })).toContain("Nothing of yours was left in Lovejoin.");
    expect(view({ done: 0, pool: true, donePool: true })).toContain("Nothing of yours was left in this pool.");
    expect(view({ done: 0, pool: true })).toContain("Nothing of yours was left in this pool.");
    // One that sent some says how many, whichever it was.
    expect(view({ done: 2, donePool: true })).toContain("Done: 2 boxes back in your private balance.");
  });

  it("hands every pool's run's end on with no pool, as it was asked", () => {
    const { follower, shown } = page();
    follower.read()(held({ back: 0 }));
    follower.read()(held());
    expect(shown.done.at(-1)).toBe(0);
    expect(shown.pools.at(-1)).toBeUndefined();
  });
});

// Round 3b, L2: the worker deleted the run's record for a Stop as for its end, so a page that saw the run go, but not
// the one Stop was pressed on, said Done: Settings in a tab, say, with the pool's page open in the side panel. The
// worker marks the Stop now, with how many it sent (LovejoinHeld `bringStopped`).
describe("Bring every box back now stopped, on this page or another (1.6.0's release review, L2)", () => {
  it("says Stopped, with how many the worker counted, where Stop was pressed on another page or tab, never Done", () => {
    for (const pool of [undefined, "classic"]) {
      const { follower, shown } = page(pool);
      follower.read()(held({ back: 3, left: 5, ...(pool ? { pool } : {}) }));
      follower.read()({ ...held(), bringStopped: { back: 3, ...(pool ? { pool } : {}) } });
      expect(shown.done, String(pool)).toEqual([3]);
      expect(shown.stopped, String(pool)).toEqual([true]);
      expect(shown.overs, String(pool)).toBe(1);
    }
  });

  it("says Stopped on the page that pressed it too, once a read sent after its request finds the worker's count", async () => {
    const { follower, shown } = page();
    follower.read()(held({ back: 3, left: 5 }));
    await follower.press(true, async () => undefined);
    // One more went before the Stop reached the worker: its count, not the page's last read.
    follower.read()({ ...held(), bringStopped: { back: 4 } });
    expect(shown.done.filter((d) => d !== undefined)).toEqual([4]);
    expect(shown.stopped.filter((s) => s !== undefined)).toEqual([true]);
    // Said once.
    follower.read()({ ...held(), bringStopped: { back: 4 } });
    expect(shown.done.filter((d) => d !== undefined)).toEqual([4]);
    expect(shown.overs).toBe(1);
  });

  it("still says Done for a run that ended with no Stop, and words a stopped one as stopped", () => {
    const { follower, shown } = page();
    follower.read()(held({ back: 2, left: 0 }));
    follower.read()(held());
    expect(shown.done).toEqual([2]);
    expect(shown.stopped).toEqual([undefined]);
    const stopped = view({ done: 3, doneStopped: true });
    expect(stopped).toContain("Stopped: 3 boxes sent back.");
    expect(stopped).not.toContain("Done");
    expect(view({ done: 1, doneStopped: true, pool: true })).toContain("Stopped: 1 box sent back.");
    expect(view({ done: 0, doneStopped: true })).toContain("Stopped: 0 boxes sent back.");
    expect(view({ done: 0, doneStopped: true })).not.toContain("Nothing of yours");
  });
});

describe("what Bring every box back now waits for, said on the page (1.6.0's release review, 321-lj-worker#1)", () => {
  const says = {
    again: "Waiting for Mix my boxes again to finish.",
    chain: "Waiting for a mix of yours that's being sent.",
    landing: "Waiting for a mix you just sent to reach its pool.",
    collateral: "What's left is a session's 5 ₳ collateral: it waits for its mix, a day at most.",
    withdraw: "Looking for a box that may already be on its way back.",
    payment: "Waiting for your last payment to go through or fail.",
  } as const;

  it("says each wait in one short line of its own, never an older run's reason, with Stop still there", () => {
    for (const [waiting, words] of Object.entries(says) as Array<[keyof typeof says, string]>) {
      for (const pool of [false, true]) {
        const shown = view({ pool, bringing: { back: 0, left: 2, waiting, why: "giveme.my didn't answer." } });
        expect(shown, waiting).toContain(words);
        expect(shown, waiting).not.toContain("The last box that didn't go");
        expect(shown, waiting).toContain("2 boxes left.");
        expect(shown, waiting).toContain("Stop");
      }
    }
  });

  it("after its sends, waiting on something else, says so, never that the chain confirms, and keeps Stop", () => {
    for (const waiting of ["landing", "chain", "again", "payment", "withdraw"] as const) {
      const shown = view({ bringing: { back: 3, left: 0, waiting } });
      expect(shown, waiting).toContain("Bringing every box back: 3 boxes sent back so far.");
      expect(shown, waiting).toContain(says[waiting]);
      expect(shown, waiting).not.toContain("Waiting for the chain to confirm");
      expect(shown, waiting).not.toContain("0 boxes left");
      expect(shown, waiting).toContain("Stop");
    }
  });
});

describe("Bring every box back now's wait for the chain, late (1.6.0's release review, 321-lj-worker#4)", () => {
  /**
   * What it says once late: true whether the run goes on (taken again once its spend lapses, two hours after it went)
   * or is stopped (read once two hours on, and given a wait of its own, Schedule `recheck`), staying unlocked in it.
   */
  const LATE =
    "One isn't on chain after 10 minutes. If a node dropped it, it's sent again within 2 hours while the wallet is unlocked, or after its own wait if you stop.";

  // Round 3b, the review's questions: the late line promised a resend within 2 hours that a Stop puts off by hours, and
  // three lines stacked above Stop (the owner: one short line beside a button).
  it("says what comes of the late withdraw whether it goes on or stops, in one line beside Stop that says to stay unlocked", () => {
    const markup = (pool: boolean) =>
      renderToStaticMarkup(
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
          createElement(BringAllBackView, { pool, bringing: { back: 8, left: 0, confirming: 1, late: true }, busy: false, onAsk: () => undefined, onStop: () => undefined }),
        ),
      );
    for (const pool of [false, true]) {
      const late = view({ pool, bringing: { back: 8, left: 0, confirming: 1, late: true } });
      expect(late).toContain(LATE);
      expect(late).not.toContain("Keep Seedelf Wallet unlocked");
      // The count's line, then one note, then Stop.
      expect(markup(pool).match(/class="note"/g), String(pool)).toHaveLength(1);
    }
    // Not late, the run still says to stay unlocked.
    expect(view({ bringing: { back: 8, left: 0, confirming: 8 } })).toContain("Keep Seedelf Wallet unlocked: if it locks, this pauses until you unlock.");
    expect(view({ bringing: { back: 3, left: 2 } })).toContain("Keep Seedelf Wallet unlocked: if it locks, this pauses until you unlock.");
  });

  it("offers Stop once a withdraw it sent is late, with one short line, and not before", () => {
    const late = view({ bringing: { back: 8, left: 0, confirming: 1, late: true } });
    expect(late).toContain("8 boxes sent. Waiting for the chain to confirm.");
    expect(late).toContain(LATE);
    expect(late).toContain("Stop");
    expect(view({ pool: true, bringing: { back: 8, left: 0, confirming: 1, late: true } })).toContain("Stop");
    // The chain's usual minute: nothing to stop, as the owner had it.
    const confirming = view({ bringing: { back: 8, left: 0, confirming: 8 } });
    expect(confirming).not.toContain("Stop");
    expect(confirming).not.toContain("If a node dropped it");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The worker's reason, as tests/lovejoin-bring-review-fixes.test.ts sets a stuck pool up (321-lj-worker#2).

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
/** Real withdraws are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 180_000 };
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

type T = ReturnType<typeof testBalances>;

/** A wallet just unlocked, its private balance holding only what a test gives it, reading both pools. */
async function stuckWallet(): Promise<{ t: T; lj: LovejoinService }> {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
  t.koios.tip = 110_000_000;
  // A byte dearer than preprod's: a 2 ₳ LJTEST box still meets its minimum, but can't pay its own way back.
  t.koios.params = { coins_per_utxo_size: "4800" };
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const wasm = loadTestWasm();
  const lj = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
  });
  return { t, lj };
}

async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** A box in the token pool (2 ₳ and its LJTEST), the wallet's or a stranger's, a mix having moved it 5 minutes ago. */
async function tokenBox(t: T, tx: string, ours = true): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - 5 * 60,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

describe("Bring every box back now where nothing private pays a stuck pool's box (1.6.0's release review, 321-lj-screens#5)", SLOW, () => {
  it("says to make some ADA private or bring it back from its pool's page, never to pay from a public account it doesn't offer", async () => {
    for (const holds of ["nothing", "a token"] as const) {
      const { t, lj } = await stuckWallet();
      // Its private balance: nothing at all, or one UTxO that holds a token beside its ADA, which pays no box's way back.
      if (holds === "a token") {
        t.koios.added.push({
          ...ownedUtxos[0]!,
          tx_hash: "a7".repeat(32),
          tx_index: 0,
          value: "50000000",
          inline_datum: { bytes: await datum(t, true), value: {} },
          asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: "5", decimals: 0, fingerprint: "asset1ljtest" }],
        } as KoiosUtxo);
      }
      const strangers = await Promise.all(Array.from({ length: 10 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));
      t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...strangers);
      await lj.status("preprod");
      await lj.bringAllBack("preprod");
      expect(await lj.withdrawDue("preprod"), holds).toEqual([]);
      const why = (await lj.held("preprod")).bringing?.why;
      expect(why, holds).toBe(tr("lj.bring.warn.privatePayNone"));
      expect(why, holds).toContain("from its pool's page");
      expect(why, holds).not.toContain("Pay from your public account");
    }
  });

  it("leaves Bring one back's words as they were: its question offered the public account", async () => {
    const { t, lj } = await stuckWallet();
    const strangers = await Promise.all(Array.from({ length: 10 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...strangers);
    const status = await lj.status("preprod");
    const pool = status.pools!.find((p) => p.cantComeBack)!;
    const box = pool.boxes[0]!;
    const anyway = pool.notMixed.some((b) => b.txHash === box.txHash && b.txIndex === box.txIndex);
    await expect(lj.withdrawNow("preprod", box, anyway, "private")).rejects.toThrow(tr("lj.privatePayNone"));
  });
});
