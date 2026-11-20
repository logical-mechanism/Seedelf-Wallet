// Chunk 51, gap-g8#6 (the owner's B2, 2026-11-18): a pool's start refuses only a box under the network's minimum for
// it, which no mix could make. The worker refused any box under S0d's least (WebAssembly's lovejoinBoxValue, core's
// least_box_lovelace: a box comes back, then pays part of what came back on its own), 3.45 ₳ for an ADA pool, and core's
// own launch refused one that can't pay its own way back (check_usable's CantComeBack, about 1.63 ₳ for ADA), though
// one_shot_mint takes both (box > 0, 0 < max_fee < box) and the wallet mixes into such pools when others start them
// (the owner's call 34). Now both are built, and the review says each: S0d's least as a warning line, and, below about
// 1.63 ₳, that a box can't come back on its own.
//
// With the real WebAssembly, from the public account (40 ₳ and 5 ₳ of ADA), as lovejoin-flows' launch tests do. The
// first case runs on any module; the second needs WebAssembly built with this change (the box's minimum, and the
// launch's `cantComeBack`).
import { describe, expect, it } from "vitest";

import { t as tr } from "../src/i18n";
import type { KoiosUtxo } from "../src/background/koios";
import { adaWords } from "../src/background/short";
import { LaunchBoxNotes } from "../src/ui/screens/LovejoinLaunch";
import { formatAda } from "../src/ui/format";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { koiosPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, as lovejoin-flows' launch tests set it.
  t.koios.tip = 110_000_000;
  t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
  return t;
}

/** One of the recorded account's UTxOs, made again as `tx`'s, holding `value` of ADA alone. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
}

describe("a pool's start under S0d's least (chunk 51, gap-g8#6)", { timeout: 300_000 }, () => {
  it("starts an ADA pool of 2 ₳ or 3 ₳ a box, which one_shot_mint takes, and its review says S0d's least", async () => {
    const t = await wallet();
    const terms = await t.launch.terms("preprod");
    for (const box of ["2000000", "3000000"]) {
      expect(BigInt(box), `S0d's least is ${terms.least}`).toBeLessThan(BigInt(terms.least));
      const made = await t.launch.build("preprod", { from: "public", boxLovelace: box });
      expect(made.pool.boxLovelace).toBe(box);
      expect(made.least).toBe(terms.least);
      expect(made.cantComeBack).toBeUndefined();
    }
    // At the suggestion, over the least: nothing to say.
    expect((await t.launch.build("preprod", { from: "public", boxLovelace: terms.suggested })).least).toBeUndefined();
  });

  it("starts one whose boxes can't come back on their own, saying so, and refuses one under a box's minimum in words", async () => {
    const t = await wallet();
    const terms = await t.launch.terms("preprod");
    // An ADA box's minimum under preprod's parameters: 1.3361 ₳.
    expect(terms.minimum).toBe("1336100");
    // 1.5 ₳: a withdraw's fee leaves 1.204978 ₳ where coming back needs 1.3361 ₳. Built, and said.
    const stuck = await t.launch.build("preprod", { from: "public", boxLovelace: "1500000" });
    expect(stuck.pool.boxLovelace).toBe("1500000");
    expect(stuck.cantComeBack).toEqual({ has: "1204978", needs: "1336100" });
    expect(stuck.least).toBe(terms.least);
    // 1.2 ₳: no mix could make such a box. Refused in the wallet's words, before anything is built.
    await expect(t.launch.build("preprod", { from: "public", boxLovelace: "1200000" })).rejects.toThrow(
      tr("lj.launch.belowMinimum", { minimum: adaWords("1336100") }),
    );
  });

  it("says each on the review, as a warning", () => {
    const html = (review: Parameters<typeof LaunchBoxNotes>[0]["review"]) =>
      renderToStaticMarkup(createElement(LaunchBoxNotes, { review })).replaceAll("&#x27;", "'");
    const under = html({ least: "3450000" });
    expect(under).toContain('data-testid="lovejoin-launch-box"');
    expect(under).toContain(tr("lovejoin.launch.warn.underLeast", { least: formatAda("3450000") }));
    const both = html({ least: "3450000", cantComeBack: { has: "1204978", needs: "1336100" } });
    expect(both).toContain(tr("lovejoin.stuck.warn.lead", { has: formatAda("1204978"), needs: formatAda("1336100") }));
    expect(html({})).toBe("");
  });
});
