// The relay client's own rate limit runs on the monotonic clock (the 1.10.0 gate's round 5, the freeze review's fix E,
// its item 19): relay.ts `limitFor` gives it performance.now, as W14 put every wait kept in memory. Ported from the
// verifiers' verify2-freeze-clock-limit.test.ts, its defect's case reversed: a device clock set back an hour after a
// sync's pages holds the next page no longer than the window. Vitest's fake timers move performance.now with the
// timers, and setSystemTime moves the device's clock alone.
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGES_A_SYNC, RelayClient } from "../src/background/relay";

const emptyPage = () => {
  const out = new Uint8Array(16);
  out[0] = 1;
  return out;
};
const relayAt = (origin: string) =>
  new RelayClient({ origin, pool: "mainnet", fetch: async () => new Response(emptyPage(), { status: 200 }) });

describe("the relay's rate limit and the device's clock (freeze item 19, fix E)", { timeout: 30_000 }, () => {
  afterEach(() => vi.useRealTimers());

  it("with the clock left alone, the page after a full sync's waits at most the window's 30 s", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const relay = relayAt("https://clock-steady.test");
    for (let i = 0; i < PAGES_A_SYNC; i++) await relay.page();
    let done = false;
    const next = relay.page().then(() => void (done = true));
    await vi.advanceTimersByTimeAsync(31_000);
    await next;
    expect(done).toBe(true);
  });

  it("the device's clock set back an hour after a full sync's pages: the next page still goes within the window's 31 s", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const relay = relayAt("https://clock-back.test");
    for (let i = 0; i < PAGES_A_SYNC; i++) await relay.page();
    vi.setSystemTime(Date.now() - 3600_000);
    let done = false;
    const next = relay.page().then(() => void (done = true));
    await vi.advanceTimersByTimeAsync(31_000);
    await next;
    expect(done).toBe(true);
  });

  it("the device's clock set forward an hour: the window isn't skipped, the next page waits for it as the steady clock's does", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const relay = relayAt("https://clock-forward.test");
    for (let i = 0; i < PAGES_A_SYNC; i++) await relay.page();
    vi.setSystemTime(Date.now() + 3600_000);
    let done = false;
    const next = relay.page().then(() => void (done = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await next;
    expect(done).toBe(true);
  });
});
