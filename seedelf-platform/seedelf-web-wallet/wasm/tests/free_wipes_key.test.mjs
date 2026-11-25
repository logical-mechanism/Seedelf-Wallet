// A lock leaves no key in the module's memory (run ../build.sh first).
//
// The wallet's lock frees its three key objects, scrubs WebAssembly's stack,
// and then replaces the instance and zeroes the old one's memory
// (extension/src/background/wallet.ts `free`, wasm.ts `renewWasm`).
//
// - free(): wasm-bindgen's free() moves an object out of its cell before
//   dropping it, so a key held in the cell itself was released as it was: the
//   1.10.0 gate's review read the Seedelf key back from the freed cell. Each
//   object now keeps its key in an allocation of its own that is overwritten
//   in place (src/lib.rs, `Wiped`). The first tests look there: before free()
//   the key's bytes are where the object keeps them, and after it no 8 of
//   them in a row are left.
// - scrubStack(): a call leaves copies of what it worked with on the stack,
//   which no free() reaches: after an unlock, the keys, the BIP39 seed and
//   the master key they came from. The scrub overwrites the stack's top half
//   (src/lib.rs, `scrub_stack`). Four tests lock after a run each and then
//   look through the whole memory, for the keys, the keys they derive and
//   what they came from.
// - The scrub after an unlock: a call that builds something can copy bytes an
//   earlier call left on the stack into the heap, in a value it never wrote
//   in full, where no scrub reaches them. A transfer built straight after an
//   unlock did, with 8 bytes of the BIP39 seed (the 1.10.0 gate's review). So
//   the wallet scrubs once its keys are derived too (wallet.ts `derive`), and
//   a test runs that order in a fresh instance: nothing is left. Its control
//   is the same run without that scrub, which leaves those bytes above the
//   stack.
// - The instance replaced: the same copying happens between two later calls,
//   of a key one left on the stack and the next built over, and no scrub the
//   wallet could make comes between them. The review found, after a lock's
//   free()s and scrub: 16 bytes of the stake key's signing scalar in the heap
//   after `stakePublicKey` then `messagingRequestsInfo`, 16 of payment key
//   0/0 after `paymentKeyHash` then the same, and bytes of the Seedelf key
//   itself after two `messagingReadRequest`s. So a lock ends by replacing the
//   instance with a fresh one and zeroing the old one's memory. The last
//   tests are those runs: what the free()s and the scrub leave (the control,
//   which is why the instance goes), and that the instance the glue's reset
//   puts in place is a fresh one's memory byte for byte, with no 4 bytes in a
//   row of any of it. That the old memory is zeroed is wasm.ts's own doing,
//   which extension/tests/lock-renews-wasm.test.ts holds it to.
//
// The floor: 8 bytes in a row in a memory that has been used, where 4 match
// by chance about once in ten scans of this many secrets; 4 in a fresh
// instance's, which is the same every time, so what a scan finds there is
// fixed (nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, hkdfSync, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  __wbg_reset_state,
  CardanoAccount,
  Network,
  OneTimeAccounts,
  SeedelfKey,
  buildTransfer,
  entropyToPhrase,
  initSync,
  messagingAccept,
  messagingReadRequest,
  messagingReceive,
  messagingRequestsInfo,
  messagingScan,
  messagingSend,
  messagingSetStamp,
  messagingStart,
  phraseToEntropy,
  rerandomize,
  scrubStack,
} from "./wasm.mjs";

// The instance there is: initSync gives it, wasm.mjs's or the one a reset put
// in its place. Its memory's buffer is read anew each time, since it's
// replaced when the memory grows.
const memory = () => initSync().memory;
const bytes = () => Buffer.from(memory().buffer);

// A test key and a test entropy: no wallet's. No 4 bytes of the entropy are a
// constant of the module's (it began 5eed0e1f once, the Seedelf prefix, which
// every instance's memory holds).
const SK = "1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff1";
const ENTROPY = Buffer.from("9b4f27c5d81e63a07f2c95b8e4d61a3f0c7e58b2a94d16f3857ac2e9b06d4f71", "hex");

// The scalar as the module holds it: blst's Montgomery form, x·2²⁵⁶ mod r,
// its four limbs little-endian.
const R = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const montgomery = (hex) =>
  Buffer.from((((BigInt(`0x${hex}`) << 256n) % R).toString(16).padStart(64, "0")), "hex").reverse();

// The account key the module derives from an entropy (seedelf-crypto's
// cardano.rs): CIP-3's Icarus master key, then BIP32-Ed25519's hardened
// children 1852', 1815' and the account. 96 bytes: 64 of key, 32 of chain code.
const hmac = (key, ...parts) => createHmac("sha512", key).update(Buffer.concat(parts)).digest();
const le32 = (n) => {
  const i = Buffer.alloc(4);
  i.writeUInt32LE(n >>> 0);
  return i;
};
/** A child of `xprv` from its two HMACs, `z` and the one whose right half is the chain code. */
function child(xprv, z, chain) {
  const out = Buffer.alloc(96);
  // The left half: the key's plus 8 times z's first 28 bytes. The right: the key's plus z's.
  for (let at = 0, carry = 0; at < 32; at++) {
    const sum = xprv[at] + (at < 28 ? z[at] << 3 : 0) + carry;
    out[at] = sum & 0xff;
    carry = sum >> 8;
  }
  for (let at = 0, carry = 0; at < 32; at++) {
    const sum = xprv[32 + at] + z[32 + at] + carry;
    out[32 + at] = sum & 0xff;
    carry = sum >> 8;
  }
  chain.copy(out, 64, 32);
  return out;
}
function hardened(xprv, index) {
  const [key, chain, i] = [xprv.subarray(0, 64), xprv.subarray(64), le32(0x80000000 | index)];
  return child(xprv, hmac(chain, Buffer.from([0]), key, i), hmac(chain, Buffer.from([1]), key, i));
}

// The keys an account derives, the ones that sign: BIP32-Ed25519's soft
// children, which take the parent's public key. That is Ed25519's base point
// times the key's left half as it is: in extended coordinates on
// -x² + y² = 1 + dx²y².
const P = 2n ** 255n - 19n;
const mod = (a) => ((a % P) + P) % P;
function inverse(a) {
  let [result, base] = [1n, mod(a)];
  for (let e = P - 2n; e > 0n; e >>= 1n, base = mod(base * base)) if (e & 1n) result = mod(result * base);
  return result;
}
const D2 = mod(2n * -121665n * inverse(121666n));
const BASE_Y = mod(4n * inverse(5n));
const BASE_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
function add([x1, y1, z1, t1], [x2, y2, z2, t2]) {
  const [a, b, c, d] = [mod((y1 - x1) * (y2 - x2)), mod((y1 + x1) * (y2 + x2)), mod(t1 * D2 * t2), mod(2n * z1 * z2)];
  const [e, f, g, h] = [b - a, d - c, d + c, b + a];
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}
function publicKey(left) {
  let sum = [0n, 1n, 1n, 0n];
  let point = [BASE_X, BASE_Y, 1n, mod(BASE_X * BASE_Y)];
  for (let k = BigInt(`0x${Buffer.from(left).reverse().toString("hex")}`); k > 0n; k >>= 1n, point = add(point, point)) {
    if (k & 1n) sum = add(sum, point);
  }
  const z = inverse(sum[2]);
  const [x, y] = [mod(sum[0] * z), mod(sum[1] * z)];
  const out = Buffer.from(y.toString(16).padStart(64, "0"), "hex").reverse();
  out[31] |= Number(x & 1n) << 7;
  return out;
}
function soft(xprv, index) {
  const [chain, pub, i] = [xprv.subarray(64), publicKey(xprv.subarray(0, 32)), le32(index)];
  return child(xprv, hmac(chain, Buffer.from([2]), pub, i), hmac(chain, Buffer.from([3]), pub, i));
}
function masterKey(entropy) {
  const master = pbkdf2Sync("", entropy, 4096, 96, "sha512");
  master[0] &= 0xf8;
  master[31] = (master[31] & 0x1f) | 0x40;
  return master;
}
const accountKey = (entropy, account) => [1852, 1815, account].reduce(hardened, masterKey(entropy));

/** Where `secret` is in the module's memory. */
function places(secret) {
  const all = bytes();
  const found = [];
  for (let at = all.indexOf(secret); at !== -1; at = all.indexOf(secret, at + 1)) found.push(at);
  return found;
}

/**
 * Where the object at `cell` keeps `secret`: in its cell, or behind a
 * pointer in it. Not the stack's copies, which no object owns.
 */
function kept(cell, secret) {
  const all = bytes();
  const pointers = [0, 4, 8, 12].map((at) => all.readUInt32LE(cell + at));
  return places(secret).filter((at) => (at >= cell && at < cell + 16) || pointers.includes(at));
}

for (const [name, make, secret] of [
  ["SeedelfKey", () => SeedelfKey.fromHex(SK), montgomery(SK)],
  ["CardanoAccount", () => CardanoAccount.fromEntropy(new Uint8Array(ENTROPY), 0), accountKey(ENTROPY, 0)],
  ["OneTimeAccounts", () => OneTimeAccounts.fromEntropy(new Uint8Array(ENTROPY)), accountKey(ENTROPY, 0x5eed)],
]) {
  test(`${name}.free() overwrites the key where the object kept it`, () => {
    const object = make();
    // The key is there to be seen while the object lives.
    const [at, ...more] = kept(object.__wbg_ptr, secret);
    assert.ok(at !== undefined && more.length === 0, `a live ${name} keeps its key in one place`);
    object.free();
    const after = bytes().subarray(at, at + secret.length);
    // An allocator may write a few bytes of its own over the start; none of the key's stay in a row.
    let longest = 0;
    for (let i = 0, run = 0; i < secret.length; i++) {
      run = after[i] === secret[i] ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    assert.ok(longest < 8, `${longest} bytes in a row of a freed ${name}'s key are still where it kept them`);
  });
}

// The stack: the first mebibyte of the module's memory, growing down from its
// top (rust-lld's layout for wasm32-unknown-unknown), and how much of it the
// scrub overwrites (src/lib.rs, `SCRUB_DEPTH`).
const STACK = 0x100000;
const SCRUB_DEPTH = 512 * 1024;

test("scrubStack() overwrites the stack's top 512 KiB, all of it, and nothing below", () => {
  // No call is running, so nothing lives on the stack: every byte of it is marked.
  new Uint8Array(memory().buffer, 0, STACK).fill(0xa5);
  scrubStack();
  const stack = bytes().subarray(0, STACK);
  const left = stack.subarray(STACK - SCRUB_DEPTH).findIndex((byte) => byte !== 0);
  assert.equal(left, -1, `a byte ${SCRUB_DEPTH - left} below the stack's top wasn't overwritten`);
  // Below the depth, only the scrub's own frame: under 64 bytes of it.
  const below = stack.subarray(0, STACK - SCRUB_DEPTH);
  const written = below.findIndex((byte) => byte !== 0xa5);
  const deeper = written === -1 ? 0 : below.length - written;
  assert.ok(deeper < 64, `the scrub wrote ${deeper} bytes below its depth`);
  new Uint8Array(memory().buffer, 0, STACK).fill(0);
});

// The three objects' keys, by the names the scans below give them.
const SEEDELF = "the Seedelf key as the module holds it";
const ACCOUNT = "the account's key";
const ONE_TIME = "the one-time accounts' key";
// And three the review's runs leave bytes of.
const SEEDELF_BE = "the Seedelf key big-endian";
const STAKE = "the stake key 2/0";
const PAYMENT = "payment key 0/0";

/**
 * A phrase's keys and what an unlock derives them from, each as the module
 * holds it (seedelf-crypto's derivation.rs and cardano.rs), and the entropy
 * the vault keeps of the phrase.
 */
function walletOf(phrase) {
  const entropy = Buffer.from(phraseToEntropy(phrase));
  const seed = pbkdf2Sync(phrase, "mnemonic", 2048, 64, "sha512");
  const info = Buffer.concat([Buffer.from("seedelf-key"), Buffer.alloc(4)]);
  const okm = Buffer.from(hkdfSync("sha256", seed, "seedelf-wallet-v1", info, 64));
  const x = (BigInt(`0x${okm.toString("hex")}`) % R).toString(16).padStart(64, "0");
  const master = masterKey(entropy);
  const [account, oneTime] = [accountKey(entropy, 0), accountKey(entropy, 0x5eed)];
  const secrets = [
    [SEEDELF, montgomery(x)],
    [SEEDELF_BE, Buffer.from(x, "hex")],
    ["the Seedelf key little-endian", Buffer.from(x, "hex").reverse()],
    // All 96 bytes of each, so the key's 64 too.
    [ACCOUNT, account],
    [ONE_TIME, oneTime],
    ["the entropy", entropy],
    ["the BIP39 seed", seed],
    ["the HKDF output", okm],
    ["the master key", master],
    ["the key at 1852'", hardened(master, 1852)],
    ["the key at 1852'/1815'", [1852, 1815].reduce(hardened, master)],
    // What the two account keys derive: a chain's key, then the keys that sign.
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
  // A secret of one byte repeated can't be looked for: the vector phrase's entropy is 16 zero bytes.
  return { entropy, secrets: secrets.filter(([, secret]) => secret.some((byte) => byte !== secret[0])) };
}

/**
 * Every run of `least` bytes or more of one of `secrets` in the module's
 * whole memory, the stack and the heap alike: whose it is, where, and how
 * long.
 */
function found(secrets, least = 8) {
  // Each 4 bytes of each secret, as a number: one pass over the memory finds them all.
  const windows = new Map();
  for (const [name, secret] of secrets) {
    for (let first = 0; first + 4 <= secret.length; first++) {
      const start = secret.readUInt32LE(first);
      if (!windows.has(start)) windows.set(start, []);
      windows.get(start).push([name, secret, first]);
    }
  }
  const all = bytes();
  const runs = new Map();
  for (let at = 0; at + 4 <= all.length; at++) {
    const starting = windows.get(all.readUInt32LE(at));
    if (!starting) continue;
    for (const [name, secret, first] of starting) {
      // The whole run these 4 bytes are part of, both ways.
      let [back, on] = [0, 4];
      while (first - back > 0 && at - back > 0 && all[at - back - 1] === secret[first - back - 1]) back++;
      while (first + on < secret.length && at + on < all.length && all[at + on] === secret[first + on]) on++;
      if (back + on >= least) runs.set(`${name} ${at - back}`, { name, at: at - back, length: back + on });
    }
  }
  return [...runs.values()];
}

/** `found`'s runs in words: each secret once, with where the last of its runs is. */
function said(here) {
  const where = ({ name, at, length }) =>
    `${length} bytes of ${name} ${at < STACK ? "on the stack" : "above the stack"} at 0x${at.toString(16)}`;
  return [...new Map(here.map((run) => [run.name, where(run)])).values()];
}

// Two phrases: the tree's 12-word vector phrase, whose Seedelf the transfer
// fixture's UTxOs are, and a 24-word one of this test's own.
const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const spender = walletOf(
  json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
    (v) => v.account === 0 && v.phrase.split(" ").length === 12,
  ).phrase,
);
const own = walletOf(entropyToPhrase(new Uint8Array(ENTROPY)));

/** An unlock, as the wallet derives its keys (wallet.ts `derive`). */
const unlock = ({ entropy }) => [
  SeedelfKey.fromEntropy(new Uint8Array(entropy), 0),
  CardanoAccount.fromEntropy(new Uint8Array(entropy), 0),
  OneTimeAccounts.fromEntropy(new Uint8Array(entropy)),
];

/** A private payment built and proven: the vector phrase's Seedelf pays a recorded one (transfer.test.mjs). */
function transfer(seedelf) {
  const recorded = json("../../extension/tests/fixtures/transfer-preprod.json");
  const request = {
    network: "preprod",
    params: json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0],
    utxos: json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos.slice(0, 2),
    payments: [{ to: recorded.to, recipient: recorded.recipient, lovelace: recorded.lovelace, tokens: recorded.tokens }],
  };
  assert.match(JSON.parse(buildTransfer(seedelf, JSON.stringify(request))).txCbor, /^[0-9a-f]+$/);
}

/** A private payment, a message started and sent, a scan, an address and a one-time key. */
function use([seedelf, cardano, oneTime]) {
  transfer(seedelf);
  const other = SeedelfKey.random();
  const theirs = other.baseRegister();
  const handle = { generator: theirs.generator, publicValue: theirs.publicValue };
  const started = JSON.parse(messagingStart(seedelf, JSON.stringify({ handle, to: "00", now: 1_800_000_000 })));
  const stamped = JSON.parse(messagingSetStamp(JSON.stringify({ conversation: started.conversation, nonce: 0 })));
  const message = { conversation: stamped.conversation, plaintext: "0168656c6c6f" };
  const sent = JSON.parse(messagingSend(JSON.stringify(message)));
  messagingScan(seedelf, JSON.stringify(Array(50).fill(sent.envelope)));
  cardano.receiveAddress(Network.Preprod, 0);
  oneTime.keyHash(0);
  theirs.free();
  other.free();
}

/** The same key's own register and a stranger's, asked about last: isOwned takes the key by value. */
function ownedLast([seedelf]) {
  const other = SeedelfKey.random();
  const [mine, theirs] = [seedelf.baseRegister(), other.baseRegister()];
  assert.equal(seedelf.isOwned(theirs), false);
  assert.equal(seedelf.isOwned(mine), true);
  for (const object of [mine, theirs, other]) object.free();
}

/** A run, then a lock. `only`: the run's one object's key. `stackKeepsThem`: free() alone leaves copies. */
const runs = [
  // Scrubbed once its keys are derived, as the wallet's unlock is: the last test says why.
  { name: "an unlock and some use", wallet: spender, run: (keys) => (scrubStack(), use(keys)) },
  { name: "a run ending in isOwned", wallet: own, run: (keys) => ownedLast(keys) },
  { name: "an unlock with nothing after it", wallet: own, run: () => undefined, stackKeepsThem: true },
  { name: "SeedelfKey.fromEntropy alone", wallet: own, only: SEEDELF },
];
for (const { name, wallet, run, only, stackKeepsThem } of runs) {
  test(`a lock after ${name} leaves no key anywhere in the module's memory`, () => {
    const keys = only ? [SeedelfKey.fromEntropy(new Uint8Array(wallet.entropy), 0)] : unlock(wallet);
    run?.(keys);
    // Before the lock each object's key is there to be found.
    const before = found(wallet.secrets);
    for (const held of only ? [only] : [SEEDELF, ACCOUNT, ONE_TIME]) {
      assert.ok(before.some((place) => place.name === held), `${held} isn't found while unlocked`);
    }

    for (const key of keys) key.free();
    if (stackKeepsThem) {
      // Without the scrub the stack still holds what the derivations left, which nothing has overwritten.
      const left = found(wallet.secrets);
      assert.ok(left.length > 0, "the lock's free()s left nothing for the scrub to overwrite");
      assert.deepEqual(said(left.filter(({ at }) => at >= STACK)), [], "free() left a key above the stack");
    }
    scrubStack();
    assert.deepEqual(said(found(wallet.secrets)), []);
  });
}

/**
 * In a fresh instance, as a worker that has just started: an unlock, a
 * private payment built at once, and a lock. What is left in the memory then.
 * `scrubbed`: with the scrub the wallet makes once its keys are derived.
 */
function leftAfterTransferAtOnce(scrubbed) {
  __wbg_reset_state();
  const keys = unlock(spender);
  if (scrubbed) scrubStack();
  transfer(keys[0]);
  for (const key of keys) key.free();
  scrubStack();
  return found(spender.secrets);
}

test("a transfer built straight after an unlock copies nothing of the keys' into the heap", () => {
  // Without the scrub after the derivations it does: the transfer builds a
  // value over what they left on the stack and moves it to the heap, 8 bytes
  // of the BIP39 seed in the part it never wrote. The lock's scrub clears the
  // stack, and those stay.
  const copied = leftAfterTransferAtOnce(false);
  assert.ok(copied.length > 0, "the transfer copied nothing for the unlock's scrub to prevent");
  assert.deepEqual(said(copied.filter(({ at }) => at < STACK)), [], "the lock's scrub left a copy on the stack");
  // As the wallet runs it, nothing is left anywhere.
  assert.deepEqual(said(leftAfterTransferAtOnce(true)), []);
});

// A stranger's request to this test's own wallet, as the wallet keeps it: two
// first-contact messages in its requests' record. Made in an instance that is
// then replaced.
const request = (() => {
  const seedelf = SeedelfKey.fromEntropy(new Uint8Array(own.entropy), 0);
  const stranger = SeedelfKey.random();
  const [base, name, now] = [seedelf.baseRegister(), "5eed0e1f" + "b0".repeat(28), 1_800_000_000];
  const register = rerandomize(base);
  const handles = [{ name, registers: [{ generator: register.generator, publicValue: register.publicValue }] }];
  const call = (fn, ...args) => JSON.parse(fn(...args.map((a) => (a?.constructor === Object ? JSON.stringify(a) : a))));
  const started = call(messagingStart, stranger, { handle: handles[0].registers[0], to: name, now });
  const stamped = call(messagingSetStamp, { conversation: started.conversation, nonce: 0 });
  const first = call(messagingSend, { conversation: stamped.conversation, plaintext: "68656c6c6f" });
  const second = call(messagingSend, { conversation: first.conversation, plaintext: "616761696e" });
  const one = call(messagingReceive, seedelf, { envelope: first.envelope, now: now + 60, handles, firstContactBits: 0 });
  const both = { envelope: second.envelope, now: now + 61, handles, firstContactBits: 0, requests: one.requests };
  const { requests } = call(messagingReceive, seedelf, both);
  for (const object of [register, base, stranger, seedelf]) object.free();
  return JSON.stringify({ requests, cid: started.cid });
})();
const requests = JSON.parse(request).requests;

test("the keys looked for are the module's: the stake key's and the account's public keys", () => {
  __wbg_reset_state();
  const [seedelf, cardano, oneTime] = unlock(own);
  const of = new Map(own.secrets);
  assert.equal(cardano.stakePublicKey(), publicKey(of.get(STAKE).subarray(0, 32)).toString("hex"));
  const account = of.get(ACCOUNT);
  const accountPublic = Buffer.concat([publicKey(account.subarray(0, 32)), account.subarray(64)]);
  assert.equal(cardano.accountPublicKey(), accountPublic.toString("hex"));
  for (const key of [seedelf, cardano, oneTime]) key.free();
});

// The review's runs: two calls between an unlock and a lock, the second
// building a value over what the first left on the stack. `left`: the secret
// whose bytes are in the heap after the lock's free()s and scrub, and how many
// of them in a row.
const copying = [
  {
    name: "stakePublicKey, then messagingRequestsInfo",
    calls: ([, cardano]) => [cardano.stakePublicKey(), messagingRequestsInfo(requests)],
    left: [STAKE, 16],
  },
  {
    name: "paymentKeyHash, then messagingRequestsInfo",
    calls: ([, cardano]) => [cardano.paymentKeyHash(0, 0), messagingRequestsInfo(requests)],
    left: [PAYMENT, 8],
  },
  {
    name: "messagingReadRequest twice",
    calls: ([seedelf]) => [messagingReadRequest(seedelf, request), messagingReadRequest(seedelf, request)],
    left: [SEEDELF_BE, 6],
  },
  {
    name: "messagingAccept, then messagingRequestsInfo",
    calls: ([seedelf]) => [messagingAccept(seedelf, request), messagingRequestsInfo(requests)],
    left: [SEEDELF_BE, 4],
  },
];
for (const { name, calls, left: [secret, least] } of copying) {
  test(`${name}: free() and the scrub leave bytes of a key in the heap, and the instance replaced leaves none`, () => {
    // A fresh instance, as it is before anything runs in it.
    __wbg_reset_state();
    const fresh = Buffer.from(new Uint8Array(memory().buffer));
    // Nothing of the wallet's is in it, even 4 bytes: if a constant of the module's ever matches, change ENTROPY.
    assert.deepEqual(said(found(own.secrets, 4)), [], "a fresh instance's memory has 4 bytes of a secret by chance");

    // The wallet's order: the keys derived, a scrub, the calls, the keys freed, a scrub.
    const keys = unlock(own);
    scrubStack();
    calls(keys);
    for (const key of keys) key.free();
    scrubStack();
    const left = found(own.secrets, 4);
    assert.deepEqual(said(left.filter(({ at }) => at < STACK)), [], "the scrub left a copy on the stack");
    const copied = left.filter((run) => run.name === secret && run.length >= least);
    assert.ok(copied.length > 0, `no ${least} bytes of ${secret} above the stack: ${said(left).join("; ") || "nothing"}`);

    // The lock's last step: a fresh instance in its place (wasm.ts `renewWasm`, which zeroes the old one's memory).
    __wbg_reset_state();
    assert.ok(bytes().equals(fresh), "the instance put in place isn't a fresh one's memory");
    assert.deepEqual(said(found(own.secrets, 4)), []);
  });
}
