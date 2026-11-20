// The wallet's own list of DReps by name (src/dreps/, `npm run dreps`), and
// the vote page's search over it, which asks no one anything.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { listOf, MAX_LOSS, METADATA_SELECT, readRows, stillWanted } from "../scripts/dreps.mjs";
import { isDrepId, searchDreps, type DrepEntry } from "../src/ui/dreps";

const list = (network: string) =>
  JSON.parse(readFileSync(new URL(`../src/dreps/${network}.json`, import.meta.url), "utf8")) as {
    recorded: string;
    dreps: string[][];
  };
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

describe("the DRep lists", () => {
  it.each(["preprod", "mainnet"])("%s: CIP-129 IDs, each once, with a clean name, by name", (network) => {
    const { recorded, dreps } = list(network);
    expect(recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dreps.length).toBeGreaterThan(0);
    for (const [id, name] of dreps) {
      expect(isDrepId(id!)).toBe(true);
      expect(id!.startsWith("drep1y")).toBe(true);
      expect(name!.length).toBeGreaterThan(0);
      expect(name!.length).toBeLessThanOrEqual(64);
      expect(name).toBe(name!.trim());
      expect(name).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    }
    expect(new Set(dreps.map(([id]) => id)).size).toBe(dreps.length);
    const names = dreps.map(([, name]) => name!);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    expect(names).toEqual(sorted);
  });

  it("has Logical Mechanism's preprod DRep", () => {
    expect(list("preprod").dreps).toContainEqual([LOGIC_DREP, "Logical Mechanism dRep"]);
  });
});

// A DRep's CIP-119 profile can ask directories not to list it (doNotList), the default in the wallet's own form, and
// the list named every registered DRep with a name all the same: in every Seedelf Wallet's vote list (chunk 51,
// gap-g7#2). The script is never run here, nor Koios asked: its rules are imported (it runs only as node's main) and fed
// drep_metadata's rows.
describe("a DRep that asks not to be listed (chunk 51, gap-g7#2)", () => {
  const SCRIPT = readFileSync(new URL("../scripts/dreps.mjs", import.meta.url), "utf8");
  const [A, B, C, D] = ["drep1yaaa", "drep1ybbb", "drep1yccc", "drep1yddd"];

  it("is asked for beside the name, in the JSON-LD form too, and left out of the list and of later passes", () => {
    expect(METADATA_SELECT).toBe("select=drep_id,meta_json->body->givenName,meta_json->body->doNotList");
    const named = new Map<string, string>();
    const unlisted = new Set<string>();
    readRows(
      [
        { drep_id: A, givenName: "Alice", doNotList: false },
        { drep_id: B, givenName: "Bob", doNotList: true },
        { drep_id: C, givenName: { "@value": "Carol" }, doNotList: { "@value": true } },
        { drep_id: D, givenName: "Dave" },
      ],
      named,
      unlisted,
    );
    expect([...named.keys()]).toEqual([A, D]);
    expect([...unlisted].sort()).toEqual([B, C]);
    // A later pass asks only for those neither named nor unlisted.
    expect(stillWanted([A, B, C, D, "drep1yeee"], named, unlisted)).toEqual(["drep1yeee"]);
    // Its own word, written as text, counts too; anything else isn't an ask.
    const loose = new Set<string>();
    readRows(
      [
        { drep_id: A, givenName: "Alice", doNotList: "true" },
        { drep_id: B, givenName: "Bob", doNotList: "false" },
        { drep_id: C, givenName: "Carol", doNotList: null },
      ],
      new Map(),
      loose,
    );
    expect([...loose]).toEqual([A]);
  });

  it("never keeps its committed name, and isn't counted as a loss", () => {
    // Twenty committed DReps, still registered; three now ask not to be listed, and the passes name the rest.
    const ids = Array.from({ length: 20 }, (_, i) => `drep1y${String(i).padStart(3, "0")}`);
    const committed = new Map(ids.map((id, i) => [id, `Name ${i}`]));
    const unlisted = new Set(ids.slice(0, 3));
    const named = new Map(ids.slice(3).map((id, i) => [id, `Name ${i + 3}`]));
    const { dreps, kept, left } = listOf("preprod", { ids, named, unlisted, committed });
    expect(dreps.map(([id]) => id)).toEqual(ids.slice(3).sort((a, b) => committed.get(a)!.localeCompare(committed.get(b)!, "en")));
    expect(dreps.some(([id]) => unlisted.has(id!))).toBe(false);
    expect([kept, left]).toEqual([0, 3]);
    // 3 of 20 is more than MAX_LOSS would let go: they left by their own ask, not by Koios failing.
    expect(3 / 20).toBeGreaterThan(MAX_LOSS);
    // The control: three that no pass names keep their committed names, as before.
    const quiet = listOf("preprod", { ids, named, unlisted: new Set(), committed });
    expect([quiet.dreps.length, quiet.kept]).toEqual([20, 3]);
  });

  it("sorts names of one spelling by ID in en-US, whatever the shell's locale", () => {
    expect(SCRIPT).toContain('ia.localeCompare(ib, "en-US")');
  });
});

describe("searching DReps", () => {
  const dreps: DrepEntry[] = [
    { id: "drep1yaaa", name: "Alice" },
    { id: "drep1ybbb", name: "Bob's Governance" },
    { id: "drep1yccc", name: "carol" },
  ];

  it("finds by any part of the name or the ID, case aside, keeping the list's order", () => {
    expect(searchDreps(dreps, "")).toEqual(dreps);
    expect(searchDreps(dreps, "  GOV ").map((d) => d.name)).toEqual(["Bob's Governance"]);
    expect(searchDreps(dreps, "o").map((d) => d.name)).toEqual(["Bob's Governance", "carol"]);
    expect(searchDreps(dreps, "DREP1YCC").map((d) => d.name)).toEqual(["carol"]);
    expect(searchDreps(dreps, "dave")).toEqual([]);
  });

  it("knows a whole DRep ID, in either CIP's form, from a name or a piece of one", () => {
    expect(isDrepId(LOGIC_DREP)).toBe(true);
    expect(isDrepId(` ${LOGIC_DREP.toUpperCase()} `)).toBe(true);
    expect(isDrepId("drep_script1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqp8tcfx")).toBe(true);
    // CIP-105's own form for a key, and its deprecated one (its test vector 1): drep_vkh1… was "matches nothing".
    expect(isDrepId("drep_vkh15k6929drl7xt0spvudgcxndryn4kmlzpk4meed0xhqe254czjh2")).toBe(true);
    expect(isDrepId("drep15k6929drl7xt0spvudgcxndryn4kmlzpk4meed0xhqe25nle07s")).toBe(true);
    expect(isDrepId("drep_vkh15k6929")).toBe(false);
    expect(isDrepId("drep_vk1" + "q".repeat(52))).toBe(false);
    expect(isDrepId("drep1ydmraa")).toBe(false);
    expect(isDrepId("Logical Mechanism")).toBe(false);
    expect(isDrepId("pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg")).toBe(false);
  });
});
