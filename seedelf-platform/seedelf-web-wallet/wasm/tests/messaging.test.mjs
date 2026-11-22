// Seedelf Messaging through the built module (chunk 54's 54d; run ../build.sh
// first): the session vectors' first messages read at the full first-contact
// stamp, the relay vectors' stamps and posts, the reveal vectors' checks
// (54f), and two wallets writing to each other with nothing but the records
// the exports give back, as the worker will keep them, one showing the other
// its Seedelf. tests/messaging_test.rs checks the same natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SeedelfKey,
  messagingAccept,
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
  rerandomize,
} from "./wasm.mjs";

const vectors = (name) =>
  JSON.parse(readFileSync(new URL(`../../../seedelf-messaging/tests/vectors/${name}`, import.meta.url)));
// A request is JSON text, the key passed as itself.
const call = (fn, ...args) =>
  JSON.parse(fn(...args.map((a) => (a?.constructor === Object || Array.isArray(a) ? JSON.stringify(a) : a))));
const hex = (text) => Buffer.from(text, "utf8").toString("hex");
const text = (h) => Buffer.from(h, "hex").toString("utf8");
const T = 1_800_000_000;

test("the session vectors' first messages read at 24 bits, then accepted", () => {
  const session = vectors("messaging_session_v1.json").sessions[0];
  const bob = SeedelfKey.fromHex(session.responder_secret_key);
  const handles = [
    {
      name: session.to,
      registers: [{ generator: session.handle.generator, publicValue: session.handle.public_value }],
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
    const answer = call(messagingReceive, bob, { envelope, now: at, handles, requests });
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
  const alice = SeedelfKey.random();
  const bob = SeedelfKey.random();
  const plain = (r) => ({ generator: r.generator, publicValue: r.publicValue });
  const seedelf = plain(rerandomize(bob.baseRegister()));
  const name = "5eed0e1f" + "b0".repeat(28);
  const handles = [{ name, registers: [seedelf] }];

  // A start, then its stamp in slices.
  const started = call(messagingStart, alice, { handle: seedelf, to: name, now: T });
  assert.equal(typeof messagingStart(alice, JSON.stringify({ handle: seedelf, to: name, now: T })), "string");
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
      conversation: call(messagingStart, bob, { handle: plain(alice.baseRegister()), to: "61", now: T }).conversation,
      nonce: 0,
    }).conversation,
    plaintext: hex("to Alice"),
  }).envelope;
  assert.deepEqual(call(messagingScan, bob, [noise, sent.envelope, noise]), [1]);
  assert.deepEqual(call(messagingScan, alice, [noise, sent.envelope, noise]), [0, 2]);
  assert.throws(() => messagingScan(bob, JSON.stringify(["zz"])), /hex/);
  const opened = call(messagingOpen, bob, sent.envelope);
  assert.deepEqual(opened, { cid: started.cid, kind: "first-contact", t: T, to: name, replaces: null });
  const take = (request) => call(messagingReceive, bob, { envelope: sent.envelope, now: T + 60, ...request });
  if (stamped.bits < 24) assert.deepEqual(take({ handles }), { refused: "stamp_too_low" });
  assert.deepEqual(take({ firstContactBits: 8 }), { refused: "unknown_handle" });
  const request = take({ handles, firstContactBits: 8 });
  assert.equal(text(request.received.plaintext), "hello Bob");
  assert.deepEqual(request.received.evicted, []);

  // Bob replies; Alice reads it with her record; then session messages.
  const accepted = call(messagingAccept, bob, { requests: request.requests, cid: started.cid });
  const reply = call(messagingSend, { conversation: accepted.conversation, plaintext: hex("hello Alice") });
  let b = reply.conversation;
  assert.equal(call(messagingOpen, alice, reply.envelope).kind, "session");
  const got = call(messagingReceive, alice, { envelope: reply.envelope, now: T + 120, conversations: [a] });
  assert.equal(got.received.kind, "message");
  assert.equal(text(got.received.plaintext), "hello Alice");
  a = got.conversation;
  assert.equal(call(messagingConversationInfo, a).sendsFirstContact, false);
  const one = call(messagingSend, { conversation: a, plaintext: hex("one") });
  a = one.conversation;
  const read = call(messagingReceive, bob, { envelope: one.envelope, now: T + 180, conversations: [b] });
  assert.equal(text(read.received.plaintext), "one");
  assert.deepEqual(call(messagingReceive, bob, { envelope: one.envelope, now: T + 181, conversations: [read.conversation] }), {
    refused: "key_used_or_deleted",
  });
  b = read.conversation;

  // Alice shows Bob her Seedelf, now that he has replied: a message of kind 0x02, which only Bob checks.
  const mine = plain(rerandomize(alice.baseRegister()));
  const hers = "5eed0e1f" + "a0".repeat(28);
  const reveal = (key, conversation, seedelfName, register) =>
    call(messagingReveal, key, { conversation, name: seedelfName, register });
  assert.deepEqual(reveal(alice, stamped.conversation, hers, mine), { refused: "reveal_not_allowed" });
  assert.deepEqual(reveal(bob, b, name, seedelf), { refused: "reveal_not_allowed" });
  assert.deepEqual(reveal(alice, a, name, seedelf), { refused: "not_for_this_key" });
  const shown = reveal(alice, a, hers, mine);
  assert.equal(shown.reveal.length, 2 * 257);
  const carried = call(messagingSend, { conversation: a, plaintext: "02" + shown.reveal });
  assert.equal(carried.envelope.length, 2 * 2048);
  a = carried.conversation;
  const came = call(messagingReceive, bob, { envelope: carried.envelope, now: T + 190, conversations: [b] });
  assert.equal(came.received.plaintext, "02" + shown.reveal);
  b = came.conversation;
  assert.deepEqual(call(messagingCheckReveal, { conversation: b, reveal: shown.reveal }), { name: hers, register: mine });
  assert.deepEqual(call(messagingCheckReveal, { conversation: a, reveal: shown.reveal }), { refused: "reveal_not_allowed" });
  assert.deepEqual(call(messagingCheckReveal, { conversation: b, reveal: shown.reveal.slice(0, -2) }), {
    refused: "invalid_message",
  });
  assert.throws(() => messagingCheckReveal(JSON.stringify({ conversation: b, reveal: "zz" })), /hex/);

  // A continuation Bob verifies against the conversation it continues.
  const continued = call(messagingStartContinuing, alice, { conversation: a, now: T + 3600 });
  const fresh = call(messagingSend, {
    conversation: call(messagingSetStamp, { conversation: continued.conversation, nonce: 0 }).conversation,
    plaintext: hex("again"),
  }).envelope;
  const joined = call(messagingReceive, bob, { envelope: fresh, now: T + 3660, conversations: [b], firstContactBits: 0 });
  const [info] = call(messagingRequestsInfo, joined.requests);
  assert.deepEqual(info.continues, { cid: started.cid, verified: true });

  // Bob deletes the conversation: a tombstone, then gone after its 48 hours.
  const deleted = call(messagingDelete, { cid: started.cid, conversation: b });
  assert.equal(deleted.deleted, true);
  const two = call(messagingSend, { conversation: a, plaintext: hex("two") }).envelope;
  const after = (tombstones) => call(messagingReceive, bob, { envelope: two, now: T + 200, tombstones });
  assert.deepEqual(after(deleted.tombstones), { refused: "deleted" });
  const { tombstones } = call(messagingExpire, { now: T + 48 * 3600 + 1, tombstones: deleted.tombstones });
  assert.deepEqual(after(tombstones), { refused: "unknown_conversation" });
  alice.free();
  bob.free();
});

test("the reveal vectors' checks come out the same through messagingCheckReveal", () => {
  const file = vectors("messaging_reveal_v1.json");
  for (const check of file.checks) {
    const c = file.conversations[check.conversation];
    const conversation = check.side === "initiator" ? c.initiator_state : c.responder_state;
    const answer = call(messagingCheckReveal, { conversation, reveal: check.reveal });
    if (check.result === "ok") assert.equal(typeof answer.name, "string", check.name);
    else assert.deepEqual(answer, { refused: check.result }, check.name);
  }
  for (const r of file.reveals) {
    const { responder_state: conversation } = file.conversations[r.conversation];
    assert.deepEqual(call(messagingCheckReveal, { conversation, reveal: r.reveal }), {
      name: r.seedelf.name,
      register: { generator: r.seedelf.generator, publicValue: r.seedelf.public_value },
    });
  }
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
  });
});
