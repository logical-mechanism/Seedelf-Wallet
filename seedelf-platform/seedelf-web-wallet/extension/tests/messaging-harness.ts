// What the worker's messaging tests share (tests/messaging*.test.ts): wallets
// over in-memory storage writing to each other through an in-memory relay
// (fake-relay.ts), with the records alone between their calls, as a restarted
// worker has them. Each wallet keeps a trace of what its service did, in
// order: the relay's requests, the chain's reads, WebAssembly's scan, open
// and receive, and every read and write of a sealed record. The tests of
// what the wallet sends, and when, are assertions on that order.
import { type ConversationFile, MessagingService, storedBytes } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { PreferencesService } from "../src/background/preferences";
import { conversationRecord, PRIVATE_PREFIX, PrivateStore, type RecordName } from "../src/background/private-store";
import { type Admit, SESSION_UNLOCKED_AT, type Wallet } from "../src/background/wallet";
import type { RegisterHex } from "../src/background/chain";
import type { NetworkName } from "../src/networks";
import { fakeRelay, type FakeRelay } from "./fake-relay";
import { loadTestWasm, memoryArea, testWallet, vectors, type MemoryArea } from "./fakes";

export const PASSWORD = "correct horse battery";

/**
 * The harness's wallets have Messages open on both networks, as a release that opens mainnet will: the tests of two
 * pools, of an envelope copied across them and of the one budget stay live. What ships now, preprod only (networks.ts
 * `MESSAGING_NETWORKS`), is messaging-open.test.ts's, over the worker's own settings.
 */
export const BOTH_OPEN: readonly NetworkName[] = ["preprod", "mainnet"];
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
   * Everything the service did, in order (the 1.10.0 gate's round 5): each sealed record read, written or removed, with
   * its stored length then (its sealed data, base64; a `get`'s is what was stored as it was read); each request
   * (`GET`, `POST`, with its path); each WebAssembly call the trace names; and each lane's and runner step's start and
   * end, and each pass of the gate (`observe`). `at`: the test's clock then (the service's monotonic one); `t`:
   * performance.now().
   */
  log: LogEntry[];
  /**
   * chrome.storage.local's own reads of the wallet's sealed records, as each is asked (1.10.0's second review, F5): the
   * log's `get` is a record's unseal in the wallet's queue, and a read of the area with no unseal after it (one whose
   * call was then turned away, a count's fallback) showed nowhere. Kept beside the log, never in it, so nothing an
   * earlier test compares changes: `index` is where the log stood as the read was asked.
   */
  area: AreaRead[];
  /**
   * Every throw a take passed over without a word (W9; the 1.10.0 gate's f2): a test that meets one it didn't mean to
   * fails (an error thrown out of the run), unless it sets `passOverOk`.
   */
  passedOver: unknown[];
  /** The test means its takes to pass a throw over (a module that throws on one envelope, say). */
  passOverOk: boolean;
  /**
   * Each branch the worker reached that its own count of the writer's share makes unreachable (relay-oracle fix item 2,
   * the service's `unreachable` hook): a test that reaches one it didn't mean to fails, unless it sets `unreachableOk`.
   */
  unreachable: string[];
  /** The test means to reach such a branch (a module that misreports the share, say). */
  unreachableOk: boolean;
  /** A new service over the same storage: a restarted worker's, on `wasm` if given, with `options` changed if given. */
  restart(wasm?: Wasm, options?: ServiceOptions): MessagingService;
}

export const clock = { now: 1_800_000_000_000 };

/** One thing a service did (`Party.log`). */
export interface LogEntry {
  what:
    | "get"
    | "set"
    | "remove"
    | "GET"
    | "POST"
    | "scan"
    | "open"
    | "receive"
    | "lane-start"
    | "lane-end"
    | "run-start"
    | "run-end"
    | "step-start"
    | "step-end"
    | "gate"
    | "yield"
    | "changed";
  /** A record's name, a request's path, a lane's network. */
  name?: string;
  /** A record's stored length; a POST's body length (its nonce and envelope). */
  bytes?: number;
  at: number;
  t: number;
}

/** One read of chrome.storage.local for a sealed record (`Party.area`). */
export interface AreaRead {
  /** The record's name. */
  name: string;
  /** What the area holds under its key then: its JSON's length, 0 for none. */
  bytes: number;
  /** Where the log stood as it was asked: entries from `index` on came after. */
  index: number;
  at: number;
  t: number;
}

/**
 * Notes each read of `area` for a sealed record as it's asked (F5), whatever follows it. Outside `overIpc`'s turn, where
 * that's on: a read is noted as the service asks, not as the area answers.
 */
function tracedArea(p: Pick<Party, "log" | "area">, area: MemoryArea): void {
  const get = area.get.bind(area) as (key: string) => Promise<unknown>;
  (area as unknown as { get: (key: string) => Promise<unknown> }).get = (key: string) => {
    if (key.startsWith(PRIVATE_PREFIX)) {
      const raw = area.data.get(key) as string | undefined;
      p.area.push({ name: key.slice(PRIVATE_PREFIX.length), bytes: raw?.length ?? 0, index: p.log.length, at: clock.now, t: performance.now() });
    }
    return get(key);
  };
}

const logged = (p: Pick<Party, "log">, what: LogEntry["what"], name?: string, bytes?: number) =>
  void p.log.push({ what, ...(name !== undefined ? { name } : {}), ...(bytes !== undefined ? { bytes } : {}), at: clock.now, t: performance.now() });

/** The sealed store as the service uses it: every read and write traced, a write stoppable. */
class TracedStore extends PrivateStore {
  /** What the next call into the wallet's queue notes as it runs there: set right before `super`'s, which queues at once. */
  private running?: () => void;

  constructor(
    deps: ConstructorParameters<typeof PrivateStore>[0],
    private readonly party: Pick<Party, "trace" | "beforeWrite" | "log" | "local">,
  ) {
    // The store's key as the wallet gives it, each task noting itself as its turn in the queue comes and it runs (round
    // 5's admit check): a call turned away, or one waiting its turn, isn't traced.
    const wallet = deps.wallet;
    const own = {
      withStoreKey: <T>(task: (key: Uint8Array) => T | Promise<T>, admit?: Admit) => {
        const note = this.running;
        this.running = undefined;
        return wallet.withStoreKey((key) => {
          note?.();
          return task(key);
        }, admit);
      },
    } as unknown as Wallet;
    super({ ...deps, wallet: own });
  }

  /** `call`, which goes into the wallet's queue at once, `note` told as it runs there. */
  private queued<T>(note: () => void, call: () => Promise<T>): Promise<T> {
    this.running = note;
    const run = call();
    if ((this.running as unknown) !== undefined) throw new Error("the harness's store: the call didn't go into the wallet's queue at once");
    return run;
  }

  // Every read is a `get` or the service's `sealed` then `open` (round 5): traced at the unseal, as it runs in the
  // wallet's queue, with its stored length.
  override async open<T>(name: RecordName, sealed: unknown, admit?: Admit): Promise<T | undefined> {
    return this.queued(
      () => {
        this.party.trace.push(`get ${name}`);
        logged(this.party, "get", name, (sealed as { data?: string } | undefined)?.data?.length ?? 0);
      },
      () => super.open<T>(name, sealed, admit),
    );
  }

  override async set(name: RecordName, value: unknown, admit?: Admit): Promise<void> {
    await this.party.beforeWrite?.(name, value);
    // Traced as its seal runs in the wallet's queue, with the size it's stored at: what a lane's window holds is what
    // began in it.
    return this.queued(
      () => {
        this.party.trace.push(`set ${name}`);
        logged(this.party, "set", name, storedBytes(new TextEncoder().encode(JSON.stringify(value)).length));
      },
      () => super.set(name, value, admit),
    );
  }

  override async remove(name: RecordName): Promise<void> {
    this.party.trace.push(`remove ${name}`);
    logged(this.party, "remove", name);
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
  /** The take record's room, as its JSON, for tests: 128 KiB otherwise (the 1.10.0 gate's round 5). */
  takeRoomBytes?: number;
  /**
   * chrome.storage as Chrome answers it, over IPC (round 5): every get and set of either area resolves a macrotask later,
   * and the service's own turns of the event loop are the worker's (a setTimeout of 0) in place of a setImmediate.
   */
  ipc?: boolean;
  /** The ticks the worker's alarms give (`ticks`), by the device's clock: none otherwise. */
  ticks?: () => Array<{ at: number; lane: boolean }>;
  /** TAKE_MARGIN_MS, for tests. */
  takeMarginMs?: number;
  /** The first-contact stamp's bits, solved and asked: 6 otherwise, cheap for tests. */
  firstContactBits?: number;
  /** The call a solve makes between its slices so Chrome keeps the worker (`keepAlive`): none otherwise. */
  keepAlive?: () => Promise<void>;
}

function service(p: Omit<Party, "messaging" | "restart">, relay: FakeRelay, directory: Directory, options: ServiceOptions, given?: Wasm): MessagingService {
  const wasm = given ?? loadTestWasm();
  const { ipc, ticks, ...rest } = options;
  const traced: Wasm = {
    ...wasm,
    messagingScan: (key, envelopes) => {
      p.trace.push("scan");
      logged(p, "scan");
      return wasm.messagingScan(key, envelopes);
    },
    messagingOpen: (key, envelope) => {
      p.trace.push("open");
      logged(p, "open");
      return wasm.messagingOpen(key, envelope);
    },
    messagingReceive: (key, request) => {
      p.trace.push("receive");
      logged(p, "receive");
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
    relay: (n) =>
      relay.client(n, (call, init) => {
        p.trace.push(call);
        const [method, path] = call.split(" ");
        // A POST with its body's length (round 4's review, #9): what the C1 traces compare beside the order.
        const body = method === "POST" ? (init?.body as Uint8Array | undefined)?.byteLength : undefined;
        logged(p, method as "GET" | "POST", path, body);
      }),
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
    // chrome.storage.local.getBytesInUse(key), the same count for one key, with no value read (round 5).
    bytesOf: async (key) => {
      const raw = p.local.data.get(key) as string | undefined;
      return raw === undefined ? 0 : key.length + raw.length;
    },
    // A turn of the event loop, timers included, as the worker's own: a search that ran away (a price no test meant
    // to be solved) then fails at its test's timeout instead of holding the whole run in microtasks. Over `ipc`, the
    // worker's own: a setTimeout of 0.
    wait: async () => {
      await new Promise((r) => (ipc ? setTimeout(r, 0) : setImmediate(r)));
      await p.onWait?.();
    },
    // The gate's waits run on the test's clock: they end once the test moves it on, or a lane starts.
    sleep: async () => {
      await new Promise((r) => setImmediate(r));
    },
    ...(ticks ? { ticks: async () => ticks() } : {}),
    observe: (event, network) => logged(p, event, network),
    changed: (n) => {
      logged(p, "changed", n);
      p.changed.push(n);
    },
    // A throw a take passes over without a word fails the test that meets it, unless it means to (f2): out of the run,
    // so the service does what it does.
    passedOver: (e) => {
      p.passedOver.push(e);
      if (p.passOverOk) return;
      queueMicrotask(() => {
        throw new Error(`a take passed over a throw without a word: ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`);
      });
    },
    // A branch the worker's count of the share makes unreachable fails the test that reaches it, unless it means to (fix
    // item 2): out of the run, as passedOver's.
    unreachable: (where) => {
      p.unreachable.push(where);
      if (p.unreachableOk) return;
      queueMicrotask(() => {
        throw new Error(`the worker reached a branch its share count makes unreachable: ${where}`);
      });
    },
    // Cheap first-contact stamps for tests; the worker never sets it.
    firstContactBits: 6,
    ...rest,
  });
}

/**
 * The wallet's unlock stamp (`seedelf.unlockedAt`) moved on at every unlock, create and restore, as a real worker's is
 * (round 4's review, #8): the test's clock stands still between a lock and an unlock, where a real one never does, so
 * the service would take the new unlock for the old one and keep what it holds in memory of it.
 */
function movingUnlockStamp(session: MemoryArea): void {
  // From the stamp already there: the wallet was created before this.
  const now = session.data.get(SESSION_UNLOCKED_AT);
  let last = typeof now === "string" ? Number(JSON.parse(now)) : Number.NEGATIVE_INFINITY;
  const set = session.set.bind(session);
  session.set = async (key, value) => {
    if (key === SESSION_UNLOCKED_AT && typeof value === "number") {
      const stamp = value > last ? value : last + 1;
      last = stamp;
      return set(key, stamp);
    }
    return set(key, value);
  };
}

/** Each get and set of `area` answered a macrotask later, as chrome.storage's IPC answers (round 5's `ipc`). */
function overIpc(area: MemoryArea): void {
  const a = area as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of ["get", "set", "remove", "keys"]) {
    const real = a[method]!.bind(area);
    a[method] = async (...args: unknown[]) => {
      await new Promise((r) => setTimeout(r, 0));
      return real(...args);
    };
  }
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
    preferences: new PreferencesService(t.local, BOTH_OPEN),
    own: [],
    keptView: true,
    revealReads: 0,
    freshReads: 0,
    skew: 0,
    changed: [],
    trace: [],
    log: [],
    area: [],
    passedOver: [],
    passOverOk: false,
    unreachable: [],
    unreachableOk: false,
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
  movingUnlockStamp(t.session);
  if (given.ipc) {
    overIpc(t.local);
    overIpc(t.session);
  }
  tracedArea(base, t.local);
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

/**
 * Every sealed record of `p` that a take writes, opened: the inbox, each conversation's record and the take record
 * (round 4's review, #9). What a sync may and may not have changed.
 */
export async function records(p: Party): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of (await p.local.keys("seedelf.private.")).sort()) {
    const name = key.slice("seedelf.private.".length) as RecordName;
    if (name.startsWith("messaging.") || name.startsWith("conversation.") || name.startsWith("messagingTake.")) out[name] = await p.store.get(name);
  }
  return out;
}

/**
 * Where `p`'s next read of `network`'s pool goes on from, as stored: the read record's cursor (the 1.10.0 gate's round
 * 5). Round 4 kept it in the take record, and builds before that in the inbox.
 */
export async function cursorOf(p: Pick<Party, "store">, network: NetworkName = "preprod"): Promise<string | undefined> {
  return (await readOf(p, network))?.cursor;
}

/** What `p`'s read record holds, as stored (round 5): the cursor, a gap, the skip list, the clock, what's owed. */
export async function readOf(p: Pick<Party, "store">, network: NetworkName = "preprod") {
  return p.store.get<{
    v: 1;
    cursor?: string;
    gapAt?: number;
    skip?: Array<{ envelope: string; until: number }>;
    clock?: { at: number; off: number };
    owed?: number;
  }>(`messagingRead.${network}`);
}

/** What `p`'s take record holds, as stored: the reads' envelopes waiting for the take, and the counts (finding 8). */
export async function takesOf(p: Pick<Party, "store">, network: NetworkName = "preprod") {
  return p.store.get<{ v: number; batches: Array<{ to?: string; envelopes: string[] }>; unopened?: number; noRoom?: number }>(`messagingTake.${network}`);
}

/** What `p`'s outbox record holds, as stored (round 5): the user's envelopes waiting to be posted. */
export async function outboxOf(p: Pick<Party, "store">, network: NetworkName = "preprod") {
  return (await p.store.get<{ v: 1; waiting: Array<{ cid: string; id: number; envelope: string }> }>(`messagingOutbox.${network}`))?.waiting;
}

/** What `p`'s requests record holds, as stored (round 5): the crate's requests, in base64, and any set aside. */
export async function requestsOf(p: Pick<Party, "store">, network: NetworkName = "preprod") {
  return p.store.get<{ v: 1; requests?: string; aside?: string[] }>(`messagingRequests.${network}`);
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
