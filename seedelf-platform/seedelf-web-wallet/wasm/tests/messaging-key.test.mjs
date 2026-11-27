// Messages' own key through the built module (chunk 55's 55d; run ../build.sh
// first): MessagingKey derives seedelf-crypto's frozen-to-be x_m vectors on
// both networks, never the Seedelf key, and it's a class of its own. It's
// one network's, named strictly when it's made and kept: every call whose
// request names a network throws for the other (protocol.md §21.2). It has
// none of the funds methods, every messaging* export that takes a key takes
// it and no other class (wasm-bindgen checks the class before anything is
// read), and messagingCertificate alone takes the Seedelf key beside it
// (protocol.md §21.6, joint-security.md rule 8). messaging_test.rs checks the
// derivation natively against the crate's own m_S.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as wasm from "./wasm.mjs";

const {
  MessagingKey,
  SeedelfKey,
  buildTransfer,
  lovejoinOwned,
  messagingCertificate,
  messagingCheckCertificate,
  messagingValue,
  phraseToEntropy,
} = wasm;

const call = (fn, ...args) =>
  JSON.parse(fn(...args.map((a) => (a?.constructor === Object ? JSON.stringify(a) : a))));
const plain = (r) => ({ generator: r.generator, publicValue: r.publicValue });
const NAME = "5eed0e1f" + "4d".repeat(28);
const NETWORKS = ["preprod", "mainnet"];

const { spec, vectors } = JSON.parse(
  readFileSync(new URL("../../../seedelf-crypto/tests/vectors/seedelf_messaging_key_v1.json", import.meta.url)),
);

/**
 * The m_S a certificate made with `x` and `m` names, for x's root register
 * under `network`: the m_S `messagingValue` gives `m` too.
 */
function named(x, m, network) {
  const base = x.baseRegister();
  const register = plain(base);
  base.free();
  const { certificate } = call(messagingCertificate, x, m, { network, name: NAME, register });
  const { messaging } = call(messagingCheckCertificate, { network, certificate });
  assert.deepEqual(call(messagingValue, m, { network, name: NAME, register }), { messaging });
  return messaging;
}

test("MessagingKey is the vectors' x_m on both networks, from the phrase and its entropy", () => {
  assert.equal(spec, "seedelf-messaging-key-v1");
  assert.equal(vectors.length, 22);
  const counted = [0, 0];
  // MessagingKey derives generation 0, v1's only one.
  for (const v of vectors.filter((v) => v.generation === 0)) {
    const network = NETWORKS[v.network];
    const entropy = phraseToEntropy(v.phrase);
    const x = SeedelfKey.fromEntropy(entropy, v.account);
    const vector = MessagingKey.fromHex(v.x_m, network);
    const want = named(x, vector, network);
    const keys = [
      MessagingKey.fromEntropy(entropy, v.account, network),
      MessagingKey.fromPhrase(v.phrase, v.account, network),
      // Case and extra whitespace are ignored, as for the Seedelf key.
      MessagingKey.fromPhrase(`  ${v.phrase.toUpperCase().split(" ").join("   ")}\n`, v.account, network),
    ];
    for (const key of keys) {
      assert.equal(key.network, network);
      assert.equal(named(x, key, network), want, `${v.phrase} / ${v.account} / ${network}`);
    }
    // G1^x_m is the vector's public value, and never the Seedelf key's: a
    // certificate took the two as two keys, and x_m given as both is same_key.
    const asSeedelf = SeedelfKey.fromHex(v.x_m);
    const [mine, theirs] = [asSeedelf.baseRegister(), x.baseRegister()];
    assert.equal(mine.publicValue, v.public_value);
    assert.notEqual(mine.publicValue, theirs.publicValue);
    assert.deepEqual(
      call(messagingCertificate, asSeedelf, keys[0], { network, name: NAME, register: plain(mine) }),
      { refused: "same_key" },
    );
    // The other network's key is another: on that network, its m_S isn't this x_m's.
    const other = NETWORKS[1 - v.network];
    const elsewhere = MessagingKey.fromEntropy(entropy, v.account, other);
    const thisOnThere = MessagingKey.fromHex(v.x_m, other);
    assert.equal(elsewhere.network, other);
    assert.notEqual(named(x, elsewhere, other), named(x, thisOnThere, other));
    for (const object of [x, vector, asSeedelf, mine, theirs, elsewhere, thisOnThere, ...keys]) object.free();
    counted[v.network]++;
  }
  // Every phrase of seedelf_key_v1.json on each network, and account 1 once, on preprod.
  assert.deepEqual(counted, [8, 7]);
});

test("MessagingKey refuses what isn't a phrase, an entropy or a network, and says its network", () => {
  const [v] = vectors;
  const entropy = phraseToEntropy(v.phrase);
  const hex = v.x_m;
  assert.throws(() => MessagingKey.fromPhrase(v.phrase.replace(/ art$/, " abandon"), 0, "preprod"), /checksum/);
  assert.throws(() => MessagingKey.fromEntropy(entropy.subarray(0, 15), 0, "preprod"));
  assert.throws(() => MessagingKey.fromHex("00".repeat(32), "preprod"), /zero/);
  assert.throws(() => MessagingKey.fromHex("01".repeat(31), "preprod"), /32 bytes/);
  // The network is a name, strictly: nothing else falls back to one, the old enum's numbers included.
  const constructors = {
    fromEntropy: (network) => MessagingKey.fromEntropy(entropy, 0, network),
    fromPhrase: (network) => MessagingKey.fromPhrase(v.phrase, 0, network),
    random: (network) => MessagingKey.random(network),
    fromHex: (network) => MessagingKey.fromHex(hex, network),
  };
  for (const [name, make] of Object.entries(constructors)) {
    for (const network of [undefined, null, "Mainnet", "PREPROD", "preview", "", " mainnet", 0, 1, 2]) {
      assert.throws(() => make(network), undefined, `${name}(${JSON.stringify(network)})`);
    }
    assert.throws(() => make("Mainnet"), /`preprod` or `mainnet`, not `Mainnet`/, name);
    assert.throws(() => make(), name);
    for (const network of NETWORKS) {
      const key = make(network);
      assert.equal(key.network, network, `${name}(${network})`);
      key.free();
    }
  }
  // The getter reads; there's nothing to set (a module is strict, so the write throws).
  const key = MessagingKey.random("mainnet");
  assert.throws(() => {
    key.network = "preprod";
  }, TypeError);
  assert.equal(key.network, "mainnet");
  key.free();
});

test("a call whose request names the other network than the key's throws, either way", () => {
  const x = SeedelfKey.random();
  const base = x.baseRegister();
  const register = plain(base);
  base.free();
  const request = (network) => ({
    receive: { network, envelope: "00", now: 1 },
    start: { network, name: "61", register, certificate: "00", now: 1 },
    reveal: { network, conversation: "00", name: "61", register, certificate: "00" },
    certificate: { network, name: "61", register },
    value: { network, name: "61", register },
    withdrawal: { network, certificate: "00" },
  });
  const calls = {
    messagingReceive: (key, network) => wasm.messagingReceive(key, JSON.stringify(request(network).receive)),
    messagingStart: (key, network) => wasm.messagingStart(key, JSON.stringify(request(network).start)),
    messagingReveal: (key, network) => wasm.messagingReveal(key, JSON.stringify(request(network).reveal)),
    messagingCertificate: (key, network) => messagingCertificate(x, key, JSON.stringify(request(network).certificate)),
    messagingValue: (key, network) => messagingValue(key, JSON.stringify(request(network).value)),
    messagingWithdrawal: (key, network) => wasm.messagingWithdrawal(key, JSON.stringify(request(network).withdrawal)),
  };
  for (const [keyNetwork, other] of [["preprod", "mainnet"], ["mainnet", "preprod"]]) {
    const key = MessagingKey.random(keyNetwork);
    const mismatch = new RegExp(`this messaging key is ${keyNetwork}'s, and the request is for \`${other}\``);
    for (const [name, run] of Object.entries(calls)) {
      assert.throws(() => run(key, other), mismatch, `${name}: a ${keyNetwork} key, a ${other} request`);
      // Its own network passes that check: whatever comes of the rest isn't the network's.
      try {
        run(key, keyNetwork);
      } catch (error) {
        assert.doesNotMatch(String(error), /this messaging key is/, name);
      }
    }
    key.free();
  }
  x.free();
});

test("a MessagingKey has none of the funds methods, and only messagingCertificate takes both classes", () => {
  const m = MessagingKey.random("preprod");
  const x = SeedelfKey.random();
  for (const method of ["isOwned", "createProof", "baseRegister"]) {
    assert.equal(method in m, false, `MessagingKey has ${method}`);
    assert.equal(typeof x[method], "function", `SeedelfKey lost ${method}`);
  }
  // Its prototype: free and the network's getter, beside the glue's own, nothing else.
  const own = Object.getOwnPropertyNames(MessagingKey.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(own.filter((name) => !name.startsWith("__")).sort(), ["free", "network"]);
  assert.equal(typeof Object.getOwnPropertyDescriptor(MessagingKey.prototype, "network").get, "function");
  assert.equal(Object.getOwnPropertyDescriptor(MessagingKey.prototype, "network").set, undefined);
  // Its statics: the four constructors.
  const statics = Object.getOwnPropertyNames(MessagingKey).filter((name) => typeof MessagingKey[name] === "function");
  assert.deepEqual(statics.filter((name) => !name.startsWith("__")).sort(), ["fromEntropy", "fromHex", "fromPhrase", "random"]);

  // Every messaging* export the module has that takes a key, by its declaration.
  const declared = readFileSync(new URL("../pkg/seedelf_wasm.d.ts", import.meta.url), "utf8");
  const takes = {};
  for (const [, name, params] of declared.matchAll(/^export function (messaging\w+)\(([^)]*)\)/gm)) {
    takes[name] = [...params.matchAll(/\w+: (SeedelfKey|MessagingKey)\b/g)].map(([, type]) => type);
  }
  const keyed = Object.entries(takes).filter(([, types]) => types.length > 0);
  assert.deepEqual(Object.fromEntries(keyed), {
    messagingAccept: ["MessagingKey"],
    messagingCertificate: ["SeedelfKey", "MessagingKey"],
    messagingOpen: ["MessagingKey"],
    messagingReadRequest: ["MessagingKey"],
    messagingReceive: ["MessagingKey"],
    messagingReveal: ["MessagingKey"],
    messagingScan: ["MessagingKey"],
    messagingStart: ["MessagingKey"],
    messagingStartContinuing: ["MessagingKey"],
    messagingValue: ["MessagingKey"],
    messagingWithdrawal: ["MessagingKey"],
  });
  // A SeedelfKey where the MessagingKey goes throws at the call, before the request is read.
  for (const [name, types] of keyed) {
    assert.throws(() => wasm[name](...types.map(() => x), "not json"), /expected instance of MessagingKey/, name);
  }
  assert.throws(() => messagingCertificate(m, m, "{}"), /expected instance of SeedelfKey/);
  assert.throws(() => messagingCertificate(x, x, "{}"), /expected instance of MessagingKey/);
  assert.throws(() => messagingCertificate(m, x, "{}"), /expected instance of SeedelfKey/);
  // And the funds exports take no MessagingKey.
  assert.throws(() => buildTransfer(m, "{}"), /expected instance of SeedelfKey/);
  assert.throws(() => lovejoinOwned(m, "{}"), /expected instance of SeedelfKey/);
  // A plain object shaped like one is no key either.
  assert.throws(() => wasm.messagingScan({ __wbg_ptr: m.__wbg_ptr }, "[]"), /expected instance of MessagingKey/);
  // After free(), the object is spent: the glue passes a null pointer, and Rust refuses it.
  const spent = MessagingKey.random("preprod");
  spent.free();
  assert.throws(() => wasm.messagingScan(spent, "[]"));
  x.free();
  m.free();
});
