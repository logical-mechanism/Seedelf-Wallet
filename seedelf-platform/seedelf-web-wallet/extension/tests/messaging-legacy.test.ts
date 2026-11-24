// A conversation as builds before the 1.10.0 gate kept it, met by this
// build's first unlock (the gate's f7: confirmed, no migration). Those builds
// wrote the inbox `messaging.<network>` as v 1, its conversations keyed by cid
// with no record ID, and each conversation's record as
// `conversation.<network>.<cid>`, v 1. No released build had Messages (it's
// absent at web-wallet/1.9.3), and this build's crate refuses that state at
// its first byte: the first unlock's sweep deletes such a conversation with
// its record, locally, and the unlock asks the relay what a wallet without it
// asks. The state here is a real one of that tree's crate: seedelf-messaging's
// fixture old_records_v1.json, version 1.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { conversationRecord, PRIVATE_PREFIX } from "../src/background/private-store";
import { clock, fakeRelay, PASSWORD, party, type Party } from "./messaging-harness";

const OLD = JSON.parse(readFileSync(new URL("../../../seedelf-messaging/tests/fixtures/old_records_v1.json", import.meta.url), "utf8")) as Record<
  string,
  string
>;
/** An answered conversation's crate state as the tree at 3ab5bf9f wrote it: version 1, the initiator's. */
const STATE = OLD.initiator_answered!;
// Its F, after the version, the role and F's length (2 bytes): cid (16) | t (8, s) | to's length (1) | to | ...
const F = STATE.slice(8);
const CID = F.slice(0, 32);
const T_MS = Number(BigInt("0x" + F.slice(32, 48))) * 1000;
const TO = F.slice(50, 50 + 2 * parseInt(F.slice(48, 50), 16));

const SENT = "hello, from a build before the gate";
const GOT = "and its answer";

/** 3ab5bf9f messaging.ts:324 `storedBytes`: what a record took as that build counted it. */
function storedBytes(jsonLength: number): number {
  let size = 1024;
  while (size < jsonLength) size *= 2;
  return Math.ceil(((size + 16) * 4) / 3);
}

/** The conversation's record as a build before the gate wrote it (3ab5bf9f messaging.ts:191-204): v 1, hex. */
const legacyRecord = () => ({
  v: 1,
  state: STATE,
  history: [
    { id: 0, dir: "out", at: T_MS, text: SENT, sent: "posted", expires: T_MS + 36 * 3600_000 },
    { id: 1, dir: "in", at: T_MS + 60_000, text: GOT },
  ],
  next: 2,
  trimmed: 0,
});

/** That build's inbox (3ab5bf9f messaging.ts:110-183): v 1, the conversation by its cid, no record ID, `lost`. */
const legacyInbox = () => ({
  v: 1,
  handles: {},
  conversations: {
    [CID]: {
      role: "initiator",
      handle: TO,
      startedAt: T_MS,
      lastAt: T_MS + 60_000,
      unread: 0,
      outbox: 0,
      bytes: storedBytes(JSON.stringify(legacyRecord()).length),
      oldestAt: T_MS,
      answered: true,
      last: { dir: "in", text: GOT },
    },
  },
  requestsUnread: {},
  expiredAt: T_MS,
  lost: {},
});

/** A wallet whose browser ran a build before the gate: preprod's Messages `on` or off, and, if `legacy`, that conversation. */
async function before(on: boolean, legacy = true): Promise<{ relay: ReturnType<typeof fakeRelay>; alice: Party }> {
  const relay = fakeRelay(clock);
  const alice = await party(12, relay, new Map());
  await alice.preferences.set({ messaging: { preprod: on, mainnet: false } });
  if (legacy) {
    // The record before the inbox that lists it, as that build wrote them.
    await alice.store.set(conversationRecord("preprod", CID), legacyRecord());
    await alice.store.set("messaging.preprod", legacyInbox());
  }
  // The update: a new worker over the same storage, the wallet locked.
  alice.restart();
  await alice.wallet.lock();
  return { relay, alice };
}

/** The unlock after it, as sw.ts runs it: the unlock, then `syncAll` over the build's networks. */
async function unlock(alice: Party): Promise<void> {
  await alice.wallet.unlock(PASSWORD);
  await alice.messaging.syncAll(["preprod", "mainnet"]);
  await alice.messaging.whenIdle();
}

/** Every conversation record `p` holds on preprod. */
const held = async (p: Party) => p.local.keys(PRIVATE_PREFIX + "conversation.preprod.");

/** Whether any storage key of `p`'s names the conversation (W7: none may). */
const cidInAKey = async (p: Party) => (await p.local.keys("")).some((key) => key.includes(CID));

describe("a conversation a build before the 1.10.0 gate kept, at this build's first unlock (f7)", { timeout: 120_000 }, () => {
  it("is listed before any sync: the inbox v 1 reads as this build's", async () => {
    const { alice } = await before(true);
    await alice.wallet.unlock(PASSWORD);
    expect((await alice.messaging.overview("preprod")).conversations).toMatchObject([{ cid: CID, role: "initiator" }]);
    expect(await held(alice)).toEqual([PRIVATE_PREFIX + `conversation.preprod.${CID}`]);
  });

  it("is deleted with its record at the first unlock's sync, which asks the relay what a wallet without it asks", async () => {
    const control = await before(true, false);
    await unlock(control.alice);
    const { relay, alice } = await before(true);
    await unlock(alice);
    // THE RULE: what the sweep does with it is local.
    expect(relay.calls).toEqual(control.relay.calls);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    expect(await held(alice)).toEqual([]);
    expect(await cidInAKey(alice)).toBe(false);
  });

  it("is deleted where that network's Messages are off too: the unlock's tidy, which asks nothing", async () => {
    const { relay, alice } = await before(false);
    await unlock(alice);
    expect(relay.calls).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    expect(await held(alice)).toEqual([]);
  });

  it("leaves no listed conversation without its record where the worker stops before any write of that first unlock, and the next unlock finishes", async () => {
    for (let k = 0; k < 24; k++) {
      const { alice } = await before(true);
      await alice.wallet.unlock(PASSWORD);
      let writes = 0;
      let stopped = false;
      alice.beforeWrite = () => {
        if (writes++ === k) {
          stopped = true;
          throw new Error("the worker stopped");
        }
      };
      await alice.messaging.syncAll(["preprod", "mainnet"]).catch(() => undefined);
      await alice.messaging.whenIdle().catch(() => undefined);
      alice.beforeWrite = undefined;
      // Another worker, and the next unlock.
      alice.restart();
      await alice.wallet.lock();
      await unlock(alice);
      const at = `stopped before write ${k}`;
      expect((await alice.messaging.overview("preprod")).conversations, at).toEqual([]);
      expect(await held(alice), at).toEqual([]);
      expect(await cidInAKey(alice), at).toBe(false);
      if (!stopped) break;
    }
  });
});
