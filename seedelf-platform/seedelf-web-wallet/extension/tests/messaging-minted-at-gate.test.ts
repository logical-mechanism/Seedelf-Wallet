// `mintedAt.<network>` is the one record Messages and the money flows both write: a mint's submit puts the register it
// minted under there (`rememberRegister`, mint.ts) and a Remove takes one out (`forgetRegisters`, withdraw.ts), through
// the plain store, at once; Messages lifts a removal's mark and adopts a pair through its gated store, which waits at
// the gate while a lane runs or a tick is near. A write of the money flows' made while Messages waits for its READ must
// hold: the gated read is made after the gate, never before it (messaging.ts `admitted`: gate, then prepare; 1.10.0's
// second review, the wallet-regressions lens's finding 1 and the worker-rule lens's F5). Before, Messages read the
// record, waited, then changed and wrote back the copy from before the wait, and the mint's pair or the Remove's mark
// was gone. What this doesn't hold: Messages' write waits at the gate too, so a lane or a tick's margin that begins
// between its read and its write, with a mint or a Remove sent in that moment, can still write over it (the merged
// diff's finding 3: a window of milliseconds a tick, left for a read-change-write in one admitted call).
import { describe, expect, it } from "vitest";

import { MessagingService } from "../src/background/messaging";
import { clearRemoved, forgetRegisters, mintedAt, rememberRegister } from "../src/background/minted-by";
import type { PrivateStore } from "../src/background/private-store";
import type { NetworkName } from "../src/networks";
import { fakeRelay } from "./fake-relay";
import { loadTestWasm, testBalances } from "./fakes";

const PASSWORD = "correct horse battery";
const A = { generator: "a".repeat(96), publicValue: "b".repeat(96) };
const NEW = { generator: "c".repeat(96), publicValue: "d".repeat(96) };
const turns = () => new Promise<void>((done) => setTimeout(done, 20));

/** What the test reaches of the service: its lanes' marks, and the store its own writes go through. */
interface Inside {
  laneStart(network: NetworkName): void;
  laneEnd(network: NetworkName): void;
  gatedStore: PrivateStore;
}

async function setup() {
  const t = testBalances();
  await t.wallet.create(loadTestWasm().generatePhrase(), PASSWORD);
  const relay = fakeRelay(t.clock);
  const messaging = new MessagingService({
    wasm: loadTestWasm(),
    wallet: t.wallet,
    store: t.store,
    local: t.local,
    session: t.session,
    preferences: t.preferences,
    relay: (n) => relay.client(n),
    ownSeedelfs: async () => undefined,
    seedelfRegister: async () => {
      throw new Error("none");
    },
    revealedRegisters: async () => () => undefined,
    networks: ["preprod", "mainnet"],
    now: () => t.clock.now,
    wait: async () => undefined,
  });
  return { t, inside: messaging as unknown as Inside };
}

describe("mintedAt: Messages' write, held at its gate, against a money flow's write made meanwhile", () => {
  it("keeps a mint's pair written while Messages waited", async () => {
    const { t, inside } = await setup();
    // A Seedelf removed here earlier: its mark, which the user's own turn-on in Messages lifts (`clearRemoved`).
    await forgetRegisters(t.store, "preprod", "5eed01");
    // A lane is running: Messages' calls wait at the gate.
    inside.laneStart("preprod");
    let lifted = false;
    const lifting = clearRemoved(inside.gatedStore, "preprod", "5eed01").then(() => (lifted = true));
    await turns();
    expect(lifted).toBe(false);
    // Meanwhile the user's mint is submitted, through the plain store.
    await rememberRegister(t.store, "preprod", "5eed02", NEW);
    expect(await mintedAt(t.store, "preprod")).toEqual({ "5eed01": [], "5eed02": [NEW] });
    // The lane ends, and Messages' write is made over what the mint left.
    inside.laneEnd("preprod");
    await lifting;
    const after = await mintedAt(t.store, "preprod");
    expect(after["5eed02"], "the mint's pair").toEqual([NEW]);
    expect(after["5eed01"], "the removal's mark, lifted").toBeUndefined();
  });

  it("keeps a Remove's mark written while Messages waited", async () => {
    const { t, inside } = await setup();
    await rememberRegister(t.store, "preprod", "5eed03", A);
    await forgetRegisters(t.store, "preprod", "5eed01");
    inside.laneStart("preprod");
    let lifted = false;
    const lifting = clearRemoved(inside.gatedStore, "preprod", "5eed01").then(() => (lifted = true));
    await turns();
    expect(lifted).toBe(false);
    // The user removes Seedelf 5eed03, through the plain store.
    await forgetRegisters(t.store, "preprod", "5eed03");
    expect(await mintedAt(t.store, "preprod")).toEqual({ "5eed01": [], "5eed03": [] });
    inside.laneEnd("preprod");
    await lifting;
    const after = await mintedAt(t.store, "preprod");
    expect(after["5eed03"], "the removed Seedelf takes no first messages").toEqual([]);
    expect(after["5eed01"], "the other removal's mark, lifted").toBeUndefined();
  });
});
