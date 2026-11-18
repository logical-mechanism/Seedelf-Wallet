// Save as CSV never lets a stranger's words run as a spreadsheet formula in a column they can choose (chunk 51,
// t1l#1): a token's name (an unlisted token goes by the name it calls itself), a pool's ticker and a DRep's name.
// Each of those columns marks its text as free (activity.ts, `csvCell(…, true)`), and a revert of any of the three
// passed every test: the formula test in activity.test.ts builds its case from a note and a detail only.
import { describe, expect, it, vi } from "vitest";

import type { ActivityEntry } from "../src/shared/rpc";

const DREP = "drep1y296z8tm7y7elwsmsewn4q2tdr5gu0fqztq97yttlpv7zycvsl554";
// A DRep's name is its own to choose, and the list keeps it: one starting as a formula would.
vi.mock("../src/ui/dreps", async (original) => ({
  ...(await original<typeof import("../src/ui/dreps")>()),
  drepList: () => ({ recorded: "", dreps: [{ id: DREP, name: "@SUM(A1)" }] }),
}));

const { t } = await import("../src/i18n");
const { activityCsv } = await import("../src/ui/activity");

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const POOL = "pool1z5uqdk7dzdxaae5633fqfcu2eqzy3a3rgtuvy087fdld7yws0xt";

/** One CSV row's cells, its quotes read as a spreadsheet reads them. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

describe("Save as CSV's columns a stranger can choose (chunk 51, t1l#1)", () => {
  it("never starts a token's name, a pool's ticker or a DRep's name as a formula", () => {
    const entry: ActivityEntry = {
      txHash: "cd".repeat(32),
      at: Date.UTC(2026, 10, 1, 12),
      kind: "sent",
      direction: "out",
      lovelace: "1000000",
      tokens: 1,
      // A token a stranger minted and sent, named as a formula: unlisted, readable, like no listed one.
      assets: [{ policyId: STRANGER, assetName: hex("=HYPERLINK(1)"), quantity: "-5" }],
      // A pool's ticker and a DRep's name, each its owner's to choose.
      staking: { pool: POOL, ticker: "=1+1", drep: DREP },
    };
    const [header, row] = activityCsv("preprod", [entry]).replace(/^\uFEFF/, "").trim().split("\r\n");
    const columns = cells(header!);
    const cell = (key: Parameters<typeof t>[0]) => cells(row!)[columns.indexOf(t(key))]!;
    expect(cell("activity.csv.tokens")).toMatch(/^'=HYPERLINK\(1\) /);
    expect(cell("activity.csv.pool")).toBe(`'=1+1 ${POOL}`);
    expect(cell("activity.csv.vote")).toBe("'@SUM(A1)");
  });
});
