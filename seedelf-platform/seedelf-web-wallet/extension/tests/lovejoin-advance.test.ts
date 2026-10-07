// Lovejoin's page moves a running mix on every 20 s while it's open, as the
// alarm would (release review C37). Its 2 s watch of the mixes replaces the
// list with every read, so an advance keyed on the list was torn down before
// it ever fired, and a mix moved only on the one-minute alarm. It's keyed on
// which mixes run instead, which a read of the same mixes leaves as it was.
// The tests run without a DOM, so the effect's key is checked here, and that
// the page's effect is keyed on it.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { SessionView } from "../src/shared/rpc";
import { runningKey } from "../src/ui/screens/Lovejoin";

/** A mix at `index`, at `stage`, as a read of the record returns it: a new object every time. */
const mix = (index: number, stage: SessionView["stage"] = "open"): SessionView =>
  ({ index, network: "preprod", address: "addr_test1", createdAt: 0, stage, txs: [], holding: null, mix: { boxes: 1 } }) as SessionView;

describe("the page's 20 s advance of a running mix (release review C37)", () => {
  it("keeps its key across the watch's reads of the same mixes, and changes it once one ends", () => {
    const first = [mix(3), mix(1, "closed"), mix(0)];
    const read = [mix(3), mix(1, "closed"), mix(0)];
    expect(read).not.toBe(first);
    expect(runningKey(read)).toBe(runningKey(first));
    expect(runningKey(first)).toBe("3,0");
    expect(runningKey([mix(3), mix(1, "closed"), mix(0, "failed")])).toBe("3");
    expect(runningKey([mix(1, "closed")])).toBe("");
  });

  it("is what the page's advance effect is keyed on, not the list of mixes", () => {
    const page = readFileSync(new URL("../src/ui/screens/Lovejoin.tsx", import.meta.url), "utf8");
    const effect = /useEffect\(\(\) => \{[^]*?call\("session-advance"[^]*?\}, \[(\w+)\]\);/.exec(page);
    expect(effect?.[1]).toBe("running");
    expect(page).toContain("const running = runningKey(mixes);");
  });
});
