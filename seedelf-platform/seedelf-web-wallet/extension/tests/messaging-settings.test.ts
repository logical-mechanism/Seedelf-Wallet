// Messages' switches and what the worker does around them (the 1.10.0 gate's
// W6): the settings written one at a time, a switch asked while locked that
// changes nothing, what only a sync cleaned up cleaned up for a network whose
// switch is off too, and the other network's switch said and turned off from
// this one's page.
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import type { Inbox } from "../src/background/messaging";
import { LOCAL_PREFERENCES, PreferencesService } from "../src/background/preferences";
import { conversationRecord, PRIVATE_PREFIX } from "../src/background/private-store";
import type { Area } from "../src/background/storage";
import type { MessagingOverview } from "../src/shared/rpc";
import { memoryArea } from "./fakes";
import { ALICE_SEEDELF, BOB_SEEDELF, busyFor, clock, fakeRelay, pair, party, PASSWORD, synced, talking, turns } from "./messaging-harness";

describe("Messages' switches (W6)", { timeout: 30_000 }, () => {
  it("writes the settings one at a time: a write that raced a switch turned off never turns it back on (worker-net#9)", async () => {
    // The settings' storage, its next read held until the test lets it go: a write caught between its read and its write.
    const local = memoryArea();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let holdNext = false;
    const held: Area = {
      ...local,
      async get<T>(key: string) {
        const value = await local.get<T>(key);
        if (key === LOCAL_PREFERENCES && holdNext) {
          holdNext = false;
          await gate;
        }
        return value;
      },
    };
    // Two services over one storage, as the worker makes them (sw.ts): one for the requests, one for Chrome's events.
    const requests = new PreferencesService(held);
    const events = new PreferencesService(held);
    await requests.set({ messaging: { preprod: true } as never });
    holdNext = true;
    // Chrome takes the sites' access away: its write reads the settings, Messages on, and is held there.
    const racing = events.set({ dappConnector: false, hideBalances: true });
    await turns();
    // Meanwhile the user turns Messages off.
    const off = requests.set({ messaging: { preprod: false } as never });
    await turns();
    release();
    await Promise.all([racing, off]);
    const now = await requests.get();
    expect(now.messaging.preprod).toBe(false);
    expect(now.hideBalances).toBe(true);
  });

  it("changes nothing when the switch is asked while locked, and says it's locked (cross-feature#11)", async () => {
    const relay = fakeRelay(clock);
    const alice = await party(12, relay, new Map(), ALICE_SEEDELF);
    await alice.wallet.lock();
    await expect(alice.messaging.switch("preprod", true)).rejects.toThrow(/locked/);
    expect((await alice.preferences.get()).messaging).toEqual({ preprod: false, mainnet: false });
    expect(alice.alarm.on).toBe(false);
    await alice.messaging.whenIdle();
    expect(relay.calls).toEqual([]);
  });

  it("cleans up at unlock what only a sync would, where the switch is off, and asks nothing (worker-state#12)", async () => {
    const { relay, alice, bob } = await pair();
    await talking(alice, bob);
    // A request Bob deletes (a tombstone until its t + 48 hours and 7 days), and a record a stop left that nothing lists.
    const request = await alice.messaging.start("preprod", BOB_SEEDELF, "a second");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.remove("preprod", request);
    const orphan = conversationRecord("preprod", "cd".repeat(16));
    await bob.store.set(orphan, { v: 1, state: "", history: [], next: 0, trimmed: 0 });
    await bob.messaging.switch("preprod", false);
    const tombstones = async () => (await bob.store.get<Inbox>("messaging.preprod"))!.tombstones!.length;
    const kept = await tombstones();
    await busyFor(49 * 3600_000 + 7 * 24 * 3600_000, alice, bob);
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    relay.calls.length = 0;
    // The unlock's run, as sw.ts makes it: the tidying is the runner's, in the background (round 5).
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(await bob.local.get(PRIVATE_PREFIX + orphan)).toBeUndefined();
    expect(await tombstones()).toBeLessThan(kept);
    expect(relay.calls).toEqual([]);
    expect(bob.alarm.on).toBe(false);
    // A network that never had Messages gains no record.
    expect(await bob.local.get(PRIVATE_PREFIX + "messaging.mainnet")).toBeUndefined();
  });

  it("says which other network's Messages are on, and turns them off from this one's page (docs-claims#3)", async () => {
    const relay = fakeRelay(clock);
    const alice = await party(12, relay, new Map(), ALICE_SEEDELF);
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("mainnet")).alsoOn).toEqual(["preprod"]);
    expect((await alice.messaging.overview("preprod")).alsoOn).toBeUndefined();
    // The requests, as the Messages page on mainnet asks them.
    const ctx = { messaging: alice.messaging, network: "mainnet", networks: ["preprod", "mainnet"] } as unknown as Context;
    const overview = (await handle({ type: "messaging-switch", on: false, network: "preprod" }, ctx)) as MessagingOverview;
    expect(overview.on).toBe(false);
    expect(overview.alsoOn).toBeUndefined();
    expect((await alice.preferences.get()).messaging).toEqual({ preprod: false, mainnet: false });
    expect(alice.alarm.on).toBe(false);
    // Only a network the build has.
    await expect(handle({ type: "messaging-switch", on: true, network: "nowhere" as never }, ctx)).rejects.toThrow(/isn't a network/);
    expect((await alice.preferences.get()).messaging).toEqual({ preprod: false, mainnet: false });
    // The two requests the screens gain go where they say.
    await expect(handle({ type: "messaging-check-reveal", cid: "00".repeat(16) }, ctx)).rejects.toThrow(/Turn Messages on/);
    await expect(handle({ type: "messaging-resend", cid: "00".repeat(16), id: 0 }, ctx)).rejects.toThrow(/isn't in this browser/);
  });
});
