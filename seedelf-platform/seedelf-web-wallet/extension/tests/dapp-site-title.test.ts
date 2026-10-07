// A page's title is the site's own words, shown in the connector's windows
// beside the origin Chrome reports, "{{title}} · {{origin}}" in one line. A
// title starting with U+202E (right-to-left override) reversed that origin:
// "https://evil.example" read "elpmaxe.live//:sptth" after a title spelling
// "minswap.org" backwards (the release review). Direction and invisible
// format characters are left out of a title as it's kept, as governance.ts's
// shownText leaves them out of an action's.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

describe("a page's title, as the windows and the lists show it", () => {
  it("keeps no character that turns text around or hides in it", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true });
    const titled = (id: string, title: string): DappSession => ({ id, origin: `https://${id}.example`, title });

    const cases = [
      ["rlo", "\u202egro.pawsnim", "gro.pawsnim"],
      ["isolate", "\u2067Minswap\u2069 \u200f·\u200e Swap", "Minswap · Swap"],
      ["hidden", "Min\u200bswap\ufeff\u061c", "Minswap"],
      ["controls", "Min\u0007swap\u0085DEX", "Min swap DEX"],
      ["nothing", "\u202e\u200b", undefined],
    ] as const;
    for (const [id, title, shown] of cases) {
      const enabling = t.dapp.call(titled(id, title), "enable", []);
      await until(() => t.dapp.approvals().length === 1);
      const [approval] = t.dapp.approvals();
      expect(approval!.title).toBe(shown);
      await t.dapp.answer(approval!.id, true);
      expect(await enabling).toBe(true);
    }
    // The connected sites' list keeps them so.
    const sites = await t.dapp.sites();
    expect(Object.fromEntries(sites.map((s) => [s.origin, s.title]))).toEqual(
      Object.fromEntries(cases.map(([id, , shown]) => [`https://${id}.example`, shown])),
    );
  });

  it("is read so even when it was kept before, unstripped", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.store.set("dapps", [{ origin: "https://old.example", network: "preprod", connectedAt: 1, title: "\u202egro.pawsnim" }]);
    expect(await t.dapp.sites()).toEqual([{ origin: "https://old.example", connectedAt: 1, title: "gro.pawsnim" }]);
  });
});
