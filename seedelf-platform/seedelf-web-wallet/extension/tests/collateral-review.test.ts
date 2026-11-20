// Set collateral's review says the staking rewards its payment withdraws, as every other public review does
// (chunk 51, e8b#2, its verifier's test, moved here). Settings → Collateral, with no 5 ₳ UTxO held, builds a payment
// (Collateral.tsx `set` → "collateral-build" → send.ts `buildCollateral` → `pay`), which hands WebAssembly readAccount's
// `withdrawal` as every account payment does: with "Use staking rewards when spending" on (the default), the stake key
// registered and the vote delegated, that's the whole reward balance (account.ts `readAccount`), withdrawn into the
// change and signed for with the stake key (wasm `account_send`: `withdrawing`, `sign_staking`). Send, Make private and
// Create Seedelf showed it on their reviews (ReviewTotals.tsx `RewardsRow`); this review showed To, Address, Set aside,
// Fee and UTxOs spent, and its note said only the fee leaves.
//
// The payment is built for real, over the house's fakes (the recorded 12-word account: 57.475311 ₳ of rewards, its
// vote on Always abstain), and its held transaction is read as Transaction details reads it. Then the review is
// rendered with React's server renderer, which has no DOM and can't press Set collateral, so the page's `summary`
// state starts as the built summary: the third useState of the render (useT's, the status, then the review's), as
// tests/swap-hidden-balances.test.ts seeds a form's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `after`: the render's first states, before the review's summary, by their initial values. Collateral's, in order:
// useT's redraw (0) and the status.
const seam = vi.hoisted(() => ({ initials: [] as unknown[], after: [0, undefined] as unknown[], summary: undefined as unknown, seeded: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial?: unknown) => {
      const before = seam.initials;
      seam.initials = [...before, initial];
      const isSummary =
        before.length === seam.after.length && seam.after.every((want, i) => Object.is(before[i], want)) && initial === undefined;
      if (isSummary && seam.summary !== undefined && !seam.seeded) {
        seam.seeded = true;
        return react.useState(seam.summary);
      }
      return react.useState(initial);
    },
  };
});

const { txView } = await import("../src/background/tx-view");
const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { Collateral } = await import("../src/ui/screens/Collateral");
const { CreateSeedelf } = await import("../src/ui/screens/CreateSeedelf");
const { formatAda } = await import("../src/ui/format");
const { accountMintPreprod, loadTestWasm, stakingPreprod, testBalances, vectors } = await import("./fakes");

const PASSWORD = "correct horse battery";
const phrase12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
const noop = () => undefined;
/** What a person reads of markup. */
const words = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();

describe("Set collateral's review (chunk 51, e8b#2)", () => {
  it("says the staking rewards its payment withdraws, as every other public review does", async () => {
    // The 12-word account holds no 5 ₳ UTxO, so Set collateral is a payment, and its rewards can be withdrawn.
    const w = testBalances();
    await w.wallet.create(phrase12.phrase, PASSWORD);
    await w.balances.get("preprod");
    expect(await w.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
    expect((await w.preferences.get()).spendRewards).toBe(true);
    const stake = stakingPreprod.account_info.find((a) => a.stake_address === phrase12.preprod.stake)!;
    expect(stake).toMatchObject({ status: "registered", delegated_drep: "drep_always_abstain", rewards_available: "57475311" });

    // Built as the page's Set collateral builds it: 5 ₳ to the account's own 0/0, and the whole reward balance withdrawn.
    const summary = await w.send.buildCollateral("preprod");
    expect(summary.payments).toMatchObject([{ address: phrase12.preprod.receive_0, own: true, lovelace: "5000000", tokens: [] }]);
    expect(summary.withdrawal).toBe(stake.rewards_available);
    // What Send submits withdraws it: the held bytes, read as Transaction details reads them.
    const view = await txView({ wasm: loadTestWasm(), wallet: w.wallet, session: w.session }, "preprod", summary.txHash);
    expect(view.detail.withdrawals.map((x) => x.lovelace)).toEqual([stake.rewards_available]);

    // The review of that payment, as the page shows it once Set collateral has built it.
    seam.initials = [];
    seam.after = [0, undefined];
    seam.summary = summary;
    seam.seeded = false;
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
          createElement(Collateral, { onBack: noop }),
        ),
      ),
    );
    expect(seam.seeded, "Collateral's states moved: its review's summary wasn't the render's third useState").toBe(true);
    const review = words(html);
    expect(review).toContain(words(t("collateral.review.title")));
    expect(review).toContain(`${words(t("collateral.setAside"))} ${formatAda("5000000")} ₳`);
    // The 57.475311 ₳ it withdraws, which Send, Make private and Create Seedelf show (RewardsRow), and the setting that
    // did it (RewardsSetting).
    expect(review).toContain(formatAda(stake.rewards_available));
    expect(html).toContain('data-testid="review-rewards"');
    expect(html).toContain('data-testid="rewards-setting"');
  });
});

// The same rule's sibling, which no test held (chunk 51, r2tests#3): Create a Seedelf paid from the account withdraws
// the rewards too, and its review says so, with the setting that does it.
describe("Create a Seedelf's review, paid from the account (chunk 51, e8b#2's sibling)", () => {
  it("says the staking rewards its payment withdraws, and which setting does it", async () => {
    const w = testBalances();
    await w.wallet.create(phrase12.phrase, PASSWORD);
    w.koios.evaluation = accountMintPreprod.evaluation;
    const balances = await w.balances.get("preprod");
    // Built as the page builds it, from the account: the whole reward balance withdrawn into its change.
    const summary = await w.mint.build("preprod", "first", "account");
    expect(summary.withdrawal).toBe("57475311");

    // Create's first states, in order: useT's redraw (0), what pays ("account" here), the tag typed (""), then the
    // review's summary.
    seam.initials = [];
    seam.after = [0, "account", ""];
    seam.summary = summary;
    seam.seeded = false;
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
          createElement(CreateSeedelf, { balances, onCancel: noop, onSent: noop }),
        ),
      ),
    );
    expect(seam.seeded, "Create's states moved: its review's summary wasn't the render's fourth useState").toBe(true);
    expect(words(html)).toContain(words(t("mint.review.title")));
    // The 57.475311 ₳ it withdraws (RewardsRow), and the setting that did it (RewardsSetting).
    expect(html).toContain('data-testid="review-rewards"');
    expect(words(html)).toContain(formatAda(summary.withdrawal!));
    expect(html).toContain('data-testid="rewards-setting"');
  });
});
