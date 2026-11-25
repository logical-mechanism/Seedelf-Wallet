// A lock replaces the WebAssembly instance and zeroes the old one's memory (wallet.ts `free`, wasm.ts `renewWasm`;
// the trap path's `freshWasm` zeroes it too), over the real module and the real Wallet class, wired as the worker
// wires them (sw.ts).
//
// Why: free() overwrites a key where its object kept it and the scrub what calls left on the stack, but a call that
// builds something can copy bytes an earlier call left on the stack into the heap, in a value it never wrote in full,
// and those outlast both. 1.10.0's review found them after a lock: 16 bytes of the stake key's signing scalar after
// `stakePublicKey` then `messagingRequestsInfo`, 16 of payment key 0/0 after `paymentKeyHash` then the same, and
// bytes of the Seedelf key itself after two `messagingReadRequest`s. The first tests here are that finding, with no
// renew wired: the control. The next are the same runs with it, and four more: after the lock every byte of the old
// memory is zero, and the new instance's memory is a fresh instance's, byte for byte, with no run of 4 bytes of any of
// the wallet's keys, of the keys they derive, or of what they came from.
//
// The 4-byte floor is exact only there: a fresh instance's memory is the same every time, so what a scan finds in it
// is fixed (nothing, for these phrases). In a used heap 4 bytes match by chance about once in ten scans of this many
// secrets, so the controls ask only for the runs the review named, at their lengths.
import { createHmac, hkdfSync, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";

import type * as Wasm from "@seedelf/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { stackScrub, Wallet, WASM_BROKEN, type Keys } from "../src/background/wallet";
import { freshWasm, renewWasm } from "../src/background/wasm";
import { loadTestWasm, memoryArea, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const T = 1_800_000_000;
const STACK = 0x100000;
const accounts = vectors("cardano_account.json").filter((v) => v.account === 0);
/** The 12-word vector phrase: the transfer fixture's UTxOs are its Seedelf's. Its entropy is 16 zero bytes. */
const spender = accounts.find((v) => v.phrase.split(" ").length === 12)!;
/** A 24-word vector phrase whose entropy can be looked for. */
const holder = accounts.find((v) => v.phrase.split(" ").length === 24 && !v.phrase.startsWith("abandon"))!;

const wasm = loadTestWasm();
/** The memory of the instance there is now: the glue's `initSync` gives the exports of the one it has. */
const memory = () => (wasm as unknown as { initSync(): { memory: WebAssembly.Memory } }).initSync().memory;
/** A copy of a memory's bytes as they are now. */
const copyOf = (of: WebAssembly.Memory) => Buffer.from(new Uint8Array(of.buffer));
const allZero = (of: WebAssembly.Memory) => new Uint8Array(of.buffer).every((byte) => byte === 0);

// ---- The wallet's secrets, each as the module holds it (seedelf-crypto's derivation.rs and cardano.rs).

const R = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const hmac = (key: Buffer, ...parts: Buffer[]) => createHmac("sha512", key).update(Buffer.concat(parts)).digest();

/** `key` plus `z`: the left half takes 8 times z's first 28 bytes, the right half z's right half (BIP32-Ed25519). */
function child(xprv: Buffer, z: Buffer, chain: Buffer): Buffer {
  const out = Buffer.alloc(96);
  for (let at = 0, carry = 0; at < 32; at++) {
    const sum = xprv[at]! + (at < 28 ? z[at]! << 3 : 0) + carry;
    out[at] = sum & 0xff;
    carry = sum >> 8;
  }
  for (let at = 0, carry = 0; at < 32; at++) {
    const sum = xprv[32 + at]! + z[32 + at]! + carry;
    out[32 + at] = sum & 0xff;
    carry = sum >> 8;
  }
  chain.copy(out, 64, 32);
  return out;
}
const index = (n: number) => {
  const i = Buffer.alloc(4);
  i.writeUInt32LE(n >>> 0);
  return i;
};
function hardened(xprv: Buffer, n: number): Buffer {
  const [key, chain, i] = [xprv.subarray(0, 64), xprv.subarray(64), index(0x80000000 | n)];
  return child(xprv, hmac(chain, Buffer.from([0]), key, i), hmac(chain, Buffer.from([1]), key, i));
}

// Ed25519's base point times a scalar, for a soft child's public key: extended coordinates on -x² + y² = 1 + dx²y².
const P = 2n ** 255n - 19n;
const mod = (a: bigint) => ((a % P) + P) % P;
function inverse(a: bigint): bigint {
  let [result, base] = [1n, mod(a)];
  for (let e = P - 2n; e > 0n; e >>= 1n, base = mod(base * base)) if (e & 1n) result = mod(result * base);
  return result;
}
const D2 = mod(2n * -121665n * inverse(121666n));
type Point = [bigint, bigint, bigint, bigint];
const BASE_Y = mod(4n * inverse(5n));
const BASE_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
function add([x1, y1, z1, t1]: Point, [x2, y2, z2, t2]: Point): Point {
  const [a, b, c, d] = [mod((y1 - x1) * (y2 - x2)), mod((y1 + x1) * (y2 + x2)), mod(t1 * D2 * t2), mod(2n * z1 * z2)];
  const [e, f, g, h] = [b - a, d - c, d + c, b + a];
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}
/** The public key of an extended key's left half: the scalar as it is, no hashing and no clamping. */
function publicKey(left: Buffer): Buffer {
  let sum: Point = [0n, 1n, 1n, 0n];
  let point: Point = [BASE_X, BASE_Y, 1n, mod(BASE_X * BASE_Y)];
  for (let k = BigInt(`0x${Buffer.from(left).reverse().toString("hex")}`); k > 0n; k >>= 1n, point = add(point, point)) {
    if (k & 1n) sum = add(sum, point);
  }
  const z = inverse(sum[2]);
  const [x, y] = [mod(sum[0] * z), mod(sum[1] * z)];
  const out = Buffer.from(y.toString(16).padStart(64, "0"), "hex").reverse();
  out[31]! |= Number(x & 1n) << 7;
  return out;
}
function soft(xprv: Buffer, n: number): Buffer {
  const [chain, pub, i] = [xprv.subarray(64), publicKey(xprv.subarray(0, 32)), index(n)];
  return child(xprv, hmac(chain, Buffer.from([2]), pub, i), hmac(chain, Buffer.from([3]), pub, i));
}

type Secret = [name: string, bytes: Buffer];
const STAKE = "the stake key 2/0";
const PAYMENT = "payment key 0/0";
const X_BE = "the Seedelf key big-endian";
const X_HELD = "the Seedelf key as the module holds it";

function secretsOf(phrase: string): Secret[] {
  const entropy = Buffer.from(wasm.phraseToEntropy(phrase));
  const seed = pbkdf2Sync(phrase, "mnemonic", 2048, 64, "sha512");
  const info = Buffer.concat([Buffer.from("seedelf-key"), Buffer.alloc(4)]);
  const okm = Buffer.from(hkdfSync("sha256", seed, "seedelf-wallet-v1", info, 64));
  const x = (BigInt(`0x${okm.toString("hex")}`) % R).toString(16).padStart(64, "0");
  const master = pbkdf2Sync("", entropy, 4096, 96, "sha512");
  master[0]! &= 0xf8;
  master[31] = (master[31]! & 0x1f) | 0x40;
  const purpose = hardened(master, 1852);
  const coin = hardened(purpose, 1815);
  const [account, oneTime] = [hardened(coin, 0), hardened(coin, 0x5eed)];
  const all: Secret[] = [
    // blst's Montgomery form, x·2²⁵⁶ mod r, its limbs little-endian.
    [X_HELD, Buffer.from(((BigInt(`0x${x}`) << 256n) % R).toString(16).padStart(64, "0"), "hex").reverse()],
    [X_BE, Buffer.from(x, "hex")],
    ["the Seedelf key little-endian", Buffer.from(x, "hex").reverse()],
    ["the entropy", entropy],
    ["the BIP39 seed", seed],
    ["the HKDF output", okm],
    ["the master key", master],
    ["the key at 1852'", purpose],
    ["the key at 1852'/1815'", coin],
    ["the account's key", account],
    ["the one-time accounts' key", oneTime],
    // The keys those two derive: the ones that sign.
    ["the account's chain 0", soft(account, 0)],
    [PAYMENT, soft(soft(account, 0), 0)],
    ["the account's chain 1", soft(account, 1)],
    ["payment key 1/0", soft(soft(account, 1), 0)],
    ["the account's chain 2", soft(account, 2)],
    [STAKE, soft(soft(account, 2), 0)],
    ["the one-time accounts' chain 0", soft(oneTime, 0)],
    ["one-time payment key 0/0", soft(soft(oneTime, 0), 0)],
    ["the one-time accounts' chain 2", soft(oneTime, 2)],
    ["one-time stake key 2/0", soft(soft(oneTime, 2), 0)],
  ];
  // A secret of one byte repeated can't be looked for: the 12-word vector phrase's entropy is 16 zero bytes.
  return all.filter(([, bytes]) => bytes.some((byte) => byte !== bytes[0]));
}

/**
 * Every run of `least` bytes or more of one of `secrets` in `bytes` from `from` on: whose, which of its bytes, where
 * and how long.
 */
type Run = { name: string; first: number; at: number; length: number };
function runsOf(bytes: Buffer, secrets: Secret[], least: number, from = 0): Run[] {
  const windows = new Map<number, Array<[string, Buffer, number]>>();
  for (const [name, secret] of secrets) {
    for (let first = 0; first + 4 <= secret.length; first++) {
      const start = secret.readUInt32LE(first);
      if (!windows.has(start)) windows.set(start, []);
      windows.get(start)!.push([name, secret, first]);
    }
  }
  const runs = new Map<string, Run>();
  for (let at = from; at + 4 <= bytes.length; at++) {
    const starting = windows.get(bytes.readUInt32LE(at));
    if (!starting) continue;
    for (const [name, secret, first] of starting) {
      // The whole run this window is part of, both ways.
      let [back, on] = [0, 4];
      while (first - back > 0 && at - back > from && bytes[at - back - 1] === secret[first - back - 1]) back++;
      while (first + on < secret.length && at + on < bytes.length && bytes[at + on] === secret[first + on]) on++;
      if (back + on < least) continue;
      runs.set(`${name}|${first - back}|${at - back}`, { name, first: first - back, at: at - back, length: back + on });
    }
  }
  return [...runs.values()];
}
const said = (runs: Run[]) =>
  runs.map((r) => `${r.length} bytes of ${r.name} from its byte ${r.first}, ${r.at < STACK ? "on the stack" : "above the stack"}`);

// ---- The wallet, wired as the worker wires it.

function wired(o: { renew?: boolean; local?: ReturnType<typeof memoryArea>; session?: ReturnType<typeof memoryArea> } = {}) {
  const counts = { renews: 0 };
  const [local, session] = [o.local ?? memoryArea(), o.session ?? memoryArea()];
  const wallet = new Wallet({
    wasm,
    local,
    session,
    now: () => T * 1000,
    autoLock: { start: async () => undefined, stop: async () => undefined },
    changed: () => undefined,
    fresh: freshWasm,
    scrub: stackScrub(wasm),
    ...(o.renew === false
      ? {}
      : {
          renew: () => {
            counts.renews++;
            renewWasm();
          },
        }),
  });
  return { wallet, counts, local, session };
}

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
/** A call whose request is JSON text, the key passed as itself. */
const call = <R>(fn: (...args: never[]) => string, ...args: unknown[]): R => {
  const passed = args.map((a) => (typeof a === "object" && a?.constructor === Object ? JSON.stringify(a) : a));
  return JSON.parse((fn as (...a: unknown[]) => string)(...passed)) as R;
};
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

/** A stranger's request to `holder`'s Seedelf, as the wallet keeps it: two first-contact messages in its record. */
const request = { requests: "", cid: "" };
/** A fresh instance's memory, as it is before any call. */
let pristine: Buffer;

beforeAll(() => {
  const seedelf = wasm.SeedelfKey.fromPhrase(holder.phrase, 0);
  const stranger = wasm.SeedelfKey.random();
  const [base, name] = [seedelf.baseRegister(), "5eed0e1f" + "b0".repeat(28)];
  const register = wasm.rerandomize(base);
  const handle = { generator: register.generator, publicValue: register.publicValue };
  const handles = [{ name, registers: [handle] }];
  const started = call<{ cid: string; conversation: string }>(wasm.messagingStart, stranger, { handle, to: name, now: T });
  const stamped = call<{ conversation: string }>(wasm.messagingSetStamp, { conversation: started.conversation, nonce: 0 });
  type Sent = { conversation: string; envelope: string };
  const first = call<Sent>(wasm.messagingSend, { conversation: stamped.conversation, plaintext: hex("hello") });
  const second = call<Sent>(wasm.messagingSend, { conversation: first.conversation, plaintext: hex("again") });
  const arrived = { envelope: first.envelope, now: T + 60, handles, firstContactBits: 0 };
  const one = call<{ requests: string }>(wasm.messagingReceive, seedelf, arrived);
  const two = call<{ requests: string }>(wasm.messagingReceive, seedelf, {
    envelope: second.envelope,
    now: T + 61,
    handles,
    firstContactBits: 0,
    requests: one.requests,
  });
  Object.assign(request, { requests: two.requests, cid: started.cid });
  for (const object of [register, base, stranger, seedelf]) object.free();
  // What that left goes with its instance, and the next one is looked at before anything runs in it.
  renewWasm();
  pristine = copyOf(memory());
});

const transfer = () => {
  const recorded = json("./fixtures/transfer-preprod.json");
  return JSON.stringify({
    network: "preprod",
    params: json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0],
    utxos: json("./fixtures/owned-utxos.json").owned_utxos.slice(0, 2),
    payments: [{ to: recorded.to, recipient: recorded.recipient, lovelace: recorded.lovelace, tokens: recorded.tokens }],
  });
};
const reads = (keys: Keys) => wasm.messagingReadRequest(keys.seedelf, JSON.stringify(request));

/**
 * What the wallet's keys do between an unlock and a lock. `left`: the secret the review found bytes of in the heap
 * after the lock's free()s and scrub, and how many in a row.
 */
type Use = { name: string; of: typeof holder; use: (keys: Keys) => void; left?: [secret: string, bytes: number] };
const runs: Use[] = [
  {
    name: "stakePublicKey, then messagingRequestsInfo",
    of: holder,
    use: (keys) => void [keys.cardano.stakePublicKey(), wasm.messagingRequestsInfo(request.requests)],
    left: [STAKE, 16],
  },
  {
    name: "paymentKeyHash, then messagingRequestsInfo",
    of: holder,
    use: (keys) => void [keys.cardano.paymentKeyHash(0, 0), wasm.messagingRequestsInfo(request.requests)],
    left: [PAYMENT, 8],
  },
  { name: "messagingReadRequest twice", of: holder, use: (keys) => void [reads(keys), reads(keys)], left: [X_BE, 6] },
  {
    name: "messagingAccept, then messagingRequestsInfo",
    of: holder,
    use: (keys) =>
      void [wasm.messagingAccept(keys.seedelf, JSON.stringify(request)), wasm.messagingRequestsInfo(request.requests)],
    left: [X_BE, 4],
  },
  {
    name: "a private transfer built at once",
    of: spender,
    use: (keys) => expect(JSON.parse(wasm.buildTransfer(keys.seedelf, transfer())).txCbor).toMatch(/^[0-9a-f]+$/),
  },
  { name: "nothing at all", of: holder, use: () => undefined },
];

/**
 * In a fresh instance: a wallet made and unlocked, `use`, a lock. The memory that held the keys, and the one there is
 * after.
 */
async function locked(run: Use, o: { renew?: boolean; restart?: boolean } = {}) {
  renewWasm();
  let { wallet, counts, local, session } = wired({ renew: o.renew });
  await wallet.create(run.of.phrase, PASSWORD);
  if (o.restart) {
    // The worker was stopped and started while unlocked: a new instance, and the keys derived again at their first use.
    renewWasm();
    ({ wallet, counts } = wired({ renew: o.renew, local, session }));
  }
  await wallet.withKeys((keys) => run.use(keys));
  const held = memory();
  const unlocked = runsOf(copyOf(held), secretsOf(run.of.phrase), 8, STACK).map((r) => r.name);
  await wallet.lock();
  expect(await wallet.state()).toBe("locked");
  return { wallet, counts, held, unlocked, after: memory() };
}

describe("what a lock left before it replaced the instance (the control: no renew wired)", () => {
  it("derives the secrets it looks for as the module does", async () => {
    const { wallet } = wired();
    await wallet.create(holder.phrase, PASSWORD);
    const secrets = new Map(secretsOf(holder.phrase));
    await wallet.withKeys((keys) => {
      expect(keys.cardano.stakePublicKey()).toBe(publicKey(secrets.get(STAKE)!.subarray(0, 32)).toString("hex"));
      const account = secrets.get("the account's key")!;
      const accountPublic = Buffer.concat([publicKey(account.subarray(0, 32)), account.subarray(64)]);
      expect(keys.cardano.accountPublicKey()).toBe(accountPublic.toString("hex"));
      const base = keys.seedelf.baseRegister();
      const mine = wasm.SeedelfKey.fromHex(secrets.get(X_BE)!.toString("hex"));
      expect(mine.isOwned(base)).toBe(true);
      for (const object of [base, mine]) object.free();
    });
    await wallet.lock();
  });

  it("a fresh instance's memory is the same every time, and holds nothing of these phrases' at 4 bytes", () => {
    renewWasm();
    expect(copyOf(memory()).equals(pristine)).toBe(true);
    for (const phrase of [holder.phrase, spender.phrase]) expect(said(runsOf(pristine, secretsOf(phrase), 4))).toEqual([]);
  });

  for (const run of runs.filter((r) => r.left)) {
    it(`${run.name}: bytes of a key stay in the heap after the lock's free()s and scrub`, async () => {
      const { held, after } = await locked(run, { renew: false });
      expect(after).toBe(held);
      const left = runsOf(copyOf(after), secretsOf(run.of.phrase), 4);
      // The scrub did its part: nothing of the wallet's on the stack.
      expect(said(left.filter((r) => r.at < STACK))).toEqual([]);
      const [secret, bytes] = run.left!;
      expect(said(left.filter((r) => r.name === secret && r.length >= bytes)), said(left).join("; ")).not.toEqual([]);
    });
  }
});

describe("a lock replaces the instance and zeroes the memory that held the keys", () => {
  for (const [run, restart] of [...runs.map((r) => [r, false] as const), [runs[0]!, true] as const]) {
    const where = restart ? ", in a worker restarted while unlocked" : "";
    it(`${run.name}${where}: nothing of the wallet's is in either memory`, async () => {
      const { counts, held, unlocked, after } = await locked(run, { restart });
      // While unlocked the keys were there to be found.
      expect(unlocked).toEqual(expect.arrayContaining([X_HELD, "the account's key", "the one-time accounts' key"]));
      expect(counts.renews).toBe(1);
      // The memory that held them: every byte of it zero.
      expect(after).not.toBe(held);
      expect(held.buffer.byteLength).toBeGreaterThanOrEqual(pristine.length);
      expect(allZero(held)).toBe(true);
      // The one there is now: a fresh instance's, in which nothing has run.
      expect(copyOf(after).equals(pristine)).toBe(true);
      expect(said(runsOf(copyOf(after), secretsOf(run.of.phrase), 4))).toEqual([]);
    });
  }

  it("the wallet works on the new instance, renews again at its next lock, and never while locked", async () => {
    const { wallet, counts, after } = await locked(runs[0]!);
    expect(await wallet.state()).toBe("locked");
    await wallet.lock();
    await expect(wallet.account("preprod")).rejects.toThrow("locked");
    // Looked at and locked again while locked: no keys were held, so nothing is replaced.
    expect(counts.renews).toBe(1);
    expect(memory()).toBe(after);

    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    // An unlock replaces nothing either.
    expect(counts.renews).toBe(1);
    expect(memory()).toBe(after);
    expect((await wallet.account("preprod")).receiveAddress).toBe(holder.preprod.receive_0);
    await wallet.withKeys((keys) => {
      const base = keys.seedelf.baseRegister();
      expect(keys.seedelf.isOwned(base)).toBe(true);
      const proof = keys.seedelf.createProof(base, "00".repeat(28));
      expect(proof.z).toMatch(/^[0-9a-f]{64}$/);
      for (const object of [proof, base]) object.free();
      // A stranger's request, read with the key the new instance derived.
      const read = JSON.parse(reads(keys)) as { refused?: string };
      expect(read.refused).toBeUndefined();
      expect(JSON.stringify(read)).toContain(hex("hello"));
    });
    // A second account's keys, kept while unlocked, go with the rest.
    await wallet.withAccount(1, (keys) => keys.cardano.receiveAddress(wasm.Network.Preprod, 0));

    const held = memory();
    await wallet.lock();
    expect(counts.renews).toBe(2);
    expect(memory()).not.toBe(held);
    expect(allZero(held)).toBe(true);
    expect(copyOf(memory()).equals(pristine)).toBe(true);
    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    expect((await wallet.account("preprod")).receiveAddress).toBe(holder.preprod.receive_0);
    await wallet.lock();
  });

  it("an object of the old instance refuses, as after a trap, and that refusal isn't read as a trap", async () => {
    const { wallet } = wired();
    await wallet.create(holder.phrase, PASSWORD);
    // Held past the wallet's queue, as nothing in the worker holds one (a test's own).
    const old = await wallet.withKeys((keys) => keys);
    await wallet.lock();
    expect(() => old.cardano.stakePublicKey()).toThrow("Invalid stale object from previous Wasm instance");
    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    // Used inside the wallet's queue it's an error of the call's, and the wallet stays unlocked.
    await expect(wallet.withKeys(() => old.seedelf.baseRegister())).rejects.toThrow("stale object");
    expect(await wallet.state()).toBe("unlocked");
    expect(wallet.lockReason()).toBeUndefined();
    await wallet.lock();
  });
});

describe("the wallet's own part", () => {
  it("renews once at a lock, after the frees and the scrub, and a renew that throws never stops the lock", async () => {
    for (const thrown of [undefined, new Error("the reset failed"), new WebAssembly.RuntimeError("unreachable")]) {
      const order: string[] = [];
      const session = memoryArea();
      const wallet = new Wallet({
        wasm,
        local: memoryArea(),
        session,
        now: () => T * 1000,
        autoLock: { start: async () => undefined, stop: async () => undefined },
        changed: () => undefined,
        scrub: () => void order.push("scrub"),
        renew: () => {
          order.push("renew");
          if (thrown) throw thrown;
        },
      });
      await wallet.create(holder.phrase, PASSWORD);
      const keys = await wallet.withKeys((k) => k);
      for (const name of ["seedelf", "cardano", "oneTime"] as const) {
        const free = keys[name].free.bind(keys[name]);
        keys[name].free = () => {
          order.push(`free ${name}`);
          free();
        };
      }
      // An unlock scrubs, and replaces nothing.
      expect(order).toEqual(["scrub"]);

      await wallet.lock();
      expect(order).toEqual(["scrub", "free seedelf", "free cardano", "free oneTime", "scrub", "renew"]);
      expect(session.data.size).toBe(0);
      expect(wallet.lockReason()).toBeUndefined();
      expect(await wallet.state()).toBe("locked");
      await wallet.lock();
      expect(order.filter((step) => step === "renew")).toHaveLength(1);
      expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
      expect((await wallet.account("preprod")).receiveAddress).toBe(holder.preprod.receive_0);
      await wallet.lock();
      expect(order.filter((step) => step === "renew")).toHaveLength(2);
    }
  });
});

describe("a trap's fresh instance", () => {
  /** A Register pointing far outside WebAssembly's memory: using it traps the instance (wallet.test.ts). */
  const outOfBounds = () => Object.assign(Object.create(wasm.Register.prototype), { __wbg_ptr: 0x7fff_fff0 }) as Wasm.Register;

  for (const renew of [true, false]) {
    it(`leaves the trapped one's memory all zeros, ${renew ? "with a renew wired" : "by freshWasm alone"}`, async () => {
      renewWasm();
      const { wallet, counts } = wired({ renew });
      await wallet.create(holder.phrase, PASSWORD);
      await wallet.withKeys((keys) => void keys.cardano.stakePublicKey());
      const held = memory();
      expect(runsOf(copyOf(held), secretsOf(holder.phrase), 8, STACK).length).toBeGreaterThan(0);

      // The trap is inside a call that borrowed the key: its free() is refused, and its bytes stay where they were.
      await expect(wallet.withKeys((keys) => keys.seedelf.isOwned(outOfBounds()))).rejects.toThrow(WASM_BROKEN());
      expect(wallet.lockReason()).toBe("trap");
      expect(counts.renews).toBe(renew ? 1 : 0);
      expect(memory()).not.toBe(held);
      expect(allZero(held)).toBe(true);
      expect(copyOf(memory()).equals(pristine)).toBe(true);

      expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
      expect((await wallet.account("preprod")).receiveAddress).toBe(holder.preprod.receive_0);
      await wallet.lock();
    });
  }
});
