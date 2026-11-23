// What the worker's messaging tests share (tests/messaging*.test.ts): wallets
// over in-memory storage writing to each other through an in-memory relay
// (fake-relay.ts), with the records alone between their calls, as a restarted
// worker has them. Each wallet keeps a trace of what its service did, in
// order: the relay's requests, the chain's reads, WebAssembly's scan, open
// and receive, and every read and write of a sealed record. The tests of
// what the wallet sends, and when, are assertions on that order.
import { type ConversationFile, MessagingService } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { PreferencesService } from "../src/background/preferences";
import { conversationRecord, PrivateStore, type RecordName } from "../src/background/private-store";
import type { RegisterHex } from "../src/background/chain";
import type { NetworkName } from "../src/networks";
import { fakeRelay, type FakeRelay } from "./fake-relay";
import { loadTestWasm, memoryArea, testWallet, vectors, type MemoryArea } from "./fakes";

export const PASSWORD = "correct horse battery";
export const phrase = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!.phrase as string;

/** A Seedelf's asset name: the prefix, then a tag. */
export const BOB_SEEDELF = "5eed0e1f00" + "626f62";
export const ALICE_SEEDELF = "5eed0e1f00" + "616c696365";
export const CAROL_SEEDELF = "5eed0e1f00" + "6361726f6c";

/** Where Send's pay-by-name would look a Seedelf's register up: the chain, for every wallet. */
export type Directory = Map<string, RegisterHex>;

export type Wasm = ReturnType<typeof loadTestWasm>;

export interface Party {
  messaging: MessagingService;
  wallet: ReturnType<typeof testWallet>["wallet"];
  local: MemoryArea;
  session: MemoryArea;
  /** The sealed records, read and written by the test itself: nothing of it is traced. */
  store: PrivateStore;
  preferences: PreferencesService;
  /** What `ownSeedelfs` answers: the Seedelfs the wallet's contract view holds now. */
  own: Array<{ name: string; register: RegisterHex }>;
  /** Whether the wallet keeps a view of the contract: without one, only a read (`ownSeedelfs(n, true)`) finds them. */
  keptView: boolean;
  /** The kept view's Seedelfs, when it's older than the chain (`own`): a read finds the rest. */
  kept?: Array<{ name: string; register: RegisterHex }>;
  /** What a read of the contract does instead of answering: throw. */
  readFails?: unknown;
  /** What any look at the wallet's Seedelfs does instead of answering, kept view or read: throw. */
  ownFails?: unknown;
  /** What a read of the contract for reveals does instead of answering: throw. */
  revealFails?: unknown;
  /** Runs as a read of the contract for reveals begins, before it answers. */
  onRevealRead?: () => Promise<void>;
  /** How many times the contract was read for reveals. */
  revealReads: number;
  /** How many times the contract was read for the wallet's own Seedelfs (`ownSeedelfs(n, true)`). */
  freshReads: number;
  /** Runs at each turn of the event loop the service takes (between scan batches, between a stamp's slices). */
  onWait?: () => Promise<void>;
  /** Runs before the service writes a sealed record; throwing is a worker stopped before that write. */
  beforeWrite?: (name: RecordName, value: unknown) => Promise<void> | void;
  /** The messaging alarm, as sw.ts gives it. */
  alarm: { on: boolean; start(): Promise<void>; stop(): Promise<void> };
  /**
   * How far this wallet's device clock is off (ms, signed): what its service reads as the time is `clock.now` and this.
   * Its monotonic clock, and the relay's, keep `clock.now` (the 1.10.0 gate's W14).
   */
  skew: number;
  changed: NetworkName[];
  /**
   * What the service did, in order: `GET <path>` and `POST <path>` (the relay), `chain own` and `chain reveal` (reads
   * of the contract), `scan`, `open` and `receive` (WebAssembly), `get <record>`, `set <record>` and `remove <record>`
   * (sealed records).
   */
  trace: string[];
  /**
   * Every throw a take passed over without a word (W9; the 1.10.0 gate's f2): a test that meets one it didn't mean to
   * fails (an error thrown out of the run), unless it sets `passOverOk`.
   */
  passedOver: unknown[];
  /** The test means its takes to pass a throw over (a module that throws on one envelope, say). */
  passOverOk: boolean;
  /** A new service over the same storage: a restarted worker's, on `wasm` if given, with `options` changed if given. */
  restart(wasm?: Wasm, options?: ServiceOptions): MessagingService;
}

export const clock = { now: 1_800_000_000_000 };

/** The sealed store as the service uses it: every read and write traced, a write stoppable. */
class TracedStore extends PrivateStore {
  constructor(
    deps: ConstructorParameters<typeof PrivateStore>[0],
    private readonly party: Pick<Party, "trace" | "beforeWrite">,
  ) {
    super(deps);
  }

  override async get<T>(name: RecordName): Promise<T | undefined> {
    this.party.trace.push(`get ${name}`);
    return super.get<T>(name);
  }

  override async set(name: RecordName, value: unknown): Promise<void> {
    await this.party.beforeWrite?.(name, value);
    this.party.trace.push(`set ${name}`);
    return super.set(name, value);
  }

  override async remove(name: RecordName): Promise<void> {
    this.party.trace.push(`remove ${name}`);
    return super.remove(name);
  }
}

/** Every option a test's service takes beside the party's own. */
export interface ServiceOptions {
  budgetBytes?: number;
  /** What one conversation's record may take of the budget once it's tight, for tests. */
  shareBytes?: number;
  /** chrome.storage.local's quota, for tests: 10,485,760 bytes otherwise (W11). */
  quotaBytes?: number;
  /** What Messages leaves free of the quota, for tests: 2 MiB otherwise (W11). */
  reserveBytes?: number;
  /** The take record's bound, as its JSON, for tests: 512 KiB otherwise (the 1.10.0 gate's finding 8). */
  takeBytes?: number;
}

function service(p: Omit<Party, "messaging" | "restart">, relay: FakeRelay, directory: Directory, options: ServiceOptions, given?: Wasm): MessagingService {
  const wasm = given ?? loadTestWasm();
  const traced: Wasm = {
    ...wasm,
    messagingScan: (key, envelopes) => {
      p.trace.push("scan");
      return wasm.messagingScan(key, envelopes);
    },
    messagingOpen: (key, envelope) => {
      p.trace.push("open");
      return wasm.messagingOpen(key, envelope);
    },
    messagingReceive: (key, request) => {
      p.trace.push("receive");
      return wasm.messagingReceive(key, request);
    },
  };
  return new MessagingService({
    wasm: traced,
    wallet: p.wallet,
    store: new TracedStore({ wallet: p.wallet, local: p.local }, p),
    local: p.local,
    session: p.session,
    preferences: p.preferences,
    relay: (n) => relay.client(n, (call) => void p.trace.push(call)),
    ownSeedelfs: async (_n, read) => {
      if (p.ownFails) throw p.ownFails;
      if (read) {
        p.freshReads++;
        p.trace.push("chain own");
        if (p.readFails) throw p.readFails;
      }
      return read ? p.own : p.keptView ? (p.kept ?? p.own) : undefined;
    },
    alarm: p.alarm,
    seedelfRegister: async (_n, name) => {
      const register = directory.get(name);
      if (!register) throw new Error("no such Seedelf");
      return register;
    },
    revealedRegisters: async () => {
      p.revealReads++;
      p.trace.push("chain reveal");
      await p.onRevealRead?.();
      if (p.revealFails) throw p.revealFails;
      // The chain as it is now: what the read finds.
      const now = new Map(directory);
      return (name) => now.get(name);
    },
    // The device's clock, which may be off; the monotonic one never is, and moves with the test's clock.
    now: () => clock.now + p.skew,
    monotonic: () => clock.now,
    // chrome.storage.local.getBytesInUse(null), as Chrome counts it: each key and its JSON value.
    bytesInUse: async () => usedBytes(p),
    // A turn of the event loop, timers included, as the worker's own: a search that ran away (a price no test meant
    // to be solved) then fails at its test's timeout instead of holding the whole run in microtasks.
    wait: async () => {
      await new Promise((r) => setImmediate(r));
      await p.onWait?.();
    },
    changed: (n) => void p.changed.push(n),
    // A throw a take passes over without a word fails the test that meets it, unless it means to (f2): out of the run,
    // so the service does what it does.
    passedOver: (e) => {
      p.passedOver.push(e);
      if (p.passOverOk) return;
      queueMicrotask(() => {
        throw new Error(`a take passed over a throw without a word: ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`);
      });
    },
    // Cheap first-contact stamps for tests; the worker never sets it.
    firstContactBits: 6,
    ...options,
  });
}

/** Another register of `p`'s key: what a Seedelf's datum holds once it's locked again. */
export async function another(p: Pick<Party, "wallet">): Promise<RegisterHex> {
  const wasm = loadTestWasm();
  return p.wallet.withKeys((keys) => {
    const b = keys.seedelf.baseRegister();
    const r = wasm.rerandomize(b);
    b.free();
    try {
      return { generator: r.generator, publicValue: r.publicValue };
    } finally {
      r.free();
    }
  });
}

/** A wallet of the `words`-word test phrase, holding `seedelf` if given, Messages off. */
export async function party(
  words: number,
  relay: FakeRelay,
  directory: Directory,
  seedelf?: string,
  options: ServiceOptions | number = {},
): Promise<Party> {
  // A number is the history's budget, as the first tests gave it.
  const given: ServiceOptions = typeof options === "number" ? { budgetBytes: options } : options;
  const t = testWallet({ local: memoryArea(), session: memoryArea(), clock });
  await t.wallet.create(phrase(words), PASSWORD);
  const base: Omit<Party, "messaging" | "restart"> = {
    wallet: t.wallet,
    local: t.local,
    session: t.session,
    store: new PrivateStore({ wallet: t.wallet, local: t.local }),
    preferences: new PreferencesService(t.local),
    own: [],
    keptView: true,
    revealReads: 0,
    freshReads: 0,
    skew: 0,
    changed: [],
    trace: [],
    passedOver: [],
    passOverOk: false,
    alarm: {
      on: false,
      async start() {
        this.on = true;
      },
      async stop() {
        this.on = false;
      },
    },
  };
  if (seedelf) {
    const register = await another(base);
    base.own.push({ name: seedelf, register });
    directory.set(seedelf, register);
    // Minted in this browser, under that register: it takes first messages by itself (the 1.10.0 gate's W8).
    await rememberRegister(base.store, "preprod", seedelf, register);
  }
  // One object: what a test changes on the party (its Seedelfs, its kept view) is what its service reads.
  const p = base as Party;
  p.messaging = service(p, relay, directory, given);
  p.restart = (wasm, options) => (p.messaging = service(p, relay, directory, options ? Object.assign(given, options) : given, wasm));
  return p;
}

/** Two wallets, Messages on for preprod, each holding a Seedelf. */
export async function pair(options: ServiceOptions | number = {}) {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const alice = await party(12, relay, directory, ALICE_SEEDELF, options);
  const bob = await party(24, relay, directory, BOB_SEEDELF, options);
  await turnOn(alice, bob);
  relay.calls.length = 0;
  return { relay, directory, alice, bob };
}

/** Turns preprod's Messages on for each wallet and waits for the first read. */
export async function turnOn(...parties: Party[]) {
  for (const p of parties) {
    await p.messaging.switch("preprod", true);
    await p.messaging.whenIdle();
    p.trace.length = 0;
    p.changed.length = 0;
  }
}

/** Syncs `p` and waits for everything it started. */
export async function synced(p: Party, network: NetworkName = "preprod") {
  await p.messaging.sync(network);
  await p.messaging.whenIdle();
}

/** `writer` writes first to `reader`'s Seedelf `name`; the reader accepts and replies. Returns the conversation's ID. */
export async function talking(writer: Party, reader: Party, name = BOB_SEEDELF): Promise<string> {
  const cid = await writer.messaging.start("preprod", name, "hello Bob");
  await writer.messaging.whenIdle();
  await synced(reader);
  await reader.messaging.accept("preprod", cid);
  await reader.messaging.send("preprod", cid, "hi Alice");
  await reader.messaging.whenIdle();
  await synced(writer);
  return cid;
}

/** Moves the clock on by `ms` with each wallet's user busy all along, so none locks itself. */
export async function busyFor(ms: number, ...parties: Party[]) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    clock.now += Math.min(left, 10 * 60_000);
    for (const p of parties) await p.wallet.touch();
  }
}

export const texts = async (p: Party, cid: string) => (await p.messaging.thread("preprod", cid)).messages.map((m) => `${m.dir}:${m.text}`);

/** Lets everything already queued run: a few turns of the event loop, timers included. */
export async function turns(n = 5) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Every sealed record of `p`, opened: what a sync may and may not have changed. */
export async function records(p: Party): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of (await p.local.keys("seedelf.private.")).sort()) {
    const name = key.slice("seedelf.private.".length) as RecordName;
    if (name.startsWith("messaging.") || name.startsWith("conversation.")) out[name] = await p.store.get(name);
  }
  return out;
}

/**
 * Where `p`'s next read of `network`'s pool goes on from, as stored: the take record's cursor (the 1.10.0 gate's
 * finding 8), or, where there's no take record yet, the one an inbox from before it kept.
 */
export async function cursorOf(p: Pick<Party, "store">, network: NetworkName = "preprod"): Promise<string | undefined> {
  const takes = await p.store.get<{ cursor?: string }>(`messagingTake.${network}`);
  if (takes) return takes.cursor;
  return (await p.store.get<{ cursor?: string }>(`messaging.${network}`))?.cursor;
}

/** What `p`'s take record holds, as stored: the reads' envelopes waiting for the take, and the counts (finding 8). */
export async function takesOf(p: Pick<Party, "store">, network: NetworkName = "preprod") {
  return p.store.get<{ cursor?: string; gapAt?: number; batches: Array<{ envelopes: string[] }>; unopened?: number; noRoom?: number }>(
    `messagingTake.${network}`,
  );
}

/**
 * A conversation's record's name, as `p`'s inbox lists it: by the record's own ID (the 1.10.0 gate's W7), or by the
 * conversation's ID where an inbox names none.
 */
export async function recordName(p: Party, cid: string, network: NetworkName = "preprod"): Promise<RecordName> {
  const inbox = await p.store.get<{ conversations: Record<string, { id?: string }> }>(`messaging.${network}`);
  return conversationRecord(network, inbox?.conversations[cid]?.id ?? cid);
}

const isBase64Record = (record: { v?: number }) => record.v === 2;
const hexOfBase64 = (text: string) => Buffer.from(text, "base64").toString("hex");
const base64OfHex = (hex: string) => Buffer.from(hex, "hex").toString("base64");

/**
 * A conversation's record as the service works with it, the crate's bytes and each envelope in hex, however it's
 * stored (base64 since W7).
 */
export async function fileOf(p: Party, cid: string, network: NetworkName = "preprod"): Promise<ConversationFile | undefined> {
  const stored = await p.store.get<ConversationFile>(await recordName(p, cid, network));
  if (!stored || !isBase64Record(stored)) return stored;
  return {
    ...stored,
    state: hexOfBase64(stored.state),
    history: stored.history.map((e) => (e.envelope ? { ...e, envelope: hexOfBase64(e.envelope) } : e)),
  };
}

/** Writes a conversation's record of `p` from the service's form, stored as the record it replaces is. */
export async function setFileOf(p: Party, cid: string, file: ConversationFile, network: NetworkName = "preprod"): Promise<void> {
  const name = await recordName(p, cid, network);
  const stored = await p.store.get<ConversationFile>(name);
  await p.store.set(
    name,
    stored && isBase64Record(stored)
      ? { ...file, state: base64OfHex(file.state), history: file.history.map((e) => (e.envelope ? { ...e, envelope: base64OfHex(e.envelope) } : e)) }
      : file,
  );
}

/** What every Messages record of `p` takes of its storage now, as stored: each inbox and each conversation's record. */
export function storedTotal(p: Party): number {
  let total = 0;
  for (const [key, value] of p.local.data) {
    if (!/^seedelf\.private\.(messaging|conversation)\./.test(key)) continue;
    total += (JSON.parse(value as string) as { data: string }).data.length;
  }
  return total;
}

/**
 * chrome.storage.local as Chrome holds it to its quota: a write that would take the area past `quota()` bytes (each
 * key and its JSON value) is refused with Chrome's own words, and nothing of it is stored.
 */
export function withQuota(p: Party, quota: () => number): void {
  const set = p.local.set.bind(p.local);
  p.local.set = async (key, value) => {
    let used = key.length + JSON.stringify(value).length;
    for (const [k, v] of p.local.data) if (k !== key) used += k.length + (v as string).length;
    if (used > quota()) throw new Error("QUOTA_BYTES quota exceeded");
    await set(key, value);
  };
}

/** What `p`'s area holds now, each key and its JSON value: what chrome.storage.local.getBytesInUse(null) counts. */
export function usedBytes(p: Pick<Party, "local">): number {
  let used = 0;
  for (const [k, v] of p.local.data) used += k.length + (v as string).length;
  return used;
}

export { fakeRelay, loadTestWasm };
export type { FakeRelay };
