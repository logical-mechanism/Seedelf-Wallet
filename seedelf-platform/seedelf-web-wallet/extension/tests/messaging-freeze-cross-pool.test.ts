// The §20 freeze review's item 6 (the 1.10.0 gate; ported from the verifiers' verify2-freeze-cross-pool.test.ts). No
// label names the network (protocol.md §20). Under 1.10.0's one key, a Seedelf's key was one on every network, so an
// envelope copied from one pool into the other was the other network's reader's to scan and open, and only what it
// named refused it there. Since chunk 55 Messages' key is each network's own (protocol.md §21.2, wallet.ts
// `Keys.messaging`), and a Seedelf's messaging register is on a base hashed with its network (§21.3): an envelope
// copied from preprod's pool into mainnet's isn't even the mainnet reader's to open. Shown here: a first contact and a
// session message copied from preprod to mainnet are scanned there and matched by nothing, opened by nothing, kept and
// shown by nothing; and with the copied name made one of mainnet's handles too, at the same register, a copied first
// contact is still nothing there. On its own network each is what it was.
import { describe, expect, it } from "vitest";

import { rememberRegister } from "../src/background/minted-by";
import { BOB_SEEDELF, loadTestWasm, pair, requestsOf, synced, texts } from "./messaging-harness";

const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");

interface InboxView {
  conversations: Record<string, unknown>;
  requestsShown: Record<string, unknown>;
  requests?: string;
  handles: Record<string, unknown>;
}

describe("an envelope copied to the other network's pool (the freeze review, item 6)", { timeout: 60_000 }, () => {
  it("is matched by nothing there, each network's messaging key its own: never opened, kept or shown, a handle of that name there too", async () => {
    const { relay, alice, bob } = await pair();
    // Bob's receive answers: each refusal by its code.
    const refused: string[] = [];
    const wasm = loadTestWasm();
    bob.restart({
      ...wasm,
      messagingReceive: (key, request) => {
        const out = wasm.messagingReceive(key, request);
        const read = JSON.parse(String(out)) as { refused?: string };
        if (read.refused) refused.push(read.refused);
        return out;
      },
    });
    await bob.messaging.switch("mainnet", true);
    await bob.messaging.whenIdle();
    const preprod = () => relay.pools.get("preprod")!.held;
    const mainnetInbox = async () => (await bob.store.get<InboxView>("messaging.mainnet"))!;
    const calls = () => bob.trace.filter((t) => ["scan", "open", "receive"].includes(t));

    // 1. A first contact on preprod, its envelope copied into mainnet's pool.
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    expect(preprod()).toHaveLength(1);
    relay.put("mainnet", hexOf(preprod()[0]!.bytes));
    const preprodBefore = await bob.store.get("messaging.preprod");
    bob.trace.length = 0;
    await synced(bob, "mainnet");
    // Scanned with mainnet's key, which isn't the one it's sealed to: nothing opened, nothing received.
    expect(calls()).toEqual(["scan"]);
    expect(refused).toEqual([]);
    let overview = await bob.messaging.overview("mainnet");
    expect(overview.requests).toEqual([]);
    expect(overview.conversations).toEqual([]);
    const inbox = await mainnetInbox();
    expect(inbox.conversations).toEqual({});
    expect(inbox.requestsShown).toEqual({});
    expect((await requestsOf(bob, "mainnet"))?.requests).toBeUndefined();
    expect(inbox.handles).toEqual({});
    expect(await bob.store.get("messaging.preprod")).toEqual(preprodBefore);
    // On its own network the same bytes are a request.
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toMatchObject([{ cid, messages: 1 }]);

    // 2. A session message, once they talk, copied the same way.
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    await synced(alice);
    await alice.messaging.send("preprod", cid, "a session message");
    await alice.messaging.whenIdle();
    relay.put("mainnet", hexOf(preprod().at(-1)!.bytes));
    refused.length = 0;
    bob.trace.length = 0;
    await synced(bob, "mainnet");
    expect(calls()).toEqual(["scan"]);
    expect(refused).toEqual([]);
    overview = await bob.messaging.overview("mainnet");
    expect(overview.requests).toEqual([]);
    expect(overview.conversations).toEqual([]);
    await synced(bob);
    expect(await texts(bob, cid)).toContain("in:a session message");

    // 3. Not the name, now: made a mainnet handle too, at the register Bob's preprod Seedelf holds (which no Seedelf's
    // name can be on two chains), a copied first contact is still nothing at mainnet, and a request at preprod.
    await rememberRegister(bob.store, "mainnet", BOB_SEEDELF, bob.own[0]!.register);
    const again = await alice.messaging.start("preprod", BOB_SEEDELF, "hello again");
    await alice.messaging.whenIdle();
    relay.put("mainnet", hexOf(preprod().at(-1)!.bytes));
    refused.length = 0;
    bob.trace.length = 0;
    await synced(bob, "mainnet");
    expect(calls()).toEqual(["scan"]);
    expect(refused).toEqual([]);
    expect((await bob.messaging.overview("mainnet")).requests).toEqual([]);
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toMatchObject([{ cid: again, messages: 1 }]);
  });
});
