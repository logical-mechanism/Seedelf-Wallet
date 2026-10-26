// 1.6.0's review of the fixes, 309#1's leftover (the review's cross-area question). Since 309#1, a collateral payment
// reads as on its way while it can still land, for up to two hours, so one a mempool dropped kept Set collateral away
// that long, and with it public mixes and anything else a collateral backs. Past its first 10 minutes it's now `late`,
// and the Collateral page offers to pay it again anyway, a choice of the user's with one line on what both landing
// means. Nothing is refused: the payment again is the one Set collateral makes. Each failed before its fix.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n";
import type { KoiosUtxo } from "../src/background/koios";
import * as CollateralScreen from "../src/ui/screens/Collateral";
import { koiosPreprod, testBalances, vectors } from "./fakes";

vi.mock("../src/i18n", async (original) => {
  const real = await original<typeof import("../src/i18n")>();
  return { ...real, useT: () => real.t };
});

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;

/** The 12-word phrase's wallet, unlocked, with no collateral: setting one pays 5 ₳ to its own 0/0. */
async function unlocked() {
  const t = testBalances();
  await t.wallet.create(PHRASE.phrase, PASSWORD);
  await t.balances.get("preprod");
  return t;
}

/** Output 0 of `txHash`, 5 ₳ at 0/0, in a block: the payment landed. */
function landed(txHash: string, height: number): KoiosUtxo {
  const template = koiosPreprod.accounts[PHRASE.preprod.stake]!.account_utxos.find((u) => u.address === PHRASE.preprod.receive_0)!;
  return { ...template, tx_hash: txHash, tx_index: 0, value: "5000000", asset_list: [], block_height: height };
}

describe("a collateral payment that may have been dropped (1.6.0's review of the fixes, 309#1's leftover)", () => {
  it("is on its way for its first 10 minutes, then late while it can still land", async () => {
    const t = await unlocked();
    const first = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", first.txHash);
    t.clock.now += 9 * 60_000;
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: first.txHash });
    // Not in a block 11 minutes on: a mempool may have dropped it, though the wallet waits while it can still land.
    t.clock.now += 2 * 60_000;
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: first.txHash, late: true });
  });

  it("can be paid again anyway: the new payment is the collateral, and if both land the first is spendable", async () => {
    const t = await unlocked();
    const first = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", first.txHash);
    t.clock.now += 11 * 60_000;
    expect(await t.coins.collateral("preprod")).toMatchObject({ state: "waiting", late: true });
    // Pay it again anyway: what Set collateral builds, never refused, on other UTxOs than the first one's.
    const again = await t.send.buildCollateral("preprod");
    expect(again.txHash).not.toBe(first.txHash);
    await t.send.submitCollateral("preprod", again.txHash);
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: again.txHash });
    // Both land: the second is kept aside, and the first 5 ₳ goes back into the balance, as the page's line says.
    t.koios.addedToAccounts.push(landed(first.txHash, 5_300_000), landed(again.txHash, 5_300_001));
    await t.balances.get("preprod", true);
    expect(await t.coins.collateral("preprod")).toMatchObject({ state: "set", by: "you", utxo: { txHash: again.txHash, index: 0 } });
    const listed = (await t.coins.lists("preprod")).cardano.find((u) => u.txHash === first.txHash)!;
    expect(listed).toMatchObject({ locked: false });
    expect(listed.collateral).toBeUndefined();
  });
});

/**
 * The button `testId` names in `node`, each component on the way called as React calls it: what clicking it runs is
 * its own `onClick`.
 */
function buttonIn(node: ReactNode, testId: string): ReactElement<{ onClick: () => void; disabled?: boolean }> | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = buttonIn(n, testId);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as { "data-testid"?: string; children?: ReactNode };
  if (props["data-testid"] === testId) return node as ReactElement<{ onClick: () => void }>;
  if (typeof node.type === "function") return buttonIn((node.type as (p: unknown) => ReactNode)(node.props), testId);
  return buttonIn(props.children, testId);
}

describe("the Collateral page while its payment waits (1.6.0's review of the fixes, 309#1's leftover)", () => {
  // Looked up by name, so this file loads before it exists.
  const { WaitingFoot } = CollateralScreen as unknown as {
    WaitingFoot: (props: { late?: boolean; busy: boolean; blocked?: string; onDone: () => void; onAgain: () => void }) => ReactElement;
  };
  const foot = (props: Partial<Parameters<typeof WaitingFoot>[0]> = {}) =>
    createElement(WaitingFoot, { busy: false, onDone: () => undefined, onAgain: () => undefined, ...props });
  const words = (element: ReactElement) =>
    renderToStaticMarkup(element).replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();

  it("offers no payment again for its first 10 minutes: Done alone", () => {
    expect(words(foot())).toBe(t("common.done"));
  });

  it("offers to pay it again anyway once it's late, with one line on both landing, as a choice", () => {
    let asked = 0;
    const late = foot({ late: true, onAgain: () => (asked += 1) });
    expect(words(late)).toContain(t("collateral.payAgain"));
    expect(words(late)).toContain(t("collateral.warn.bothLand"));
    expect(t("collateral.warn.bothLand")).toBe("If both land, the first 5 ₳ goes back into your balance.");
    const again = buttonIn(late, "collateral-again")!;
    expect(again.props.disabled).toBe(false);
    again.props.onClick();
    expect(asked).toBe(1);
  });

  it("says why it can't while Home holds payments back, its button off", () => {
    const held = foot({ late: true, blocked: "Wait for the payment on its way." });
    expect(buttonIn(held, "collateral-again")!.props.disabled).toBe(true);
    expect(words(held)).toContain("Wait for the payment on its way.");
  });
});
