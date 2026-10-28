// A return held at its collateral's mix, on a session's page (ui/components/LovejoinReturn.tsx CollateralHeldWayOut):
// from an hour after the mix's deposit went in, what bringing the rest back without it leaves unmixed, and the button
// (the owner, 2026-10-28; 1.6.0's release review, 323-worker#3; 1.7.0).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import { CollateralHeldWayOut } from "../src/ui/components/LovejoinReturn";

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
});
