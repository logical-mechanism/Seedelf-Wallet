// The wallet's own list of DReps by name (src/dreps/, `npm run dreps`), and
// the vote page's search over it, which asks no one anything.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
    expect(isDrepId("drep1ydmraa")).toBe(false);
    expect(isDrepId("Logical Mechanism")).toBe(false);
    expect(isDrepId("pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg")).toBe(false);
  });
});
