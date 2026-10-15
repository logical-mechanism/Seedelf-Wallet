// A pool's return on stake (chunk 37), as its page renders it: the figures'
// last row, the yearly rate over the epochs the server gave rewards for, how
// many those are behind the figures' icon, each recent epoch folded under
// them with its blocks and rate or "not known", folded with the figures on
// Staking, and nowhere a page didn't read it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PoolDetails, PoolHistory } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PoolFacts } from "../src/ui/screens/Staking";

const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";

const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
/** The icon's text, which a click puts on the page. */
const hint = (html: string) => /title="([^"]*)"/.exec(html)?.[1]?.replaceAll("&#x27;", "'");
const noop = () => undefined;

/** Recent epochs as the worker hands them over (staking.test.ts checks that): some the server gave no rewards for. */
const history = (over: Partial<PoolHistory> = {}): PoolHistory => ({
  id: LOGIC,
  epochs: [
    { epoch: 317, blocks: 161, ros: 5.276072341 },
    { epoch: 316, blocks: 161 },
    { epoch: 315, blocks: 1, ros: 0.0312 },
    { epoch: 314, blocks: 0, ros: 0 },
  ],
  ros: 1.7623,
  ...over,
});
const details: PoolDetails = {
  id: LOGIC,
  ticker: "LOGIC",
  margin: 0.02,
  cost: "170000000",
  pledge: "5500000000000",
  livePledge: "5600000000000",
  stake: "12000000000000",
  saturation: 18.81,
  delegators: 40,
  blocks: 6000,
  status: "registered",
  retiringEpoch: null,
};

describe("a pool's return on stake (chunk 37)", () => {
  const facts = (returns: Parameters<typeof PoolFacts>[0]["returns"], over: Partial<Parameters<typeof PoolFacts>[0]> = {}) =>
    markup(createElement(PoolFacts, { pool: details, testId: "p", named: false, returns, ...over }));

  it("is the figures' last row, a yearly rate over the epochs the server gave, each epoch folded under them", () => {
    const html = facts({ history: history(), onRetry: noop });
    expect(text(html)).toMatch(/^Saturation 18\.8% .* Blocks made 6,000 Return on stake 1\.76% a year Recent epochs /);
    expect(html).toMatch(/<dl class="review" data-testid="p-facts">.*Return on stake.*<\/dl>/);
    expect(text(html)).toContain(
      "Epoch 317 161 blocks · 5.28% a year Epoch 316 161 blocks · not known Epoch 315 1 block · 0.03% a year " +
        "Epoch 314 0 blocks · 0% a year",
    );
    expect(html).toMatch(/<details class="disclosure" data-testid="p-return-epochs"><summary>Recent epochs<\/summary>/);
  });

  it("is explained behind the figures' one icon: over how many epochs, and that some the server didn't give", () => {
    const say = (h: PoolHistory) => hint(facts({ history: h, onRetry: noop }))!;
    const before = "Pledge: what its owners stake in it. Return on stake: what each ADA staked with it earned";
    const luck = "It's what the pool did, not what it will do: a small pool's blocks, and so its rewards, come down to luck.";
    expect(say(history())).toContain(
      `${before} over 3 of its last 4 epochs, after its fees, as a yearly rate; the server didn't give the others' rewards. ${luck}`,
    );
    const all = history({ epochs: [{ epoch: 317, blocks: 161, ros: 5.27 }, { epoch: 316, blocks: 160, ros: 5.2 }], ros: 5.23 });
    expect(say(all)).toContain(`${before} over its last 2 epochs, after its fees, as a yearly rate. ${luck}`);
    expect(say(history({ epochs: [{ epoch: 317, blocks: 161, ros: 5.27 }], ros: 5.27 }))).toContain(`${before} in its last epoch,`);
    // With no rate, nothing to explain; and nowhere a page didn't read it.
    expect(say(history({ epochs: [{ epoch: 317, blocks: 161 }], ros: undefined }))).toMatch(/what its owners stake in it\.$/);
    expect(hint(facts(undefined))).toMatch(/what its owners stake in it\.$/);
  });

  it("is not known when the server gave no epoch's rewards; and a pool with no epochs lists none", () => {
    expect(text(facts({ history: history({ epochs: [{ epoch: 317, blocks: 161 }], ros: undefined }), onRetry: noop }))).toMatch(
      /Return on stake Not known Recent epochs Epoch 317 161 blocks · not known$/,
    );
    expect(text(facts({ history: { id: LOGIC, epochs: [] }, onRetry: noop }))).toMatch(/Return on stake Not known$/);
  });

  it("says it's reading, or that it couldn't, with Try again under the figures", () => {
    expect(text(facts({ onRetry: noop }))).toMatch(/Return on stake Reading…$/);
    expect(text(facts({ error: "Koios is busy", onRetry: noop }))).toMatch(/Return on stake Couldn't read just now Details Koios is busy Try again$/);
  });

  it("is folded with the figures on Staking, and left out where a page didn't read it, or before the figures are", () => {
    const returns = { history: history(), onRetry: noop };
    const folded = facts(returns, { folded: true, onUnfold: noop, named: true });
    expect(folded).toMatch(/<details class="disclosure" data-testid="p-details"><summary>Pool details<\/summary>.*Return on stake/);
    expect(text(facts(undefined))).not.toContain("Return on stake");
    expect(text(facts(returns, { pool: { id: LOGIC } }))).not.toContain("Return on stake");
  });
});
