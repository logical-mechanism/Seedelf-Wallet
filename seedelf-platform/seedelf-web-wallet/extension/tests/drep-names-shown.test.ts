// The DReps' names from the list that ships with the wallet (src/dreps/, `npm run dreps`), as every screen shows them
// (chunk 51, gap-g7#3). A DRep chooses its givenName, and the list kept what its generator doesn't strip: bidi
// overrides and zero-width characters. Voting's rows cleaned each name (plainName), but Delegations' rows and
// Activity's staking line showed it as it came, where a right-to-left override turns the name and what follows it
// round, so the user's own past delegation read otherwise than it did when they picked it. The list cleans each name
// as it loads now, for every screen, and a name with nothing left is no name: the DRep's ID stands for it.
//
// The list here is the real preprod one, with two entries a DRep could make: one with an override and a zero-width
// space in it, and one of nothing but invisible characters.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/dreps/preprod.json", async (original) => {
  const list = (await original<{ default: { recorded: string; dreps: string[][] } }>()).default;
  return {
    default: {
      ...list,
      dreps: [
        ...list.dreps,
        ["drep1yxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "Ev\u202eil\u200b Drep"],
        ["drep1yzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "\u200b\u2060\u202e"],
      ],
    },
  };
});

const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { drepName } = await import("../src/ui/activity");
const { drepList } = await import("../src/ui/dreps");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { DelegationList } = await import("../src/ui/screens/Delegations");

const DIRTY = "drep1yxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const BLANK = "drep1yzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
/** What no shown name may hold: a format character (bidi controls, zero-width ones) or another one that's default ignorable. */
const HIDDEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

const markup = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("the bundled DReps' names, as the screens show them (chunk 51, gap-g7#3)", () => {
  it("are cleaned as the list loads: no override or zero-width character in any", () => {
    const { dreps } = drepList("preprod");
    expect(dreps.find((d) => d.id === DIRTY)?.name).toBe("Evil Drep");
    expect(dreps.filter((d) => HIDDEN.test(d.name)).map((d) => d.id)).toEqual([]);
    // The rest are as they were.
    expect(dreps.find((d) => d.id === "drep1ytenukatzrvc2a8kyalzj67us4ms568f6jy8p8qu3luw07gjdmlar")?.name).toBe("₳rturo");
  });

  it("read on Delegations' rows as the DRep was picked by, and its ID where nothing of the name is left", () => {
    const at = Date.UTC(2026, 9, 1);
    const html = markup(
      createElement(DelegationList, {
        rows: [
          { kind: "vote", drep: DIRTY, txHash: "aa".repeat(32), at, epoch: 300 },
          { kind: "vote", drep: BLANK, txHash: "bb".repeat(32), at, epoch: 299 },
        ],
      }),
    );
    expect(HIDDEN.test(html)).toBe(false);
    expect(text(html)).toContain("Voting power to Evil Drep");
    expect(text(html)).toContain(`Voting power to ${BLANK.slice(0, 8)}`);
  });

  it("and on Activity's staking line, which reads the same list", () => {
    expect(drepName("preprod", DIRTY)).toBe("Evil Drep");
  });
});
