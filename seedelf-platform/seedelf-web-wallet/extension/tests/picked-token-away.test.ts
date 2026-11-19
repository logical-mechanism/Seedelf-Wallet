// A token Home lists that a form can't pay with now: all of it locked, or on its way back with a payment's change,
// both of which Home counts in. Its details offer Send and Make private or public for it, and the form, handed the side
// less what's locked and nothing on its way, drew no box for it yet counted it picked: Review stayed greyed out with no
// reason under it, and once an amount was typed it went on without the token, unsaid (chunk 51, e9a#1). Each of the
// four forms now says why under Review, first, and holds Review until the token is there.
//
// The forms are rendered with React's server renderer, as a token's details open them: the token picked, nothing typed.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Nothing the forms show is asked of the worker while they render: any request stays unanswered.
vi.mock("../src/ui/background", async (original) => {
  const pending = { then: () => pending, catch: () => pending, finally: () => pending };
  return { ...(await original<typeof import("../src/ui/background")>()), call: () => pending };
});

const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { recipientAmounts, waitingFor } = await import("../src/ui/components/Recipients");
const { pickedAway } = await import("../src/ui/components/TokenAmounts");
const { tokenKey, unlocked } = await import("../src/ui/format");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { CardanoSend } = await import("../src/ui/screens/CardanoSend");
const { MoveIn } = await import("../src/ui/screens/MoveIn");
const { Transfer } = await import("../src/ui/screens/Transfer");
const { Withdraw } = await import("../src/ui/screens/Withdraw");

const noop = () => undefined;
const SNEK = { policyId: "ab".repeat(28), assetName: "534e454b", quantity: "1000", decimals: 0, fingerprint: "" };
const HOSKY = { policyId: "cd".repeat(28), assetName: "484f534b59", quantity: "50", decimals: 0, fingerprint: "" };
const picked = { [tokenKey(SNEK)]: "" };

/** 100 ₳ and 1,000 of the token in three UTxOs, the one holding all of the token locked: the side a form is handed. */
const side = unlocked({ lovelace: "100000000", tokens: [SNEK], utxos: 3, locked: { lovelace: "2000000", tokens: [SNEK], utxos: 1 } });
const cardano = {
  ...side,
  addressesUsed: 1,
  staking: { registered: false, pool: null, drep: null, rewards: "0", deposit: "0" },
} as unknown as Parameters<typeof CardanoSend>[0]["cardano"];
const seedelf = { ...side, seedelfs: [] } as unknown as Parameters<typeof Transfer>[0]["seedelf"];

/** What a person reads of markup. */
const words = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
const page = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(PreferencesContext.Provider, { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } }, element),
    ),
  );
/** The line under Review that says why it waits, or "" for none. */
const why = (html: string) => words(html.match(/data-testid="review-wait">(.*?)<\/p>/)?.[1] ?? "");

describe("a token picked that the form can't pay with now (chunk 51, e9a#1)", () => {
  it("is the side Home hands a form: a token all locked isn't on it, and is named as picked but not held", () => {
    expect(side.tokens).toEqual([]);
    expect(pickedAway(side.tokens, picked)).toEqual([tokenKey(SNEK)]);
    // One the side holds isn't, nor is one the side holds part of.
    expect(pickedAway([SNEK, HOSKY], { ...picked, [tokenKey(HOSKY)]: "5" })).toEqual([]);
    expect(pickedAway([HOSKY], { ...picked, [tokenKey(HOSKY)]: "5" })).toEqual([tokenKey(SNEK)]);
  });

  it("says why under Review on each of the four forms, before anything the form asks for", () => {
    const said = t("review.why.tokenAway");
    expect(said).toBe("The token you picked is locked, or still on its way.");
    expect(why(page(createElement(CardanoSend, { cardano, picked, onCancel: noop, onSent: noop })))).toBe(said);
    expect(why(page(createElement(MoveIn, { cardano, picked, onCancel: noop, onSent: noop })))).toBe(said);
    expect(why(page(createElement(Transfer, { seedelf, picked, onCancel: noop, onSent: noop })))).toBe(said);
    expect(why(page(createElement(Withdraw, { seedelf, picked, onCancel: noop, onSent: noop })))).toBe(said);
    // The control: picked from a side that holds it, its own box is what's missing, as before.
    const held = { ...cardano, tokens: [SNEK] };
    expect(why(page(createElement(MoveIn, { cardano: held, picked, onCancel: noop, onSent: noop })))).toBe(t("review.why.tokens"));
  });

  it("holds the payment back once an amount is typed, rather than send it without the token", () => {
    const draft = { id: 0, to: "addr_test1qz", amount: "5", tokens: picked };
    const away = recipientAmounts("preprod", side.tokens, [draft], false);
    expect(away.ok).toBe(false);
    expect(away.each[0]!.away).toEqual([tokenKey(SNEK)]);
    expect(away.each[0]!.tokens.sent).toEqual([]);
    // With Max too: Max sends the tokens picked, and this one can't go.
    expect(recipientAmounts("preprod", side.tokens, [draft], true).ok).toBe(false);
    // The control: the same payment with the token held is one Review takes.
    const held = recipientAmounts("preprod", [SNEK], [{ ...draft, tokens: { [tokenKey(SNEK)]: "5" } }], false);
    expect(held.ok).toBe(true);
    expect(held.each[0]!.away).toEqual([]);
  });

  it("counts only the tokens the form holds as picked, so the ADA is asked for when none is", () => {
    const ready = { to: "ok" as const, amount: "", tokensPicked: false, tokensOk: true };
    expect(waitingFor({ ...ready, tokensAway: true })).toBe("review.why.tokenAway");
    expect(waitingFor({ ...ready, to: "empty", tokensAway: true })).toBe("review.why.tokenAway");
    expect(waitingFor(ready)).toBe("review.why.amount");
    // Each recipient says whether it holds a picked token: one away isn't one held.
    const draft = { id: 0, to: "addr_test1qz", amount: "", tokens: picked };
    expect(recipientAmounts("preprod", side.tokens, [draft], false).each[0]!.picked).toBe(false);
    expect(recipientAmounts("preprod", [SNEK], [draft], false).each[0]!.picked).toBe(true);
  });
});
