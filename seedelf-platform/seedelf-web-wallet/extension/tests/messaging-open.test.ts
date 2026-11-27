// Where Messages is open (networks.ts `MESSAGING_NETWORKS`; the owner's call, 2026-11-24, 1.10.0's second review):
// preprod only for now. Over the worker's own settings, as sw.ts makes them, with no list of networks passed: on
// mainnet a switch can't be turned on, one a development build left on reads as off everywhere it's read, and nothing of
// mainnet's reaches the relay. Nor is anything written, sealed or solved there, whoever asks the worker: every press
// that would is refused in the worker's own words before its chain read, over what a development build left there too
// (the worker's finding 8). The other messaging tests run wallets with both networks open (messaging-harness.ts
// `BOTH_OPEN`), as a release that opens mainnet will have them; these are what ships.
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RegisterHex } from "../src/background/chain";
import { handle, type Context } from "../src/background/handlers";
import { rememberRegister } from "../src/background/minted-by";
import { NetworkChoice, PreferencesService } from "../src/background/preferences";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { MESSAGING_NETWORKS, messagingOpen, type NetworkName } from "../src/networks";
import { DEFAULT_PREFERENCES, LOCAL_PREFERENCES, messagingSwitches } from "../src/shared/preferences";
import type { MessagingOverview, Message } from "../src/shared/rpc";
import { loadTestWasm, memoryArea, testBalances, vectors } from "./fakes";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  BOTH_OPEN,
  CAROL_SEEDELF,
  clock,
  fakeRelay,
  listed,
  outboxOf,
  party,
  type Party,
  type Wasm,
} from "./messaging-harness";

const PASSWORD = "correct horse battery";
const phraseOf = (words: number) =>
  (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find((v) => v.account === 0 && v.phrase.split(" ").length === words)!
    .phrase;

/** The worker's context on `network`, in a build with both networks, as the store's is. */
function context(t: ReturnType<typeof testBalances>, network: NetworkName): Context {
  const { local: _local, clock: _clock, relay: _relay, ...services } = t;
  return {
    ...services,
    wasm: loadTestWasm(),
    connector: async (on: boolean) => on,
    version: "1.0.0",
    network,
    networks: ["mainnet", "preprod"],
    networkChoice: new NetworkChoice(t.local, ["mainnet", "preprod"]),
  } as unknown as Context;
}

const ask = (message: Record<string, unknown>, ctx: Context) => handle(message as unknown as Message, ctx);
const REFUSED = "Messages can't be turned on for Mainnet yet.";

describe("where Messages is open", () => {
  it("is preprod alone in this release", () => {
    // Opening mainnet is a change to this list, made on purpose, with protocol.md §20's freeze.
    expect(MESSAGING_NETWORKS).toEqual(["preprod"]);
    expect(messagingOpen("preprod")).toBe(true);
    expect(messagingOpen("mainnet")).toBe(false);
    expect(messagingSwitches({ preprod: true, mainnet: true })).toEqual({ preprod: true, mainnet: false });
    expect(messagingSwitches({ preprod: true, mainnet: true }, BOTH_OPEN)).toEqual({ preprod: true, mainnet: true });
  });

  it("is what the worker's settings hold to, with no list passed: sw.ts passes none", () => {
    const dir = new URL("../src/background/", import.meta.url);
    /** Each construction's arguments, read to its own closing bracket: how many there are at the top level. */
    const constructions = (file: string): string[] => {
      const source = readFileSync(new URL(file, dir), "utf8");
      const found: string[] = [];
      const open = "new PreferencesService(";
      for (let at = source.indexOf(open); at !== -1; at = source.indexOf(open, at + 1)) {
        let depth = 1;
        let args = 1;
        let end = at + open.length;
        for (; depth > 0 && end < source.length; end++) {
          const c = source[end]!;
          if ("([{".includes(c)) depth++;
          else if (")]}".includes(c)) depth--;
          else if (c === "," && depth === 1) args++;
        }
        const text = source.slice(at + open.length, end - 1);
        found.push(`${file}: ${text.trim() === "" ? 0 : args} argument(s): ${text}`);
      }
      return found;
    };
    const made = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .flatMap(constructions);
    // sw.ts makes three, one of them over `chromeArea(chrome.storage.local)`: a pattern that stopped at the first
    // closing bracket would never see an argument after it (1.10.0's second review, the merged diff's finding 4).
    expect(made.filter((call) => call.startsWith("sw.ts:")).length).toBeGreaterThanOrEqual(3);
    // One argument each, the storage area: the networks Messages is open on are the default's.
    expect(made.filter((call) => !call.includes(": 1 argument(s): "))).toEqual([]);
  });
});

describe("the settings, where Messages isn't open", () => {
  it("read a kept mainnet switch as off, and write one asked on as off", async () => {
    const local = memoryArea();
    // As a development build of the 1.10.0 gate left it: both on.
    await local.set(LOCAL_PREFERENCES, { ...DEFAULT_PREFERENCES, messaging: { preprod: true, mainnet: true } });
    const prefs = new PreferencesService(local);
    expect((await prefs.get()).messaging).toEqual({ preprod: true, mainnet: false });
    expect(prefs.messagingOpen("preprod")).toBe(true);
    expect(prefs.messagingOpen("mainnet")).toBe(false);

    // Asked on: written off, the other kept. The next write of any setting leaves it off in storage too.
    expect((await prefs.set({ messaging: { mainnet: true } as never })).messaging).toEqual({ preprod: true, mainnet: false });
    expect((await local.get<{ messaging: unknown }>(LOCAL_PREFERENCES))!.messaging).toEqual({ preprod: true, mainnet: false });
    await prefs.set({ messaging: { preprod: false } as never });
    expect((await prefs.get()).messaging).toEqual({ preprod: false, mainnet: false });

    // A release with mainnet open reads and writes it as the user's.
    const later = new PreferencesService(local, BOTH_OPEN);
    expect((await later.set({ messaging: { mainnet: true } as never })).messaging).toEqual({ preprod: false, mainnet: true });
    expect(later.messagingOpen("mainnet")).toBe(true);
    // And this release, over what that one kept, still reads it off.
    expect((await prefs.get()).messaging).toEqual({ preprod: false, mainnet: false });
  });
});

describe("the worker, on mainnet", () => {
  it("refuses to turn Messages on, in words, and asks the relay nothing", async () => {
    const t = testBalances();
    const ctx = context(t, "mainnet");
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, ctx);
    t.relay.calls.length = 0;

    await expect(ask({ type: "messaging-switch", on: true }, ctx)).rejects.toThrow(REFUSED);
    // From preprod's pages too, naming the other network.
    await expect(ask({ type: "messaging-switch", on: true, network: "mainnet" }, context(t, "preprod"))).rejects.toThrow(REFUSED);
    await t.messaging.whenIdle();
    expect((await t.preferences.get()).messaging).toEqual({ preprod: false, mainnet: false });
    expect(await t.messaging.isOn("mainnet")).toBe(false);

    // Every way a sync starts: the alarm's and the unlock's, a page's poll, a retry.
    await t.messaging.syncAll(["mainnet", "preprod"]);
    await ask({ type: "messaging-sync", page: "page-1", kind: "view" }, ctx);
    await ask({ type: "messaging-retry" }, ctx);
    await t.messaging.whenIdle();
    expect(t.relay.calls).toEqual([]);
    expect(await t.local.keys(PRIVATE_PREFIX + "messaging.")).toEqual([]);

    // The page reads it off, and may always ask it off.
    expect(((await ask({ type: "messaging" }, ctx)) as MessagingOverview).on).toBe(false);
    expect(((await ask({ type: "messaging-switch", on: false }, ctx)) as MessagingOverview).on).toBe(false);
    // Writing is refused in the worker's own words, before the Seedelf is looked up on the chain (these fakes' lookup
    // throws words of its own): nothing is read, sealed, solved or posted for mainnet.
    await expect(ask({ type: "messaging-start", to: "5eed0e1f00" + "626f62".padEnd(54, "0"), text: "hello" }, ctx)).rejects.toThrow(REFUSED);
    await t.messaging.whenIdle();
    expect(t.relay.calls).toEqual([]);
  });

  it("reads a switch a development build left on as off: no request for mainnet, and preprod's page doesn't say it's on", async () => {
    const t = testBalances();
    const mainnet = context(t, "mainnet");
    const preprod = context(t, "preprod");
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, mainnet);
    // Kept on for both, under this release's settings.
    await t.local.set(LOCAL_PREFERENCES, { ...DEFAULT_PREFERENCES, messaging: { preprod: true, mainnet: true } });
    t.relay.calls.length = 0;

    await t.messaging.syncAll(["mainnet", "preprod"]);
    await ask({ type: "messaging-sync" }, mainnet);
    await t.messaging.whenIdle();
    // Preprod's pool is read; mainnet's never.
    expect(t.relay.calls.length).toBeGreaterThan(0);
    expect(t.relay.calls.filter((call) => call.includes("/mainnet/"))).toEqual([]);
    expect(t.relay.calls.every((call) => call.includes("/preprod/"))).toBe(true);

    const here = (await ask({ type: "messaging" }, preprod)) as MessagingOverview;
    expect(here.on).toBe(true);
    expect(here.alsoOn).toBeUndefined();
    const there = (await ask({ type: "messaging" }, mainnet)) as MessagingOverview;
    expect(there.on).toBe(false);
    // From mainnet's page, preprod's is said to be on, and can be turned off from there (call 9).
    expect(there.alsoOn).toEqual(["preprod"]);
    await t.messaging.whenIdle();
  });
});

// What a development build left on mainnet, under the worker's own settings (1.10.0's second review, the worker's
// finding 8): conversations, a request, an envelope waiting in the outbox. The worker refuses there every press that
// would write, seal or solve (start, start again, continue, send, send again, Show my Seedelf, accept), in its own
// words, before anything: no chain read, no relay request, no stamp, no record touched. The page's own gate is
// messages-open-screen.test.ts's; this is the worker's, whoever asks. Reading, naming, deleting, starting Messages
// again and turning a switch off stay: what's there must still be readable and removable.

/** The chain's Seedelfs as the harness's wallets look them up (`seedelfRegister`), each lookup counted. */
class Chain extends Map<string, RegisterHex> {
  reads = 0;
  override get(name: string): RegisterHex | undefined {
    this.reads++;
    return super.get(name);
  }
}

/** Every stored record of `p` that names mainnet, as stored: sealed bytes and all. */
const mainnetRecords = (p: Party) => Object.fromEntries([...p.local.data].filter(([key]) => key.includes("mainnet")));

/**
 * Alice with what a development build (both networks open, as the harness's wallets are) left on mainnet: a
 * conversation she started and Bob answered, with a message of hers waiting in the outbox; one she started that Carol
 * never answered; and Carol's request. Then this release's worker over it: the settings as sw.ts makes them, a fresh
 * service, every export that seals, solves or uses the key to write counted.
 */
async function leftOnMainnet() {
  const relay = fakeRelay(clock);
  const chain = new Chain();
  const alice = await party(12, relay, chain, ALICE_SEEDELF);
  const bob = await party(24, relay, chain, BOB_SEEDELF);
  const carol = await party(15, relay, chain, CAROL_SEEDELF);
  await rememberRegister(alice.store, "mainnet", ALICE_SEEDELF, chain.get(ALICE_SEEDELF)!);
  await rememberRegister(bob.store, "mainnet", BOB_SEEDELF, chain.get(BOB_SEEDELF)!);
  // Carol's too: her turn-on posts its certificate there (chunk 55's 55e), so Alice can write to her first.
  await rememberRegister(carol.store, "mainnet", CAROL_SEEDELF, chain.get(CAROL_SEEDELF)!);
  for (const p of [alice, bob, carol]) {
    await p.messaging.switch("mainnet", true);
    await p.messaging.whenIdle();
  }
  const read = async (p: Party) => {
    await p.messaging.sync("mainnet");
    await p.messaging.whenIdle();
  };
  const answered = await alice.messaging.start("mainnet", BOB_SEEDELF, "hello Bob");
  await alice.messaging.whenIdle();
  await read(bob);
  await bob.messaging.accept("mainnet", answered);
  await bob.messaging.send("mainnet", answered, "hi Alice");
  await bob.messaging.whenIdle();
  await read(alice);
  const request = await carol.messaging.start("mainnet", ALICE_SEEDELF, "hello Alice");
  await carol.messaging.whenIdle();
  await read(alice);
  // The server unreachable for posts: what's sealed from here waits. Its list still answers, since a first message is
  // written only once the list is read to its end (the review's second round, finding 6).
  const reachable = relay.fetch;
  relay.fetch = async (url, init) => (init.method === "POST" ? Promise.reject(new TypeError("Failed to fetch")) : reachable(url, init));
  const unanswered = await alice.messaging.start("mainnet", CAROL_SEEDELF, "anyone there?");
  await alice.messaging.send("mainnet", answered, "waiting in the outbox");
  await alice.messaging.whenIdle();
  expect((await outboxOf(alice, "mainnet"))?.length).toBe(2);
  relay.fetch = reachable;

  // 1.10.0: the worker's own settings (no list passed), a fresh worker, the server reachable.
  alice.preferences = new PreferencesService(alice.local);
  const real = loadTestWasm();
  const used: string[] = [];
  const counted =
    <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
    (...args: A): R => {
      used.push(name);
      return call(...args);
    };
  const counting: Wasm = {
    ...real,
    messagingStart: counted("start", real.messagingStart),
    messagingStartContinuing: counted("startContinuing", real.messagingStartContinuing),
    messagingSetStamp: counted("setStamp", real.messagingSetStamp),
    messagingFindStamp: counted("findStamp", real.messagingFindStamp),
    messagingSend: counted("send", real.messagingSend),
    messagingReveal: counted("reveal", real.messagingReveal),
    messagingAccept: counted("accept", real.messagingAccept),
  };
  alice.restart(counting);
  relay.up = true;
  relay.calls.length = 0;
  alice.trace.length = 0;
  chain.reads = 0;
  alice.freshReads = 0;
  alice.revealReads = 0;
  /** No request to any server, nothing sealed or solved, since the release's worker started. */
  const quiet = () => {
    expect(relay.calls).toEqual([]);
    expect(alice.trace.filter((s) => /^(GET|POST|chain) /.test(s))).toEqual([]);
    expect({ register: chain.reads, own: alice.freshReads, reveal: alice.revealReads }).toEqual({ register: 0, own: 0, reveal: 0 });
    expect(used).toEqual([]);
  };
  return { relay, chain, alice, bob, answered, unanswered, request, used, quiet };
}

describe("the worker, on mainnet, over what a development build left there", { timeout: 30_000 }, () => {
  it("refuses every press that writes, seals or solves, in its own words, before any chain read", async () => {
    const { alice, answered, unanswered, request, quiet } = await leftOnMainnet();
    const before = mainnetRecords(alice);
    const presses: Array<[string, () => Promise<unknown>]> = [
      ["start", () => alice.messaging.start("mainnet", BOB_SEEDELF, "a new conversation")],
      ["restart", () => alice.messaging.restart("mainnet", unanswered, "again")],
      ["continueIn", () => alice.messaging.continueIn("mainnet", answered, "continued")],
      ["send", () => alice.messaging.send("mainnet", answered, "another")],
      ["resend", () => alice.messaging.resend("mainnet", answered, 0)],
      ["reveal", () => alice.messaging.reveal("mainnet", answered, ALICE_SEEDELF)],
      ["accept", () => alice.messaging.accept("mainnet", request)],
    ];
    for (const [what, press] of presses) await expect(press(), what).rejects.toThrow(REFUSED);
    await alice.messaging.whenIdle();
    // Nothing asked of any server, the chain's included; nothing sealed or solved.
    quiet();
    // And nothing written: every mainnet record is byte for byte what it was, and none was read for these.
    expect(mainnetRecords(alice)).toEqual(before);
    expect(alice.trace).toEqual([]);
  });

  it("asks nothing and solves nothing by itself: unlock, alarm, a page's poll, Try again", async () => {
    const { alice, quiet } = await leftOnMainnet();
    await alice.wallet.lock();
    await alice.wallet.unlock(PASSWORD);
    await alice.messaging.syncAll(["preprod", "mainnet"]);
    await alice.messaging.sync("mainnet", { page: "page-1", kind: "view" });
    await alice.messaging.sync("mainnet", { page: "page-1", kind: "grid" });
    await alice.messaging.retry("mainnet");
    await alice.messaging.whenIdle();
    quiet();
    // The envelope a development build left in the outbox, and the stamp it never set, wait as they were.
    expect((await outboxOf(alice, "mainnet"))?.length).toBe(2);
  });

  it("still reads, names and deletes what's there, starts Messages again and turns a switch off", async () => {
    const { alice, answered, unanswered, request, quiet } = await leftOnMainnet();
    const overview = await alice.messaging.overview("mainnet");
    expect(overview.on).toBe(false);
    expect(overview.conversations.map((c) => c.cid).sort()).toEqual([answered, unanswered].sort());
    expect(overview.requests.map((r) => r.cid)).toEqual([request]);
    expect((await alice.messaging.thread("mainnet", answered)).messages.map((m) => m.text)).toEqual(["hello Bob", "hi Alice", "waiting in the outbox"]);
    expect((await alice.messaging.request("mainnet", request)).map((m) => m.text)).toEqual(["hello Alice"]);
    await alice.messaging.rename("mainnet", answered, "Bob");
    expect((await alice.messaging.overview("mainnet")).conversations.find((c) => c.cid === answered)?.name).toBe("Bob");
    await alice.messaging.remove("mainnet", request);
    await alice.messaging.remove("mainnet", answered);
    const less = await alice.messaging.overview("mainnet");
    expect(less.conversations.map((c) => c.cid)).toEqual([unanswered]);
    expect(less.requests).toEqual([]);
    // The deleted conversation's waiting envelope went from the outbox record with it.
    expect((await outboxOf(alice, "mainnet"))?.map((w) => w.cid)).toEqual([unanswered]);
    await alice.messaging.switch("mainnet", false);
    await alice.messaging.clear("mainnet");
    const none = await alice.messaging.overview("mainnet");
    expect([none.conversations, none.requests]).toEqual([[], []]);
    expect(Object.keys(mainnetRecords(alice)).filter((key) => /messaging|conversation/.test(key))).toEqual([]);
    await alice.messaging.whenIdle();
    quiet();
  });

  it("changes nothing where Messages is open and its switch is off: a first message is refused, before any read", async () => {
    const { relay, chain, alice, bob, used } = await leftOnMainnet();
    // Bob's preprod certificate on the list, and Alice's copy of it, read while her preprod switch was on (chunk 55's
    // 55e): with it off, a first message isn't written on the list as last read (the review's second round, finding
    // 6: the writer reads the list to its end before it decides).
    await listed(relay, bob, BOB_SEEDELF, bob.own[0]!.register);
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await alice.messaging.switch("preprod", false);
    // Her own certificate withdrawn at the switch off (chunk 55's call 9): its post, then nothing more.
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    chain.reads = 0;
    used.length = 0;
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "waits for the switch")).rejects.toThrow(/Turn Messages on/);
    await alice.messaging.whenIdle();
    // Nothing looked up, solved, sealed or posted, and nothing kept.
    expect(chain.reads).toBe(0);
    expect(used).toEqual([]);
    expect(relay.calls).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    expect(await outboxOf(alice, "preprod")).toBeUndefined();
  });
});
