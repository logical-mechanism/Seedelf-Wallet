// A return held at its collateral's mix, on a session's page (ui/components/LovejoinReturn.tsx CollateralHeldWayOut):
// from an hour after the mix's deposit went in, what bringing the rest back without it leaves unmixed, and the button
// (the owner, 2026-10-28; 1.6.0's release review, 323-worker#3; 1.7.0).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import es from "../src/i18n/translations/es.json";
import ja from "../src/i18n/translations/ja.json";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { SessionView } from "../src/shared/rpc";
import { CollateralHeldWayOut, reviewAfterSkip } from "../src/ui/components/LovejoinReturn";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { MixList } from "../src/ui/screens/Lovejoin";

const page = (held: { offerAt: number } | undefined, now: number) =>
  renderToStaticMarkup(createElement(CollateralHeldWayOut, { held, busy: false, onSkip: () => undefined, now }))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("the way out of a return held at its collateral's mix", () => {
  const offerAt = 1_800_000_000_000;

  it("says nothing before its hour, nor with nothing held", () => {
    expect(page({ offerAt }, offerAt - 1)).toBe("");
    expect(page(undefined, offerAt)).toBe("");
  });

  it("says, from its hour, that the 5 ₳ box stays unmixed and tied to the session, and offers the rest back", () => {
    const shown = page({ offerAt }, offerAt);
    expect(shown).toContain('data-testid="collateral-held"');
    expect(shown).toContain(t("lj.tail.privacy.wayOut"));
    expect(shown).toContain("unmixed, tied to this session");
    expect(shown).toContain(`>${t("lj.tail.wayOut")}</button>`);
    expect(shown).not.toContain("disabled");
  });

  // 1.7.0's release review: the mix may wait for giveme.my's signature, for the 5 ₳ pool's boxes, or to be built again,
  // and the line shows in each: it says what holds in all of them, the amount and its unit on one line (x-priv#3, x-ui#0,
  // x-docs#5, x-scen#2, x-ui#3).
  it("names no cause of the wait in any language, and keeps 5 ₳ whole", () => {
    for (const line of [t("lj.tail.privacy.wayOut"), es["lj.tail.privacy.wayOut"], ja["lj.tail.privacy.wayOut"]]) {
      expect(line).not.toContain("giveme.my");
      expect(line).toContain("5 ₳");
    }
  });
});

// 1.7.0's release review, pr337#1: on a page brought back by hand, nothing brings the rest back after the press, so the
// page opens its return's review, as Bring it back does; a swap or a mix that runs itself sent it in the press's request.
describe("the return's review after the way out", () => {
  const view = (extra: Partial<SessionView> = {}): SessionView => ({
    index: 0,
    network: "preprod",
    address: "addr_test1",
    createdAt: 0,
    stage: "open",
    txs: [],
    holding: { lovelace: "9000000", tokens: [], utxos: 1 },
    ...extra,
  });

  it("opens on a site's session or a swap brought back by hand whose rest is at the account, nothing held", () => {
    expect(reviewAfterSkip(view({ site: { origin: "https://example.org" } }))).toBe(true);
    expect(reviewAfterSkip(view())).toBe(true);
    // A worker started afresh since the page read the account answers with no reading: the page's own stands.
    expect(reviewAfterSkip(view({ holding: null }), { lovelace: "9000000", tokens: [], utxos: 1 })).toBe(true);
    expect(reviewAfterSkip(view({ holding: { lovelace: "0", tokens: [], utxos: 0 } }), { lovelace: "9000000", tokens: [], utxos: 1 })).toBe(false);
    // Nothing sending the rest: its chain stopped (the press's own stop, or a lock's cut), what was left came back
    // directly, or it was all sent before the site paid again (1.7.0's fixes' review, screens#3).
    const chain = { total: 5, sent: 3, confirmed: 3, cut: false };
    expect(reviewAfterSkip(view({ chain: { ...chain, stopped: t("lj.tail.skipped") } }))).toBe(true);
    expect(reviewAfterSkip(view({ chain: { ...chain, cut: true } }))).toBe(true);
    expect(reviewAfterSkip(view({ chain: { ...chain, sent: 5, confirmed: 5 } }))).toBe(true);
  });

  it("never where it runs itself, where it's still held, nor with nothing at the account, unread, a return on its way, or its chain still being sent", () => {
    expect(reviewAfterSkip(view({ auto: { step: "returning", stopping: false, filled: true, approvedMinOut: "0" } }))).toBe(false);
    expect(reviewAfterSkip(view({ collateralHeld: { offerAt: 1 } }))).toBe(false);
    expect(reviewAfterSkip(view({ holding: { lovelace: "0", tokens: [], utxos: 0 } }))).toBe(false);
    expect(reviewAfterSkip(view({ holding: null }))).toBe(false);
    expect(reviewAfterSkip(view({ stage: "returning" }))).toBe(false);
    // Its own return brings the rest back, and the worker refuses another till it's sent: the review would only be an
    // error (1.7.0's fixes' review, screens#3).
    expect(reviewAfterSkip(view({ chain: { total: 5, sent: 3, confirmed: 3, cut: false } }))).toBe(false);
  });
});

// 1.7.0's release review, x-ui#2 and pr337#5: a mix's card on the Lovejoin page offers the way out as the session pages
// do, nothing before the hour, its button at the page's size rather than the detail line's 12 px.
describe("a mix's card held at its collateral's mix", () => {
  const card = (offerAt: number) =>
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
          createElement(MixList, {
            entries: [],
            sessions: [
              {
                index: 3,
                network: "preprod",
                address: "addr_test1",
                createdAt: 0,
                stage: "open",
                txs: [],
                holding: null,
                mix: { boxes: 1 },
                auto: { step: "returning", stopping: false, filled: false, approvedMinOut: "0" },
                chain: { total: 5, sent: 3, confirmed: 3, cut: false },
                collateralHeld: { offerAt },
              },
            ],
            chains: [],
            pools: [],
            busy: false,
            onRetry: () => undefined,
            onStop: () => undefined,
            onSkipCollateral: () => undefined,
          }),
        ),
      ),
    );
  /** The class of what holds the way out, if the card shows it. */
  const holder = (markup: string) => /<\w+ class="([^"]*)"><div class="stack" data-testid="collateral-held"/.exec(markup)?.[1];

  it("adds nothing before the hour, not even an empty row", () => {
    const before = card(Date.now() + 60 * 60_000);
    expect(before).toContain('data-testid="lovejoin-mix-card"');
    expect(before).not.toContain('data-testid="collateral-held"');
    expect(before).not.toMatch(/<div class="token-row__detail"><\/div>/);
  });

  it("offers it from the hour, outside the detail line's 12 px", () => {
    const after = card(Date.now() - 1);
    expect(after).toContain('data-testid="collateral-held-skip"');
    expect(holder(after)).toBeDefined();
    expect(holder(after)).not.toContain("token-row__detail");
  });
});
