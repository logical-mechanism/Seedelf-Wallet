// Seedelf Messaging through the built module (chunk 54's 54d, and chunk 55's
// 55d, Messages' own key; run ../build.sh first): the session vectors' first
// messages read at the full first-contact stamp, the relay vectors' stamps
// and posts, the reveal vectors' checks (54f), the certificate vectors'
// checks (55b), certificates made and refused, and two wallets writing to
// each other with nothing but the records the exports give back, as the
// worker will keep them, one showing the other its Seedelf; a writer's share,
// and the records development builds wrote, refused by their version. Each
// wallet has a SeedelfKey x and a MessagingKey x_m: every messaging* export
// takes x_m, and only messagingCertificate takes x beside it, to make the
// certificate a writer starts on. tests/messaging_test.rs checks the same
// natively; messaging-key.test.mjs holds the key's class and derivation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  MessagingKey,
  SeedelfKey,
  messagingAccept,
  messagingCertificate,
  messagingCheckCertificate,
  messagingCheckReveal,
  messagingConstants,
  messagingConversationInfo,
  messagingDelete,
  messagingExpire,
  messagingFindStamp,
  messagingOpen,
  messagingPostBody,
  messagingReadRequest,
  messagingReceive,
  messagingRelayDigest,
  messagingRequestsInfo,
  messagingReveal,
  messagingScan,
  messagingSend,
  messagingSetStamp,
  messagingStart,
  messagingStartContinuing,
  messagingValue,
  messagingWithdrawal,
  rerandomize,
} from "./wasm.mjs";

const vectors = (name) =>
  JSON.parse(readFileSync(new URL(`../../../seedelf-messaging/tests/vectors/${name}`, import.meta.url)));
// A request is JSON text, the key passed as itself.
const call = (fn, ...args) =>
  JSON.parse(fn(...args.map((a) => (a?.constructor === Object || Array.isArray(a) ? JSON.stringify(a) : a))));
const hex = (text) => Buffer.from(text, "utf8").toString("hex");
const text = (h) => Buffer.from(h, "hex").toString("utf8");
const plain = (r) => ({ generator: r.generator, publicValue: r.publicValue });
const T = 1_800_000_000;
const NET = "preprod";

// Variant 1's Seedelf policy, the same on both networks (seedelf-core's
// constants.rs): the only one the bindings read a Seedelf under.
const POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
/** The network the bindings name a vector's chain by, or nothing for a chain they can't read. */
const networkOf = (chain) => (chain?.policy === POLICY ? ["preprod", "mainnet"][chain.network] : undefined);

/**
 * A wallet on `network`: its Seedelf key x and its messaging key x_m, one
 * network's, one Seedelf at a re-randomization of x's root register, and
 * that Seedelf's certificate, as the relay's list gives it to a writer.
 */
function wallet(byte, network = NET) {
  const x = SeedelfKey.random();
  const m = MessagingKey.random(network);
  const base = x.baseRegister();
  const fresh = rerandomize(base);
  const register = plain(fresh);
  base.free();
  fresh.free();
  const name = "5eed0e1f" + byte.repeat(28);
  const { certificate } = call(messagingCertificate, x, m, { network, name, register });
  return {
    x,
    m,
    network,
    name,
    register,
    certificate,
    handles: [{ name, registers: [register] }],
    // What a writer starts with on this Seedelf.
    on: (now = T) => ({ network, name, register, certificate, now }),
    free() {
      x.free();
      m.free();
    },
  };
}

test("the session vectors' first messages read at 24 bits, then accepted", () => {
  const session = vectors("messaging_session_v1.json").sessions[0];
  const network = networkOf(session.seedelf);
  assert.ok(network, `the session vectors' Seedelf is under a chain the bindings can't read: ${JSON.stringify(session.seedelf)}`);
  const bob = MessagingKey.fromHex(session.responder_secret_key, network);
  const handles = [
    {
      name: session.to,
      registers: [{ generator: session.seedelf.generator, publicValue: session.seedelf.public_value }],
    },
  ];
  let requests;
  const arrivals = [];
  for (const event of session.events.slice(2, 4)) {
    const { at, delivers, plaintext } = event.receive;
    const envelope = session.events[delivers].send.envelope;
    const opened = call(messagingOpen, bob, envelope);
    assert.deepEqual(opened, {
      cid: opened.cid,
      kind: "first-contact",
      t: session.t,
      to: session.to,
      replaces: null,
    });
    const answer = call(messagingReceive, bob, { network, envelope, now: at, handles, requests });
    assert.equal(answer.received.kind, "request");
    assert.equal(answer.received.plaintext, plaintext);
    assert.equal(answer.received.new, requests === undefined);
    assert.equal(answer.conversation, undefined);
    requests = answer.requests;
    arrivals.push(at);
  }
  const [request] = call(messagingRequestsInfo, requests);
  assert.deepEqual(request.arrivals, arrivals);
  assert.equal(request.to, session.to);
  const shown = call(messagingReadRequest, bob, { requests, cid: request.cid });
  assert.deepEqual(
    shown.messages.map((m) => m.at),
    arrivals,
  );
  const accepted = call(messagingAccept, bob, { requests, cid: request.cid });
  assert.deepEqual(call(messagingRequestsInfo, accepted.requests), []);
  assert.equal(accepted.continues, null);
  const info = call(messagingConversationInfo, accepted.conversation);
  assert.equal(info.role, "responder");
  assert.equal(info.sendsFirstContact, false);
  bob.free();
});

test("the vectors' stamps are found in slices, and a post is its nonce and envelope", () => {
  const { sessions } = vectors("messaging_session_v1.json");
  for (const { stamp } of sessions) {
    const find = (from, attempts) => call(messagingFindStamp, { digest: stamp.digest, bits: 24, from, attempts });
    assert.deepEqual(find(stamp.nonce - 2000, 2001), { nonce: stamp.nonce });
    assert.deepEqual(find(stamp.nonce - 2000, 2000), { nonce: null });
  }
  const relay = vectors("messaging_relay_v1.json");
  for (const stamp of relay.stamps) {
    const { envelope } = relay.posts.find((post) => post.name === stamp.envelope);
    const digest = messagingRelayDigest(stamp.pool, envelope);
    assert.equal(digest, stamp.digest);
    const found = call(messagingFindStamp, { digest, bits: stamp.bits, from: Math.max(0, stamp.nonce - 300), attempts: 301 });
    assert.deepEqual(found, { nonce: stamp.nonce });
    const body = messagingPostBody(JSON.stringify({ nonce: stamp.nonce, envelope }));
    assert.ok(body instanceof Uint8Array);
    assert.equal(Buffer.from(body.subarray(0, 8)).toString("hex"), stamp.post);
    assert.equal(Buffer.from(body.subarray(8)).toString("hex"), envelope);
  }
  assert.deepEqual(call(messagingFindStamp, { digest: relay.stamps[0].digest, bits: 33, from: 0, attempts: 1 }), {
    refused: "stamp_too_hard",
  });
  assert.throws(() => messagingFindStamp(JSON.stringify({ digest: "00", bits: 8, from: 0, attempts: 1 })), /32 bytes/);
});

test("two wallets write to each other through the exports' records", () => {
  const alice = wallet("a0");
  const bob = wallet("b0");
  const { name, register: seedelf, handles } = bob;

  // A start on Bob's certificate, then its stamp in slices.
  const started = call(messagingStart, alice.m, bob.on());
  assert.equal(typeof messagingStart(alice.m, JSON.stringify(bob.on())), "string");
  assert.deepEqual(call(messagingSend, { conversation: started.conversation, plaintext: hex("soon") }), {
    refused: "unstamped",
  });
  let nonce = null;
  for (let from = 0; nonce === null; from += 1024) {
    ({ nonce } = call(messagingFindStamp, { digest: started.digest, bits: 8, from, attempts: 1024 }));
  }
  const stamped = call(messagingSetStamp, { conversation: started.conversation, nonce });
  assert.ok(stamped.bits >= 8);
  const sent = call(messagingSend, { conversation: stamped.conversation, plaintext: hex("hello Bob") });
  assert.equal(sent.envelope.length, 2 * 2048);
  let a = sent.conversation;

  // Bob's scan, his opening, then the rules: the stamp, the handle, the proof.
  const noise = call(messagingSend, {
    conversation: call(messagingSetStamp, {
      conversation: call(messagingStart, bob.m, alice.on()).conversation,
      nonce: 0,
    }).conversation,
    plaintext: hex("to Alice"),
  }).envelope;
  // The scan's answer is a digit an envelope, not JSON: as long as the batch, whatever matched.
  const batch = JSON.stringify([noise, sent.envelope, noise]);
  assert.equal(messagingScan(bob.m, batch), "010");
  assert.equal(messagingScan(alice.m, batch), "101");
  assert.equal(messagingScan(bob.m, "[]"), "");
  assert.throws(() => messagingScan(bob.m, JSON.stringify(["zz"])), /hex/);
  // The Seedelf keys aren't the class the scan takes.
  assert.throws(() => messagingScan(bob.x, batch), /expected instance of MessagingKey/);
  const opened = call(messagingOpen, bob.m, sent.envelope);
  assert.deepEqual(opened, { cid: started.cid, kind: "first-contact", t: T, to: name, replaces: null });
  const take = (request) => call(messagingReceive, bob.m, { network: NET, envelope: sent.envelope, now: T + 60, ...request });
  if (stamped.bits < 24) assert.deepEqual(take({ handles }), { refused: "stamp_too_low" });
  assert.deepEqual(take({ firstContactBits: 8 }), { refused: "unknown_handle" });
  assert.deepEqual(take({ handles: alice.handles.map((h) => ({ ...h, name })), firstContactBits: 8 }), {
    refused: "invalid_base_proof",
  });
  const request = take({ handles, firstContactBits: 8 });
  assert.equal(text(request.received.plaintext), "hello Bob");
  assert.deepEqual(request.received.evicted, []);

  // Bob replies; Alice reads it with her record; then session messages.
  const accepted = call(messagingAccept, bob.m, { requests: request.requests, cid: started.cid });
  const reply = call(messagingSend, { conversation: accepted.conversation, plaintext: hex("hello Alice") });
  let b = reply.conversation;
  assert.equal(call(messagingOpen, alice.m, reply.envelope).kind, "session");
  const got = call(messagingReceive, alice.m, { network: NET, envelope: reply.envelope, now: T + 120, conversations: [a] });
  assert.equal(got.received.kind, "message");
  assert.equal(text(got.received.plaintext), "hello Alice");
  a = got.conversation;
  assert.equal(call(messagingConversationInfo, a).sendsFirstContact, false);
  const one = call(messagingSend, { conversation: a, plaintext: hex("one") });
  a = one.conversation;
  const read = call(messagingReceive, bob.m, { network: NET, envelope: one.envelope, now: T + 180, conversations: [b] });
  assert.equal(text(read.received.plaintext), "one");
  assert.deepEqual(
    call(messagingReceive, bob.m, { network: NET, envelope: one.envelope, now: T + 181, conversations: [read.conversation] }),
    { refused: "key_used_or_deleted" },
  );
  b = read.conversation;

  // Alice shows Bob her Seedelf, now that he has replied: a message of kind 0x02, which only Bob checks.
  const reveal = (key, conversation, of, certificate = of.certificate) =>
    call(messagingReveal, key, { network: NET, conversation, name: of.name, register: of.register, certificate });
  assert.deepEqual(reveal(alice.m, stamped.conversation, alice), { refused: "reveal_not_allowed" });
  assert.deepEqual(reveal(bob.m, b, bob), { refused: "reveal_not_allowed" });
  assert.deepEqual(reveal(bob.m, a, bob), { refused: "not_for_this_key" });
  assert.deepEqual(reveal(bob.m, a, alice), { refused: "not_for_this_key" });
  assert.throws(() => reveal(alice.x, a, alice), /expected instance of MessagingKey/);
  // She can't show Bob's Seedelf: his certificate names his m_S, and hers names another register.
  assert.deepEqual(reveal(alice.m, a, bob), { refused: "not_for_this_key" });
  assert.deepEqual(reveal(alice.m, a, bob, alice.certificate), { refused: "invalid_certificate" });
  assert.throws(() => reveal(alice.m, a, alice, "zz"), /hex/);
  // A reveal's request names a certificate, and the key's own network.
  const { certificate: _, ...bare } = { network: NET, conversation: a, name: alice.name, register: alice.register, certificate: "" };
  assert.throws(() => messagingReveal(alice.m, JSON.stringify(bare)), /certificate/);
  assert.throws(
    () => messagingReveal(alice.m, JSON.stringify({ ...bare, network: "mainnet", certificate: alice.certificate })),
    /this messaging key is preprod's/,
  );
  const shown = reveal(alice.m, a, alice);
  assert.equal(shown.reveal.length, 2 * 305);
  const carried = call(messagingSend, { conversation: a, plaintext: "02" + shown.reveal });
  // Padded to its first-contact size, as every message is, a reveal is 2 KiB like any short message.
  assert.equal(carried.envelope.length, 2 * 2048);
  a = carried.conversation;
  const came = call(messagingReceive, bob.m, { network: NET, envelope: carried.envelope, now: T + 190, conversations: [b] });
  assert.equal(came.received.plaintext, "02" + shown.reveal);
  b = came.conversation;
  // It names the m_S Alice's certificate names: what Bob's press holds it to, with the chain's register.
  const { messaging } = call(messagingCheckCertificate, { network: NET, certificate: alice.certificate });
  const check = (conversation, reveal, network = NET) => call(messagingCheckReveal, { network, conversation, reveal });
  assert.deepEqual(check(b, shown.reveal), { name: alice.name, register: alice.register, messaging });
  assert.deepEqual(check(a, shown.reveal), { refused: "reveal_not_allowed" });
  assert.deepEqual(check(b, shown.reveal.slice(0, -2)), { refused: "invalid_message" });
  assert.deepEqual(check(b, shown.reveal, "mainnet"), { refused: "invalid_reveal" });
  assert.throws(() => messagingCheckReveal(JSON.stringify({ network: NET, conversation: b, reveal: "zz" })), /hex/);

  // A continuation Bob verifies against the conversation it continues.
  const continued = call(messagingStartContinuing, alice.m, { conversation: a, now: T + 3600 });
  const fresh = call(messagingSend, {
    conversation: call(messagingSetStamp, { conversation: continued.conversation, nonce: 0 }).conversation,
    plaintext: hex("again"),
  }).envelope;
  const joined = call(messagingReceive, bob.m, {
    network: NET,
    envelope: fresh,
    now: T + 3660,
    conversations: [b],
    firstContactBits: 0,
  });
  const [info] = call(messagingRequestsInfo, joined.requests);
  assert.deepEqual(info.continues, { cid: started.cid, verified: true });

  // Bob deletes the conversation: a tombstone, kept past the window's 48 hours for a margin of 7 days, then gone.
  const deleted = call(messagingDelete, { cid: started.cid, conversation: b });
  assert.equal(deleted.deleted, true);
  const two = call(messagingSend, { conversation: a, plaintext: hex("two") }).envelope;
  const after = (tombstones) => call(messagingReceive, bob.m, { network: NET, envelope: two, now: T + 200, tombstones });
  assert.deepEqual(after(deleted.tombstones), { refused: "deleted" });
  const expire = (now) => call(messagingExpire, { now, tombstones: deleted.tombstones });
  assert.equal(expire(T + 48 * 3600 + 1).tombstones, deleted.tombstones);
  const { tombstones } = expire(T + (48 + 7 * 24) * 3600 + 1);
  assert.deepEqual(after(tombstones), { refused: "unknown_conversation" });
  alice.free();
  bob.free();
});

test("a certificate round trip, and what it refuses", () => {
  const alice = wallet("a0");
  const bob = wallet("b0");
  const { certificate } = alice;
  assert.match(certificate, /^[0-9a-f]{608}$/);
  // Checked with no key: what it names.
  const checked = call(messagingCheckCertificate, { network: NET, certificate });
  assert.deepEqual(Object.keys(checked), ["name", "register", "messaging"]);
  assert.deepEqual([checked.name, checked.register], [alice.name, alice.register]);
  assert.match(checked.messaging, /^[0-9a-f]{96}$/);
  // Made again: other bytes, the same m_S.
  const again = call(messagingCertificate, alice.x, alice.m, { network: NET, name: alice.name, register: alice.register });
  assert.notEqual(again.certificate, certificate);
  assert.deepEqual(call(messagingCheckCertificate, { network: NET, certificate: again.certificate }), checked);
  // Under the other network it doesn't check. One made there takes that network's key, and names another m_S.
  assert.deepEqual(call(messagingCheckCertificate, { network: "mainnet", certificate }), { refused: "invalid_certificate" });
  const mainnet = MessagingKey.random("mainnet");
  const request = { name: alice.name, register: alice.register };
  assert.throws(
    () => messagingCertificate(alice.x, alice.m, JSON.stringify({ network: "mainnet", ...request })),
    /this messaging key is preprod's/,
  );
  assert.throws(
    () => messagingCertificate(alice.x, mainnet, JSON.stringify({ network: NET, ...request })),
    /this messaging key is mainnet's/,
  );
  const there = call(messagingCertificate, alice.x, mainnet, { network: "mainnet", ...request });
  const named = call(messagingCheckCertificate, { network: "mainnet", certificate: there.certificate });
  assert.deepEqual([named.name, named.register], [alice.name, alice.register]);
  assert.notEqual(named.messaging, checked.messaging);
  assert.deepEqual(call(messagingCheckCertificate, { network: NET, certificate: there.certificate }), { refused: "invalid_certificate" });
  mainnet.free();
  // Changed in its last byte, or cut.
  const last = (parseInt(certificate.slice(-2), 16) ^ 1).toString(16).padStart(2, "0");
  assert.deepEqual(call(messagingCheckCertificate, { network: NET, certificate: certificate.slice(0, -2) + last }), {
    refused: "invalid_certificate",
  });
  assert.deepEqual(call(messagingCheckCertificate, { network: NET, certificate: certificate.slice(0, -2) }), {
    refused: "invalid_certificate",
  });
  assert.throws(() => messagingCheckCertificate(JSON.stringify({ network: NET, certificate: "zz" })), /hex/);

  // One key for both: same_key. A register that isn't x's: not_owned, x_m given as x included.
  const make = (x, m, register = alice.register) => call(messagingCertificate, x, m, { network: NET, name: alice.name, register });
  const sk = "1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff1";
  const [asSeedelf, asMessaging] = [SeedelfKey.fromHex(sk), MessagingKey.fromHex(sk, NET)];
  const own = plain(asSeedelf.baseRegister());
  assert.deepEqual(make(asSeedelf, asMessaging, own), { refused: "same_key" });
  assert.deepEqual(make(alice.x, alice.m, bob.register), { refused: "not_owned" });
  assert.deepEqual(make(asSeedelf, alice.m, alice.register), { refused: "not_owned" });
  // A network the wallet has no chain for throws, as a request that doesn't read does.
  for (const network of ["preview", "Preprod", "", 0]) {
    assert.throws(() => messagingCertificate(alice.x, alice.m, JSON.stringify({ network, name: alice.name, register: alice.register })));
    assert.throws(() => messagingCheckCertificate(JSON.stringify({ network, certificate })));
    assert.throws(() => messagingStart(bob.m, JSON.stringify({ ...alice.on(), network })));
  }
  assert.throws(() => messagingCheckCertificate(JSON.stringify({ certificate })), /network/);
  // The two keys go in their order: each class is checked.
  assert.throws(() => messagingCertificate(alice.m, alice.x, JSON.stringify(alice.on())), /expected instance of SeedelfKey/);
  assert.throws(() => messagingCertificate(alice.x, alice.x, JSON.stringify(alice.on())), /expected instance of MessagingKey/);
  asSeedelf.free();
  asMessaging.free();
  alice.free();
  bob.free();
});

test("a start takes only a certificate for the chain read's Seedelf, under its network", () => {
  const alice = wallet("a0");
  const bob = wallet("b0");
  const other = wallet("cc");
  const start = (request) => call(messagingStart, alice.m, request);
  assert.equal(typeof start(bob.on()).cid, "string");
  // Bob's Seedelf moved: the chain read gives a new register, his certificate names the old one.
  const base = bob.x.baseRegister();
  const moved = plain(rerandomize(base));
  base.free();
  assert.deepEqual(start({ ...bob.on(), register: moved }), { refused: "invalid_certificate" });
  const renewed = call(messagingCertificate, bob.x, bob.m, { network: NET, name: bob.name, register: moved });
  assert.equal(typeof start({ ...bob.on(), register: moved, certificate: renewed.certificate }).cid, "string");
  // Another Seedelf's certificate, another name, the other network's certificate or network.
  assert.deepEqual(start({ ...bob.on(), certificate: other.certificate }), { refused: "invalid_certificate" });
  assert.deepEqual(start({ ...bob.on(), name: other.name }), { refused: "invalid_certificate" });
  const [bobThere, aliceThere] = [MessagingKey.random("mainnet"), MessagingKey.random("mainnet")];
  const there = call(messagingCertificate, bob.x, bobThere, { network: "mainnet", name: bob.name, register: bob.register });
  assert.deepEqual(start({ ...bob.on(), certificate: there.certificate }), { refused: "invalid_certificate" });
  // Alice's preprod key writes on preprod alone; her mainnet key takes only mainnet's certificate.
  assert.throws(() => messagingStart(alice.m, JSON.stringify({ ...bob.on(), network: "mainnet" })), /this messaging key is preprod's/);
  const startThere = (request) => call(messagingStart, aliceThere, { ...request, network: "mainnet" });
  assert.deepEqual(startThere(bob.on()), { refused: "invalid_certificate" });
  assert.equal(typeof startThere({ ...bob.on(), certificate: there.certificate }).cid, "string");
  bobThere.free();
  aliceThere.free();
  // Without a certificate, a start doesn't read.
  const { certificate, ...bare } = bob.on();
  assert.ok(certificate);
  assert.throws(() => messagingStart(alice.m, JSON.stringify(bare)), /certificate/);
  for (const wallet of [alice, bob, other]) wallet.free();
});

test("the reveal vectors' checks come out the same through messagingCheckReveal", () => {
  const file = vectors("messaging_reveal_v1.json");
  let asked = 0;
  for (const check of file.checks) {
    const network = networkOf(check);
    // A check under another policy can't be asked of the bindings: the crate's tests hold those.
    if (!network) continue;
    const c = file.conversations[check.conversation];
    const conversation = check.side === "initiator" ? c.initiator_state : c.responder_state;
    const answer = call(messagingCheckReveal, { network, conversation, reveal: check.reveal });
    if (check.result === "ok") assert.equal(typeof answer.name, "string", check.name);
    else assert.deepEqual(answer, { refused: check.result }, check.name);
    asked++;
  }
  assert.ok(asked > 0, "the reveal vectors' checks are under no chain the bindings read");
  for (const r of file.reveals) {
    const network = networkOf(r.seedelf);
    assert.ok(network, `the reveal vectors' Seedelf is under a chain the bindings can't read: ${r.name}`);
    const { responder_state: conversation } = file.conversations[r.conversation];
    assert.deepEqual(call(messagingCheckReveal, { network, conversation, reveal: r.reveal }), {
      name: r.seedelf.name,
      register: { generator: r.seedelf.generator, publicValue: r.seedelf.public_value },
      messaging: r.seedelf.messaging_value,
    });
  }
});

test("the certificate vectors check through messagingCheckCertificate, and a writer starts on each", () => {
  const file = vectors("messaging_certificate_v1.json");
  assert.deepEqual(file.networks, { preprod: 0, mainnet: 1 });
  const seen = new Set();
  for (const c of file.certificates) {
    const network = networkOf(c);
    assert.ok(network, `${c.name}: under a chain the bindings can't read`);
    seen.add(network);
    const register = { generator: c.seedelf.generator, publicValue: c.seedelf.public_value };
    assert.deepEqual(call(messagingCheckCertificate, { network, certificate: c.certificate }), {
      name: c.seedelf.name,
      register,
      messaging: c.messaging_value,
    });
    const other = network === "preprod" ? "mainnet" : "preprod";
    assert.deepEqual(call(messagingCheckCertificate, { network: other, certificate: c.certificate }), {
      refused: "invalid_certificate",
    });
    const writer = MessagingKey.random(network);
    const started = call(messagingStart, writer, { network, name: c.seedelf.name, register, certificate: c.certificate, now: T });
    assert.equal(typeof started.cid, "string");
    writer.free();
  }
  assert.equal(seen.size, 2);
  const results = new Set();
  for (const r of file.refusals) {
    const network = networkOf(r);
    if (!network) continue;
    const answer = call(messagingCheckCertificate, { network, certificate: r.certificate });
    assert.equal(answer.refused ?? "ok", r.result, r.name);
    results.add(r.result);
  }
  for (const code of ["ok", "invalid_certificate", "invalid_encoding", "not_in_subgroup", "identity_point", "unsupported_version"]) {
    assert.ok(results.has(code), `no refusal vector gives ${code}`);
  }
});

/** Alice writes first to Bob's Seedelf and Bob replies, on their network: each side's record then. */
function answered(alice, bob) {
  const { network } = alice;
  const started = call(messagingStart, alice.m, bob.on());
  const stamped = call(messagingSetStamp, { conversation: started.conversation, nonce: 0 });
  const first = call(messagingSend, { conversation: stamped.conversation, plaintext: hex("hello") });
  const now = T + 60;
  const request = call(messagingReceive, bob.m, { network, envelope: first.envelope, now, handles: bob.handles, firstContactBits: 0 });
  const accepted = call(messagingAccept, bob.m, { requests: request.requests, cid: started.cid });
  const reply = call(messagingSend, { conversation: accepted.conversation, plaintext: hex("hi") });
  const read = call(messagingReceive, alice.m, { network, envelope: reply.envelope, now: T + 120, conversations: [first.conversation] });
  return [read.conversation, reply.conversation];
}

test("a reveal made and checked under one network is refused under the other", () => {
  for (const [network, other] of [["preprod", "mainnet"], ["mainnet", "preprod"]]) {
    const alice = wallet("a0", network);
    const bob = wallet("b0", network);
    const [a, b] = answered(alice, bob);
    const request = { network, conversation: a, name: alice.name, register: alice.register, certificate: alice.certificate };
    const { reveal } = call(messagingReveal, alice.m, request);
    const { messaging } = call(messagingValue, alice.m, { network, name: alice.name, register: alice.register });
    assert.deepEqual(call(messagingCheckReveal, { network, conversation: b, reveal }), {
      name: alice.name,
      register: alice.register,
      messaging,
    });
    assert.deepEqual(call(messagingCheckReveal, { network: other, conversation: b, reveal }), { refused: "invalid_reveal" });
    // The key makes no reveal under the other network.
    assert.throws(() => messagingReveal(alice.m, JSON.stringify({ ...request, network: other })), /this messaging key is/);
    alice.free();
    bob.free();
  }
});

test("messagingValue is the wallet's own m_S, from the messaging key alone", () => {
  const alice = wallet("a0");
  const bob = wallet("b0");
  const value = (key, of, register = of.register, network = NET) =>
    call(messagingValue, key, { network, name: of.name, register });
  const own = value(alice.m, alice);
  assert.deepEqual(Object.keys(own), ["messaging"]);
  // What her own certificate for that register names, and not Bob's.
  const named = (certificate, network = NET) => call(messagingCheckCertificate, { network, certificate }).messaging;
  assert.equal(own.messaging, named(alice.certificate));
  assert.notEqual(own.messaging, named(bob.certificate));
  assert.notEqual(value(bob.m, alice).messaging, own.messaging);
  // Another register, after a move: another, which the certificate for it names.
  const base = alice.x.baseRegister();
  const moved = plain(rerandomize(base));
  base.free();
  const after = value(alice.m, alice, moved);
  assert.notEqual(after.messaging, own.messaging);
  const renewed = call(messagingCertificate, alice.x, alice.m, { network: NET, name: alice.name, register: moved });
  assert.equal(after.messaging, named(renewed.certificate));
  // The other network's key, on its own network: another, its own certificate's.
  const there = MessagingKey.random("mainnet");
  const elsewhere = value(there, alice, alice.register, "mainnet");
  assert.notEqual(elsewhere.messaging, own.messaging);
  const thereCertificate = call(messagingCertificate, alice.x, there, { network: "mainnet", name: alice.name, register: alice.register });
  assert.equal(elsewhere.messaging, named(thereCertificate.certificate, "mainnet"));
  // A key gives no value under the other network.
  assert.throws(() => value(alice.m, alice, alice.register, "mainnet"), /this messaging key is preprod's/);
  assert.throws(() => value(there, alice), /this messaging key is mainnet's/);
  // What isn't a Seedelf: its code; a network that isn't one throws.
  assert.deepEqual(value(alice.m, alice, { ...alice.register, publicValue: "c0" + "00".repeat(47) }), { refused: "identity_point" });
  assert.deepEqual(call(messagingValue, alice.m, { network: NET, name: "", register: alice.register }), { refused: "invalid_message" });
  assert.throws(() => messagingValue(alice.m, JSON.stringify({ network: "preview", name: alice.name, register: alice.register })));
  assert.throws(() => messagingValue(alice.x, "{}"), /expected instance of MessagingKey/);
  there.free();
  alice.free();
  bob.free();
});

/** SHA-256 of `label ‖ len(pool) ‖ pool ‖ bytes`, by node, not the module: a listing's or a withdrawal's stamp digest. */
const stampDigest = (label, pool, bytes) =>
  createHash("sha256")
    .update(Buffer.concat([Buffer.from(label), Buffer.from([pool.length]), Buffer.from(pool), Buffer.from(bytes, "hex")]))
    .digest("hex");

test("a withdrawal takes down the wallet's own certificate only, with its messaging key", () => {
  for (const network of ["preprod", "mainnet"]) {
    const alice = wallet("a0", network);
    const bob = wallet("b0", network);
    const withdraw = (key, certificate) => call(messagingWithdrawal, key, { network, certificate });
    const made = withdraw(alice.m, alice.certificate);
    assert.deepEqual(Object.keys(made), ["withdrawal", "digest"]);
    // 98 bytes: version 1, the network's byte, the certificate's listing digest under the pool's name, then c and z.
    assert.match(made.withdrawal, /^[0-9a-f]{196}$/);
    assert.equal(made.withdrawal.slice(0, 4), network === "preprod" ? "0100" : "0101");
    assert.equal(made.withdrawal.slice(4, 68), stampDigest("Seedelf-Messaging|v1|listing-stamp|", network, alice.certificate));
    // What its post's stamp is solved over.
    assert.equal(made.digest, stampDigest("Seedelf-Messaging|v1|unlisting-stamp|", network, made.withdrawal));
    // Made again: another aux, another proof, the same certificate named.
    const again = withdraw(alice.m, alice.certificate);
    assert.notEqual(again.withdrawal, made.withdrawal);
    assert.equal(again.withdrawal.slice(0, 68), made.withdrawal.slice(0, 68));
    // Not the key's: another wallet's certificate, and her own Seedelf certified under another messaging key.
    assert.deepEqual(withdraw(alice.m, bob.certificate), { refused: "not_for_this_key" });
    const stranger = MessagingKey.random(network);
    const another = call(messagingCertificate, alice.x, stranger, { network, name: alice.name, register: alice.register });
    assert.deepEqual(withdraw(alice.m, another.certificate), { refused: "not_for_this_key" });
    assert.equal(typeof withdraw(stranger, another.certificate).withdrawal, "string");
    // A certificate that doesn't check: its code.
    const flip = (hex, at) => hex.slice(0, 2 * at) + (parseInt(hex.slice(2 * at, 2 * at + 2), 16) ^ 1).toString(16).padStart(2, "0") + hex.slice(2 * at + 2);
    const { certificate } = alice;
    assert.deepEqual(withdraw(alice.m, flip(certificate, certificate.length / 2 - 1)), { refused: "invalid_certificate" });
    assert.deepEqual(withdraw(alice.m, flip(certificate, 0)), { refused: "unsupported_version" });
    assert.deepEqual(withdraw(alice.m, certificate.slice(0, -2)), { refused: "invalid_certificate" });
    const identity = certificate.slice(0, certificate.length - 2 * (96 + 48)) + "c0" + "00".repeat(47) + certificate.slice(-2 * 96);
    assert.deepEqual(withdraw(alice.m, identity), { refused: "identity_point" });
    assert.throws(() => messagingWithdrawal(alice.m, JSON.stringify({ network, certificate: "zz" })), /hex/);
    // The other network: its key throws, and its chain doesn't read this certificate.
    const other = network === "preprod" ? "mainnet" : "preprod";
    assert.throws(
      () => messagingWithdrawal(alice.m, JSON.stringify({ network: other, certificate })),
      new RegExp(`this messaging key is ${network}'s, and the request is for \`${other}\``),
    );
    const elsewhere = MessagingKey.random(other);
    assert.deepEqual(call(messagingWithdrawal, elsewhere, { network: other, certificate }), { refused: "invalid_certificate" });
    // The Seedelf key is no messaging key.
    assert.throws(() => messagingWithdrawal(alice.x, JSON.stringify({ network, certificate })), /expected instance of MessagingKey/);
    for (const object of [stranger, elsewhere]) object.free();
    alice.free();
    bob.free();
  }
});

test("the certificate vectors' withdrawals are made again through messagingWithdrawal", () => {
  const file = vectors("messaging_certificate_v1.json");
  assert.equal(file.unlisting_stamp_label, "Seedelf-Messaging|v1|unlisting-stamp|");
  const pools = new Set();
  for (const w of file.withdrawals) {
    const c = file.certificates[w.certificate];
    const network = networkOf({ network: w.network, policy: c.policy });
    assert.equal(network, w.pool, w.name);
    pools.add(network);
    assert.equal(w.digest, stampDigest("Seedelf-Messaging|v1|listing-stamp|", network, c.certificate));
    assert.equal(w.unlisting_digest, stampDigest("Seedelf-Messaging|v1|unlisting-stamp|", network, w.withdrawal));
    // The module draws its own aux: the proof is other bytes, what comes before it the vector's.
    const key = MessagingKey.fromHex(w.messaging_secret_key, network);
    const made = call(messagingWithdrawal, key, { network, certificate: c.certificate });
    assert.notEqual(made.withdrawal, w.withdrawal);
    assert.equal(made.withdrawal.slice(0, 68), w.withdrawal.slice(0, 68), w.name);
    assert.equal(made.digest, stampDigest("Seedelf-Messaging|v1|unlisting-stamp|", network, made.withdrawal));
    key.free();
  }
  assert.equal(pools.size, 2);
});

test("the numbers the worker works by", () => {
  assert.deepEqual(JSON.parse(messagingConstants()), {
    firstContactStampBits: 24,
    maxStampBits: 32,
    envelopeSizes: [512, 2048, 8192, 32768],
    firstContactMaxAge: 172_800,
    firstContactMaxAhead: 3600,
    skippedKeyLifetime: 172_800,
    maxRequests: 50,
    maxRequestBytes: 262_144,
    maxRequestMessages: 16,
    maxOneRequestBytes: 65_536,
    maxAuthSteps: 4096,
    priceCeilingBits: 26,
    requestsVersion: 2,
  });
});

test("a writer's share: what's left of it, then request_full", { timeout: 120_000 }, () => {
  const alice = wallet("a0");
  const bob = wallet("b0");
  const started = call(messagingStart, alice.m, bob.on());
  let conversation = call(messagingSetStamp, { conversation: started.conversation, nonce: 0 }).conversation;
  // F to a 32-byte name is 522 bytes; each first-contact message takes 97 more beside its text.
  const perMessage = 522 + 97;
  assert.deepEqual(call(messagingConversationInfo, conversation).firstContactLeft, {
    messages: 16,
    bytes: 65_536,
    perMessage,
  });
  for (let i = 0; i < 16; i++) {
    conversation = call(messagingSend, { conversation, plaintext: hex(`message ${i}`) }).conversation;
  }
  const info = call(messagingConversationInfo, conversation);
  assert.equal(info.firstContactLeft.messages, 0);
  assert.equal(info.maxTextLen, 0);
  assert.deepEqual(call(messagingSend, { conversation, plaintext: hex("one too many") }), { refused: "request_full" });
  alice.free();
  bob.free();
});

test("the records development builds wrote are refused by their version", { timeout: 60_000 }, () => {
  const old = JSON.parse(
    readFileSync(new URL("../../../seedelf-messaging/tests/fixtures/old_records_v1.json", import.meta.url)),
  );
  const bob = MessagingKey.random(NET);
  const cid = "00".repeat(16);
  // A requests' record: refused, never thrown, by each export that reads one.
  const requests = old.requests_two_requests_three_messages;
  const refusal = { refused: "unsupported_state_version", version: 1 };
  assert.deepEqual(call(messagingRequestsInfo, requests), refusal);
  assert.deepEqual(call(messagingAccept, bob, { requests, cid }), refusal);
  assert.deepEqual(call(messagingReadRequest, bob, { requests, cid }), refusal);
  assert.deepEqual(call(messagingDelete, { cid, requests }), refusal);
  assert.deepEqual(call(messagingReceive, bob, { network: NET, envelope: "01".repeat(512), now: T, requests }), refusal);
  assert.deepEqual(call(messagingRequestsInfo, "02"), { refused: "invalid_state" });
  // A conversation's: messagingDelete takes it as absent; the others throw.
  const deleted = call(messagingDelete, { cid, conversation: old.initiator_answered });
  assert.equal(deleted.deleted, false);
  assert.throws(() => messagingConversationInfo(old.initiator_answered), /version 1/);
  bob.free();
});
