// Remove's review names each token that goes with the Seedelf's ADA (chunk 51, w1b#2). The deployed policy checks only a
// Seedelf's name, so anyone can mint one beside tokens of theirs under a register of the user's, and the wallet lists it
// as the user's. Removing it moves those tokens with the ADA, to where the user sends it; the review said only the ADA
// and the fee, so the user signed for tokens it never named.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RemoveSummary } from "../src/shared/rpc";
import { RemoveRows } from "../src/ui/screens/RemoveSeedelf";

const hexOf = (s: string) => Buffer.from(s, "ascii").toString("hex");

/** A removal back to the public account, as WebAssembly's buildRemove gives it to the worker. */
const removal = (tokens: RemoveSummary["tokens"]): RemoveSummary => ({
  network: "preprod",
  txHash: "ab".repeat(32),
  name: `5eed0e1f${hexOf("web-wallet")}00${"ab".repeat(17)}`,
  label: "web-wallet",
  to: "account",
  lovelace: "2755846",
  tokens,
  fee: { size: "192473", compute: "34461", scriptReference: "17220", total: "244154" },
});

/** The review's rows as text: each row's label and value, in order. */
const rows = (summary: RemoveSummary) =>
  [...renderToStaticMarkup(createElement(RemoveRows, { summary })).matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(
    ([, label, value]) => [label, value!.replace(/<[^>]+>/g, "")],
  );

describe("Remove's review (chunk 51, w1b#2)", () => {
  it("names each token that comes back with the ADA, under it", () => {
    const shown = rows(removal([{ policyId: "cd".repeat(28), assetName: hexOf("junk"), quantity: "100" }]));
    const back = shown.findIndex(([label]) => label === "Comes back to your public account");
    expect(back).toBeGreaterThan(-1);
    expect(shown[back]![1]).toBe("2.755846 ₳");
    // Its amount and name, with the mark an unlisted token gets everywhere.
    const [label, token] = shown[back + 1]!;
    expect(label).toBe("");
    expect(token).toMatch(/^100 junkNot on the wallet&#x27;s list, asset1/);
    expect(shown.at(-1)![0]).toBe("Network fee");
  });

  it("shows the ADA alone when nothing else sat with the Seedelf", () => {
    const shown = rows(removal([]));
    expect(shown.map(([label]) => label)).toEqual(["Seedelf", "Seedelf name", "Comes back to your public account", "Network fee"]);
  });
});
